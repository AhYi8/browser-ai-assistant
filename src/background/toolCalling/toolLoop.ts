import { buildPromptExpandedUserContent } from "../../shared/chat/buildChatRequestMessages";
import {
  createCompressedToolLoopMessages,
  createContextCompressionToolCallRecord,
  createContextCompressionToolTurnMessage,
  createContextSummaryMessage,
  estimateModelRequestContextTokens,
  shouldCompressModelRequestContext,
  createToolLoopCompressionMessages,
  TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION,
} from "../../shared/chat/contextCompression";
import type { AutomationPlaybookSelection, ChatContextEstimate, ChatContextEstimatePhase, ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatTokenUsageEntry, ChatToolAttachment, ChatToolCallRecord, ModelConfig, PageContextExtractMode } from "../../shared/types";
import type { ModelRequestMessage, ModelResponseData, ModelToolCall, ModelToolExecutor, ModelToolRegistryEntry, ModelToolResultMessage } from "../../shared/models/types";
import { isBrowserAutomationToolId } from "../../shared/models/toolRegistry";
import { createAutomationReportToolAttachment } from "../../shared/toolArtifacts";
import { truncateText } from "../../shared/utils/text";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const CONTEXT_COMPRESSION_FAILURE_MESSAGE = "聊天上下文压缩失败，请稍后重试";
const CONTEXT_COMPRESSION_OVER_BUDGET_MESSAGE = "聊天上下文压缩后仍超过自动压缩阈值，请调大最大聊天上下文或缩短系统提示、页面上下文后重试";
const TOOL_RESULT_SUMMARIZATION_FAILURE_MESSAGE = "工具结果过长，摘要化后仍超过最大聊天上下文。请缩小工具读取范围或调大最大聊天上下文后重试。";
// token 阈值与字符阈值是 OR 关系；字符阈值用于没有真实 tokenizer 时对中文/长文本做保守兜底。
const LARGE_TOOL_RESULT_TOKEN_THRESHOLD = 8000;
const LARGE_TOOL_RESULT_CHAR_THRESHOLD = LARGE_TOOL_RESULT_TOKEN_THRESHOLD * 2;
const FINAL_RESPONSE_INSTRUCTION = [
  "工具调用阶段已经结束，当前请求不会再执行任何工具。",
  "请只基于上文用户问题和已经返回的工具结果，直接给出面向用户的最终中文答复。",
  "最终答复必须区分事实证据、模型推断和未验证假设：工具结果可作为事实证据，基于证据的判断要标明为模型推断，未被工具或用户确认的信息要标明为未验证假设。",
  "上一轮工具决策阶段的自然语言正文只作为过程参考，不要把其中的待办话术当作还会继续执行的计划。",
  "不要再声称将继续调用、测试或等待工具；如果信息不足，请明确说明已完成的部分和无法继续验证的原因。",
].join("\n");

const GUIDANCE_PREFIX = "用户在当前任务运行中补充了以下引导：";
const GUIDANCE_SUFFIX = "请在不丢弃已完成结果的前提下，优先依据该引导调整后续工具调用和最终回答。若引导与原目标冲突，说明采用了新的用户引导。";
const ACTIVE_GUIDANCE_PREFIX = "当前任务运行中的持续引导：";
const ACTIVE_GUIDANCE_SUFFIX = "以上引导在当前任务结束前持续有效，并且是当前任务的最高优先级覆盖约束。每次决定工具调用和最终回答时，都必须优先参考这些引导；若引导与原始任务冲突，必须以引导为准；若引导取消、缩小或改写了原始任务中的子目标，后续不得继续执行被取消或被排除的目标。不要回复确认、不要复述引导，直接继续工具决策或最终回答。";
const CURRENT_TASK_REMINDER_PREFIX = "当前必须优先处理的最新用户请求是：";
const CURRENT_TASK_REMINDER_SUFFIX = "请围绕这条最新请求决定是否调用工具和如何最终回答。除非最新请求明确要求继续旧任务，否则不要继续更早的历史任务。";
const CURRENT_TASK_GUIDANCE_SUFFIX = "当前任务存在运行中引导，引导是最高优先级覆盖约束；原始任务与引导冲突时必须以引导为准，被引导取消、缩小或排除的目标不得继续执行。";

interface GuidanceItem {
  id: string;
  content: string;
  attachments?: ChatImageAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  userMessageId?: string;
}

export interface ToolLoopContextCompressionOptions {
  model: ModelConfig;
  maxContextTokens: number;
  initialContextTokens?: number;
  thresholdPercent?: number;
  compressionPrompt: string;
  systemPrompt: string;
  contextMode: PageContextExtractMode;
  requestCompression: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
}

export interface RunModelToolLoopInput {
  initialMessages: ModelRequestMessage[];
  tools: ModelToolRegistryEntry[];
  enabledToolIds: string[];
  requestModel: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  requestFinalModel?: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  executeTool: ModelToolExecutor;
  automationPlaybookSelection?: AutomationPlaybookSelection;
  onToolTurnMessage?: (message: ChatMessage) => void;
  onContextSummaryMessage?: (message: ChatMessage) => void;
  onContextEstimate?: (estimate: ChatContextEstimate) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  consumeGuidance?: () => GuidanceItem[];
  onGuidanceConsumed?: (followUpId: string) => void;
  maxIterations?: number;
  signal?: AbortSignal;
  contextCompression?: ToolLoopContextCompressionOptions;
}

export type ModelToolLoopResponse =
  | ({ ok: true } & ModelResponseData)
  | {
      ok: false;
      message: string;
    };

export async function runModelToolLoop(input: RunModelToolLoopInput): Promise<ModelToolLoopResponse> {
  const maxIterations = Math.max(1, Math.floor(input.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS));
  const enabledToolIds = new Set(input.enabledToolIds);
  let messages = [...input.initialMessages];
  const toolCallRecords: ChatToolCallRecord[] = [];
  const toolAttachments: ChatToolAttachment[] = [];
  const toolTurnMessages: ChatMessage[] = [];
  const tokenUsageEntries: ChatTokenUsageEntry[] = [];
  const activeGuidanceItems: GuidanceItem[] = [];
  let lastResponse: ModelToolLoopResponse | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    collectActiveGuidanceItems(input, activeGuidanceItems);
    messages = appendCurrentTaskReminder(messages, activeGuidanceItems);
    let requestMessages = createRequestMessagesWithActiveGuidance(messages, activeGuidanceItems);
    const compressedForDecision = await maybeCompressToolLoopMessages({
      messages: requestMessages,
      input,
      toolTurnMessages,
      tokenUsageEntries,
      phase: "decision",
    });
    if (!compressedForDecision.ok) {
      return compressedForDecision;
    }
    requestMessages = compressedForDecision.messages === requestMessages
      ? requestMessages
      : createDecisionRequestMessagesAfterCompression(compressedForDecision.messages, activeGuidanceItems);
    messages = stripActiveGuidanceMessages(requestMessages);
    const response = await input.requestModel(requestMessages);
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    if (!response.ok) {
      return response;
    }
    tokenUsageEntries.push(...(response.tokenUsageEntries ?? []));

    if (!response.toolCalls?.length) {
      lastResponse = {
        ok: true,
        content: response.content,
        thinking: response.thinking,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
        ...(toolAttachments.length ? { toolAttachments } : {}),
        ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
        ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
      };
      break;
    }

    const currentTurnRecords: ChatToolCallRecord[] = [];
    const currentTurnAttachments: ChatToolAttachment[] = [];
    const toolTurnMessageId = createToolTurnMessageId(response.toolCalls[0]?.id);
    const toolDecisionResponse = {
      ...response,
      content: sanitizeToolDecisionContent(response.content, activeGuidanceItems),
    };
    input.onToolTurnMessage?.(
      createToolTurnMessage({
        id: toolTurnMessageId,
        initialMessages: input.initialMessages,
        response: toolDecisionResponse,
        toolCallRecords: [],
        toolAttachments: [],
      }),
    );
    const executeCurrentTool = (toolCall: ModelToolCall) =>
      executeAllowedTool(toolCall, input.tools, enabledToolIds, input.executeTool, {
        signal: input.signal,
        onStart: (record) => {
          toolCallRecords.push(record);
          currentTurnRecords.push(record);
          input.onToolCallStart?.(record);
        },
        onComplete: (record, attachments) => {
          const existingIndex = toolCallRecords.findIndex((item) => item.id === record.id);
          if (existingIndex >= 0) {
            toolCallRecords[existingIndex] = record;
          } else {
            toolCallRecords.push(record);
          }
          const currentTurnExistingIndex = currentTurnRecords.findIndex((item) => item.id === record.id);
          if (currentTurnExistingIndex >= 0) {
            currentTurnRecords[currentTurnExistingIndex] = record;
          } else {
            currentTurnRecords.push(record);
          }
          appendUniqueToolAttachments(toolAttachments, attachments);
          appendUniqueToolAttachments(currentTurnAttachments, attachments);
          input.onToolCallComplete?.(record, attachments);
        },
      });
    const hasBrowserAutomationToolCall = response.toolCalls.some((toolCall) => {
      const tool = input.tools.find((entry) => entry.name === toolCall.name || entry.id === toolCall.name);
      return tool ? isBrowserAutomationToolId(tool.id) : false;
    });
    const toolResultMessages: ModelToolResultMessage[] = [];
    if (hasBrowserAutomationToolCall) {
      // 浏览器自动化工具共享 tab、Network 缓存和一次性授权状态；串行执行避免同轮多个工具并发覆盖 grant。
      for (const toolCall of response.toolCalls) {
        toolResultMessages.push(await executeCurrentTool(toolCall));
      }
    } else {
      toolResultMessages.push(...await Promise.all(response.toolCalls.map(executeCurrentTool)));
    }
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    for (const toolResultMessage of toolResultMessages) {
      appendUniqueToolAttachments(toolAttachments, toolResultMessage.toolAttachments ?? []);
      appendUniqueToolAttachments(currentTurnAttachments, toolResultMessage.toolAttachments ?? []);
    }
    if (hasBrowserAutomationToolCall) {
      const report = createAutomationReportToolAttachment({
        objective: getAutomationObjective(input.initialMessages),
        conclusion: summarizeAutomationConclusion(currentTurnRecords),
        records: currentTurnRecords,
        attachments: currentTurnAttachments,
        playbook: input.automationPlaybookSelection,
      });
      if (report) {
        appendUniqueToolAttachments(toolAttachments, [report]);
        appendUniqueToolAttachments(currentTurnAttachments, [report]);
      }
    }
    const toolTurnMessage = createToolTurnMessage({
      id: toolTurnMessageId,
      initialMessages: input.initialMessages,
      response: toolDecisionResponse,
      toolCallRecords: currentTurnRecords,
      toolAttachments: currentTurnAttachments,
    });
    toolTurnMessages.push(toolTurnMessage);

    messages = [
      ...messages,
      {
        role: "assistant",
        content: toolDecisionResponse.content,
        toolCalls: response.toolCalls,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      },
      ...toolResultMessages,
    ];
  }

  if (input.requestFinalModel && lastResponse?.ok) {
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    collectActiveGuidanceItems(input, activeGuidanceItems);
    messages = appendCurrentTaskReminder(messages, activeGuidanceItems);
    const guidedFinalMessages = createRequestMessagesWithActiveGuidance(messages, activeGuidanceItems);
    const finalRequestMessages = createFinalRequestMessages(guidedFinalMessages);
    const compressedForFinal = await maybeCompressToolLoopMessages({
      messages: finalRequestMessages,
      input,
      toolTurnMessages,
      tokenUsageEntries,
      phase: "final",
    });
    if (!compressedForFinal.ok) {
      return compressedForFinal;
    }
    const messagesForFinal = compressedForFinal.messages === finalRequestMessages
      ? finalRequestMessages
      : createFinalRequestMessagesAfterCompression(compressedForFinal.messages, activeGuidanceItems);
    const finalResponse = await input.requestFinalModel(messagesForFinal);
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    if (!finalResponse.ok) {
      return finalResponse;
    }
    tokenUsageEntries.push(...(finalResponse.tokenUsageEntries ?? []));

    return {
      ok: true,
      content: finalResponse.content,
      thinking: finalResponse.thinking,
      ...(finalResponse.reasoningContent ? { reasoningContent: finalResponse.reasoningContent } : {}),
      ...(toolAttachments.length ? { toolAttachments } : {}),
      ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
      ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
    };
  }

  return lastResponse ?? { ok: false, message: "工具调用超过最大轮次，已停止本次请求。" };
}

type CompressionGuardResult =
  | { ok: true; messages: ModelRequestMessage[] }
  | { ok: false; message: string };

async function maybeCompressToolLoopMessages(input: {
  messages: ModelRequestMessage[];
  input: RunModelToolLoopInput;
  toolTurnMessages: ChatMessage[];
  tokenUsageEntries: ChatTokenUsageEntry[];
  phase: ChatContextEstimatePhase;
}): Promise<CompressionGuardResult> {
  const contextCompression = input.input.contextCompression;
  if (!contextCompression) {
    return { ok: true, messages: input.messages };
  }
  if (input.input.signal?.aborted) {
    return createAbortCompressionGuardResponse();
  }
  const thresholdPercent = contextCompression.thresholdPercent ?? 90;
  const estimatedContextTokens = estimateToolLoopContextTokens(input.messages, input.input);
  const compressionThresholdTokens = Math.floor(contextCompression.maxContextTokens * (thresholdPercent / 100));
  input.input.onContextEstimate?.({
    scope: "tool_loop",
    phase: input.phase,
    estimatedContextTokens,
    maxContextTokens: contextCompression.maxContextTokens,
    thresholdPercent,
    triggerThresholdTokens: compressionThresholdTokens,
  });
  if (estimatedContextTokens < compressionThresholdTokens) {
    return { ok: true, messages: input.messages };
  }
  if (!hasNewMessagesAfterLatestContextSummary(input.messages)) {
    return { ok: true, messages: input.messages };
  }
  let messagesForCompression = input.messages;
  const compressionRequestMessages = createToolLoopCompressionMessages({
    model: contextCompression.model,
    compressionPrompt: contextCompression.compressionPrompt,
    messages: messagesForCompression,
  });
  if (hasLargeToolResultMessage(messagesForCompression) && estimateModelRequestContextTokens(compressionRequestMessages) >= compressionThresholdTokens) {
    const summarized = summarizeLargeToolResultMessages(messagesForCompression);
    if (summarized.changed) {
      messagesForCompression = summarized.messages;
      const summarizedEstimatedContextTokens = estimateToolLoopContextTokens(messagesForCompression, input.input);
      input.input.onContextEstimate?.({
        scope: "tool_loop",
        phase: input.phase,
        estimatedContextTokens: summarizedEstimatedContextTokens,
        maxContextTokens: contextCompression.maxContextTokens,
        thresholdPercent,
        triggerThresholdTokens: compressionThresholdTokens,
      });
      if (summarizedEstimatedContextTokens < compressionThresholdTokens) {
        return { ok: true, messages: messagesForCompression };
      }
      const summarizedCompressionMessages = createToolLoopCompressionMessages({
        model: contextCompression.model,
        compressionPrompt: contextCompression.compressionPrompt,
        messages: messagesForCompression,
      });
      if (estimateModelRequestContextTokens(summarizedCompressionMessages) >= compressionThresholdTokens) {
        return { ok: false, message: TOOL_RESULT_SUMMARIZATION_FAILURE_MESSAGE };
      }
    }
  }

  const compressionArguments = {
    maxContextTokens: contextCompression.maxContextTokens,
    thresholdPercent,
    triggerThresholdTokens: compressionThresholdTokens,
    estimatedContextTokens,
    ...(messagesForCompression !== input.messages ? { localToolResultSummarized: true } : {}),
    temporaryMessageCount: input.messages.length,
  };

  const startedAt = Date.now();
  const compressionIdSuffix = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const toolCallId = `tool-call-${compressionIdSuffix}-tool-loop-context-compression`;
  const runningRecord = createContextCompressionToolCallRecord({
    id: toolCallId,
    status: "running",
    startedAt,
    arguments: compressionArguments,
  });
  const compressionMessage = createContextCompressionToolTurnMessage({
    id: `message-${compressionIdSuffix}-tool-loop-context-compression`,
    record: runningRecord,
    createdAt: startedAt,
    model: contextCompression.model,
    systemPrompt: contextCompression.systemPrompt,
    contextMode: contextCompression.contextMode,
  });
  input.input.onToolTurnMessage?.(compressionMessage);

  const compressionResponse = await contextCompression.requestCompression(
    createToolLoopCompressionMessages({
      model: contextCompression.model,
      compressionPrompt: contextCompression.compressionPrompt,
      messages: messagesForCompression,
    }),
  );
  if (input.input.signal?.aborted) {
    completeContextCompressionWithError({
      input,
      compressionMessage,
      toolCallId,
      startedAt,
      errorMessage: "已终止本次生成。",
      arguments: compressionArguments,
    });
    return createAbortCompressionGuardResponse();
  }
  if (!compressionResponse.ok || !compressionResponse.content.trim()) {
    const errorMessage = CONTEXT_COMPRESSION_FAILURE_MESSAGE;
    completeContextCompressionWithError({
      input,
      compressionMessage,
      toolCallId,
      startedAt,
      errorMessage,
      arguments: compressionArguments,
    });
    return { ok: false, message: errorMessage };
  }

  input.tokenUsageEntries.push(...(compressionResponse.tokenUsageEntries ?? []));
  const summaryCreatedAt = Date.now();
  const summaryMessage = createContextSummaryMessage({
    content: compressionResponse.content,
    createdAt: summaryCreatedAt,
    model: contextCompression.model,
    systemPrompt: contextCompression.systemPrompt,
    contextMode: contextCompression.contextMode,
    tokenUsageEntries: compressionResponse.tokenUsageEntries,
  });
  const compressedMessages = createCompressedToolLoopMessages({
    messages: messagesForCompression,
    summaryMessage,
    maxContextTokens: contextCompression.maxContextTokens,
    thresholdPercent: contextCompression.thresholdPercent,
  });
  const compressedEstimatedContextTokens = estimateToolLoopContextTokens(compressedMessages, input.input);
  input.input.onContextEstimate?.({
    scope: "tool_loop",
    phase: input.phase,
    estimatedContextTokens: compressedEstimatedContextTokens,
    maxContextTokens: contextCompression.maxContextTokens,
    thresholdPercent,
    triggerThresholdTokens: compressionThresholdTokens,
  });
  if (shouldCompressModelRequestContext({
    maxContextTokens: contextCompression.maxContextTokens,
    thresholdPercent: contextCompression.thresholdPercent,
    messages: compressedMessages,
  })) {
    completeContextCompressionWithError({
      input,
      compressionMessage,
      toolCallId,
      startedAt,
      errorMessage: CONTEXT_COMPRESSION_OVER_BUDGET_MESSAGE,
      resultSummary: summaryMessage.content,
      arguments: compressionArguments,
    });
    return { ok: false, message: CONTEXT_COMPRESSION_OVER_BUDGET_MESSAGE };
  }
  const completedRecord = createContextCompressionToolCallRecord({
    id: toolCallId,
    status: "success",
    startedAt,
    completedAt: summaryCreatedAt,
    arguments: compressionArguments,
    resultSummary: summaryMessage.content,
  });
  const completedMessage: ChatMessage = {
    ...compressionMessage,
    toolCallRecords: [completedRecord],
  };
  input.toolTurnMessages.push(completedMessage, summaryMessage);
  input.input.onToolCallComplete?.(completedRecord, []);
  input.input.onContextSummaryMessage?.(summaryMessage);

  return {
    ok: true,
    messages: compressedMessages,
  };
}

function estimateToolLoopContextTokens(messages: ModelRequestMessage[], input: RunModelToolLoopInput): number {
  const initialContextTokens = input.contextCompression?.initialContextTokens;
  if (initialContextTokens === undefined || !isInitialMessagesPrefix(messages, input.initialMessages)) {
    return estimateModelRequestContextTokens(messages);
  }

  return initialContextTokens + estimateModelRequestContextTokens(messages.slice(input.initialMessages.length));
}

function summarizeLargeToolResultMessages(messages: ModelRequestMessage[]): { messages: ModelRequestMessage[]; changed: boolean } {
  let changed = false;
  const summarizedMessages = messages.map((message) => {
    if (message.role !== "tool" || message.isError) {
      return message;
    }
    const estimatedTokens = estimateModelRequestContextTokens([message]);
    if (estimatedTokens < LARGE_TOOL_RESULT_TOKEN_THRESHOLD && message.content.length < LARGE_TOOL_RESULT_CHAR_THRESHOLD) {
      return message;
    }
    changed = true;
    return {
      ...message,
      content: createLocalToolResultSummary(message),
    };
  });

  return { messages: summarizedMessages, changed };
}

function hasLargeToolResultMessage(messages: ModelRequestMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "tool" || message.isError) {
      return false;
    }
    return estimateModelRequestContextTokens([message]) >= LARGE_TOOL_RESULT_TOKEN_THRESHOLD || message.content.length >= LARGE_TOOL_RESULT_CHAR_THRESHOLD;
  });
}

function createLocalToolResultSummary(message: ModelToolResultMessage): string {
  const attachmentSummaries = (message.toolAttachments ?? []).map(formatToolAttachmentSummaryForModel).filter(Boolean);
  const truncatedContent = truncateText(message.content.trim(), 3000).text;
  return [
    "工具结果已因上下文预算被摘要化；完整详情仍保留在工具附件弹窗中。",
    `工具：${message.name}`,
    `调用 ID：${message.toolCallId}`,
    message.isError ? "状态：错误" : "状态：成功",
    attachmentSummaries.length ? `附件索引：\n${attachmentSummaries.join("\n")}` : "",
    truncatedContent ? `原始结果摘录：\n${truncatedContent}` : "",
    "如果后续需要具体字段，请引用上方请求 ID、资源 ID 或重新选择更小范围。", 
  ].filter(Boolean).join("\n");
}

function formatToolAttachmentSummaryForModel(attachment: ChatToolAttachment): string {
  if (attachment.kind === "network" && "requests" in attachment) {
    const requests = attachment.requests
      .slice(0, 20)
      .map((request) => {
        const status = typeof request.status === "number" ? request.status : "";
        return `- ${request.id} ${request.method} ${status} ${truncateText(request.url, 180).text}`.trim();
      });
    return [`Network 附件：${attachment.id}`, attachment.summary, ...requests].filter(Boolean).join("\n");
  }

  if (attachment.kind === "js-source" && "resources" in attachment) {
    const resources = attachment.resources
      .slice(0, 20)
      .map((resource) => `- ${resource.id} ${truncateText(resource.url, 180).text}`);
    const matches = attachment.jsMatches
      .slice(0, 10)
      .map((match) => `- 匹配 ${match.resourceId}:${match.line}:${match.column} ${truncateText(match.term, 80).text}`);
    return [`JS 附件：${attachment.id}`, attachment.summary, ...resources, ...matches].filter(Boolean).join("\n");
  }

  if (attachment.kind === "source-map" && "resolvedLocations" in attachment) {
    const locations = attachment.resolvedLocations
      .slice(0, 20)
      .map((location) => `- ${location.resourceId}:${location.generatedLine}:${location.generatedColumn}`);
    return [`Source Map 附件：${attachment.id}`, attachment.summary, ...locations].filter(Boolean).join("\n");
  }

  return [`附件：${attachment.id}`, attachment.title, attachment.summary].filter(Boolean).join(" ");
}

function isInitialMessagesPrefix(messages: ModelRequestMessage[], initialMessages: ModelRequestMessage[]): boolean {
  if (messages.length < initialMessages.length) {
    return false;
  }
  return initialMessages.every((message, index) => messages[index] === message);
}

function completeContextCompressionWithError(input: {
  input: Parameters<typeof maybeCompressToolLoopMessages>[0];
  compressionMessage: ChatMessage;
  toolCallId: string;
  startedAt: number;
  errorMessage: string;
  resultSummary?: string;
  arguments?: Record<string, unknown>;
}): void {
  const failedRecord = createContextCompressionToolCallRecord({
    id: input.toolCallId,
    status: "error",
    startedAt: input.startedAt,
    completedAt: Date.now(),
    arguments: input.arguments,
    errorMessage: input.errorMessage,
    resultSummary: input.resultSummary,
  });
  input.input.toolTurnMessages.push({
    ...input.compressionMessage,
    toolCallRecords: [failedRecord],
  });
  input.input.input.onToolCallComplete?.(failedRecord, []);
}

function hasNewMessagesAfterLatestContextSummary(messages: ModelRequestMessage[]): boolean {
  let summaryIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if ("assistantMessageKind" in message && message.assistantMessageKind === "context_summary") {
      summaryIndex = index;
      break;
    }
  }
  if (summaryIndex < 0) {
    return true;
  }

  // 压缩后的临时上下文会保留原始任务、摘要和继续指令；摘要后没有新工具结果或用户引导时不应马上再次压缩。
  return messages.slice(summaryIndex + 1).some((message) => {
    if (message.role === "user" && message.content === TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION) {
      return false;
    }
    return true;
  });
}

function collectActiveGuidanceItems(input: RunModelToolLoopInput, activeGuidanceItems: GuidanceItem[]): void {
  const guidanceItems = input.consumeGuidance?.() ?? [];
  if (guidanceItems.length === 0) {
    return;
  }

  for (const item of guidanceItems) {
    if (!hasGuidanceContent(item)) {
      continue;
    }
    const existingIndex = activeGuidanceItems.findIndex((current) => current.id === item.id);
    if (existingIndex >= 0) {
      activeGuidanceItems[existingIndex] = item;
      continue;
    } else {
      activeGuidanceItems.push(item);
    }
    const createdAt = Date.now();
    input.onToolTurnMessage?.(createGuidanceToolTurnMessage(item, createdAt));
    input.onGuidanceConsumed?.(item.id);
  }
}

function createRequestMessagesWithActiveGuidance(messages: ModelRequestMessage[], activeGuidanceItems: GuidanceItem[]): ModelRequestMessage[] {
  const baseMessages = stripActiveGuidanceMessages(messages);
  const activeGuidanceContent = createActiveGuidanceContent(activeGuidanceItems);
  const messagesWithGuidance = activeGuidanceContent
    ? mergeActiveGuidanceIntoSystemMessage(baseMessages, activeGuidanceContent)
    : baseMessages;
  const activeGuidanceAttachmentMessage = createActiveGuidanceAttachmentMessage(activeGuidanceItems);
  return activeGuidanceAttachmentMessage
    ? insertBeforeTrailingControlMessages(messagesWithGuidance, activeGuidanceAttachmentMessage)
    : messagesWithGuidance;
}

function createDecisionRequestMessagesAfterCompression(messages: ModelRequestMessage[], activeGuidanceItems: GuidanceItem[]): ModelRequestMessage[] {
  return createRequestMessagesWithActiveGuidance(
    appendCurrentTaskReminder(removeTransientToolLoopControlMessages(stripActiveGuidanceMessages(messages)), activeGuidanceItems),
    activeGuidanceItems,
  );
}

function createFinalRequestMessagesAfterCompression(messages: ModelRequestMessage[], activeGuidanceItems: GuidanceItem[]): ModelRequestMessage[] {
  return createFinalRequestMessages(createRequestMessagesWithActiveGuidance(
    appendCurrentTaskReminder(removeTransientToolLoopControlMessages(stripActiveGuidanceMessages(messages)), activeGuidanceItems),
    activeGuidanceItems,
  ));
}

function removeTransientToolLoopControlMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  return messages.filter((message) => !(message.role === "user"
    && typeof message.content === "string"
    && (message.content === TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION || message.content === FINAL_RESPONSE_INSTRUCTION)));
}

function stripActiveGuidanceMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  return messages
    .filter((message) => !isGuidanceUserMessage(message))
    .map((message) => message.role === "system"
      ? { ...message, content: stripActiveGuidanceContent(message.content) }
      : message);
}

function stripActiveGuidanceContent(content: string): string {
  const markerIndex = content.indexOf(`\n\n${ACTIVE_GUIDANCE_PREFIX}`);
  if (markerIndex >= 0) {
    return content.slice(0, markerIndex).trim();
  }
  return content.startsWith(ACTIVE_GUIDANCE_PREFIX) ? "" : content;
}

function insertBeforeTrailingControlMessages(messages: ModelRequestMessage[], messageToInsert: ModelRequestMessage): ModelRequestMessage[] {
  let insertIndex = messages.length;
  while (insertIndex > 0 && isToolLoopControlUserMessage(messages[insertIndex - 1])) {
    insertIndex -= 1;
  }
  return [
    ...messages.slice(0, insertIndex),
    messageToInsert,
    ...messages.slice(insertIndex),
  ];
}

function createActiveGuidanceContent(activeGuidanceItems: GuidanceItem[]): string {
  const validItems = activeGuidanceItems.filter(hasGuidanceContent);
  if (validItems.length === 0) {
    return "";
  }
  const guidanceSections = validItems.map((item, index) => {
    const guidanceContent = buildGuidanceContent(item);
    return `${index + 1}. ${guidanceContent}`;
  });
  const guidanceBlock = validItems.length === 1 ? buildGuidanceContent(validItems[0]) : guidanceSections.join("\n");
  return [
    ACTIVE_GUIDANCE_PREFIX,
    "",
    GUIDANCE_PREFIX,
    guidanceBlock,
    "",
    ACTIVE_GUIDANCE_SUFFIX,
  ].join("\n");
}

function mergeActiveGuidanceIntoSystemMessage(messages: ModelRequestMessage[], guidanceContent: string): ModelRequestMessage[] {
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex < 0) {
    return [{ role: "system", content: guidanceContent }, ...messages];
  }
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: [message.content, "", guidanceContent].filter(Boolean).join("\n") }
    : message);
}

function createActiveGuidanceAttachmentMessage(activeGuidanceItems: GuidanceItem[]): ChatMessage | undefined {
  const validItems = activeGuidanceItems.filter(hasGuidanceContent);
  const attachmentsById = new Map<string, ChatImageAttachment>();
  for (const attachment of validItems.flatMap((item) => item.attachments ?? [])) {
    attachmentsById.set(attachment.id, attachment);
  }
  const attachments = Array.from(attachmentsById.values());
  if (attachments.length === 0) {
    return undefined;
  }
  return createGuidanceMessage(
    `active-guidance-${validItems.map((item) => item.id).join("-")}`,
    `${ACTIVE_GUIDANCE_PREFIX}\n当前任务持续引导包含图片附件；这些图片只作为已生效引导的补充材料，不是新的用户任务。`,
    attachments,
  );
}

function hasGuidanceContent(item: GuidanceItem): boolean {
  return Boolean(item.content.trim() || item.promptInvocations?.length || item.attachments?.length);
}

function appendCurrentTaskReminder(messages: ModelRequestMessage[], activeGuidanceItems: GuidanceItem[] = []): ModelRequestMessage[] {
  const latestUserContent = getLatestUserTaskContent(messages);
  if (!latestUserContent) {
    return messages;
  }
  const messagesWithoutOldReminder = messages.filter((message) => !(message.role === "user" && message.content.startsWith(CURRENT_TASK_REMINDER_PREFIX)));
  const lastMessage = messagesWithoutOldReminder.at(-1);
  if (lastMessage?.role === "user" && lastMessage.content.startsWith(CURRENT_TASK_REMINDER_PREFIX)) {
    return messagesWithoutOldReminder;
  }

  return [
    ...messagesWithoutOldReminder,
    {
      role: "user",
      content: [
        CURRENT_TASK_REMINDER_PREFIX,
        latestUserContent,
        createActiveGuidanceReminderContent(activeGuidanceItems),
        "",
        CURRENT_TASK_REMINDER_SUFFIX,
        activeGuidanceItems.some(hasGuidanceContent) ? CURRENT_TASK_GUIDANCE_SUFFIX : "",
      ].filter((item) => item !== "").join("\n"),
    },
  ];
}

function createActiveGuidanceReminderContent(activeGuidanceItems: GuidanceItem[]): string {
  const guidanceContent = createActiveGuidanceContent(activeGuidanceItems);
  if (!guidanceContent) {
    return "";
  }
  return [
    "",
    "当前有效运行中引导覆盖约束：",
    guidanceContent,
    "",
    "若上述引导取消、缩小或改写了原始任务中的任何子目标，后续工具调用和最终回答必须以引导为准，不得继续执行被排除的目标。",
  ].join("\n");
}

function getLatestUserTaskContent(messages: ModelRequestMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || !message.content.trim()) {
      continue;
    }
    if (isGuidanceUserMessage(message) || message.content === TOOL_LOOP_COMPRESSION_CONTINUE_INSTRUCTION || message.content.startsWith(CURRENT_TASK_REMINDER_PREFIX)) {
      continue;
    }
    return truncateText(message.content.trim(), 300).text;
  }
  return "";
}

function isGuidanceUserMessage(message: ModelRequestMessage): boolean {
  return message.role === "user"
    && typeof message.content === "string"
    && (message.content.startsWith(GUIDANCE_PREFIX) || message.content.startsWith(ACTIVE_GUIDANCE_PREFIX));
}

function isToolLoopControlUserMessage(message: ModelRequestMessage | undefined): boolean {
  return message?.role === "user"
    && typeof message.content === "string"
    && (message.content.startsWith(CURRENT_TASK_REMINDER_PREFIX) || message.content === FINAL_RESPONSE_INSTRUCTION);
}

function sanitizeToolDecisionContent(content: string, activeGuidanceItems: GuidanceItem[] = []): string {
  let sanitized = content.trim();
  for (const pattern of [
    /^(好的|好|明白了?|收到|了解了?|可以)[，,。！!\s]*/u,
    /^(聚焦于|专注于|只聚焦于|只专注于)[^，,。！？!?]*[，,。！？!?]\s*/u,
    /^(聚焦于|专注于|只聚焦于|只专注于)\s*/u,
    /^(按|按照|根据)(你的|用户的)?(最新)?(用户消息|引导|要求|指示)[，,。！!\s]*/u,
    /^(我将|我会|现在我来|接下来我会|接下来将|下面我会)\s*/u,
  ]) {
    sanitized = sanitized.replace(pattern, "").trimStart();
  }
  if (
    !sanitized
    || isGuidanceConflictToolDecisionContent(sanitized, activeGuidanceItems)
    || isGuidanceRestatementToolDecisionContent(sanitized, activeGuidanceItems)
    || isNonSubstantiveToolDecisionContent(sanitized)
  ) {
    return "";
  }
  return sanitized;
}

function isGuidanceConflictToolDecisionContent(content: string, activeGuidanceItems: GuidanceItem[]): boolean {
  const guidanceText = activeGuidanceItems.map(buildGuidanceContent).join("\n");
  if (!guidanceText) {
    return false;
  }
  const excludesListInterface = /(不需要|不要|无需|只|仅).*(对话列表|历史对话列表|列表接口)|((对话列表|历史对话列表|列表接口).*(不需要|不要|无需|排除))/u.test(guidanceText);
  if (!excludesListInterface) {
    return false;
  }
  return /(两个接口都需要|都需要|对话接口和.*列表接口|列表接口和.*对话接口)/u.test(content);
}

function isGuidanceRestatementToolDecisionContent(content: string, activeGuidanceItems: GuidanceItem[]): boolean {
  const guidanceText = activeGuidanceItems.map(buildGuidanceContent).join("\n");
  const normalizedContent = normalizeToolDecisionComparisonText(content);
  if (!guidanceText || normalizedContent.length < 6) {
    return false;
  }
  const normalizedGuidance = normalizeToolDecisionComparisonText(guidanceText);
  // 引导刚生效后的第一轮允许展示实质动作，但纯复述引导会让模型每轮都像刚收到新消息一样先确认。
  return normalizedGuidance.includes(normalizedContent);
}

function normalizeToolDecisionComparisonText(content: string): string {
  return content
    .replace(/[，,。！？!?；;：:\s]/gu, "")
    .replace(/了/gu, "");
}

function isNonSubstantiveToolDecisionContent(content: string): boolean {
  return [
    /^(好的|好|明白了?|收到|了解了?|可以)[。！!\s]*$/u,
    /^(我将|我会|现在我来|接下来我会|接下来将|下面我会)[，,。！!\s]*$/u,
    /^(消息已发送|已发送消息|已经发送消息)[。！？!?]?\s*(等待.*(回复|响应|完成))?[。！？!?]?$/u,
    /^(等待.*(回复|响应|完成)|继续等待.*)(。|！|!|？|\?)?$/u,
    /^(按|按照|根据)(你的|用户的)?(最新)?(用户消息|引导|要求|指示)[^。！？!?]*(。|！|!|？|\?)?$/u,
  ].some((pattern) => pattern.test(content.trim()));
}

function createGuidanceMessage(id: string, content: string, attachments?: ChatImageAttachment[], createdAt = Date.now()): ChatMessage {
  return {
    id,
    role: "user",
    content,
    createdAt,
    modelId: "",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
    attachments,
  };
}

function createGuidanceToolTurnMessage(item: GuidanceItem, createdAt: number): ChatMessage {
  return {
    id: `message-${createdAt}-guided-follow-up-${item.id}`,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: "",
    createdAt,
    modelId: "",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
    toolCallRecords: [
      {
        id: `guided-follow-up-${item.id}`,
        toolId: "chat.follow_up_guidance",
        name: "chat_follow_up_guidance",
        displayName: "已引导对话",
        arguments: {},
        status: "success",
        startedAt: createdAt,
        completedAt: createdAt,
        resultSummary: getGuidanceResultSummary(item),
      },
    ],
  };
}

function buildGuidanceContent(item: GuidanceItem): string {
  const expandedContent = item.promptInvocations?.length
    ? buildPromptExpandedUserContent({
        content: item.content,
        promptInvocations: item.promptInvocations,
      }).trim()
    : item.content.trim();
  if (expandedContent) {
    return expandedContent;
  }
  return item.attachments?.length ? "用户补充了图片附件。" : "";
}

function getGuidanceResultSummary(item: GuidanceItem): string {
  const content = item.content.trim();
  if (content) {
    return content;
  }
  if (item.promptInvocations?.length) {
    return "已调用提示词";
  }
  if (item.attachments?.length) {
    return "图片消息";
  }
  return "";
}

function createFinalRequestMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  if (messages.some((message) => message.role === "user" && message.content === FINAL_RESPONSE_INSTRUCTION)) {
    return messages;
  }
  return [
    ...messages,
    {
      role: "user",
      content: FINAL_RESPONSE_INSTRUCTION,
    },
  ];
}

function createAbortResponse(): ModelToolLoopResponse {
  return { ok: false, message: "已终止本次生成。" };
}

function createAbortCompressionGuardResponse(): CompressionGuardResult {
  return { ok: false, message: "已终止本次生成。" };
}

function createToolTurnMessage(input: {
  id: string;
  initialMessages: ModelRequestMessage[];
  response: Extract<ModelToolLoopResponse, { ok: true }>;
  toolCallRecords: ChatToolCallRecord[];
  toolAttachments: ChatToolAttachment[];
}): ChatMessage {
  const createdAt = Date.now();
  const baseMessage = input.initialMessages.find((message): message is ChatMessage => "id" in message && "modelId" in message);
  return {
    id: input.id,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: input.response.content,
    thinking: input.response.thinking,
    reasoningContent: input.response.reasoningContent,
    createdAt,
    modelId: baseMessage?.modelId ?? "",
    endpointType: baseMessage?.endpointType ?? "openai_chat",
    streamMode: baseMessage?.streamMode ?? false,
    systemPrompt: baseMessage?.systemPrompt ?? "",
    contextPrompt: baseMessage?.contextPrompt ?? "",
    contextMode: baseMessage?.contextMode ?? "text",
    matchedRuleId: baseMessage?.matchedRuleId,
    toolCallRecords: input.toolCallRecords,
    toolAttachments: input.toolAttachments.length ? input.toolAttachments : undefined,
  };
}

function createToolTurnMessageId(firstToolCallId: string | undefined): string {
  return `message-${Date.now()}-tool-turn-${firstToolCallId ?? "unknown"}`;
}

function getAutomationObjective(messages: ModelRequestMessage[]): string {
  const userMessage = messages.find((message): message is Extract<ModelRequestMessage, { role: "user"; content: string }> =>
    message.role === "user" && typeof message.content === "string" && Boolean(message.content.trim()),
  );
  return truncateText(userMessage?.content.trim() || "未记录任务目标", 500).text;
}

function summarizeAutomationConclusion(records: ChatToolCallRecord[]): string {
  const successCount = records.filter((record) => record.status === "success").length;
  const errorRecords = records.filter((record) => record.status === "error");
  if (errorRecords.length > 0) {
    const failedTools = Array.from(new Set(errorRecords.map((record) => record.displayName || record.name))).join("、");
    return `已执行 ${records.length} 个自动化步骤，其中 ${successCount} 个成功、${errorRecords.length} 个失败；失败工具：${failedTools}。`;
  }
  return `已执行 ${records.length} 个自动化步骤，全部成功完成。`;
}

async function executeAllowedTool(
  toolCall: ModelToolCall,
  tools: ModelToolRegistryEntry[],
  enabledToolIds: Set<string>,
  executeTool: ModelToolExecutor,
  callbacks: {
    signal?: AbortSignal;
    onStart: (record: ChatToolCallRecord) => void;
    onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  },
): Promise<ModelToolResultMessage> {
  const tool = tools.find((candidate) => candidate.name === toolCall.name);
  const runningRecord: ChatToolCallRecord = {
    id: toolCall.id,
    toolId: tool?.id ?? toolCall.name,
    name: toolCall.name,
    displayName: tool?.displayName ?? toolCall.name,
    arguments: sanitizeToolArguments(toolCall.arguments),
    status: "running",
    startedAt: Date.now(),
  };
  callbacks.onStart(runningRecord);

  if (!tool) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未注册，已拒绝执行。`, callbacks);
  }

  if (!enabledToolIds.has(tool.id)) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未启用，已拒绝执行。`, callbacks);
  }

  if (toolCall.parseError) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 参数无效：${toolCall.parseError}`, callbacks);
  }

  try {
    if (callbacks.signal?.aborted) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const result = await executeTool(toolCall, tool, { signal: callbacks.signal });
    if (callbacks.signal?.aborted) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const resultMessage: ModelToolResultMessage = {
      role: "tool",
      toolCallId: result.toolCallId,
      name: result.name,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
      ...(result.toolAttachments?.length ? { toolAttachments: result.toolAttachments } : {}),
    };
    callbacks.onComplete(createCompletedToolRecord(runningRecord, resultMessage), result.toolAttachments ?? []);
    return resultMessage;
  } catch {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 执行失败，请稍后重试。`, callbacks);
  }
}

function completeToolError(
  runningRecord: ChatToolCallRecord,
  toolCall: ModelToolCall,
  content: string,
  callbacks: { onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void },
): ModelToolResultMessage {
  const result = createToolErrorResult(toolCall, content);
  callbacks.onComplete(createCompletedToolRecord(runningRecord, result), []);
  return result;
}

function createToolErrorResult(toolCall: ModelToolCall, content: string): ModelToolResultMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function createCompletedToolRecord(record: ChatToolCallRecord, result: ModelToolResultMessage): ChatToolCallRecord {
  const attachmentIds = result.toolAttachments?.map((attachment) => attachment.id).filter(Boolean) ?? [];
  return {
    ...record,
    status: result.isError ? "error" : "success",
    completedAt: Date.now(),
    resultSummary: truncateText(result.content.trim(), 280).text,
    ...(result.isError ? { errorMessage: result.content } : {}),
    ...(attachmentIds.length ? { attachmentIds } : {}),
  };
}

function appendUniqueToolAttachments(target: ChatToolAttachment[], attachments: ChatToolAttachment[]): void {
  for (const attachment of attachments) {
    if (!target.some((item) => item.id === attachment.id)) {
      target.push(attachment);
    }
  }
}

function sanitizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, truncateText(value, 1000).text];
      }
      if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return [key, value];
      }
      try {
        return [key, JSON.parse(JSON.stringify(value ?? null)) as unknown];
      } catch {
        return [key, "[无法序列化的参数]"];
      }
    }),
  );
}
