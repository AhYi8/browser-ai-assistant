import type { ChatMessage, ModelConfig } from "../types";

interface BuildChatRequestMessagesInput {
  model: ModelConfig;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
}

export function buildChatRequestMessages(input: BuildChatRequestMessagesInput): ChatMessage[] {
  const systemContent = buildSystemContent(input.model.systemPrompt, input.pageContext);
  const now = Date.now();
  const systemMessage: ChatMessage = {
    id: `system-${now}`,
    role: "system",
    content: systemContent,
    createdAt: now,
    modelId: input.model.id,
    endpointType: input.model.endpointType,
    streamMode: input.userMessage.streamMode,
    systemPrompt: input.model.systemPrompt,
    contextPrompt: input.pageContext,
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
