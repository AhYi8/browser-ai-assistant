import type { ChatMessage, ChatSession, ChatTokenUsageEntry, ChatToolCallRecord, ModelConfig, PageContextExtractMode } from "../types";
import type { ModelRequestMessage } from "../models/types";
import { sumTokenUsages } from "./tokenUsage";
import type { ChatToolAttachmentsById } from "../toolArtifacts";
import { collectMessageToolAttachments, formatToolAttachmentForPromptSummary } from "../toolArtifacts";
import { truncateText } from "../utils/text";

export const DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT = 90;
export const CONTEXT_COMPRESSION_TOOL_ID = "chat.context_compression";
export const CONTEXT_COMPRESSION_TOOL_NAME = "context_compression";
export const CONTEXT_COMPRESSION_TOOL_DISPLAY_NAME = "上下文压缩";

export const DEFAULT_CONTEXT_COMPRESSION_PROMPT = [
  "你是聊天上下文压缩助手。请把下面即将被压缩的历史对话整理为一份可继续对话的中文上下文摘要。",
  "摘要必须保留：用户目标、关键事实、已确认结论、未解决问题、重要约束、工具结果、文件名/URL/代码标识、后续回答需要延续的偏好。",
  "摘要应删除寒暄、重复内容、失败尝试和无关细节；不得编造历史中没有的信息。",
  "请直接输出压缩后的上下文摘要，不要解释压缩过程。",
].join("\n");

export const APPROX_CHARS_PER_TOKEN = 2;
export const IMAGE_ATTACHMENT_TOKEN_ESTIMATE = 1000;
export const TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION = "请基于以上压缩上下文继续当前任务。";

export function getLatestContextSummaryIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.assistantMessageKind === "context_summary") {
      return index;
    }
  }

  return -1;
}

export function getMessagesFromLatestContextSummary(messages: ChatMessage[]): ChatMessage[] {
  const summaryIndex = getLatestContextSummaryIndex(messages);
  return summaryIndex >= 0 ? messages.slice(summaryIndex) : messages;
}

export function shouldCompressChatContext(input: {
  maxContextTokens: number;
  thresholdPercent?: number;
  systemPrompt: string;
  pageContext: string;
  messages: ChatMessage[];
  tokenUsageEntries?: ChatTokenUsageEntry[];
  toolAttachmentsById?: ChatToolAttachmentsById;
}): boolean {
  const thresholdPercent = normalizeContextCompressionThresholdPercent(input.thresholdPercent);
  return estimateChatContextTokens(input) >= Math.floor(input.maxContextTokens * (thresholdPercent / 100));
}

export function normalizeContextCompressionThresholdPercent(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT;
  }

  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT;
  }
  return Math.round(Math.min(100, Math.max(1, numberValue)));
}

export function estimateChatContextTokens(input: {
  maxContextTokens?: number;
  systemPrompt: string;
  pageContext: string;
  messages: ChatMessage[];
  tokenUsageEntries?: ChatTokenUsageEntry[];
  toolAttachmentsById?: ChatToolAttachmentsById;
}): number {
  const tokenUsageById = new Map((input.tokenUsageEntries ?? []).map((entry) => [entry.id, entry]));
  const scopedMessages = getMessagesFromLatestContextSummary(input.messages);
  const fixedTokens = estimateTextTokens(input.systemPrompt) + estimateTextTokens(input.pageContext);
  const localEstimate = fixedTokens + scopedMessages.reduce(
    (total, message) => total + estimateMessageContextTokens(message, tokenUsageById, input.toolAttachmentsById),
    0,
  );

  return Math.max(localEstimate, estimateContextTokensFromLatestResponseUsage(scopedMessages, tokenUsageById, input.toolAttachmentsById));
}

export function shouldCompressModelRequestContext(input: {
  maxContextTokens: number;
  thresholdPercent?: number;
  messages: ModelRequestMessage[];
}): boolean {
  const thresholdPercent = normalizeContextCompressionThresholdPercent(input.thresholdPercent);
  return estimateModelRequestContextTokens(input.messages) >= Math.floor(input.maxContextTokens * (thresholdPercent / 100));
}

export function estimateModelRequestContextTokens(messages: ModelRequestMessage[]): number {
  return messages.reduce((total, message) => total + estimateModelRequestMessageTokens(message), 0);
}

export function createToolLoopCompressionMessages(input: {
  model: ModelConfig;
  compressionPrompt: string;
  messages: ModelRequestMessage[];
}): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: `system-${now}-tool-loop-context-compression`,
      role: "system",
      content: input.compressionPrompt.trim() || DEFAULT_CONTEXT_COMPRESSION_PROMPT,
      createdAt: now,
      modelId: input.model.id,
      endpointType: input.model.endpointType,
      streamMode: false,
      systemPrompt: input.compressionPrompt,
      contextPrompt: "",
      contextMode: "text",
    },
    {
      id: `user-${now}-tool-loop-context-compression`,
      role: "user",
      content: formatModelRequestMessagesForCompression(input.messages),
      createdAt: now,
      modelId: input.model.id,
      endpointType: input.model.endpointType,
      streamMode: false,
      systemPrompt: input.compressionPrompt,
      contextPrompt: "",
      contextMode: "text",
    },
  ];
}

export function createCompressedToolLoopMessages(input: {
  messages: ModelRequestMessage[];
  summaryMessage: ChatMessage;
  maxContextTokens?: number;
  thresholdPercent?: number;
}): ModelRequestMessage[] {
  const systemMessages = input.messages.filter((message) => message.role === "system");
  const continueMessage: ModelRequestMessage = {
    role: "user",
    content: TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION,
  };
  const recentUserMessages = createRecentUserExcerptMessages({
    userMessages: getRecentUserMessages(input.messages),
    systemMessages,
    summaryMessage: input.summaryMessage,
    continueMessage,
    maxContextTokens: input.maxContextTokens,
    thresholdPercent: input.thresholdPercent,
  });
  return [
    ...systemMessages,
    input.summaryMessage,
    ...recentUserMessages,
    continueMessage,
  ];
}

export function createContextSummaryMessage(input: {
  content: string;
  createdAt: number;
  model: Pick<ModelConfig, "id" | "endpointType">;
  systemPrompt: string;
  contextMode: PageContextExtractMode;
  tokenUsageEntries?: ChatTokenUsageEntry[];
}): ChatMessage {
  return {
    id: `message-${input.createdAt}-context-summary`,
    role: "assistant",
    assistantMessageKind: "context_summary",
    content: input.content.trim(),
    createdAt: input.createdAt,
    modelId: input.model.id,
    endpointType: input.model.endpointType,
    streamMode: false,
    systemPrompt: input.systemPrompt,
    contextPrompt: "",
    contextMode: input.contextMode,
    tokenUsageEntryIds: input.tokenUsageEntries?.map((entry) => entry.id),
  };
}

export function createContextCompressionToolTurnMessage(input: {
  id: string;
  record: ChatToolCallRecord;
  createdAt: number;
  model: Pick<ModelConfig, "id" | "endpointType">;
  systemPrompt: string;
  contextMode: PageContextExtractMode;
}): ChatMessage {
  return {
    id: input.id,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: "",
    createdAt: input.createdAt,
    modelId: input.model.id,
    endpointType: input.model.endpointType,
    streamMode: false,
    systemPrompt: input.systemPrompt,
    contextPrompt: "",
    contextMode: input.contextMode,
    toolCallRecords: [input.record],
  };
}

export function createContextCompressionToolCallRecord(input: {
  id: string;
  status: ChatToolCallRecord["status"];
  startedAt: number;
  completedAt?: number;
  arguments?: Record<string, unknown>;
  resultSummary?: string;
  errorMessage?: string;
}): ChatToolCallRecord {
  return {
    id: input.id,
    toolId: CONTEXT_COMPRESSION_TOOL_ID,
    name: CONTEXT_COMPRESSION_TOOL_NAME,
    displayName: CONTEXT_COMPRESSION_TOOL_DISPLAY_NAME,
    arguments: input.arguments ?? {},
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.resultSummary ? { resultSummary: input.resultSummary } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}

export function createContextCompressionMessages(input: {
  model: ModelConfig;
  compressionPrompt: string;
  messages: ChatMessage[];
  toolAttachmentsById?: ChatToolAttachmentsById;
}): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: `system-${now}-context-compression`,
      role: "system",
      content: input.compressionPrompt.trim() || DEFAULT_CONTEXT_COMPRESSION_PROMPT,
      createdAt: now,
      modelId: input.model.id,
      endpointType: input.model.endpointType,
      streamMode: false,
      systemPrompt: input.compressionPrompt,
      contextPrompt: "",
      contextMode: "text",
    },
    {
      id: `user-${now}-context-compression`,
      role: "user",
      content: formatMessagesForCompression(input.messages, input.toolAttachmentsById),
      createdAt: now,
      modelId: input.model.id,
      endpointType: input.model.endpointType,
      streamMode: false,
      systemPrompt: input.compressionPrompt,
      contextPrompt: "",
      contextMode: "text",
    },
  ];
}

function estimateMessageContextTokens(
  message: ChatMessage,
  tokenUsageById: Map<string, ChatTokenUsageEntry>,
  toolAttachmentsById?: ChatToolAttachmentsById,
): number {
  const boundUsage = message.tokenUsageEntryIds
    ?.map((id) => tokenUsageById.get(id))
    .filter((entry): entry is ChatTokenUsageEntry => Boolean(entry));
  if (message.role === "assistant" && boundUsage?.length) {
    const usage = sumTokenUsages(boundUsage);
    // response usage 的 input/cacheRead 覆盖了当次请求整体上下文，绑定到单条 assistant 消息时不能再次累加，避免重复估算历史输入。
    return usage.outputTokens + usage.cacheWriteTokens;
  }

  return estimateTextTokens(formatMessageForBudget(message, toolAttachmentsById)) + estimateImageAttachmentTokens(message);
}

function estimateModelRequestMessageTokens(message: ModelRequestMessage): number {
  const imageTokens = "attachments" in message ? estimateImageAttachmentTokens(message) : 0;
  return estimateTextTokens(formatModelRequestMessageForBudget(message)) + imageTokens;
}

function getRecentUserMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  const recentMessages: ModelRequestMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || !message.content.trim() || message.content === TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION) {
      continue;
    }
    recentMessages.push(message);
    if (recentMessages.length >= 2) {
      break;
    }
  }
  return recentMessages.reverse();
}

function createRecentUserExcerptMessages(input: {
  userMessages: ModelRequestMessage[];
  systemMessages: ModelRequestMessage[];
  summaryMessage: ChatMessage;
  continueMessage: ModelRequestMessage;
  maxContextTokens?: number;
  thresholdPercent?: number;
}): ModelRequestMessage[] {
  if (!input.userMessages.length) {
    return [];
  }
  if (!input.maxContextTokens) {
    return input.userMessages;
  }

  const thresholdPercent = normalizeContextCompressionThresholdPercent(input.thresholdPercent);
  const thresholdTokens = Math.floor(input.maxContextTokens * (thresholdPercent / 100));
  const selectedMessages: ModelRequestMessage[] = [];
  for (let index = input.userMessages.length - 1; index >= 0; index -= 1) {
    const userMessage = input.userMessages[index];
    const reservedTokens = estimateModelRequestContextTokens([
      ...input.systemMessages,
      input.summaryMessage,
      ...selectedMessages,
      input.continueMessage,
    ]);
    // 触发判断使用 >= 阈值，摘录预算需要预留 1 token，避免压缩后刚好等于阈值又被判定为超阈值。
    const availableTokens = thresholdTokens - reservedTokens - 1;
    if (availableTokens <= 0) {
      break;
    }
    if (estimateModelRequestMessageTokens(userMessage) <= availableTokens) {
      selectedMessages.unshift(userMessage);
      continue;
    }

    const prefix = "最近用户任务摘录：\n";
    const availableContentTokens = availableTokens - estimateTextTokens(prefix);
    if (availableContentTokens <= 0) {
      break;
    }
    selectedMessages.unshift({
      role: "user",
      content: `${prefix}${truncateText(userMessage.content, availableContentTokens * APPROX_CHARS_PER_TOKEN).text}`,
    });
  }

  return selectedMessages;
}

function estimateContextTokensFromLatestResponseUsage(
  messages: ChatMessage[],
  tokenUsageById: Map<string, ChatTokenUsageEntry>,
  toolAttachmentsById?: ChatToolAttachmentsById,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entries = getContextWindowUsageEntries(messages[index], tokenUsageById);
    if (!entries.length) {
      continue;
    }

    const usage = sumTokenUsages(entries);
    const requestContextTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    const assistantOutputTokens = usage.outputTokens;
    const laterMessagesTokens = messages
      .slice(index + 1)
      .reduce((total, message) => total + estimateMessageContextTokens(message, tokenUsageById, toolAttachmentsById), 0);
    return requestContextTokens + assistantOutputTokens + laterMessagesTokens;
  }

  return 0;
}

function getContextWindowUsageEntries(message: ChatMessage | undefined, tokenUsageById: Map<string, ChatTokenUsageEntry>): ChatTokenUsageEntry[] {
  if (message?.role !== "assistant") {
    return [];
  }

  return (message.tokenUsageEntryIds ?? [])
    .map((id) => tokenUsageById.get(id))
    .filter((entry): entry is ChatTokenUsageEntry => {
      if (!entry) {
        return false;
      }
      return entry.source === "chat" || entry.source === "tool_final";
    });
}

export function estimateTextTokens(value: string): number {
  return Math.ceil(value.trim().length / APPROX_CHARS_PER_TOKEN);
}

export function estimateImageAttachmentTokens(message: Pick<ChatMessage, "attachments">): number {
  return (message.attachments?.length ?? 0) * IMAGE_ATTACHMENT_TOKEN_ESTIMATE;
}

function formatMessageForBudget(message: ChatMessage, toolAttachmentsById?: ChatToolAttachmentsById): string {
  const sections = [message.content, message.thinking, message.reasoningContent === message.thinking ? undefined : message.reasoningContent];
  if (message.promptInvocations?.length) {
    sections.push(...message.promptInvocations.map((prompt) => `${prompt.title}\n${prompt.contentSnapshot}`));
  }
  sections.push(
    ...collectMessageToolAttachments(message, toolAttachmentsById)
      .map((attachment) => formatToolAttachmentForPromptSummary(attachment))
      .filter((item): item is string => Boolean(item?.trim())),
  );
  return sections.filter((item): item is string => Boolean(item?.trim())).join("\n\n");
}

function formatModelRequestMessageForBudget(message: ModelRequestMessage): string {
  if (message.role === "tool") {
    // 工具循环的即时请求 payload 只发送 tool.content，不发送 toolAttachments；这里不能把附件再计入一次，否则 Tavily 等工具会被重复估算并过早触发压缩。
    return [
      `工具：${message.name}`,
      `调用 ID：${message.toolCallId}`,
      message.isError ? "状态：错误" : "状态：成功",
      message.content,
    ].filter(Boolean).join("\n");
  }

  if (message.role === "assistant" && "toolCalls" in message) {
    const toolCallsText = message.toolCalls
      .map((toolCall) => {
        const args = truncateText(safeStringify(toolCall.arguments), 1000).text;
        return [`工具调用：${toolCall.name}`, `调用 ID：${toolCall.id}`, args ? `参数：${args}` : "", toolCall.parseError ? `参数错误：${toolCall.parseError}` : ""]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    return [message.content, message.reasoningContent, toolCallsText].filter((item): item is string => Boolean(item?.trim())).join("\n\n");
  }

  if ("createdAt" in message && "modelId" in message) {
    return formatPersistedRequestMessageForBudget(message);
  }

  return message.content;
}

function formatPersistedRequestMessageForBudget(message: ChatMessage): string {
  // buildChatRequestMessages 会把历史工具附件展开到 assistant.content 中；工具循环即时估算只应按真实请求 payload 计一次。
  const sections = [message.content, message.thinking, message.reasoningContent === message.thinking ? undefined : message.reasoningContent];
  if (message.promptInvocations?.length) {
    sections.push(...message.promptInvocations.map((prompt) => `${prompt.title}\n${prompt.contentSnapshot}`));
  }
  return sections.filter((item): item is string => Boolean(item?.trim())).join("\n\n");
}

function formatModelRequestMessagesForCompression(messages: ModelRequestMessage[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message, index) => {
      const roleLabel = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "工具";
      return [`${index + 1}. ${roleLabel}`, formatModelRequestMessageForBudget(message)].join("\n").trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "[无法序列化的参数]";
  }
}

function formatMessagesForCompression(messages: ChatMessage[], toolAttachmentsById?: ChatToolAttachmentsById): string {
  const scopedMessages = getMessagesFromLatestContextSummary(messages);
  return scopedMessages
    .map((message, index) => {
      const roleLabel = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      const kindLabel = message.assistantMessageKind === "context_summary" ? "（上次压缩摘要）" : "";
      return [`${index + 1}. ${roleLabel}${kindLabel}`, formatMessageForBudget(message, toolAttachmentsById)].join("\n").trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}
