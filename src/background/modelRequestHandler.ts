import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import { normalizeModelRequestRetryCount, shouldRetryModelResponse, withModelRequestRetry } from "../shared/models/modelRequestRetry";
import { BROWSER_TAKE_SNAPSHOT_TOOL_ID, BROWSER_TAKE_SNAPSHOT_TOOL_NAME, CURRENT_TIME_TOOL_NAME, TAVILY_SEARCH_TOOL_NAME, getRegisteredModelTools, resolveEnabledModelTools } from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelSystemMessage, ModelToolCall, ModelToolChoice, ModelToolDefinition, ModelToolExecutor, ModelToolRegistryEntry, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type { ChatToolAttachment, ChatToolCallRecord, ModelConfig } from "../shared/types";
import type { TavilySearchOptions } from "../shared/webSearch/tavily";
import { createTavilySearchContextPrompt } from "../shared/webSearch/tavily";
import { createWebSearchToolAttachment } from "../shared/toolArtifacts";
import { runModelToolLoop } from "./toolCalling/toolLoop";
import { executeTavilySearchFromSettings } from "./webSearchMessageHandler";
import { browserControlManager } from "./browserControlMessageHandler";

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
      ...(message.stream
        ? {
            requestFinalModel: (messages: ModelRequestMessage[]) =>
              requestModelOnce({ ...message, messages, stream: true, tools: undefined, toolChoice: undefined }, fetcher, callbacks),
          }
        : {}),
      executeTool: toolExecutor,
      onToolCallStart: callbacks.onToolCallStart,
      onToolCallComplete: callbacks.onToolCallComplete,
    });
  }

  return requestModelOnce({ ...message, messages: initialMessages, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice }, fetcher, callbacks);
}

function shouldExposeTool(tool: ModelToolRegistryEntry): boolean {
  if (tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID) {
    return browserControlManager.canExposeTakeSnapshotTool();
  }

  if (tool.id.startsWith("browser.")) {
    return browserControlManager.canExposeBrowserTool();
  }

  return true;
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

      return readStreamResponse(streamResponse, message.model, callbacks);
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

function createModelToolDefinition(tool: ModelToolRegistryEntry): ModelToolDefinition {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.parameters,
  };
}

function createBackgroundToolExecutor(message: ChatSendMessage, fetcher: Fetcher): ModelToolExecutor {
  return async (toolCall, tool) => {
    if (tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID && tool.name === BROWSER_TAKE_SNAPSHOT_TOOL_NAME) {
      return browserControlManager.takeSnapshot(toolCall);
    }

    if (tool.id.startsWith("browser.")) {
      return browserControlManager.executeBrowserTool(toolCall);
    }

    if (tool.name === TAVILY_SEARCH_TOOL_NAME) {
      return executeTavilySearchTool(toolCall, message.tavily, fetcher);
    }

    if (tool.name === CURRENT_TIME_TOOL_NAME) {
      return executeCurrentTimeTool(toolCall);
    }

    return createUnavailableToolResult(toolCall);
  };
}

function appendBrowserControlPromptIfNeeded(messages: ModelRequestMessage[], enabledTools: ModelToolRegistryEntry[]): ModelRequestMessage[] {
  if (!enabledTools.some((tool) => tool.id.startsWith("browser."))) {
    return messages;
  }

  const browserPrompt = [
    "浏览器控制工具使用规则：",
    "- 需要当前页面结构时先调用 take_snapshot。",
    "- 不要猜测 UID；只能使用 take_snapshot 返回的 UID。",
    "- click、fill 和 press_key 成功后可按需设置 includeSnapshot=true 获取最新快照；失败时不要编造页面结构或操作结果。",
    "- press_key 只能用于白名单按键，并且应确认正确页面或元素已有焦点。",
    "- wait_for 只等待页面可见文本；超时后应重新 take_snapshot 或向用户说明等待失败。",
    "- 导航、切换或新建页面后旧 UID 会失效；继续操作前必须重新 take_snapshot。",
    "- 多页面操作只能使用 list_pages 返回的 index，不要猜测页面序号。",
    "- 遇到网页 JS 弹窗时会等待用户手动处理；不要编造用户选择或弹窗处理结果。",
  ].join("\n");
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    return messages.map((message, index) =>
      index === systemIndex
        ? { ...message, content: `${message.content}\n\n${browserPrompt}` }
        : message,
    );
  }

  const systemMessage: ModelSystemMessage = {
    role: "system",
    content: browserPrompt,
  };
  return [systemMessage, ...messages];
}

function executeCurrentTimeTool(toolCall: ModelToolCall): Awaited<ReturnType<ModelToolExecutor>> {
  const extraKeys = Object.keys(toolCall.arguments);
  if (extraKeys.length > 0) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: "当前系统时间工具不接受任何参数",
      isError: true,
    };
  }

  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localText = now.toLocaleString("zh-CN", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // 当前时间只供模型推理使用，不产出 toolAttachments，避免在 AI 消息气泡下生成可见附件。
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: [
      "当前系统时间：",
      `- 本地时间：${localText}`,
      `- IANA 时区：${timeZone}`,
      `- ISO 时间：${now.toISOString()}`,
      `- Unix 毫秒时间戳：${now.getTime()}`,
    ].join("\n"),
  };
}

async function executeTavilySearchTool(
  toolCall: ModelToolCall,
  tavily: TavilySearchOptions | undefined,
  fetcher: Fetcher,
): Promise<Awaited<ReturnType<ModelToolExecutor>>> {
  const queryResult = normalizeTavilyToolQuery(toolCall.arguments);
  if (!queryResult.ok) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: queryResult.message,
      isError: true,
    };
  }

  const response = await executeTavilySearchFromSettings(queryResult.query, tavily, fetcher);
  if (!response.ok) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: response.message,
      isError: true,
    };
  }

  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: createTavilySearchContextPrompt(response.attachment),
    toolAttachments: [createWebSearchToolAttachment(response.attachment, toolCall.id)],
  };
}

function normalizeTavilyToolQuery(args: Record<string, unknown>): { ok: true; query: string } | { ok: false; message: string } {
  const extraKeys = Object.keys(args).filter((key) => key !== "query");
  if (extraKeys.length > 0) {
    return { ok: false, message: "Tavily 搜索工具只接受 query 参数" };
  }

  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return { ok: false, message: "Tavily 搜索问题不能为空" };
  }

  return { ok: true, query };
}

function createUnavailableToolResult(toolCall: ModelToolCall): Awaited<ReturnType<ModelToolExecutor>> {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: `工具 ${toolCall.name} 暂未实现，已拒绝执行。`,
    isError: true,
  };
}

async function readStreamResponse(
  response: Response,
  model: ModelConfig,
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
    const parsed = consumeSseBuffer(buffer, model.endpointType);
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
  const tail = consumeSseBuffer(`${buffer}\n\n`, model.endpointType);
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
    ...(shouldPassDeepSeekReasoningContent(model) && rawThinking ? { reasoningContent: rawThinking } : {}),
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
): { content: string; reasoningContent?: string; toolCalls?: ModelToolCall[] } {
  const openAIResponse = extractOpenAIAssistantResponse(data, options);
  if (openAIResponse.content || openAIResponse.toolCalls?.length) {
    return openAIResponse;
  }

  return extractAnthropicAssistantResponse(data, options);
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

  if ("content" in message && typeof message.content === "string") {
    const toolCalls = options.collectToolCalls ? extractOpenAIToolCalls(message) : [];
    const reasoningContent = extractOpenAIReasoningContent(message);
    return {
      content: message.content,
      ...(reasoningContent ? { reasoningContent } : {}),
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
