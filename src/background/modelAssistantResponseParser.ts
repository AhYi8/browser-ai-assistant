import type { ModelToolCall, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type { ChatTokenUsage } from "../shared/types";
import { normalizeModelTokenUsage } from "../shared/chat/tokenUsage";
import { extractAnthropicToolCalls, extractDsmlToolCallsFromContent, extractOpenAIToolCalls } from "./modelResponseToolParser";

export interface AssistantResponseData {
  content: string;
  reasoningContent?: string;
  toolCalls?: ModelToolCall[];
  tokenUsage?: ChatTokenUsage;
  stopReason?: string;
}

export function extractAssistantResponseData(
  data: unknown,
  options: { structuredOutput?: OpenAIStructuredOutputFormat; collectToolCalls?: boolean } = {},
): AssistantResponseData {
  if (isOpenAIResponse(data)) {
    return extractOpenAIAssistantResponse(data, options);
  }

  if (isAnthropicResponse(data)) {
    return extractAnthropicAssistantResponse(data, options);
  }

  return { content: "" };
}

function extractOpenAIAssistantResponse(
  data: unknown,
  options: { structuredOutput?: OpenAIStructuredOutputFormat; collectToolCalls?: boolean },
): AssistantResponseData {
  const tokenUsage = normalizeModelTokenUsage(data);
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return { content: "", ...(tokenUsage ? { tokenUsage } : {}) };
  }

  const firstChoice = data.choices[0];
  const stopReason = getOpenAIStopReason(firstChoice);
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    return { content: "", ...(tokenUsage ? { tokenUsage } : {}), ...(stopReason ? { stopReason } : {}) };
  }

  const { message } = firstChoice;
  if (!message || typeof message !== "object") {
    return { content: "", ...(tokenUsage ? { tokenUsage } : {}), ...(stopReason ? { stopReason } : {}) };
  }

  if (options.structuredOutput && "tool_calls" in message && Array.isArray(message.tool_calls)) {
    return { content: extractFirstOpenAIToolArguments(message.tool_calls), ...(tokenUsage ? { tokenUsage } : {}), ...(stopReason ? { stopReason } : {}) };
  }

  if ("content" in message && typeof message.content === "string") {
    const dsmlToolCalls = options.collectToolCalls ? extractDsmlToolCallsFromContent(message.content) : { content: message.content, toolCalls: [] };
    const openAIToolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
    const toolCalls = [...openAIToolCalls, ...dsmlToolCalls.toolCalls];
    const reasoningContent = extractOpenAIReasoningContent(message);
    return {
      content: dsmlToolCalls.content,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(stopReason ? { stopReason } : {}),
    };
  }

  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return { content: "", ...(tokenUsage ? { tokenUsage } : {}), ...(stopReason ? { stopReason } : {}) };
  }

  const toolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
  const reasoningContent = extractOpenAIReasoningContent(message);
  return {
    content: "",
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(stopReason ? { stopReason } : {}),
  };
}

function getOpenAIStopReason(choice: unknown): string | undefined {
  return choice && typeof choice === "object" && "finish_reason" in choice && typeof choice.finish_reason === "string"
    ? choice.finish_reason
    : undefined;
}

function extractOpenAIReasoningContent(message: object): string | undefined {
  return "reasoning_content" in message && typeof message.reasoning_content === "string" && message.reasoning_content.trim()
    ? message.reasoning_content
    : undefined;
}

function extractFirstOpenAIToolArguments(toolCalls: unknown[]): string {
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object" || !("function" in toolCall)) {
      continue;
    }
    const toolFunction = toolCall.function;
    if (toolFunction && typeof toolFunction === "object" && "arguments" in toolFunction && typeof toolFunction.arguments === "string") {
      return toolFunction.arguments;
    }
  }

  return "";
}

function extractAnthropicAssistantResponse(
  data: unknown,
  options: { collectToolCalls?: boolean } = {},
): AssistantResponseData {
  const tokenUsage = normalizeModelTokenUsage(data);
  if (!isAnthropicResponse(data)) {
    return { content: "", ...(tokenUsage ? { tokenUsage } : {}) };
  }
  const stopReason = "stop_reason" in data && typeof data.stop_reason === "string" ? data.stop_reason : undefined;

  const text = data.content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(
        item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string",
      ),
    )
    .map((item) => item.text)
    .join("");
  const toolCalls = options.collectToolCalls ? extractAnthropicToolCalls(data.content) : [];

  return {
    content: text,
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(stopReason ? { stopReason } : {}),
  };
}

function isOpenAIResponse(data: unknown): data is { choices: unknown[] } {
  return Boolean(data && typeof data === "object" && "choices" in data && Array.isArray(data.choices));
}

function isAnthropicResponse(data: unknown): data is { content: unknown[] } {
  return Boolean(data && typeof data === "object" && "content" in data && Array.isArray(data.content));
}
