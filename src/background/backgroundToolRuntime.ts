import { BROWSER_TAKE_SNAPSHOT_TOOL_ID, BROWSER_TAKE_SNAPSHOT_TOOL_NAME, CURRENT_TIME_TOOL_NAME, TAVILY_SEARCH_TOOL_NAME } from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelSystemMessage, ModelToolCall, ModelToolDefinition, ModelToolExecutor, ModelToolRegistryEntry } from "../shared/models/types";
import type { ModelConfig } from "../shared/types";
import { createWebSearchToolAttachment } from "../shared/toolArtifacts";
import { createTavilySearchContextPrompt } from "../shared/webSearch/tavily";
import type { TavilySearchOptions } from "../shared/webSearch/tavily";
import { browserControlManager } from "./browserControlMessageHandler";
import { executeTavilySearchFromSettings } from "./webSearchMessageHandler";

type Fetcher = typeof fetch;

const DEFAULT_BROWSER_AUTOMATION_MAX_TOOL_ITERATIONS = 32;

export interface BackgroundToolExecutorMessage {
  model: ModelConfig;
  tavily?: TavilySearchOptions;
}

export function normalizeBrowserAutomationMaxToolIterations(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : DEFAULT_BROWSER_AUTOMATION_MAX_TOOL_ITERATIONS;
}

export function shouldExposeTool(tool: ModelToolRegistryEntry): boolean {
  if (tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID) {
    return browserControlManager.canExposeTakeSnapshotTool();
  }

  if (tool.id.startsWith("browser.")) {
    return browserControlManager.canExposeBrowserTool();
  }

  if (tool.id.startsWith("network.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  if (tool.id.startsWith("js.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  return true;
}

export function createModelToolDefinition(tool: ModelToolRegistryEntry): ModelToolDefinition {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.parameters,
  };
}

export function createBackgroundToolExecutor(message: BackgroundToolExecutorMessage, fetcher: Fetcher): ModelToolExecutor {
  return async (toolCall, tool) => {
    if (tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID && tool.name === BROWSER_TAKE_SNAPSHOT_TOOL_NAME) {
      return browserControlManager.takeSnapshot(toolCall);
    }

    if (tool.id.startsWith("browser.")) {
      return browserControlManager.executeBrowserTool(toolCall);
    }

    if (tool.id.startsWith("network.")) {
      return browserControlManager.executeNetworkTool(toolCall);
    }

    if (tool.id.startsWith("js.")) {
      return browserControlManager.executeJsSourceTool(toolCall);
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

export function appendBrowserControlPromptIfNeeded(messages: ModelRequestMessage[], enabledTools: ModelToolRegistryEntry[]): ModelRequestMessage[] {
  if (!enabledTools.some((tool) => tool.id.startsWith("browser."))) {
    return messages;
  }

  const browserPrompt = [
    "浏览器控制工具使用规则：",
    "- 仅当用户明确要求读取、分析、操作当前页面、已打开页面，或明确依赖登录后页面信息时，优先使用当前受控页面和浏览器登录态，而不是先要求用户提供 URL。",
    "- 一般知识、开发建议或未指向当前浏览器现场的问题不要调用浏览器工具。",
    ...(enabledTools.some((tool) => tool.name === TAVILY_SEARCH_TOOL_NAME)
      ? ["- 用户请求读取登录后才能看到的信息时，优先使用当前受控页面；Tavily 搜索只作为公开资料或当前页面无法访问时的兜底。"]
      : []),
    "- 需要当前页面结构时先调用 take_snapshot。",
    "- 不要猜测 UID；只能使用 take_snapshot 返回的 UID。",
    "- click、fill 和 press_key 成功后可按需设置 includeSnapshot=true 获取最新快照；失败时不要编造页面结构或操作结果。",
    "- press_key 只能用于白名单按键，并且应确认正确页面或元素已有焦点。",
    "- wait_for 只等待页面可见文本；超时后应重新 take_snapshot 或向用户说明等待失败。",
    "- 导航、切换或新建页面后旧 UID 会失效；继续操作前必须重新 take_snapshot。",
    "- 当前页面信息不足时，先使用 list_pages 或 select_page 确认受控页面，再决定是否 new_page；不要跳过现有已打开页面。",
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
