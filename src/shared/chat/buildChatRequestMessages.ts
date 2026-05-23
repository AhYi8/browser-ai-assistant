import type { ChatMessage, ModelConfig } from "../types";
import { truncateText } from "../utils/text";

interface BuildChatRequestMessagesInput {
  model: ModelConfig;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
  systemPrompt?: string;
}

export function buildChatRequestMessages(input: BuildChatRequestMessagesInput): ChatMessage[] {
  const effectiveSystemPrompt = input.systemPrompt ?? input.model.systemPrompt;
  const pageContext = fitPageContextToModelBudget({
    systemPrompt: effectiveSystemPrompt,
    pageContext: input.pageContext,
    existingMessages: input.existingMessages,
    userMessage: input.userMessage,
    maxTokens: input.model.maxTokens,
  });
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

  return [systemMessage, ...input.existingMessages, input.userMessage];
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
