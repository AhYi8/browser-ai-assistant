import type { ChatMessage, ChatSession, ChatTokenUsageEntry, ChatToolCallRecord, ModelConfig, PageContextExtractMode } from "../types";
import { sumTokenUsages } from "./tokenUsage";
import { collectMessageToolAttachments, formatToolAttachmentForPrompt } from "../toolArtifacts";

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
}): number {
  const tokenUsageById = new Map((input.tokenUsageEntries ?? []).map((entry) => [entry.id, entry]));
  const scopedMessages = getMessagesFromLatestContextSummary(input.messages);
  const fixedTokens = estimateTextTokens(input.systemPrompt) + estimateTextTokens(input.pageContext);
  const localEstimate = fixedTokens + scopedMessages.reduce(
    (total, message) => total + estimateMessageContextTokens(message, tokenUsageById),
    0,
  );

  return Math.max(localEstimate, estimateContextTokensFromLatestResponseUsage(scopedMessages, tokenUsageById));
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
  resultSummary?: string;
  errorMessage?: string;
}): ChatToolCallRecord {
  return {
    id: input.id,
    toolId: CONTEXT_COMPRESSION_TOOL_ID,
    name: CONTEXT_COMPRESSION_TOOL_NAME,
    displayName: CONTEXT_COMPRESSION_TOOL_DISPLAY_NAME,
    arguments: {},
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    resultSummary: input.resultSummary,
    errorMessage: input.errorMessage,
  };
}

export function createContextCompressionMessages(input: {
  model: ModelConfig;
  compressionPrompt: string;
  messages: ChatMessage[];
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
      content: formatMessagesForCompression(input.messages),
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

function estimateMessageContextTokens(message: ChatMessage, tokenUsageById: Map<string, ChatTokenUsageEntry>): number {
  const boundUsage = message.tokenUsageEntryIds
    ?.map((id) => tokenUsageById.get(id))
    .filter((entry): entry is ChatTokenUsageEntry => Boolean(entry));
  if (message.role === "assistant" && boundUsage?.length) {
    const usage = sumTokenUsages(boundUsage);
    // response usage 的 input/cacheRead 覆盖了当次请求整体上下文，绑定到单条 assistant 消息时不能再次累加，避免重复估算历史输入。
    return usage.outputTokens + usage.cacheWriteTokens;
  }

  return estimateTextTokens(formatMessageForBudget(message)) + estimateImageAttachmentTokens(message);
}

function estimateContextTokensFromLatestResponseUsage(messages: ChatMessage[], tokenUsageById: Map<string, ChatTokenUsageEntry>): number {
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
      .reduce((total, message) => total + estimateMessageContextTokens(message, tokenUsageById), 0);
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

function formatMessageForBudget(message: ChatMessage): string {
  const sections = [message.content, message.thinking, message.reasoningContent === message.thinking ? undefined : message.reasoningContent];
  if (message.promptInvocations?.length) {
    sections.push(...message.promptInvocations.map((prompt) => `${prompt.title}\n${prompt.contentSnapshot}`));
  }
  sections.push(...collectMessageToolAttachments(message).map(formatToolAttachmentForPrompt).filter((item): item is string => Boolean(item?.trim())));
  return sections.filter((item): item is string => Boolean(item?.trim())).join("\n\n");
}

function formatMessagesForCompression(messages: ChatMessage[]): string {
  const scopedMessages = getMessagesFromLatestContextSummary(messages);
  return scopedMessages
    .map((message, index) => {
      const roleLabel = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      const kindLabel = message.assistantMessageKind === "context_summary" ? "（上次压缩摘要）" : "";
      return [`${index + 1}. ${roleLabel}${kindLabel}`, formatMessageForBudget(message)].join("\n").trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}
