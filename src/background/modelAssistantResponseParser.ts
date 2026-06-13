import type { ModelToolCall, OpenAIStructuredOutputFormat } from "../shared/models/types";
import { extractAnthropicToolCalls, extractDsmlToolCallsFromContent, extractOpenAIToolCalls } from "./modelResponseToolParser";

export function extractAssistantResponseData(
  data: unknown,
  options: { structuredOutput?: OpenAIStructuredOutputFormat; collectToolCalls?: boolean } = {},
): { content: string; reasoningContent?: string; toolCalls?: ModelToolCall[] } {
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
): { content: string; reasoningContent?: string; toolCalls?: ModelToolCall[] } {
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return { content: "" };
  }

  const firstChoice = data.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    return { content: "" };
  }

  const { message } = firstChoice;
  if (!message || typeof message !== "object") {
    return { content: "" };
  }

  if (options.structuredOutput && "tool_calls" in message && Array.isArray(message.tool_calls)) {
    return { content: extractFirstOpenAIToolArguments(message.tool_calls) };
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
    };
  }

  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return { content: "" };
  }

  const toolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
  const reasoningContent = extractOpenAIReasoningContent(message);
  return {
    content: "",
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  };
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
): { content: string; toolCalls?: ModelToolCall[] } {
  if (!isAnthropicResponse(data)) {
    return { content: "" };
  }

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
  };
}

function isOpenAIResponse(data: unknown): data is { choices: unknown[] } {
  return Boolean(data && typeof data === "object" && "choices" in data && Array.isArray(data.choices));
}

function isAnthropicResponse(data: unknown): data is { content: unknown[] } {
  return Boolean(data && typeof data === "object" && "content" in data && Array.isArray(data.content));
}
