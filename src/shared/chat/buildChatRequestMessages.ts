import type { ChatMessage, ModelConfig } from "../types";
import type { ChatToolAttachmentsById } from "../toolArtifacts";
import { collectMessageToolAttachments, formatToolAttachmentForPromptSummary } from "../toolArtifacts";
import { truncateText } from "../utils/text";
import { APPROX_CHARS_PER_TOKEN, estimateImageAttachmentTokens, getMessagesFromLatestContextSummary } from "./contextCompression";

interface BuildChatRequestMessagesInput {
  model: ModelConfig;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
  systemPrompt?: string;
  appendPageContextToSystemPrompt?: boolean;
  maxContextTokens?: number;
  toolAttachmentsById?: ChatToolAttachmentsById;
}

export function buildChatRequestMessages(input: BuildChatRequestMessagesInput): ChatMessage[] {
  const effectiveSystemPrompt = input.systemPrompt ?? input.model.systemPrompt;
  const shouldAppendPageContext = input.appendPageContextToSystemPrompt ?? true;
  const expandedAttachmentIds = new Set<string>();
  const existingMessages = getMessagesFromLatestContextSummary(input.existingMessages).map((message) =>
    expandAssistantContextAttachments(message, input.toolAttachmentsById, expandedAttachmentIds),
  );
  const pageContext = shouldAppendPageContext
    ? fitPageContextToModelBudget({
        systemPrompt: effectiveSystemPrompt,
        pageContext: input.pageContext,
        existingMessages,
        userMessage: input.userMessage,
        maxTokens: input.maxContextTokens ?? input.model.maxTokens,
      })
    : "";
  const systemContent = buildSystemContent(effectiveSystemPrompt, pageContext);
  const now = Date.now();
  const systemMessage: ChatMessage = {
    id: `system-${now}`,
    role: "system",
    content: systemContent,
    createdAt: now,
    modelId: input.model.id,
    endpointType: input.model.endpointType,
    streamMode: input.userMessage.streamMode,
    systemPrompt: effectiveSystemPrompt,
    contextPrompt: pageContext,
    contextMode: input.userMessage.contextMode,
    matchedRuleId: input.userMessage.matchedRuleId,
  };

  return [systemMessage, ...existingMessages, expandUserMessagePromptInvocations(input.userMessage)];
}

function expandAssistantContextAttachments(
  message: ChatMessage,
  toolAttachmentsById: ChatToolAttachmentsById | undefined,
  expandedAttachmentIds: Set<string>,
): ChatMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const attachmentPrompts = collectMessageToolAttachments(message, toolAttachmentsById)
    .filter((attachment) => {
      if (expandedAttachmentIds.has(attachment.id)) {
        return false;
      }
      expandedAttachmentIds.add(attachment.id);
      return true;
    })
    .map((attachment) => formatToolAttachmentForPromptSummary(attachment))
    .filter((item): item is string => Boolean(item?.trim()));
  if (attachmentPrompts.length === 0) {
    return message;
  }

  return {
    ...message,
    content: [message.content, "", ...attachmentPrompts].join("\n").trim(),
  };
}

function expandUserMessagePromptInvocations(message: ChatMessage): ChatMessage {
  if (message.role !== "user" || !message.promptInvocations?.length) {
    return message;
  }

  return {
    ...message,
    content: buildPromptExpandedUserContent(message),
  };
}

export function buildPromptExpandedUserContent(message: Pick<ChatMessage, "content" | "promptInvocations">): string {
  const promptSections = (message.promptInvocations ?? []).map((prompt, index) =>
    [`${index + 1}. ${prompt.title}`, prompt.contentSnapshot].join("\n"),
  );
  const userContent = message.content.trim();
  const sections = ["已调用提示词：", promptSections.join("\n\n")];

  if (userContent) {
    sections.push("", "用户输入：", userContent);
  }

  return sections.join("\n").trim();
}

function buildSystemContent(systemPrompt: string, pageContext: string): string {
  const trimmedSystemPrompt = systemPrompt.trim();
  const trimmedPageContext = pageContext.trim();

  if (!trimmedPageContext) {
    return trimmedSystemPrompt;
  }

  return `${trimmedSystemPrompt}\n\n当前页面上下文：\n${trimmedPageContext}`.trim();
}

interface FitPageContextInput {
  systemPrompt: string;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
  maxTokens: number;
}

const PAGE_CONTEXT_HEADER = "\n\n当前页面上下文：\n";

function fitPageContextToModelBudget(input: FitPageContextInput): string {
  const pageContext = input.pageContext.trim();
  if (!pageContext) {
    return "";
  }

  const requestBudget = Math.max(0, Math.floor(input.maxTokens * APPROX_CHARS_PER_TOKEN));
  const fixedContentLength =
    input.systemPrompt.trim().length +
    PAGE_CONTEXT_HEADER.length +
    input.existingMessages.reduce((total, message) => total + getMessageBudgetLength(message), 0) +
    getMessageBudgetLength(input.userMessage);
  const availablePageContextLength = requestBudget - fixedContentLength;

  // 聊天偏好里的 maxTokens 表示最大聊天上下文预算；没有真实 tokenizer 时使用偏向中文场景的保守字符预算。
  if (availablePageContextLength <= 0) {
    return "";
  }

  return truncateText(pageContext, availablePageContextLength).text;
}

function getMessageBudgetLength(message: ChatMessage): number {
  const thinkingLength = message.thinking?.length ?? 0;
  const reasoningLength = message.reasoningContent && message.reasoningContent !== message.thinking ? message.reasoningContent.length : 0;
  const promptInvocationLength = (message.promptInvocations ?? []).reduce((total, prompt) => total + `${prompt.title}\n${prompt.contentSnapshot}`.length, 0);
  const attachmentLength = estimateImageAttachmentTokens(message) * APPROX_CHARS_PER_TOKEN;
  return message.content.length + thinkingLength + reasoningLength + promptInvocationLength + attachmentLength;
}
