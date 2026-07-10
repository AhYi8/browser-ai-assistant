import { updateChatSession } from "../../shared/storage/repositories";
import { mergeTokenUsageEntries } from "../../shared/chat/tokenUsage";
import {
  collectRawMessageToolAttachments,
  mergeToolAttachmentsIntoStore,
  moveMessageToolAttachmentsToRefs,
  uniqueToolAttachmentIds,
} from "../../shared/toolArtifacts";
import type {
  ChatMessage,
  ChatContextEstimate,
  ChatImageAttachment,
  ChatNetworkContextAttachment,
  ChatPromptInvocation,
  ChatTokenUsageEntry,
  ChatToolAttachment,
  ChatToolCallRecord,
  EndpointType,
  PageContextExtractMode,
} from "../../shared/types";
import type { AppChatSendMessage, AppState, ChatRetryProgress, StoreSetter } from "./appStore";
import { upsertSession } from "./appStoreSessionUtils";

const STREAM_FAILURE_MESSAGE = "流式响应异常中断，请重新生成后重试";
const STREAM_CANCELED_MESSAGE = "已终止本次生成。";

type ChatStreamPortMessage =
  | { type: "chunk"; content: string }
  | { type: "thinking"; content: string }
  | { type: "follow-up:consumed"; followUpId: string }
  | { type: "retry:progress"; currentRetry: number; maxRetries: number }
  | { type: "assistant:final-start" }
  | { type: "context:estimate"; estimate: ChatContextEstimate }
  | { type: "token_usage"; tokenUsageEntries?: ChatTokenUsageEntry[] }
  | { type: "assistant:tool-turn"; message: ChatMessage }
  | { type: "assistant:context-summary"; message: ChatMessage }
  | { type: "tool:start"; record: ChatToolCallRecord }
  | { type: "tool:complete"; record: ChatToolCallRecord; attachments?: ChatToolAttachment[] }
  | {
      type: "complete";
      content: string;
      thinking?: string;
      reasoningContent?: string;
      toolCallRecords?: ChatToolCallRecord[];
      toolAttachments?: ChatToolAttachment[];
      toolTurnMessages?: ChatMessage[];
      tokenUsageEntries?: ChatTokenUsageEntry[];
    }
  | { type: "error"; message?: string };

interface StreamingChatResult {
  completed: boolean;
  assistantContent?: string;
  canceled?: boolean;
  failed?: boolean;
  unconsumedFollowUpIds?: string[];
}

export type PortChatMessageResult =
  | { ok: true; content: string; tokenUsageEntries?: ChatTokenUsageEntry[] }
  | { ok: false; message: string; canceled?: boolean };

interface StreamingChatInput {
  set: StoreSetter;
  sessionId: string;
  modelId: string;
  endpointType: EndpointType;
  systemPrompt: string;
  contextPrompt: string;
  contextMode: PageContextExtractMode;
  matchedRuleId?: string;
  privateMode?: boolean;
  networkContextAttachment?: ChatNetworkContextAttachment;
  streamMode: boolean;
  toolAttachments?: ChatToolAttachment[];
  toolDetailPoolKeepLimit?: number;
  request: AppChatSendMessage;
  onAbortHandle?: (handle: () => void) => void;
  onFollowUpHandle?: (handle: (followUp: {
    id: string;
    content: string;
    attachments?: ChatImageAttachment[];
    promptInvocations?: ChatPromptInvocation[];
    userMessageId?: string;
  }) => void) => void;
  onFollowUpConsumed?: (followUpId: string) => void;
  shouldShowFailure?: () => boolean;
}

type AssistantPlaceholderInput = Omit<StreamingChatInput, "request">;

export async function sendPortChatMessage(input: {
  request: AppChatSendMessage;
  onAbortHandle?: (handle: () => void) => void;
}): Promise<PortChatMessageResult | undefined> {
  if (!globalThis.chrome?.runtime?.connect) {
    return undefined;
  }

  return new Promise<PortChatMessageResult>((resolve) => {
    const port = globalThis.chrome.runtime.connect({ name: "chat.stream" });
    let settled = false;
    let canceledByUser = false;
    let pendingTokenUsageEntries: ChatTokenUsageEntry[] | undefined;
    const finish = (result: PortChatMessageResult, options: { disconnect: boolean } = { disconnect: true }) => {
      if (settled) {
        return;
      }

      settled = true;
      if (options.disconnect) {
        port.disconnect();
      }
      resolve(result);
    };

    input.onAbortHandle?.(() => {
      if (settled) {
        return;
      }

      canceledByUser = true;
      port.disconnect();
    });

    port.onMessage.addListener((message: ChatStreamPortMessage) => {
      if (message.type === "token_usage") {
        pendingTokenUsageEntries = mergeTokenUsageEntries(pendingTokenUsageEntries, message.tokenUsageEntries);
        return;
      }

      if (message.type === "complete") {
        finish({
          ok: true,
          content: message.content,
          tokenUsageEntries: mergeTokenUsageEntries(pendingTokenUsageEntries, message.tokenUsageEntries),
        });
        return;
      }

      if (message.type === "error") {
        finish({ ok: false, message: resolveStreamPortFailureMessage(message) });
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) {
        return;
      }

      if (canceledByUser) {
        finish({ ok: false, message: STREAM_CANCELED_MESSAGE, canceled: true }, { disconnect: false });
        return;
      }

      finish({ ok: false, message: STREAM_FAILURE_MESSAGE }, { disconnect: false });
    });

    port.postMessage({
      type: "chat.stream.start",
      payload: input.request,
    });
  });
}

async function appendChatMessageToSession(
  sessionId: string,
  chatMessage: ChatMessage,
  set: StoreSetter,
  privateMode = false,
  toolDetailPoolKeepLimit?: number,
): Promise<ChatMessage | undefined> {
  const normalizedMessage = moveMessageToolAttachmentsToRefs(chatMessage);
  const messageToolAttachments = collectRawMessageToolAttachments(chatMessage);
  const nextToolAttachmentsById = mergeToolAttachmentsIntoStore(undefined, messageToolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit });
  if (privateMode) {
    set((current) => {
      const currentSession = current.privateChatSession;
      if (!current.privateModeActive || !currentSession || currentSession.id !== sessionId) {
        return {};
      }

      return {
        privateChatSession: {
          ...currentSession,
          updatedAt: normalizedMessage.createdAt,
          toolAttachmentsById: mergeToolAttachmentsIntoStore(currentSession.toolAttachmentsById, messageToolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
          messages: [...currentSession.messages, normalizedMessage],
        },
      };
    });
    return normalizedMessage;
  }

  const initializedSession = await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: normalizedMessage.createdAt,
    toolAttachmentsById: mergeToolAttachmentsIntoStore(latestSession.toolAttachmentsById, messageToolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
    messages: [...latestSession.messages, normalizedMessage],
  }));
  if (!initializedSession) {
    return undefined;
  }

  set((current) => {
    const currentSession = current.chatSessions.find((session) => session.id === initializedSession.id);
    if (!currentSession) {
      return {};
    }

    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...currentSession,
        updatedAt: normalizedMessage.createdAt,
        toolAttachmentsById: mergeToolAttachmentsIntoStore(currentSession.toolAttachmentsById, Object.values(nextToolAttachmentsById ?? {}), { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
        messages: [...currentSession.messages, normalizedMessage],
      }),
    };
  });

  return normalizedMessage;
}

async function appendAssistantMessageToSession(
  sessionId: string,
  assistantMessage: ChatMessage,
  set: StoreSetter,
  privateMode = false,
  toolDetailPoolKeepLimit?: number,
): Promise<ChatMessage | undefined> {
  return appendChatMessageToSession(sessionId, assistantMessage, set, privateMode, toolDetailPoolKeepLimit);
}

async function createAssistantPlaceholder(input: AssistantPlaceholderInput): Promise<ChatMessage | undefined> {
  const assistantCreatedAt = Date.now();
  const assistantMessage: ChatMessage = {
    id: `message-${assistantCreatedAt}-assistant`,
    role: "assistant",
    content: "",
    createdAt: assistantCreatedAt,
    modelId: input.modelId,
    endpointType: input.endpointType,
    streamMode: input.streamMode,
    systemPrompt: input.systemPrompt,
    contextPrompt: input.contextPrompt,
    contextMode: input.contextMode,
    matchedRuleId: input.matchedRuleId,
    networkContextAttachment: input.networkContextAttachment,
    toolAttachments: input.toolAttachments,
    streaming: true,
  };

  return appendAssistantMessageToSession(input.sessionId, assistantMessage, input.set, input.privateMode, input.toolDetailPoolKeepLimit);
}

export async function sendStreamingChatMessage(input: StreamingChatInput): Promise<StreamingChatResult> {
  if (!globalThis.chrome?.runtime?.connect) {
    return { completed: false };
  }

  const usesTools = Boolean(input.request.enabledToolIds?.length);
  let assistantMessage: ChatMessage | undefined = usesTools ? undefined : await createAssistantPlaceholder(input);
  let currentToolTurnMessageId: string | undefined;
  let pendingRetryProgress: ChatRetryProgress | undefined;
  if (!usesTools && !assistantMessage) {
    return { completed: true };
  }

  return new Promise<StreamingChatResult>((resolve) => {
    const port = globalThis.chrome.runtime.connect({ name: "chat.stream" });
    let settled = false;
    let receivedFinalComplete = false;
    let canceledByUser = false;
    let pendingTokenUsageEntries: ChatTokenUsageEntry[] | undefined;
    const pendingFollowUpIds = new Set<string>();
    let writeQueue = Promise.resolve();

    const finish = (result: StreamingChatResult, options: { disconnect: boolean } = { disconnect: true }) => {
      if (settled) {
        return;
      }

      settled = true;
      clearActiveContextEstimateInState(input.sessionId, input.set);
      if (options.disconnect) {
        port.disconnect();
      }
      resolve(result);
    };
    input.onAbortHandle?.(() => {
      if (settled) {
        return;
      }
      if (receivedFinalComplete) {
        return;
      }

      canceledByUser = true;
      port.disconnect();
    });
    input.onFollowUpHandle?.((followUp) => {
      if (settled || receivedFinalComplete) {
        return;
      }

      pendingFollowUpIds.add(followUp.id);
      port.postMessage({
        type: "chat.stream.followUp",
        payload: {
          followUpId: followUp.id,
          content: followUp.content,
          attachments: followUp.attachments,
          promptInvocations: followUp.promptInvocations,
          userMessageId: followUp.userMessageId,
        },
      });
    });
    const enqueueWrite = (operation: () => Promise<void>) => {
      writeQueue = writeQueue.then(operation).catch(() => {
        if (input.shouldShowFailure?.() ?? true) {
          input.set({ failure: { message: "消息保存失败，请重试" } });
        }
      });
      return writeQueue;
    };
    const ensureFinalAssistantMessage = async (): Promise<ChatMessage | undefined> => {
      if (assistantMessage) {
        return assistantMessage;
      }

      assistantMessage = await createAssistantPlaceholder(input);
      if (assistantMessage && pendingRetryProgress) {
        updateAssistantRetryProgress(assistantMessage.id, pendingRetryProgress, input.set);
      }
      return assistantMessage;
    };
    const clearPendingRetryProgress = () => {
      pendingRetryProgress = undefined;
      if (assistantMessage) {
        clearAssistantRetryProgress(assistantMessage.id, input.set);
      }
    };

    port.onMessage.addListener((message: ChatStreamPortMessage) => {
      if (message.type === "chunk") {
        void enqueueWrite(async () => {
          const finalAssistantMessage = await ensureFinalAssistantMessage();
          if (finalAssistantMessage) {
            clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
            await appendAssistantChunk(input.sessionId, finalAssistantMessage.id, message.content, input.set, input.privateMode);
          }
        });
        return;
      }

      if (message.type === "thinking") {
        void enqueueWrite(async () => {
          const finalAssistantMessage = await ensureFinalAssistantMessage();
          if (finalAssistantMessage) {
            clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
            await appendAssistantThinkingChunk(input.sessionId, finalAssistantMessage.id, message.content, input.set, input.privateMode);
          }
        });
        return;
      }

      if (message.type === "follow-up:consumed") {
        if (typeof message.followUpId === "string") {
          pendingFollowUpIds.delete(message.followUpId);
          input.onFollowUpConsumed?.(message.followUpId);
        }
        return;
      }

      if (message.type === "retry:progress") {
        void enqueueWrite(async () => {
          if (!isValidRetryProgress(message)) {
            return;
          }
          pendingRetryProgress = {
            currentRetry: message.currentRetry,
            maxRetries: message.maxRetries,
          };
          if (assistantMessage) {
            updateAssistantRetryProgress(assistantMessage.id, pendingRetryProgress, input.set);
          }
        });
        return;
      }

      if (message.type === "assistant:final-start") {
        void enqueueWrite(async () => {
          await ensureFinalAssistantMessage();
        });
        return;
      }

      if (message.type === "context:estimate") {
        setActiveContextEstimateInState(input.sessionId, message.estimate, input.set);
        return;
      }

      if (message.type === "token_usage") {
        void enqueueWrite(async () => {
          pendingTokenUsageEntries = mergeTokenUsageEntries(pendingTokenUsageEntries, message.tokenUsageEntries);
          previewTokenUsageEntriesInState(input.sessionId, pendingTokenUsageEntries, input.set, input.privateMode);
        });
        return;
      }

      if (message.type === "assistant:tool-turn") {
        void enqueueWrite(async () => {
          clearPendingRetryProgress();
          const storedMessage = await appendAssistantMessageToSession(input.sessionId, message.message, input.set, input.privateMode, input.request.toolDetailPoolKeepLimit);
          currentToolTurnMessageId = storedMessage?.id;
        });
        return;
      }

      if (message.type === "assistant:context-summary") {
        void enqueueWrite(async () => {
          clearPendingRetryProgress();
          await appendAssistantMessageToSession(input.sessionId, message.message, input.set, input.privateMode, input.request.toolDetailPoolKeepLimit);
        });
        return;
      }

      if (message.type === "tool:start") {
        void enqueueWrite(async () => {
          clearPendingRetryProgress();
          if (currentToolTurnMessageId) {
            await upsertAssistantToolCallRecord(input.sessionId, currentToolTurnMessageId, message.record, [], input.set, input.privateMode, input.request.toolDetailPoolKeepLimit);
          }
        });
        return;
      }

      if (message.type === "tool:complete") {
        void enqueueWrite(async () => {
          clearPendingRetryProgress();
          if (currentToolTurnMessageId) {
            await upsertAssistantToolCallRecord(input.sessionId, currentToolTurnMessageId, message.record, message.attachments ?? [], input.set, input.privateMode, input.request.toolDetailPoolKeepLimit);
          }
        });
        return;
      }

      if (message.type === "complete") {
        receivedFinalComplete = true;
        void enqueueWrite(async () => {
          const finalAssistantMessage = await ensureFinalAssistantMessage();
          if (!finalAssistantMessage) {
            return;
          }
          pendingRetryProgress = undefined;
          clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
          await finalizeAssistantMessage(input.sessionId, finalAssistantMessage.id, message.content, message.thinking, input.set, input.privateMode, {
            reasoningContent: message.reasoningContent,
            toolAttachments: mergeToolAttachments(input.toolAttachments, message.toolAttachments),
            tokenUsageEntries: mergeTokenUsageEntries(pendingTokenUsageEntries, message.tokenUsageEntries),
          }, input.request.toolDetailPoolKeepLimit);
        }).then(() => finish({ completed: true, assistantContent: message.content, unconsumedFollowUpIds: Array.from(pendingFollowUpIds) }));
        return;
      }

      const failureMessage = resolveStreamPortFailureMessage(message);
      if (input.shouldShowFailure?.() ?? true) {
        input.set({ failure: { message: failureMessage } });
      }
      void enqueueWrite(async () => {
        const finalAssistantMessage = await ensureFinalAssistantMessage();
          if (finalAssistantMessage) {
            pendingRetryProgress = undefined;
            clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
            await failAssistantMessage(input.sessionId, finalAssistantMessage.id, failureMessage, input.set, input.privateMode, pendingTokenUsageEntries);
          }
        }).then(() => finish({ completed: true, failed: true, unconsumedFollowUpIds: Array.from(pendingFollowUpIds) }));
    });

    port.onDisconnect.addListener(() => {
      if (receivedFinalComplete) {
        finish({ completed: true }, { disconnect: false });
        return;
      }

      if (canceledByUser) {
        void enqueueWrite(async () => {
          if (settled || receivedFinalComplete) {
            return;
          }
          const finalAssistantMessage = await ensureFinalAssistantMessage();
          if (finalAssistantMessage) {
            pendingRetryProgress = undefined;
            clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
            await failAssistantMessage(input.sessionId, finalAssistantMessage.id, STREAM_CANCELED_MESSAGE, input.set, input.privateMode, pendingTokenUsageEntries);
          }
        }).then(() => finish({ completed: true, canceled: true, unconsumedFollowUpIds: Array.from(pendingFollowUpIds) }, { disconnect: false }));
        return;
      }

      if (input.shouldShowFailure?.() ?? true) {
        input.set({ failure: { message: STREAM_FAILURE_MESSAGE } });
      }
      void enqueueWrite(async () => {
        const finalAssistantMessage = await ensureFinalAssistantMessage();
        if (finalAssistantMessage) {
          pendingRetryProgress = undefined;
          clearAssistantRetryProgress(finalAssistantMessage.id, input.set);
          await failAssistantMessage(input.sessionId, finalAssistantMessage.id, STREAM_FAILURE_MESSAGE, input.set, input.privateMode, pendingTokenUsageEntries);
        }
      }).then(() => finish({ completed: true, failed: true, unconsumedFollowUpIds: Array.from(pendingFollowUpIds) }, { disconnect: false }));
    });

    port.postMessage({
      type: "chat.stream.start",
      payload: input.request,
    });
  });
}

function previewTokenUsageEntriesInState(
  sessionId: string,
  tokenUsageEntries: ChatTokenUsageEntry[] | undefined,
  set: StoreSetter,
  privateMode = false,
): void {
  if (!tokenUsageEntries?.length) {
    return;
  }

  if (privateMode) {
    set((current) => {
      const session = current.privateChatSession;
      if (!current.privateModeActive || !session || session.id !== sessionId) {
        return {};
      }

      return {
        privateChatSession: {
          ...session,
          tokenUsageEntries: mergeTokenUsageEntries(session.tokenUsageEntries, tokenUsageEntries),
        },
      };
    });
    return;
  }

  set((current) => {
    const session = current.chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return {};
    }

    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...session,
        tokenUsageEntries: mergeTokenUsageEntries(session.tokenUsageEntries, tokenUsageEntries),
      }),
    };
  });
}

function setActiveContextEstimateInState(sessionId: string, estimate: ChatContextEstimate, set: StoreSetter): void {
  set((current) => ({
    activeContextEstimateBySessionId: {
      ...current.activeContextEstimateBySessionId,
      [sessionId]: estimate,
    },
  }));
}

function clearActiveContextEstimateInState(sessionId: string, set: StoreSetter): void {
  set((current) => {
    if (!current.activeContextEstimateBySessionId[sessionId]) {
      return {};
    }

    const nextEstimates = { ...current.activeContextEstimateBySessionId };
    delete nextEstimates[sessionId];
    return { activeContextEstimateBySessionId: nextEstimates };
  });
}

function removePreviewTokenUsageEntries(
  sessionId: string,
  tokenUsageEntries: ChatTokenUsageEntry[] | undefined,
  set: StoreSetter,
  privateMode = false,
): void {
  if (!tokenUsageEntries?.length) {
    return;
  }

  const pendingIds = new Set(tokenUsageEntries.map((entry) => entry.id));
  if (privateMode) {
    set((current) => {
      const session = current.privateChatSession;
      if (!current.privateModeActive || !session || session.id !== sessionId) {
        return {};
      }

      const nextTokenUsageEntries = session.tokenUsageEntries?.filter((entry) => !pendingIds.has(entry.id));
      return {
        privateChatSession: {
          ...session,
          tokenUsageEntries: nextTokenUsageEntries?.length ? nextTokenUsageEntries : undefined,
        },
      };
    });
    return;
  }

  set((current) => {
    const session = current.chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return {};
    }

    const nextTokenUsageEntries = session.tokenUsageEntries?.filter((entry) => !pendingIds.has(entry.id));
    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...session,
        tokenUsageEntries: nextTokenUsageEntries?.length ? nextTokenUsageEntries : undefined,
      }),
    };
  });
}

function updateAssistantRetryProgress(messageId: string, progress: ChatRetryProgress, set: StoreSetter): void {
  if (!isValidRetryProgress(progress)) {
    return;
  }

  set((current) => ({
    chatRetryProgressByMessageId: {
      ...current.chatRetryProgressByMessageId,
      [messageId]: {
        currentRetry: progress.currentRetry,
        maxRetries: progress.maxRetries,
      },
    },
  }));
}

function clearAssistantRetryProgress(messageId: string, set: StoreSetter): void {
  set((current) => {
    if (!current.chatRetryProgressByMessageId[messageId]) {
      return {};
    }

    const nextProgress = { ...current.chatRetryProgressByMessageId };
    delete nextProgress[messageId];
    return { chatRetryProgressByMessageId: nextProgress };
  });
}

function isValidRetryProgress(progress: ChatRetryProgress): boolean {
  return (
    Number.isInteger(progress.currentRetry) &&
    Number.isInteger(progress.maxRetries) &&
    progress.currentRetry >= 1 &&
    progress.maxRetries >= progress.currentRetry
  );
}

function resolveStreamPortFailureMessage(message: ChatStreamPortMessage): string {
  if (message.type !== "error" || typeof message.message !== "string") {
    return STREAM_FAILURE_MESSAGE;
  }

  const failureMessage = message.message.trim();
  if (!failureMessage || containsSensitiveErrorFragment(failureMessage)) {
    return STREAM_FAILURE_MESSAGE;
  }

  return failureMessage;
}

function containsSensitiveErrorFragment(message: string): boolean {
  // 端口消息异常时仍按外部输入处理，避免模型供应商原始报文把密钥、鉴权头或连接串带到用户可见错误里。
  return /(?:\bsk-[A-Za-z0-9_-]+|authorization|bearer\s+[A-Za-z0-9._~+/-]+|\btoken\b|secret|password)/i.test(message);
}

async function failAssistantMessage(
  sessionId: string,
  messageId: string,
  failureMessage: string,
  set: StoreSetter,
  privateMode = false,
  tokenUsageEntriesToDiscard?: ChatTokenUsageEntry[],
): Promise<void> {
  const applyFailure = (message: ChatMessage): ChatMessage => {
    const content = message.content.trim() ? `${message.content}\n\n${failureMessage}` : failureMessage;
    return {
      ...message,
      content,
      streaming: false,
    };
  };

  if (privateMode) {
    set((current) => updatePrivateAssistantMessageInState(current, sessionId, messageId, applyFailure));
    removePreviewTokenUsageEntries(sessionId, tokenUsageEntriesToDiscard, set, privateMode);
    return;
  }

  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: Date.now(),
    messages: latestSession.messages.map((message) => (message.id === messageId ? applyFailure(message) : message)),
  }));

  set((current) => updateAssistantMessageInState(current, sessionId, messageId, applyFailure));
  removePreviewTokenUsageEntries(sessionId, tokenUsageEntriesToDiscard, set, privateMode);
}

async function appendAssistantThinkingChunk(sessionId: string, messageId: string, content: string, set: StoreSetter, privateMode = false): Promise<void> {
  if (privateMode) {
    set((current) =>
      updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...message,
        thinking: `${message.thinking ?? ""}${content}`,
      })),
    );
    return;
  }

  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    messages: latestSession.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            thinking: `${message.thinking ?? ""}${content}`,
          }
        : message,
    ),
  }));

  set((current) =>
    updateAssistantMessageInState(current, sessionId, messageId, (message) => ({
      ...message,
      thinking: `${message.thinking ?? ""}${content}`,
    })),
  );
}

async function appendAssistantChunk(sessionId: string, messageId: string, content: string, set: StoreSetter, privateMode = false): Promise<void> {
  if (privateMode) {
    set((current) =>
      updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...message,
        content: `${message.content}${content}`,
      })),
    );
    return;
  }

  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    messages: latestSession.messages.map((message) =>
      message.id === messageId ? { ...message, content: `${message.content}${content}` } : message,
    ),
  }));

  set((current) =>
    updateAssistantMessageInState(current, sessionId, messageId, (message) => ({
      ...message,
      content: `${message.content}${content}`,
    })),
  );
}

async function upsertAssistantToolCallRecord(
  sessionId: string,
  messageId: string,
  record: ChatToolCallRecord,
  attachments: ChatToolAttachment[],
  set: StoreSetter,
  privateMode = false,
  toolDetailPoolKeepLimit?: number,
): Promise<void> {
  const applyToolUpdate = (message: ChatMessage): ChatMessage => ({
    ...moveMessageToolAttachmentsToRefs(message),
    toolCallRecords: upsertToolCallRecord(message.toolCallRecords, record),
    toolAttachmentIds: uniqueToolAttachmentIds([...(message.toolAttachmentIds ?? []), ...attachments.map((attachment) => attachment.id)]),
  });

  if (privateMode) {
    set((current) => {
      const session = current.privateChatSession;
      if (!current.privateModeActive || !session || session.id !== sessionId) {
        return {};
      }
      return {
        privateChatSession: {
          ...session,
          toolAttachmentsById: mergeToolAttachmentsIntoStore(session.toolAttachmentsById, attachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
          messages: session.messages.map((message) => (message.id === messageId ? applyToolUpdate(message) : message)),
        },
      };
    });
    return;
  }

  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: Date.now(),
    toolAttachmentsById: mergeToolAttachmentsIntoStore(latestSession.toolAttachmentsById, attachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
    messages: latestSession.messages.map((message) => (message.id === messageId ? applyToolUpdate(message) : message)),
  }));

  set((current) => {
    const session = current.chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return {};
    }
    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...session,
        toolAttachmentsById: mergeToolAttachmentsIntoStore(session.toolAttachmentsById, attachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
        messages: session.messages.map((message) => (message.id === messageId ? applyToolUpdate(message) : message)),
      }),
    };
  });
}

function upsertToolCallRecord(records: ChatToolCallRecord[] | undefined, record: ChatToolCallRecord): ChatToolCallRecord[] {
  const current = records ?? [];
  const existingIndex = current.findIndex((item) => item.id === record.id);
  if (existingIndex < 0) {
    return [...current, record];
  }

  return current.map((item, index) => (index === existingIndex ? { ...item, ...record } : item));
}

export function mergeToolAttachments(
  current: ChatToolAttachment[] | undefined,
  next: ChatToolAttachment[] | undefined,
): ChatToolAttachment[] | undefined {
  const merged: ChatToolAttachment[] = [];
  for (const attachment of [...(current ?? []), ...(next ?? [])]) {
    const existingIndex = merged.findIndex((item) => item.id === attachment.id);
    if (existingIndex >= 0) {
      merged[existingIndex] = attachment;
    } else {
      merged.push(attachment);
    }
  }

  return merged.length ? merged : undefined;
}

interface FinalizeAssistantOptions {
  reasoningContent?: string;
  toolCallRecords?: ChatToolCallRecord[];
  toolAttachments?: ChatToolAttachment[];
  tokenUsageEntries?: ChatTokenUsageEntry[];
}

async function finalizeAssistantMessage(
  sessionId: string,
  messageId: string,
  content: string,
  thinking: string | undefined,
  set: StoreSetter,
  privateMode = false,
  options: FinalizeAssistantOptions = {},
  toolDetailPoolKeepLimit?: number,
): Promise<void> {
  const nextTokenUsageEntryIds = options.tokenUsageEntries?.map((entry) => entry.id);
  if (privateMode) {
    set((current) => {
      const updated = updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...moveMessageToolAttachmentsToRefs(message),
        content,
        thinking,
        reasoningContent: options.reasoningContent ?? message.reasoningContent,
        toolCallRecords: options.toolCallRecords ?? message.toolCallRecords,
        toolAttachmentIds: uniqueToolAttachmentIds([...(message.toolAttachmentIds ?? []), ...(options.toolAttachments ?? []).map((attachment) => attachment.id)]),
        tokenUsageEntryIds: nextTokenUsageEntryIds ?? message.tokenUsageEntryIds,
        streaming: false,
      }));
      if (!updated.privateChatSession) {
        return updated;
      }
      return {
        ...updated,
        privateChatSession: {
          ...updated.privateChatSession,
          toolAttachmentsById: mergeToolAttachmentsIntoStore(updated.privateChatSession.toolAttachmentsById, options.toolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
          tokenUsageEntries: mergeTokenUsageEntries(updated.privateChatSession.tokenUsageEntries, options.tokenUsageEntries),
        },
      };
    });
    return;
  }

  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: Date.now(),
    tokenUsageEntries: mergeTokenUsageEntries(latestSession.tokenUsageEntries, options.tokenUsageEntries),
    toolAttachmentsById: mergeToolAttachmentsIntoStore(latestSession.toolAttachmentsById, options.toolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
    messages: latestSession.messages.map((message) =>
      message.id === messageId
        ? {
            ...moveMessageToolAttachmentsToRefs(message),
            content,
            thinking,
            reasoningContent: options.reasoningContent ?? message.reasoningContent,
            toolCallRecords: options.toolCallRecords ?? message.toolCallRecords,
            toolAttachmentIds: uniqueToolAttachmentIds([...(message.toolAttachmentIds ?? []), ...(options.toolAttachments ?? []).map((attachment) => attachment.id)]),
            tokenUsageEntryIds: nextTokenUsageEntryIds ?? message.tokenUsageEntryIds,
            streaming: false,
          }
        : message,
    ),
  }));

  set((current) =>
    updateAssistantMessageInState(
      current,
      sessionId,
      messageId,
      (message) => ({
        ...moveMessageToolAttachmentsToRefs(message),
        content,
        thinking,
        reasoningContent: options.reasoningContent ?? message.reasoningContent,
        toolCallRecords: options.toolCallRecords ?? message.toolCallRecords,
        toolAttachmentIds: uniqueToolAttachmentIds([...(message.toolAttachmentIds ?? []), ...(options.toolAttachments ?? []).map((attachment) => attachment.id)]),
        tokenUsageEntryIds: nextTokenUsageEntryIds ?? message.tokenUsageEntryIds,
        streaming: false,
      }),
      options.tokenUsageEntries,
      options.toolAttachments,
      toolDetailPoolKeepLimit,
    ),
  );
}

function updateAssistantMessageInState(
  state: AppState,
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
  tokenUsageEntries?: ChatTokenUsageEntry[],
  toolAttachments?: ChatToolAttachment[],
  toolDetailPoolKeepLimit?: number,
): Partial<AppState> {
  const session = state.chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    return {};
  }

  return {
    chatSessions: upsertSession(state.chatSessions, {
      ...session,
      messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
      tokenUsageEntries: mergeTokenUsageEntries(session.tokenUsageEntries, tokenUsageEntries),
      toolAttachmentsById: mergeToolAttachmentsIntoStore(session.toolAttachmentsById, toolAttachments, { detailPoolKeepLimit: toolDetailPoolKeepLimit }),
    }),
  };
}

function updatePrivateAssistantMessageInState(
  state: AppState,
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): Partial<AppState> {
  const session = state.privateChatSession;
  if (!state.privateModeActive || !session || session.id !== sessionId) {
    return {};
  }

  return {
    privateChatSession: {
      ...session,
      messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
    },
  };
}
