import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import { normalizeModelRequestRetryCount, shouldRetryModelResponse, withModelRequestRetry } from "../shared/models/modelRequestRetry";
import { getRegisteredModelTools, isBrowserAutomationToolId, resolveEnabledModelTools } from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelToolCall, ModelToolChoice, ModelToolDefinition, ModelToolExecutor, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type { ChatMessage, ChatToolAttachment, ChatToolCallRecord, ModelConfig } from "../shared/types";
import type { TavilySearchOptions } from "../shared/webSearch/tavily";
import { appendBrowserControlPromptIfNeeded, createBackgroundToolExecutor, createModelToolDefinition, normalizeBrowserAutomationMaxToolIterations, shouldExposeTool } from "./backgroundToolRuntime";
import { extractAssistantResponseData } from "./modelAssistantResponseParser";
import { readModelStreamResponse } from "./modelStreamResponseParser";
import { runModelToolLoop } from "./toolCalling/toolLoop";

export interface ChatSendMessage {
  type: "chat.send";
  model: ModelConfig;
  messages: ModelRequestMessage[];
  stream: boolean;
  structuredOutput?: OpenAIStructuredOutputFormat;
  enabledToolIds?: string[];
  toolChoice?: ModelToolChoice;
  tavily?: TavilySearchOptions;
  retryCount?: number;
  browserAutomationMaxToolIterations?: number;
}

type PreparedChatSendMessage = ChatSendMessage & {
  tools?: ModelToolDefinition[];
};

export type ChatSendResponse =
  | {
      ok: true;
      content: string;
      thinking?: string;
      reasoningContent?: string;
      toolCalls?: ModelToolCall[];
      toolCallRecords?: ChatToolCallRecord[];
      toolAttachments?: ChatToolAttachment[];
      toolTurnMessages?: ChatMessage[];
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
  onToolTurnMessage?: (message: ChatMessage) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
}

export async function handleChatSendMessage(
  message: ChatSendMessage,
  fetcher: Fetcher = fetch,
  callbacks: ChatStreamCallbacks = {},
  executeTool?: ModelToolExecutor,
): Promise<ChatSendResponse> {
  const enabledTools = resolveEnabledModelTools(getRegisteredModelTools(), message.enabledToolIds ?? []);
  const exposedTools = message.structuredOutput ? [] : enabledTools.filter(shouldExposeTool);
  const toolExecutor = executeTool ?? createBackgroundToolExecutor(message, fetcher);
  const initialMessages = appendBrowserControlPromptIfNeeded(message.messages, exposedTools);
  const exposedToolIds = exposedTools.map((tool) => tool.id);
  const toolOptions = exposedTools.length > 0
    ? {
        tools: exposedTools.map(createModelToolDefinition),
        toolChoice: message.toolChoice,
      }
    : {};

  if (exposedTools.length > 0) {
    return runModelToolLoop({
      initialMessages,
      tools: exposedTools,
      enabledToolIds: exposedToolIds,
      requestModel: (messages) =>
        requestModelOnce({ ...message, messages, stream: false, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher),
      requestFinalModel: (messages: ModelRequestMessage[]) =>
        requestModelOnce({ ...message, messages, stream: message.stream, tools: undefined, toolChoice: undefined }, fetcher, callbacks),
      executeTool: toolExecutor,
      onToolTurnMessage: callbacks.onToolTurnMessage,
      onToolCallStart: callbacks.onToolCallStart,
      onToolCallComplete: callbacks.onToolCallComplete,
      ...(exposedTools.some((tool) => isBrowserAutomationToolId(tool.id))
        ? { maxIterations: normalizeBrowserAutomationMaxToolIterations(message.browserAutomationMaxToolIterations) }
        : {}),
    });
  }

  return requestModelOnce({ ...message, messages: initialMessages, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher, callbacks);
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
    const requestInit = {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    };
    const retryCount = normalizeModelRequestRetryCount(message.retryCount);

    if (message.stream) {
      const streamResponse = await withModelRequestRetry(() => fetcher(payload.url, requestInit), retryCount, {
        onRetryResult: cancelRetryableResponseBody,
      });

      if (!streamResponse.ok) {
        return {
          ok: false,
          message: `模型请求失败：${streamResponse.status} ${streamResponse.statusText}`.trim(),
        };
      }

      return readModelStreamResponse(streamResponse, message.model, callbacks);
    }

    const modelResponse = await withModelRequestRetry(() => fetchAndReadModelResponse(fetcher, payload.url, requestInit), retryCount, {
      shouldRetryResult: (result) => result.retryable,
      onRetryResult: (result) => cancelRetryableResponseBody(result.response),
    });

    if (!modelResponse.response.ok) {
      const errorBody = message.structuredOutput ? await readSafeErrorBody(modelResponse.response) : undefined;
      return {
        ok: false,
        message: `模型请求失败：${modelResponse.response.status} ${modelResponse.response.statusText}`.trim(),
        ...(message.structuredOutput ? { status: modelResponse.response.status, errorBody } : {}),
      };
    }

    const responseData = extractAssistantResponseData(modelResponse.data, {
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
      thinking: responseData.reasoningContent || parsed.thinking,
      ...(shouldPassDeepSeekReasoningContent(message.model) && responseData.reasoningContent
        ? { reasoningContent: responseData.reasoningContent }
        : {}),
      ...(responseData.toolCalls?.length ? { toolCalls: responseData.toolCalls } : {}),
    };
  } catch {
    return {
      ok: false,
      message: "模型请求失败，请稍后重试",
    };
  }
}

async function fetchAndReadModelResponse(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; data?: unknown; retryable: boolean }> {
  const response = await fetcher(url, init);

  if (!response.ok) {
    return { response, retryable: shouldRetryModelResponse(response) };
  }

  const data = await response.json();
  return { response, data, retryable: false };
}

function cancelRetryableResponseBody(response: Response): Promise<void> | void {
  // 已决定丢弃该响应并重试时主动取消 body，避免连续失败占用连接资源。
  return response.body?.cancel().catch(() => undefined);
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
