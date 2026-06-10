import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { getRegisteredModelTools, resolveEnabledModelTools } from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelToolCall, ModelToolChoice, ModelToolDefinition, ModelToolExecutor, ModelToolRegistryEntry, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type { ModelConfig } from "../shared/types";
import { runModelToolLoop } from "./toolCalling/toolLoop";

export interface ChatSendMessage {
  type: "chat.send";
  model: ModelConfig;
  messages: ModelRequestMessage[];
  stream: boolean;
  structuredOutput?: OpenAIStructuredOutputFormat;
  enabledToolIds?: string[];
  toolChoice?: ModelToolChoice;
}

type PreparedChatSendMessage = ChatSendMessage & {
  tools?: ModelToolDefinition[];
};

export type ChatSendResponse =
  | {
      ok: true;
      content: string;
      thinking?: string;
      toolCalls?: ModelToolCall[];
    }
  | {
      ok: false;
      message: string;
      status?: number;
      errorBody?: string;
    };

type Fetcher = typeof fetch;

interface ChatStreamCallbacks {
  onContentChunk?: (content: string) => void;
  onThinkingChunk?: (content: string) => void;
}

export async function handleChatSendMessage(
  message: ChatSendMessage,
  fetcher: Fetcher = fetch,
  callbacks: ChatStreamCallbacks = {},
  executeTool: ModelToolExecutor = createUnavailableToolExecutor(),
): Promise<ChatSendResponse> {
  const enabledTools = resolveEnabledModelTools(getRegisteredModelTools(), message.enabledToolIds ?? []);
  const toolOptions = enabledTools.length > 0 && !message.structuredOutput
    ? {
        tools: enabledTools.map(createModelToolDefinition),
        toolChoice: message.toolChoice,
      }
    : {};

  if (!message.stream && enabledTools.length > 0) {
    return runModelToolLoop({
      initialMessages: message.messages,
      tools: enabledTools,
      enabledToolIds: message.enabledToolIds ?? [],
      requestModel: (messages) => requestModelOnce({ ...message, messages, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher),
      executeTool,
    });
  }

  return requestModelOnce({ ...message, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher, callbacks);
}

async function requestModelOnce(
  message: PreparedChatSendMessage,
  fetcher: Fetcher,
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatSendResponse> {
  try {
    const payload = createModelRequestPayload(message.model, message.messages, message.stream, message.structuredOutput, {
      tools: message.tools,
      toolChoice: message.toolChoice,
    });
    const response = await fetcher(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    });

    if (!response.ok) {
      const errorBody = message.structuredOutput ? await readSafeErrorBody(response) : undefined;
      return {
        ok: false,
        message: `模型请求失败：${response.status} ${response.statusText}`.trim(),
        ...(message.structuredOutput ? { status: response.status, errorBody } : {}),
      };
    }

    if (message.stream) {
      return readStreamResponse(response, message.model.endpointType, callbacks);
    }

    const data = await response.json();
    const responseData = extractAssistantResponseData(data, {
      structuredOutput: message.structuredOutput,
      collectToolCalls: Boolean(message.tools?.length),
    });
    if (!responseData.content && !responseData.toolCalls?.length) {
      return { ok: false, message: "模型响应中没有可用内容" };
    }

    const parsed = parseAssistantResponse(responseData.content);
    return {
      ok: true,
      content: parsed.content,
      thinking: parsed.thinking,
      ...(responseData.toolCalls?.length ? { toolCalls: responseData.toolCalls } : {}),
    };
  } catch {
    return {
      ok: false,
      message: "模型请求失败，请稍后重试",
    };
  }
}

function createModelToolDefinition(tool: ModelToolRegistryEntry): ModelToolDefinition {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.parameters,
  };
}

function createUnavailableToolExecutor(): ModelToolExecutor {
  return async (toolCall) => ({
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: `工具 ${toolCall.name} 暂未实现，已拒绝执行。`,
    isError: true,
  });
}

async function readStreamResponse(
  response: Response,
  endpointType: ModelConfig["endpointType"],
  callbacks: ChatStreamCallbacks,
): Promise<ChatSendResponse> {
  if (!response.body) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let rawThinking = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer, endpointType);
    buffer = parsed.remaining;
    for (const chunk of parsed.contentChunks) {
      rawContent += chunk;
      callbacks.onContentChunk?.(chunk);
    }
    for (const chunk of parsed.thinkingChunks) {
      rawThinking += chunk;
      callbacks.onThinkingChunk?.(chunk);
    }

    if (parsed.done) {
      break;
    }
  }

  buffer += decoder.decode();
  const tail = consumeSseBuffer(`${buffer}\n\n`, endpointType);
  for (const chunk of tail.contentChunks) {
    rawContent += chunk;
    callbacks.onContentChunk?.(chunk);
  }
  for (const chunk of tail.thinkingChunks) {
    rawThinking += chunk;
    callbacks.onThinkingChunk?.(chunk);
  }

  if (!rawContent && !rawThinking) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  const parsedContent = parseAssistantResponse(rawContent);
  return {
    ok: true,
    content: parsedContent.content,
    thinking: rawThinking || parsedContent.thinking,
  };
}

function consumeSseBuffer(
  buffer: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; done: boolean; remaining: string } {
  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let done = false;
  let remaining = buffer;

  while (true) {
    const separatorIndex = remaining.indexOf("\n\n");
    if (separatorIndex < 0) {
      break;
    }

    const eventBlock = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const parsed = parseSseEventBlock(eventBlock, endpointType);
    contentChunks.push(...parsed.contentChunks);
    thinkingChunks.push(...parsed.thinkingChunks);
    done = done || parsed.done;
  }

  return { contentChunks, thinkingChunks, done, remaining };
}

function parseSseEventBlock(
  eventBlock: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; done: boolean } {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let done = false;

  for (const dataLine of dataLines) {
    if (!dataLine) {
      continue;
    }

    if (dataLine === "[DONE]") {
      done = true;
      continue;
    }

    try {
      const data = JSON.parse(dataLine) as unknown;
      const chunk = endpointType === "anthropic_messages" ? extractAnthropicStreamText(data) : extractOpenAIStreamChunk(data);
      if (chunk.content) {
        contentChunks.push(chunk.content);
      }
      if (chunk.thinking) {
        thinkingChunks.push(chunk.thinking);
      }

      done = done || isAnthropicStreamStop(data);
    } catch {
      // 第三方 SSE 偶发心跳或非 JSON 片段时忽略，避免单个畸形片段中断整次回复。
    }
  }

  return { contentChunks, thinkingChunks, done };
}

function extractOpenAIStreamChunk(data: unknown): { content: string; thinking: string } {
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return { content: "", thinking: "" };
  }

  const firstChoice = data.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("delta" in firstChoice)) {
    return { content: "", thinking: "" };
  }

  const { delta } = firstChoice;
  if (!delta || typeof delta !== "object") {
    return { content: "", thinking: "" };
  }

  return {
    content: "content" in delta && typeof delta.content === "string" ? delta.content : "",
    thinking: "reasoning_content" in delta && typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
  };
}

function extractAnthropicStreamText(data: unknown): { content: string; thinking: string } {
  if (!data || typeof data !== "object" || !("delta" in data)) {
    return { content: "", thinking: "" };
  }

  const { delta } = data;
  const content = delta &&
    typeof delta === "object" &&
    "type" in delta &&
    delta.type === "text_delta" &&
    "text" in delta &&
    typeof delta.text === "string"
    ? delta.text
    : "";

  return { content, thinking: "" };
}

function isAnthropicStreamStop(data: unknown): boolean {
  return Boolean(data && typeof data === "object" && "type" in data && data.type === "message_stop");
}

function extractAssistantResponseData(
  data: unknown,
  options: { structuredOutput?: OpenAIStructuredOutputFormat; collectToolCalls?: boolean } = {},
): { content: string; toolCalls?: ModelToolCall[] } {
  const openAIResponse = extractOpenAIAssistantResponse(data, options);
  if (openAIResponse.content || openAIResponse.toolCalls?.length) {
    return openAIResponse;
  }

  return extractAnthropicAssistantResponse(data, options);
}

function extractOpenAIAssistantResponse(
  data: unknown,
  options: { structuredOutput?: OpenAIStructuredOutputFormat; collectToolCalls?: boolean },
): { content: string; toolCalls?: ModelToolCall[] } {
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

  if ("content" in message && typeof message.content === "string") {
    const toolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
    return {
      content: message.content,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return { content: "" };
  }

  if (options.structuredOutput) {
    return { content: extractFirstOpenAIToolArguments(message.tool_calls) };
  }

  const toolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
  return {
    content: "",
    ...(toolCalls.length ? { toolCalls } : {}),
  };
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

function extractOpenAIToolCalls(message: object): ModelToolCall[] {
  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls
    .map((toolCall, index) => {
      if (!toolCall || typeof toolCall !== "object" || !("function" in toolCall)) {
        return undefined;
      }

      const toolFunction = toolCall.function;
      if (!toolFunction || typeof toolFunction !== "object" || !("name" in toolFunction) || typeof toolFunction.name !== "string") {
        return undefined;
      }

      const parsedArguments = parseToolArguments(
        "arguments" in toolFunction && typeof toolFunction.arguments === "string" ? toolFunction.arguments : "{}",
      );
      return {
        id: "id" in toolCall && typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : `tool-call-${index + 1}`,
        name: toolFunction.name,
        arguments: parsedArguments.arguments,
        ...(parsedArguments.parseError ? { parseError: parsedArguments.parseError } : {}),
      };
    })
    .filter((toolCall): toolCall is ModelToolCall => Boolean(toolCall));
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

function extractAnthropicToolCalls(content: unknown[]): ModelToolCall[] {
  return content
    .map((item, index) => {
      if (
        !item ||
        typeof item !== "object" ||
        !("type" in item) ||
        item.type !== "tool_use" ||
        !("name" in item) ||
        typeof item.name !== "string"
      ) {
        return undefined;
      }

      const parsedArguments = parseToolArguments("input" in item ? item.input : {});
      return {
        id: "id" in item && typeof item.id === "string" && item.id.trim() ? item.id : `tool-use-${index + 1}`,
        name: item.name,
        arguments: parsedArguments.arguments,
        ...(parsedArguments.parseError ? { parseError: parsedArguments.parseError } : {}),
      };
    })
    .filter((toolCall): toolCall is ModelToolCall => Boolean(toolCall));
}

function parseToolArguments(value: unknown): { arguments: Record<string, unknown>; parseError?: string } {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = value.trim() ? JSON.parse(value) : {};
    } catch {
      return { arguments: {}, parseError: "工具参数不是合法 JSON" };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { arguments: {}, parseError: "工具参数必须是对象" };
  }

  return { arguments: parsed as Record<string, unknown> };
}

function isAnthropicResponse(data: unknown): data is { content: unknown[] } {
  return Boolean(data && typeof data === "object" && "content" in data && Array.isArray(data.content));
}

async function readSafeErrorBody(response: Response): Promise<string | undefined> {
  try {
    // 这里只在错误响应分支读取一次 body，用作结构化输出能力降级的诊断快照；读取后不会再复用该响应体。
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return undefined;
  }
}
