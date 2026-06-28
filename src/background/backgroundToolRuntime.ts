import {
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  BROWSER_TAKE_SNAPSHOT_TOOL_NAME,
  BROWSER_EXTRACT_CONTENT_TOOL_ID,
  CURRENT_TIME_TOOL_NAME,
  RUNTIME_DESCRIBE_FUNCTION_TOOL_ID,
  RUNTIME_INSPECT_GLOBALS_TOOL_ID,
  RUNTIME_SEARCH_MODULES_TOOL_ID,
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
  FULL_ACCESS_FETCH_TOOL_ID,
  FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID,
  FULL_ACCESS_READ_STORAGE_TOOL_ID,
  FULL_ACCESS_REVOKE_TOOL_ID,
  isBrowserAutomationToolId,
  REPLAY_COMPARE_RESPONSES_TOOL_ID,
  REPLAY_PREPARE_REQUEST_TOOL_ID,
  REPLAY_SEND_REQUEST_TOOL_ID,
  TAVILY_SEARCH_TOOL_NAME,
} from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelSystemMessage, ModelToolCall, ModelToolDefinition, ModelToolExecutor, ModelToolRegistryEntry } from "../shared/models/types";
import { getAutomationPlaybookById } from "../shared/automationPlaybooks";
import type { AutomationPlaybookSelection, ExtractionRule, ModelConfig } from "../shared/types";
import { createWebSearchToolAttachment } from "../shared/toolArtifacts";
import { createTavilySearchContextPrompt } from "../shared/webSearch/tavily";
import type { TavilySearchOptions } from "../shared/webSearch/tavily";
import { browserControlManager } from "./browserControlMessageHandler";
import { executeTavilySearchFromSettings } from "./webSearchMessageHandler";

type Fetcher = typeof fetch;

const DEFAULT_BROWSER_AUTOMATION_MAX_TOOL_ITERATIONS = 32;

export interface BackgroundToolExecutorMessage {
  model: ModelConfig;
  extractionRules?: ExtractionRule[];
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

  if (tool.id.startsWith("sourcemap.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  if (tool.id.startsWith("runtime.")) {
    return browserControlManager.canExposeRuntimeReadTool();
  }

  if (tool.id.startsWith("boundary.")) {
    return browserControlManager.canExposeBoundaryChoiceTool();
  }

  if (tool.id.startsWith("replay.")) {
    return browserControlManager.canExposeReplayTool();
  }

  if (tool.id.startsWith("full_access.")) {
    return browserControlManager.canExposeFullAccessTool();
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

    if (tool.id === BROWSER_EXTRACT_CONTENT_TOOL_ID) {
      return browserControlManager.extractContent(toolCall, message.extractionRules ?? []);
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

    if (tool.id.startsWith("sourcemap.")) {
      return browserControlManager.executeSourceMapTool(toolCall);
    }

    if (tool.id === RUNTIME_INSPECT_GLOBALS_TOOL_ID ||
      tool.id === RUNTIME_SEARCH_MODULES_TOOL_ID ||
      tool.id === RUNTIME_DESCRIBE_FUNCTION_TOOL_ID) {
      return browserControlManager.executeRuntimeReadTool(toolCall);
    }

    if (tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID) {
      return browserControlManager.executeBoundaryChoiceTool(toolCall);
    }

    if (tool.id === REPLAY_PREPARE_REQUEST_TOOL_ID ||
      tool.id === REPLAY_SEND_REQUEST_TOOL_ID ||
      tool.id === REPLAY_COMPARE_RESPONSES_TOOL_ID) {
      return browserControlManager.executeReplayTool(toolCall);
    }

    if (tool.id === FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID ||
      tool.id === FULL_ACCESS_FETCH_TOOL_ID ||
      tool.id === FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID ||
      tool.id === FULL_ACCESS_READ_STORAGE_TOOL_ID ||
      tool.id === FULL_ACCESS_REVOKE_TOOL_ID) {
      return browserControlManager.executeFullAccessTool(toolCall);
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

export function appendBrowserControlPromptIfNeeded(
  messages: ModelRequestMessage[],
  enabledTools: ModelToolRegistryEntry[],
  automationPlaybookSelection?: AutomationPlaybookSelection,
): ModelRequestMessage[] {
  if (!enabledTools.some((tool) => isBrowserAutomationToolId(tool.id))) {
    return messages;
  }

  const browserPrompt = [
    "浏览器控制工具使用规则：",
    "- 仅当用户明确要求读取、分析、操作当前页面、已打开页面，或明确依赖登录后页面信息时，优先使用当前受控页面和浏览器登录态，而不是先要求用户提供 URL。",
    "- 一般知识、开发建议或未指向当前浏览器现场的问题不要调用浏览器工具。",
    "- 按观察页面、操作页面、分析现场、请求确认、交付结果组织工具调用，避免把不同能力边界混在同一步里。",
    "- 优先使用观察页面工具确认现场，再执行操作页面工具；操作后必须用快照、等待、页面状态、Console 或 Network 等证据验证结果。",
    "- 高风险或最高风险工具结果不能替代用户确认；涉及删除、发布、付款、发送消息、跨站点跳转、第三方授权页、文件上传、下载、本地文件路径、请求重放或完全访问边界时，必须遵守当前运行态和边界确认要求。",
    ...(enabledTools.some((tool) => tool.name === TAVILY_SEARCH_TOOL_NAME)
      ? ["- 用户请求读取登录后才能看到的信息时，优先使用当前受控页面；Tavily 搜索只作为公开资料或当前页面无法访问时的兜底。"]
      : []),
    "- 需要当前页面结构时先调用 take_snapshot。",
    "- 需要确认 URL、标题、加载状态、视口、滚动位置或当前焦点时，优先调用 get_page_state。",
    "- 需要读取当前页面正文、全文 HTML，或按发送前提取规则、CSS、XPath 提取局部 HTML/文本时，调用 extract_content；该工具只读，不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe。",
    "- 需要确认页面视觉状态时调用 screenshot；截图图片只会作为工具附件返回，正文不会包含 base64。",
    "- 需要排查页面报错、JS 异常、资源加载失败或控制台日志时，优先调用 get_console_messages。",
    "- 需要按文本、role、label、placeholder 或简单 CSS 定位候选元素时，先使用 take_snapshot，再调用 find_elements 获取可继续操作的 UID。",
    "- 需要确认某个元素的属性、可见性、尺寸、样式或可交互状态时，先使用 take_snapshot 获取 UID，再调用 inspect_element。",
    "- 点击、填写或查看元素失败时，可先使用 take_snapshot 获取 UID，再调用 analyze_interaction_blocker 分析禁用、不可见、遮挡、pointer-events、表单校验等常见阻塞原因；该工具只读诊断，不会修复页面。",
    "- 需要排查表单无法提交、按钮禁用、必填项缺失或错误文案时，调用 analyze_form；如已知道表单或字段 UID，可传 uid 限定范围。该工具只读诊断，不会读取字段原文值或提交表单。",
    "- 需要排查页面加载慢、资源耗时或主线程长任务时，调用 get_performance_summary；该工具只返回脱敏性能元数据，不读取 Header、Cookie、响应体或资源内容。",
    "- 需要一次性汇总页面状态、Console、性能和 Network 错误/慢请求现场时，调用 collect_diagnostics；该工具只返回脱敏聚合摘要，不读取响应体、Header、Cookie 或敏感原文。",
    "- 需要截取元素图片时，先使用 take_snapshot 获取 UID，再调用 screenshot 且 target=element；不要传 CSS 选择器或自定义脚本。",
    "- 不要猜测 UID；只能使用 take_snapshot 返回的 UID。",
    "- 长页面、虚拟列表或懒加载内容需要继续观察时，可调用 scroll 滚动当前视口；滚动指定元素时必须先使用 take_snapshot 获取 UID。",
    "- 需要展开悬停菜单、提示层或触发 hover 状态时，先使用 take_snapshot 获取 UID，再调用 hover；不要传 CSS 选择器或自定义脚本。",
    "- 需要触发双击编辑或打开条目时，先使用 take_snapshot 获取 UID，再调用 double_click；不要传 CSS 选择器或自定义脚本。",
    "- 需要打开元素上下文菜单时，先使用 take_snapshot 获取 UID，再调用 context_click；它只负责打开菜单，不会自动选择菜单项，不要编造菜单结果。",
    "- 需要拖拽元素时，先使用 take_snapshot 获取 sourceUid；目标只能是 targetUid，或有限的 deltaX/deltaY 相对偏移。drag 是高风险操作，不要传绝对坐标、选择器或自定义脚本。",
    "- click、fill、press_key、scroll、hover、double_click、context_click、drag 和 wait_for_state 成功后可按需设置 includeSnapshot=true 获取最新快照；失败时不要编造页面结构或操作结果。",
    "- press_key 只能用于白名单按键，并且应确认正确页面或元素已有焦点。",
    "- wait_for 只等待页面可见文本；超时后应重新 take_snapshot 或向用户说明等待失败。",
    "- 需要等待 URL 片段、readyState、UID 元素可见/隐藏或 Network 空闲时调用 wait_for_state；等待元素状态必须先使用 take_snapshot 获取 UID，等待 Network 空闲使用 state=network_idle，不要传 CSS 选择器、XPath 或自定义脚本。",
    "- 导航、切换或新建页面后旧 UID 会失效；继续操作前必须重新 take_snapshot。",
    "- 当前页面信息不足时，先使用 list_pages 或 select_page 确认受控页面，再决定是否 new_page；不要跳过现有已打开页面。",
    "- 多页面操作只能使用 list_pages 返回的 index，不要猜测页面序号。",
    "- 遇到网页 JS 弹窗时会等待用户手动处理；不要编造用户选择或弹窗处理结果。",
    ...(enabledTools.some((tool) => tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)
      ? [
          "- 当前处于受控增强模式时，如果任何 browser/network/js/sourcemap/runtime/replay 工具结果提示存在脱敏字段、敏感字段、截断摘要、请求重放、同源资源读取、Runtime/完全访问边界或其他需要用户授权的边界，必须立即调用 boundary_request_user_choice 显式询问用户；在用户提交前不要继续执行依赖该边界的分析或工具调用。",
          "- 涉及表单提交、删除、付款、发布或发送消息时，先调用 boundary_request_user_choice 询问用户是否允许继续；不要把按钮文案、模型推断或工具成功当作用户确认。",
          "- 涉及跨站点跳转或第三方授权页时，先调用 boundary_request_user_choice 询问用户是否允许离开当前站点或继续授权流程；不要把 URL、页面标题或跳转成功当作用户确认。",
          "- 涉及文件上传、下载或本地文件路径时，先调用 boundary_request_user_choice 询问用户是否允许继续；不要自行编造、读取或复用本地路径，也不要把页面出现文件控件或下载链接当作用户确认。",
          "- boundary_request_user_choice 的问题和选项必须具体说明要加载的边界、风险和一次性授权范围；只要选项 grants 不为空，就必须同时填写 targetToolName 和 targetToolArguments，用来绑定用户允许后真正放行的下一步工具。",
          "- 不要把用户未确认的敏感原文写入回答或发送给远端模型；如果边界确认缺少目标工具绑定而失败，必须重新发起带目标工具和参数的确认，不要假装已经获得授权。",
        ]
      : []),
    ...(enabledTools.some((tool) => tool.id.startsWith("full_access."))
      ? [
          "- 当前处于完全访问模式，用户已授权当前会话最高权限；需要读取敏感原文、执行任意脚本、携带页面凭据请求、读取存储或读取 Network 原文时，直接使用 full_access.* 工具。",
          "- 完全访问模式不需要调用 boundary_request_user_choice，不使用请求重放沙箱，也不要求对工具结果脱敏、过滤或只读化；但仍不能声称绕过 Chrome、网页 CSP 或扩展平台本身的硬限制。",
        ]
      : []),
  ].join("\n");
  const playbookPrompt = createSelectedAutomationPlaybookPrompt(automationPlaybookSelection);
  const finalPrompt = playbookPrompt ? `${browserPrompt}\n\n${playbookPrompt}` : browserPrompt;
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    return messages.map((message, index) =>
      index === systemIndex
        ? { ...message, content: `${message.content}\n\n${finalPrompt}` }
        : message,
    );
  }

  const systemMessage: ModelSystemMessage = {
    role: "system",
    content: finalPrompt,
  };
  return [systemMessage, ...messages];
}

function createSelectedAutomationPlaybookPrompt(selection: AutomationPlaybookSelection | undefined): string | undefined {
  if (!selection) {
    return undefined;
  }
  const playbook = getAutomationPlaybookById(selection.playbookId);
  if (!playbook) {
    return undefined;
  }
  return [
    `当前选中的浏览器自动化任务策略：${playbook.title}`,
    `选择理由：${selection.reason}`,
    `置信度：${selection.confidence}`,
    "策略提示：",
    playbook.prompt,
    "注意：任务策略只影响工具调用规划，不会开启未启用工具、提升运行态权限或绕过边界确认。",
  ].join("\n");
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
