import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createTokenUsageEntry } from "../shared/chat/tokenUsage";
import { estimateModelRequestContextTokens } from "../shared/chat/contextCompression";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import { normalizeModelRequestRetryCount, shouldRetryModelResponse, withModelRequestRetry, type ModelRequestRetryProgress } from "../shared/models/modelRequestRetry";
import { getRegisteredModelTools, isBrowserAutomationToolId, resolveEnabledModelTools, TAVILY_SEARCH_TOOL_ID } from "../shared/models/toolRegistry";
import { filterConfiguredModelTools } from "../shared/webSearch/toolAvailability";
import type { ModelRequestMessage, ModelToolCall, ModelToolChoice, ModelToolDefinition, ModelToolExecutor, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type {
  AutomationPlaybookSettings,
  ChatContextEstimate,
  ChatImageAttachment,
  ChatMessage,
  ChatPromptInvocation,
  ChatTokenUsageEntry,
  ChatTokenUsageSource,
  ChatToolAttachment,
  ChatToolCallRecord,
  ExtractionRule,
  ModelConfig,
} from "../shared/types";
import type { TavilySearchOptions } from "../shared/webSearch/tavily";
import { getWebSearchSettings } from "../shared/webSearch/settings";
import { getEnabledAutomationPlaybooks, normalizeAutomationPlaybookSettings, shouldRunAutomationPlaybookSelection } from "../shared/automationPlaybooks";
import { appendBrowserControlPromptIfNeeded, createBackgroundToolExecutor, createModelToolDefinition, normalizeBrowserAutomationMaxToolIterations, shouldExposeTool } from "./backgroundToolRuntime";
import { selectAutomationPlaybook } from "./automationPlaybookSelector";
import { extractAssistantResponseData } from "./modelAssistantResponseParser";
import { getModelStopReasonFailureMessage } from "./modelResponseStopReason";
import { readModelStreamResponse } from "./modelStreamResponseParser";
import { runModelToolLoop } from "./toolCalling/toolLoop";

const EMPTY_MODEL_RESPONSE_MESSAGE = "模型响应中没有可用内容";

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
  tokenUsageSource?: ChatTokenUsageSource;
  browserAutomationMaxToolIterations?: number;
  toolDetailPoolKeepLimit?: number;
  contextCompression?: {
    maxContextTokens: number;
    initialContextTokens?: number;
    thresholdPercent?: number;
    compressionPrompt: string;
    systemPrompt: string;
    contextMode: import("../shared/types").PageContextExtractMode;
  };
  automationPlaybookSettings?: AutomationPlaybookSettings;
  extractionRules?: ExtractionRule[];
  mcp?: import("../shared/types").McpSettings & { bearerTokens?: import("../shared/types").McpServerSecretMap };
}

type ChatSendHandlerMessage = ChatSendMessage & {
  signal?: AbortSignal;
};

type PreparedChatSendMessage = ChatSendHandlerMessage & {
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
      tokenUsageEntries?: ChatTokenUsageEntry[];
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
  onRetryProgress?: (progress: ModelRequestRetryProgress) => void;
  onFinalResponseStart?: () => void;
  onTokenUsageEntries?: (entries: ChatTokenUsageEntry[]) => void;
  onToolTurnMessage?: (message: ChatMessage) => void;
  onContextSummaryMessage?: (message: ChatMessage) => void;
  onContextEstimate?: (estimate: ChatContextEstimate) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  consumeGuidance?: () => Array<{
    id: string;
    content: string;
    attachments?: ChatImageAttachment[];
    promptInvocations?: ChatPromptInvocation[];
    userMessageId?: string;
  }>;
  onGuidanceConsumed?: (followUpId: string) => void;
}

export async function handleChatSendMessage(
  message: ChatSendHandlerMessage,
  fetcher: Fetcher = fetch,
  callbacks: ChatStreamCallbacks = {},
  executeTool?: ModelToolExecutor,
): Promise<ChatSendResponse> {
  const registeredTools = await getConfiguredRegisteredModelTools(message);
  const enabledTools = resolveEnabledModelTools(registeredTools, message.enabledToolIds ?? []);
  const exposedTools = message.structuredOutput ? [] : enabledTools.filter(shouldExposeTool);
  const toolExecutor = executeTool ?? createBackgroundToolExecutor(message, fetcher);
  const automationPlaybookSelection = await maybeSelectAutomationPlaybook(message, exposedTools, fetcher);
  const initialMessages = appendBrowserControlPromptIfNeeded(message.messages, exposedTools, automationPlaybookSelection);
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
      // 工具链路会产生决策与最终回答两次模型响应，需要固定来源，不能沿用调用方传入的普通请求来源。
      requestModel: (messages) =>
        requestModelOnce({ ...message, messages, stream: false, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice, tokenUsageSource: "tool_decision" }, fetcher, callbacks),
      requestFinalModel: (messages: ModelRequestMessage[]) => {
        callbacks.onFinalResponseStart?.();
        return requestModelOnce({ ...message, messages, stream: message.stream, tools: undefined, toolChoice: undefined, tokenUsageSource: "tool_final" }, fetcher, callbacks);
      },
      contextCompression: message.contextCompression
        ? {
            model: message.model,
            maxContextTokens: message.contextCompression.maxContextTokens,
            initialContextTokens: createToolLoopInitialContextTokens(message.messages, initialMessages, message.contextCompression.initialContextTokens),
            thresholdPercent: message.contextCompression.thresholdPercent,
            compressionPrompt: message.contextCompression.compressionPrompt,
            systemPrompt: message.contextCompression.systemPrompt,
            contextMode: message.contextCompression.contextMode,
            requestCompression: (messages) =>
              requestModelOnce({
                ...message,
                messages,
                stream: false,
                tools: undefined,
                toolChoice: undefined,
                enabledToolIds: undefined,
                tokenUsageSource: "context_compression",
                contextCompression: undefined,
              }, fetcher, callbacks),
          }
        : undefined,
      executeTool: toolExecutor,
      automationPlaybookSelection,
      signal: message.signal,
      onToolTurnMessage: callbacks.onToolTurnMessage,
      onContextSummaryMessage: callbacks.onContextSummaryMessage,
      onContextEstimate: callbacks.onContextEstimate,
      onToolCallStart: callbacks.onToolCallStart,
      onToolCallComplete: callbacks.onToolCallComplete,
      consumeGuidance: callbacks.consumeGuidance,
      onGuidanceConsumed: callbacks.onGuidanceConsumed,
      maxIterations: normalizeBrowserAutomationMaxToolIterations(message.browserAutomationMaxToolIterations),
    });
  }

  return requestModelOnce({ ...message, messages: initialMessages, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher, callbacks);
}

function createToolLoopInitialContextTokens(
  requestMessages: ModelRequestMessage[],
  initialMessages: ModelRequestMessage[],
  initialContextTokens: number | undefined,
): number | undefined {
  if (initialContextTokens === undefined) {
    return undefined;
  }

  // Side Panel 估算的是正式聊天请求；background 可能额外注入浏览器控制 system prompt，这部分需要作为增量补上。
  return initialContextTokens + Math.max(0, estimateModelRequestContextTokens(initialMessages) - estimateModelRequestContextTokens(requestMessages));
}

async function getConfiguredRegisteredModelTools(message: ChatSendHandlerMessage) {
  const registeredTools = getRegisteredModelTools(message.mcp);
  if (!message.enabledToolIds?.includes(TAVILY_SEARCH_TOOL_ID)) {
    return registeredTools;
  }

  return filterConfiguredModelTools(registeredTools, await getWebSearchSettings());
}

async function maybeSelectAutomationPlaybook(
  message: ChatSendHandlerMessage,
  exposedTools: ReturnType<typeof resolveEnabledModelTools>,
  fetcher: Fetcher,
) {
  if (!message.automationPlaybookSettings || message.structuredOutput || exposedTools.length === 0 || !exposedTools.some((tool) => isBrowserAutomationToolId(tool.id))) {
    return undefined;
  }
  const userContent = getLatestUserContent(message.messages);
  if (!shouldRunAutomationPlaybookSelection(userContent)) {
    return undefined;
  }
  const settings = normalizeAutomationPlaybookSettings(message.automationPlaybookSettings);
  const playbooks = getEnabledAutomationPlaybooks(settings);
  if (playbooks.length === 0) {
    return undefined;
  }
  return selectAutomationPlaybook({
    model: message.model,
    userContent,
    pageContextSummary: getPageContextSummary(message.messages),
    playbooks,
    retryCount: message.retryCount,
    fetcher,
    signal: message.signal,
  });
}

function getLatestUserContent(messages: ModelRequestMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function getPageContextSummary(messages: ModelRequestMessage[]): string | undefined {
  const systemText = messages
    .filter((message): message is Extract<ModelRequestMessage, { role: "system"; content: string }> => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content)
    .join("\n");
  const title = systemText.match(/页面标题[:：]\s*(.+)/)?.[1]?.trim();
  const url = systemText.match(/当前 URL[:：]\s*(.+)/)?.[1]?.trim() ?? systemText.match(/URL[:：]\s*(https?:\/\/\S+)/)?.[1]?.trim();
  const parts = [title ? `标题：${title.slice(0, 120)}` : "", url ? `URL：${url.slice(0, 200)}` : ""].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
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
      signal: message.signal,
    };
    const retryCount = normalizeModelRequestRetryCount(message.retryCount);

    if (message.stream) {
      const streamAttempt = await withModelRequestRetry(async () => {
        const response = await fetcher(payload.url, requestInit);
        if (!response.ok) {
          return {
            response,
            chatResponse: {
              ok: false,
              message: `模型请求失败：${response.status} ${response.statusText}`.trim(),
            } satisfies ChatSendResponse,
            retryable: shouldRetryModelResponse(response),
          };
        }

        const chatResponse = await readModelStreamResponse(response, message.model, callbacks, message.tokenUsageSource ?? "chat");
        return {
          response,
          chatResponse,
          retryable: isEmptyModelResponse(chatResponse),
        };
      }, retryCount, {
        shouldRetryResult: (result) => result.retryable,
        onRetryResult: (result) => cancelRetryableResponseBody(result.response),
        onRetryScheduled: callbacks.onRetryProgress,
      });

      const response = streamAttempt.chatResponse;
      if (response.ok && response.tokenUsageEntries?.length) {
        callbacks.onTokenUsageEntries?.(response.tokenUsageEntries);
      }
      return response;
    }

    const modelResponse = await withModelRequestRetry(async () => {
      const response = await fetchAndReadModelResponse(fetcher, payload.url, requestInit);
      if (!response.response.ok) {
        return { ...response, responseData: undefined, stopReasonFailureMessage: undefined, retryable: response.retryable, empty: false };
      }

      const responseData = extractAssistantResponseData(response.data, {
        structuredOutput: message.structuredOutput,
        collectToolCalls: Boolean(message.tools?.length),
      });
      const stopReasonFailureMessage = getModelStopReasonFailureMessage(responseData.stopReason);
      return {
        ...response,
        responseData,
        stopReasonFailureMessage,
        empty: !stopReasonFailureMessage && !responseData.content && !responseData.toolCalls?.length,
        retryable: !stopReasonFailureMessage && !responseData.content && !responseData.toolCalls?.length,
      };
    }, retryCount, {
      shouldRetryResult: (result) => result.retryable,
      onRetryResult: (result) => cancelRetryableResponseBody(result.response),
      onRetryScheduled: callbacks.onRetryProgress,
    });

    if (!modelResponse.response.ok) {
      const errorBody = message.structuredOutput ? await readSafeErrorBody(modelResponse.response) : undefined;
      return {
        ok: false,
        message: `模型请求失败：${modelResponse.response.status} ${modelResponse.response.statusText}`.trim(),
        ...(message.structuredOutput ? { status: modelResponse.response.status, errorBody } : {}),
      };
    }

    const responseData = modelResponse.responseData;
    if (modelResponse.stopReasonFailureMessage) {
      return { ok: false, message: modelResponse.stopReasonFailureMessage };
    }
    if (!responseData || modelResponse.empty) {
      return { ok: false, message: EMPTY_MODEL_RESPONSE_MESSAGE };
    }

    const parsed = parseAssistantResponse(responseData.content);
    const tokenUsageEntry = responseData.tokenUsage
      ? createTokenUsageEntry({
          usage: responseData.tokenUsage,
          source: message.tokenUsageSource ?? "chat",
          modelId: message.model.id,
          endpointType: message.model.endpointType,
        })
      : undefined;
    if (tokenUsageEntry) {
      callbacks.onTokenUsageEntries?.([tokenUsageEntry]);
    }
    return {
      ok: true,
      content: parsed.content,
      thinking: responseData.reasoningContent || parsed.thinking,
      ...(shouldPassDeepSeekReasoningContent(message.model) && responseData.reasoningContent
        ? { reasoningContent: responseData.reasoningContent }
        : {}),
      ...(responseData.toolCalls?.length ? { toolCalls: responseData.toolCalls } : {}),
      ...(tokenUsageEntry ? { tokenUsageEntries: [tokenUsageEntry] } : {}),
    };
  } catch {
    return {
      ok: false,
      message: "模型请求失败，请稍后重试",
    };
  }
}

function isEmptyModelResponse(response: ChatSendResponse): boolean {
  return !response.ok && response.message === EMPTY_MODEL_RESPONSE_MESSAGE;
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
