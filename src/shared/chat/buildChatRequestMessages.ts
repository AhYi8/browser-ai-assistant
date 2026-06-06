import type { ChatMessage, ModelConfig } from "../types";
import { formatNetworkAttachmentForExport, redactNetworkRequestDetail } from "../networkContext";
import { truncateText } from "../utils/text";

interface BuildChatRequestMessagesInput {
  model: ModelConfig;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
  systemPrompt?: string;
  appendPageContextToSystemPrompt?: boolean;
}

export function buildChatRequestMessages(input: BuildChatRequestMessagesInput): ChatMessage[] {
  const effectiveSystemPrompt = input.systemPrompt ?? input.model.systemPrompt;
  const shouldAppendPageContext = input.appendPageContextToSystemPrompt ?? true;
  const existingMessages = input.existingMessages.map(expandAssistantNetworkContextAttachment);
  const pageContext = shouldAppendPageContext
    ? fitPageContextToModelBudget({
    systemPrompt: effectiveSystemPrompt,
    pageContext: input.pageContext,
    existingMessages,
    userMessage: input.userMessage,
    maxTokens: input.model.maxTokens,
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

function expandAssistantNetworkContextAttachment(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant" || !message.networkContextAttachment?.requests.length) {
    return message;
  }

  return {
    ...message,
    content: [
      message.content,
      "",
      "后续追问需要继续参考以下历史 DevTools Network 请求详情：",
      formatNetworkAttachmentForExport(message.networkContextAttachment.requests.map(redactNetworkRequestDetail)),
    ].join("\n").trim(),
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

const APPROX_CHARS_PER_TOKEN = 2;
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
    input.existingMessages.reduce((total, message) => total + message.content.length + (message.thinking?.length ?? 0), 0) +
    input.userMessage.content.length;
  const availablePageContextLength = requestBudget - fixedContentLength;

  // 当前 maxTokens 作为本次请求预算使用，而不是只代表模型输出上限；无真实 tokenizer 时用偏向中文场景的保守字符预算兜底。
  if (availablePageContextLength <= 0) {
    return "";
  }

  return truncateText(pageContext, availablePageContextLength).text;
}
