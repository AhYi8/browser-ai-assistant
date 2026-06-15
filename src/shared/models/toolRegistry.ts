import type { ModelToolRegistryEntry } from "./types";

export const TAVILY_SEARCH_TOOL_ID = "web_search.tavily";
export const TAVILY_SEARCH_TOOL_NAME = "tavily_search";
export const CURRENT_TIME_TOOL_ID = "system.current_time";
export const CURRENT_TIME_TOOL_NAME = "get_current_time";
export const BROWSER_TAKE_SNAPSHOT_TOOL_ID = "browser.take_snapshot";
export const BROWSER_TAKE_SNAPSHOT_TOOL_NAME = "take_snapshot";
export const BROWSER_CLICK_TOOL_ID = "browser.click";
export const BROWSER_CLICK_TOOL_NAME = "click";
export const BROWSER_FILL_TOOL_ID = "browser.fill";
export const BROWSER_FILL_TOOL_NAME = "fill";
export const BROWSER_PRESS_KEY_TOOL_ID = "browser.press_key";
export const BROWSER_PRESS_KEY_TOOL_NAME = "press_key";
export const BROWSER_WAIT_FOR_TOOL_ID = "browser.wait_for";
export const BROWSER_WAIT_FOR_TOOL_NAME = "wait_for";
export const BROWSER_NAVIGATE_PAGE_TOOL_ID = "browser.navigate_page";
export const BROWSER_NAVIGATE_PAGE_TOOL_NAME = "navigate_page";
export const BROWSER_NEW_PAGE_TOOL_ID = "browser.new_page";
export const BROWSER_NEW_PAGE_TOOL_NAME = "new_page";
export const BROWSER_LIST_PAGES_TOOL_ID = "browser.list_pages";
export const BROWSER_LIST_PAGES_TOOL_NAME = "list_pages";
export const BROWSER_SELECT_PAGE_TOOL_ID = "browser.select_page";
export const BROWSER_SELECT_PAGE_TOOL_NAME = "select_page";
export const BROWSER_CLOSE_PAGE_TOOL_ID = "browser.close_page";
export const BROWSER_CLOSE_PAGE_TOOL_NAME = "close_page";
export const NETWORK_LIST_REQUESTS_TOOL_ID = "network.list_requests";
export const NETWORK_LIST_REQUESTS_TOOL_NAME = "network_list_requests";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_ID = "network.get_request_details";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_NAME = "network_get_request_details";
export const NETWORK_CLEAR_REQUESTS_TOOL_ID = "network.clear_requests";
export const NETWORK_CLEAR_REQUESTS_TOOL_NAME = "network_clear_requests";
export const NETWORK_WAIT_FOR_REQUESTS_TOOL_ID = "network.wait_for_requests";
export const NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME = "network_wait_for_requests";
export const NETWORK_COMPARE_REQUESTS_TOOL_ID = "network.compare_requests";
export const NETWORK_COMPARE_REQUESTS_TOOL_NAME = "network_compare_requests";
export const NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID = "network.find_parameter_candidates";
export const NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME = "network_find_parameter_candidates";
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID = "network.extract_js_candidates";
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME = "network_extract_js_candidates";
export const JS_LIST_RESOURCES_TOOL_ID = "js.list_resources";
export const JS_LIST_RESOURCES_TOOL_NAME = "js_list_resources";
export const JS_SEARCH_SOURCES_TOOL_ID = "js.search_sources";
export const JS_SEARCH_SOURCES_TOOL_NAME = "js_search_sources";
export const JS_EXTRACT_CONTEXT_TOOL_ID = "js.extract_context";
export const JS_EXTRACT_CONTEXT_TOOL_NAME = "js_extract_context";

export const MODEL_TOOL_GROUP_SYSTEM_ID = "system";
export const MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID = "browser_automation";

export interface ModelToolGroup {
  id: string;
  label: string;
  tools: ModelToolRegistryEntry[];
}

export const AVAILABLE_MODEL_TOOLS: ModelToolRegistryEntry[] = [
  {
    id: CURRENT_TIME_TOOL_ID,
    name: CURRENT_TIME_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_SYSTEM_ID,
    displayName: "当前系统时间",
    description: "获取用户本机当前系统时间。仅在需要判断今天、当前日期、时区或时间相关问题时调用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: TAVILY_SEARCH_TOOL_ID,
    name: TAVILY_SEARCH_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_SYSTEM_ID,
    displayName: "Tavily 搜索",
    description: "使用 Tavily 搜索公开网页信息，适合需要最新资料或外部来源时调用。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要搜索的简洁问题或关键词。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_TAKE_SNAPSHOT_TOOL_ID,
    name: BROWSER_TAKE_SNAPSHOT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器页面快照",
    description: "读取当前受控网页的可访问结构快照。仅在已显式开启浏览器控制且需要理解当前页面结构时调用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_CLICK_TOOL_ID,
    name: BROWSER_CLICK_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器点击元素",
    description: "点击当前受控网页快照中的指定 UID 元素。必须先通过 take_snapshot 获取 UID，不能猜测 UID。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功点击后是否附带最新页面快照。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_FILL_TOOL_ID,
    name: BROWSER_FILL_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器填写元素",
    description: "填写当前受控网页快照中的输入、选择、复选框、单选框或开关元素。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        value: {
          type: "string",
          description: "要填写的文本；复选框、单选框和开关只接受 true 或 false。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功填写后是否附带最新页面快照。",
        },
      },
      required: ["uid", "value"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_PRESS_KEY_TOOL_ID,
    name: BROWSER_PRESS_KEY_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器按键",
    description: "向当前受控网页发送白名单键盘按键或常见组合键。使用前应确认目标页面或元素已有焦点。",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "按键名称，例如 Enter、Escape、ArrowDown、Ctrl+Enter。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功按键后是否附带最新页面快照。",
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_WAIT_FOR_TOOL_ID,
    name: BROWSER_WAIT_FOR_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器等待文本",
    description: "等待当前受控网页出现指定可见文本。超时后返回中文错误，不会继续阻塞。",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "array",
          items: { type: "string" },
          description: "任一出现即可成功的页面文本列表。",
        },
        timeout: {
          type: "number",
          minimum: 1,
          maximum: 30000,
          description: "等待毫秒数，最大 30000。",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_NAVIGATE_PAGE_TOOL_ID,
    name: BROWSER_NAVIGATE_PAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器导航页面",
    description: "在当前受控页面中执行跳转、后退、前进或刷新。导航后旧 UID 会失效，继续操作前应重新读取快照。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["goto", "back", "forward", "reload"],
          description: "导航动作：goto 跳转到 URL，back 后退，forward 前进，reload 刷新当前页。",
        },
        url: {
          type: "string",
          description: "goto 动作的目标 URL，仅允许 http 或 https 普通网页。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "导航成功后是否附带最新页面快照。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_NEW_PAGE_TOOL_ID,
    name: BROWSER_NEW_PAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器新建页面",
    description: "打开新的普通网页并加入浏览器控制后台受控页面列表，默认切换为当前受控页面。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要打开的目标 URL，仅允许 http 或 https 普通网页。",
        },
        background: {
          type: "boolean",
          description: "是否在后台打开；默认 false 表示打开后切换到新页面。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "新页面打开并切换成功后是否附带最新页面快照。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_LIST_PAGES_TOOL_ID,
    name: BROWSER_LIST_PAGES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器列出页面",
    description: "列出当前浏览器控制后台受控页面列表。select_page 和 close_page 只能使用这里返回的 index。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_SELECT_PAGE_TOOL_ID,
    name: BROWSER_SELECT_PAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器切换页面",
    description: "根据 list_pages 返回的 index 切换当前受控页面。切换后旧 UID 会失效。",
    parameters: {
      type: "object",
      properties: {
        index: {
          type: "integer",
          minimum: 1,
          description: "list_pages 返回的一基页面序号。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "切换成功后是否附带最新页面快照。",
        },
      },
      required: ["index"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_CLOSE_PAGE_TOOL_ID,
    name: BROWSER_CLOSE_PAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "浏览器关闭页面",
    description: "关闭当前浏览器控制后台受控列表中指定 index 的页面，不允许关闭列表外页面。",
    parameters: {
      type: "object",
      properties: {
        index: {
          type: "integer",
          minimum: 1,
          description: "list_pages 返回的一基页面序号。",
        },
      },
      required: ["index"],
      additionalProperties: false,
    },
  },
  {
    id: NETWORK_LIST_REQUESTS_TOOL_ID,
    name: NETWORK_LIST_REQUESTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "Network 请求列表",
    description: "列出当前受控页面后台采集到的 Network 请求元数据，可按 URL、方法、类型、状态码和数量筛选。",
    parameters: {
      type: "object",
      properties: {
        urlIncludes: { type: "string", description: "URL 中需要包含的文本。" },
        method: { type: "string", description: "请求方法，例如 GET、POST。" },
        resourceType: { type: "string", description: "资源类型，例如 XHR、Fetch、Script。" },
        status: { type: "integer", description: "HTTP 状态码。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回的请求数量。" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
    name: NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "Network 请求详情",
    description: "按请求 ID 读取脱敏后的请求头、请求体、响应头和响应体。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_CLEAR_REQUESTS_TOOL_ID,
    name: NETWORK_CLEAR_REQUESTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "清空 Network 请求",
    description: "清空当前受控页面的 Network 请求缓存，适合在执行页面操作前建立干净观察窗口。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
    name: NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "等待 Network 请求",
    description: "等待当前受控页面出现匹配条件的 Network 请求，适合点击、提交、翻页后观察新增接口。",
    parameters: {
      type: "object",
      properties: {
        urlIncludes: { type: "string", description: "URL 中需要包含的文本。" },
        method: { type: "string", description: "请求方法，例如 GET、POST。" },
        resourceType: { type: "string", description: "资源类型，例如 XHR、Fetch、Script。" },
        status: { type: "integer", description: "HTTP 状态码。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回的请求数量。" },
        timeoutMs: { type: "integer", minimum: 1, maximum: 30000, description: "等待超时时间，单位毫秒。" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: NETWORK_COMPARE_REQUESTS_TOOL_ID,
    name: NETWORK_COMPARE_REQUESTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "对比 Network 请求",
    description: "对比多条请求的 URL、Header 和 Body 字段，找出稳定字段、变化字段和疑似签名参数。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
    name: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "查找可疑参数",
    description: "从请求详情中识别疑似签名、时间戳、随机数、凭据和加密载荷字段。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
    name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "提取 JS 候选片段",
    description: "从已采集 JS 资源中按接口路径、参数名或加密关键词提取候选源码片段。",
    parameters: {
      type: "object",
      properties: {
        requestIds: { type: "array", items: { type: "string" }, description: "可选，限定要分析的 JS 请求 ID。" },
        keywords: { type: "array", items: { type: "string" }, description: "要搜索的关键词，例如 sign、md5、接口路径。" },
        urlIncludes: { type: "string", description: "要在 JS 内容中搜索的接口路径或 URL 片段。" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: JS_LIST_RESOURCES_TOOL_ID,
    name: JS_LIST_RESOURCES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "列出 JS 资源",
    description: "列出当前受控页面已采集和已同源补位的 JS 资源，供后续源码检索使用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: JS_SEARCH_SOURCES_TOOL_ID,
    name: JS_SEARCH_SOURCES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "搜索 JS 源码",
    description: "按接口路径、参数名或关键词搜索已采集 JS 源码；必要时可在严格同源限制下补位读取 JS 静态文本资源。",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 20,
          description: "要搜索的关键词、接口路径或参数名。",
        },
        urls: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "可选，同源 JS URL 候选；只有 allowSameOriginFetch 为 true 时才会尝试读取。",
        },
        allowSameOriginFetch: {
          type: "boolean",
          description: "是否允许本次工具调用按严格同源规则补位读取 JS 静态文本资源。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "最多返回的命中数量。",
        },
      },
      required: ["keywords"],
      additionalProperties: false,
    },
  },
  {
    id: JS_EXTRACT_CONTEXT_TOOL_ID,
    name: JS_EXTRACT_CONTEXT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    displayName: "提取 JS 上下文",
    description: "按 JS 资源 ID 和字符位置提取更大的源码上下文片段。",
    parameters: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "由 js.list_resources 或 js.search_sources 返回的 JS 资源 ID。",
        },
        position: {
          type: "integer",
          minimum: 0,
          description: "命中的字符位置。",
        },
      },
      required: ["resourceId", "position"],
      additionalProperties: false,
    },
  },
];

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function getRegisteredModelTools(): ModelToolRegistryEntry[] {
  return AVAILABLE_MODEL_TOOLS;
}

export function getModelToolGroups(tools: ModelToolRegistryEntry[] = getRegisteredModelTools()): ModelToolGroup[] {
  const systemTools = tools.filter((tool) => (tool.groupId ?? MODEL_TOOL_GROUP_SYSTEM_ID) === MODEL_TOOL_GROUP_SYSTEM_ID && !isBrowserAutomationToolId(tool.id));
  const browserTools = tools.filter((tool) => (tool.groupId ?? (isBrowserAutomationToolId(tool.id) ? MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID : MODEL_TOOL_GROUP_SYSTEM_ID)) === MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID);

  return [
    {
      id: MODEL_TOOL_GROUP_SYSTEM_ID,
      label: "系统内置",
      tools: systemTools,
    },
    {
      id: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
      label: "浏览器自动化",
      tools: browserTools,
    },
  ].filter((group) => group.tools.length > 0);
}

export function isBrowserAutomationToolId(toolId: string): boolean {
  return toolId.startsWith("browser.") || toolId.startsWith("network.") || toolId.startsWith("js.");
}

function createNetworkRequestIdsSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      requestIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 100,
        description: "由 network.list_requests 或 network.wait_for_requests 返回的请求 ID。",
      },
    },
    required: ["requestIds"],
    additionalProperties: false,
  };
}

export function isValidModelToolId(value: unknown): value is string {
  return typeof value === "string" && TOOL_ID_PATTERN.test(value.trim());
}

export function normalizeEnabledToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(isValidModelToolId)));
}

export function resolveEnabledModelTools(tools: ModelToolRegistryEntry[], enabledToolIds: string[]): ModelToolRegistryEntry[] {
  const enabledIds = new Set(enabledToolIds);
  return tools.filter((tool) => enabledIds.has(tool.id));
}
