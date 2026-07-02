import type { BrowserAutomationMode } from "../toolAuthorization";
import type {
  ModelToolCapability,
  ModelToolClassification,
  ModelToolRegistryEntry,
  ModelToolRisk,
  ModelToolRuntimeRequirement,
} from "./types";
import type { McpSettings } from "../types";
import { createMcpToolRegistryEntries, MODEL_TOOL_GROUP_MCP_REMOTE_ID } from "../mcp/toolAdapter";

export const TAVILY_SEARCH_TOOL_ID = "web_search.tavily";
export const TAVILY_SEARCH_TOOL_NAME = "tavily_search";
export const CURRENT_TIME_TOOL_ID = "system.current_time";
export const CURRENT_TIME_TOOL_NAME = "get_current_time";
export const BROWSER_TAKE_SNAPSHOT_TOOL_ID = "browser.take_snapshot";
export const BROWSER_TAKE_SNAPSHOT_TOOL_NAME = "take_snapshot";
export const BROWSER_GET_PAGE_STATE_TOOL_ID = "browser.get_page_state";
export const BROWSER_GET_PAGE_STATE_TOOL_NAME = "get_page_state";
export const BROWSER_EXTRACT_CONTENT_TOOL_ID = "browser.extract_content";
export const BROWSER_EXTRACT_CONTENT_TOOL_NAME = "extract_content";
export const BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID = "browser.get_console_messages";
export const BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME = "get_console_messages";
export const BROWSER_INSPECT_ELEMENT_TOOL_ID = "browser.inspect_element";
export const BROWSER_INSPECT_ELEMENT_TOOL_NAME = "inspect_element";
export const BROWSER_FIND_ELEMENTS_TOOL_ID = "browser.find_elements";
export const BROWSER_FIND_ELEMENTS_TOOL_NAME = "find_elements";
export const BROWSER_SCREENSHOT_TOOL_ID = "browser.screenshot";
export const BROWSER_SCREENSHOT_TOOL_NAME = "screenshot";
export const BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID = "browser.analyze_interaction_blocker";
export const BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME = "analyze_interaction_blocker";
export const BROWSER_ANALYZE_FORM_TOOL_ID = "browser.analyze_form";
export const BROWSER_ANALYZE_FORM_TOOL_NAME = "analyze_form";
export const BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID = "browser.get_performance_summary";
export const BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME = "get_performance_summary";
export const BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID = "browser.collect_diagnostics";
export const BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME = "collect_diagnostics";
export const BROWSER_SCROLL_TOOL_ID = "browser.scroll";
export const BROWSER_SCROLL_TOOL_NAME = "scroll";
export const BROWSER_HOVER_TOOL_ID = "browser.hover";
export const BROWSER_HOVER_TOOL_NAME = "hover";
export const BROWSER_DOUBLE_CLICK_TOOL_ID = "browser.double_click";
export const BROWSER_DOUBLE_CLICK_TOOL_NAME = "double_click";
export const BROWSER_CONTEXT_CLICK_TOOL_ID = "browser.context_click";
export const BROWSER_CONTEXT_CLICK_TOOL_NAME = "context_click";
export const BROWSER_DRAG_TOOL_ID = "browser.drag";
export const BROWSER_DRAG_TOOL_NAME = "drag";
export const BROWSER_CLICK_TOOL_ID = "browser.click";
export const BROWSER_CLICK_TOOL_NAME = "click";
export const BROWSER_FILL_TOOL_ID = "browser.fill";
export const BROWSER_FILL_TOOL_NAME = "fill";
export const BROWSER_PRESS_KEY_TOOL_ID = "browser.press_key";
export const BROWSER_PRESS_KEY_TOOL_NAME = "press_key";
export const BROWSER_WAIT_FOR_TOOL_ID = "browser.wait_for";
export const BROWSER_WAIT_FOR_TOOL_NAME = "wait_for";
export const BROWSER_WAIT_FOR_STATE_TOOL_ID = "browser.wait_for_state";
export const BROWSER_WAIT_FOR_STATE_TOOL_NAME = "wait_for_state";
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
export const SOURCEMAP_LIST_CANDIDATES_TOOL_ID = "sourcemap.list_candidates";
export const SOURCEMAP_LIST_CANDIDATES_TOOL_NAME = "sourcemap_list_candidates";
export const SOURCEMAP_RESOLVE_LOCATION_TOOL_ID = "sourcemap.resolve_location";
export const SOURCEMAP_RESOLVE_LOCATION_TOOL_NAME = "sourcemap_resolve_location";
export const SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID = "sourcemap.extract_original_context";
export const SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_NAME = "sourcemap_extract_original_context";
export const RUNTIME_INSPECT_GLOBALS_TOOL_ID = "runtime.inspect_globals";
export const RUNTIME_INSPECT_GLOBALS_TOOL_NAME = "runtime_inspect_globals";
export const RUNTIME_SEARCH_MODULES_TOOL_ID = "runtime.search_modules";
export const RUNTIME_SEARCH_MODULES_TOOL_NAME = "runtime_search_modules";
export const RUNTIME_DESCRIBE_FUNCTION_TOOL_ID = "runtime.describe_function";
export const RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME = "runtime_describe_function";
export const BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID = "boundary.request_user_choice";
export const BOUNDARY_REQUEST_USER_CHOICE_TOOL_NAME = "boundary_request_user_choice";
export const REPLAY_PREPARE_REQUEST_TOOL_ID = "replay.prepare_request";
export const REPLAY_PREPARE_REQUEST_TOOL_NAME = "replay_prepare_request";
export const REPLAY_SEND_REQUEST_TOOL_ID = "replay.send_request";
export const REPLAY_SEND_REQUEST_TOOL_NAME = "replay_send_request";
export const REPLAY_COMPARE_RESPONSES_TOOL_ID = "replay.compare_responses";
export const REPLAY_COMPARE_RESPONSES_TOOL_NAME = "replay_compare_responses";
export const FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID = "full_access.execute_script";
export const FULL_ACCESS_EXECUTE_SCRIPT_TOOL_NAME = "full_access_execute_script";
export const FULL_ACCESS_FETCH_TOOL_ID = "full_access.fetch";
export const FULL_ACCESS_FETCH_TOOL_NAME = "full_access_fetch";
export const FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID = "full_access.get_network_details";
export const FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_NAME = "full_access_get_network_details";
export const FULL_ACCESS_READ_STORAGE_TOOL_ID = "full_access.read_storage";
export const FULL_ACCESS_READ_STORAGE_TOOL_NAME = "full_access_read_storage";
export const FULL_ACCESS_REVOKE_TOOL_ID = "full_access.revoke";
export const FULL_ACCESS_REVOKE_TOOL_NAME = "full_access_revoke";

export const MODEL_TOOL_GROUP_SYSTEM_ID = "system";
export const MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID = "browser_automation";

export const MODEL_TOOL_RUNTIME_VALUES = ["local", "external_web", "browser_control", "controlled_enhanced", "full_access", "mcp_remote"] as const;
export const MODEL_TOOL_CAPABILITY_VALUES = [
  "observe_page",
  "operate_page",
  "analyze_site",
  "confirm_boundary",
  "deliver_result",
  "search_public_web",
  "system_context",
  "call_remote_tool",
] as const;
export const MODEL_TOOL_RISK_VALUES = ["low", "medium", "high", "critical"] as const;

const TOOL_CLASSIFICATION_BY_ID: Record<string, ModelToolClassification> = {
  [CURRENT_TIME_TOOL_ID]: { runtime: "local", capabilities: ["system_context"], risk: "low" },
  [TAVILY_SEARCH_TOOL_ID]: { runtime: "external_web", capabilities: ["search_public_web"], risk: "low" },
  [BROWSER_TAKE_SNAPSHOT_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
  [BROWSER_GET_PAGE_STATE_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
  [BROWSER_EXTRACT_CONTENT_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "medium" },
  [BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "medium" },
  [BROWSER_INSPECT_ELEMENT_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "low" },
  [BROWSER_FIND_ELEMENTS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
  [BROWSER_SCREENSHOT_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "medium" },
  [BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "low" },
  [BROWSER_ANALYZE_FORM_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "low" },
  [BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site", "deliver_result"], risk: "medium" },
  [BROWSER_SCROLL_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_HOVER_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_DOUBLE_CLICK_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_CONTEXT_CLICK_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_DRAG_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "high" },
  [BROWSER_CLICK_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_FILL_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_PRESS_KEY_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_WAIT_FOR_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
  [BROWSER_WAIT_FOR_STATE_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "operate_page"], risk: "low" },
  [BROWSER_NAVIGATE_PAGE_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_NEW_PAGE_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_LIST_PAGES_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
  [BROWSER_SELECT_PAGE_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [BROWSER_CLOSE_PAGE_TOOL_ID]: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
  [NETWORK_CLEAR_REQUESTS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "low" },
  [NETWORK_WAIT_FOR_REQUESTS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "low" },
  [NETWORK_LIST_REQUESTS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "low" },
  [NETWORK_GET_REQUEST_DETAILS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "medium" },
  [NETWORK_COMPARE_REQUESTS_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [JS_LIST_RESOURCES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "low" },
  [JS_SEARCH_SOURCES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [JS_EXTRACT_CONTEXT_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [SOURCEMAP_LIST_CANDIDATES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [SOURCEMAP_RESOLVE_LOCATION_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [RUNTIME_INSPECT_GLOBALS_TOOL_ID]: { runtime: "browser_control", capabilities: ["observe_page", "analyze_site"], risk: "medium" },
  [RUNTIME_SEARCH_MODULES_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [RUNTIME_DESCRIBE_FUNCTION_TOOL_ID]: { runtime: "browser_control", capabilities: ["analyze_site"], risk: "medium" },
  [BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID]: { runtime: "controlled_enhanced", capabilities: ["confirm_boundary"], risk: "high" },
  [REPLAY_PREPARE_REQUEST_TOOL_ID]: { runtime: "controlled_enhanced", capabilities: ["analyze_site", "confirm_boundary"], risk: "high" },
  [REPLAY_SEND_REQUEST_TOOL_ID]: { runtime: "controlled_enhanced", capabilities: ["analyze_site", "confirm_boundary"], risk: "high" },
  [REPLAY_COMPARE_RESPONSES_TOOL_ID]: { runtime: "controlled_enhanced", capabilities: ["analyze_site"], risk: "high" },
  [FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID]: { runtime: "full_access", capabilities: ["observe_page", "operate_page", "analyze_site"], risk: "critical" },
  [FULL_ACCESS_FETCH_TOOL_ID]: { runtime: "full_access", capabilities: ["operate_page", "analyze_site"], risk: "critical" },
  [FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID]: { runtime: "full_access", capabilities: ["observe_page", "analyze_site"], risk: "critical" },
  [FULL_ACCESS_READ_STORAGE_TOOL_ID]: { runtime: "full_access", capabilities: ["observe_page", "analyze_site"], risk: "critical" },
  [FULL_ACCESS_REVOKE_TOOL_ID]: { runtime: "full_access", capabilities: ["confirm_boundary"], risk: "critical" },
};

export interface ModelToolGroup {
  id: string;
  label: string;
  tools: ModelToolRegistryEntry[];
}

export interface ModelToolClassificationFilters {
  runtime?: ModelToolRuntimeRequirement;
  capability?: ModelToolCapability;
  risk?: ModelToolRisk;
}

const RAW_AVAILABLE_MODEL_TOOLS: Omit<ModelToolRegistryEntry, "toolClassification">[] = [
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
    requiredCapabilities: ["browser_control"],
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
    id: BROWSER_GET_PAGE_STATE_TOOL_ID,
    name: BROWSER_GET_PAGE_STATE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器页面状态",
    description: "读取当前受控网页 URL、标题、readyState、viewport、滚动位置和焦点元素摘要。仅返回脱敏截断后的页面状态，不读取完整 DOM。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_EXTRACT_CONTENT_TOOL_ID,
    name: BROWSER_EXTRACT_CONTENT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器内容提取",
    description: "从当前受控页面只读提取可见文本或 HTML。可复用发送前页面提取规则、提取全文，或按合法 CSS/XPath 提取匹配节点；不执行模型自定义脚本，不读取 Cookie、Storage 或跨域 iframe。",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["text", "html"],
          description: "提取模式。text 返回可见文本，html 返回完整 HTML 或匹配节点 outerHTML；默认 text。",
        },
        source: {
          type: "string",
          enum: ["auto_rule", "document", "selector"],
          description: "提取来源。auto_rule 使用当前提取规则并允许回退，document 提取全文，selector 使用本次提供的 CSS/XPath；默认 auto_rule。",
        },
        selectorType: {
          type: "string",
          enum: ["css", "xpath"],
          description: "source=selector 时指定选择器类型。",
        },
        selector: {
          type: "string",
          description: "source=selector 时提供的 CSS 或 XPath。必须是合法选择器，不接受 JavaScript 表达式。",
        },
        maxLength: {
          type: "integer",
          minimum: 500,
          maximum: 200000,
          description: "最大返回字符数，默认 30000。超出后会截断并标记 truncated。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID,
    name: BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器 Console 消息",
    description: "读取当前受控网页已采集的 Console 日志、JS 异常和资源错误摘要。只返回脱敏、截断后的现场诊断信息，不读取完整 DOM 或执行模型自定义脚本。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_INSPECT_ELEMENT_TOOL_ID,
    name: BROWSER_INSPECT_ELEMENT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器检查元素",
    description: "按 take_snapshot 返回的 UID 读取元素 DOM 属性、可见性、尺寸、样式和可交互摘要。不会返回完整 DOM 子树，也不接受 CSS 选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_FIND_ELEMENTS_TOOL_ID,
    name: BROWSER_FIND_ELEMENTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器查找元素",
    description: "在最近一次 take_snapshot 的 UID 候选中按文本、role、label、placeholder 或简单 CSS 查询元素。返回的 UID 可继续用于 inspect_element、click 或 fill；不会扫描完整 DOM 或执行模型自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要查找的文本、role、label、placeholder 或简单 CSS 查询。",
        },
        strategy: {
          type: "string",
          enum: ["text", "role", "label", "placeholder", "css"],
          description: "查找策略；默认 text。css 只允许简单标签、类、ID 或单个属性选择器。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "最多返回候选数量，默认 20。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_SCREENSHOT_TOOL_ID,
    name: BROWSER_SCREENSHOT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器截图",
    description: "截取当前受控页面的 PNG 图片。默认截取当前视口；也可以按 take_snapshot 返回的 UID 截取元素区域。图片通过工具附件返回，正文不会包含 base64。",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["viewport", "element"],
          description: "截图目标，默认 viewport；element 必须同时提供 take_snapshot 返回的 uid。",
        },
        uid: {
          type: "string",
          description: "target 为 element 时必填，必须来自最近一次 take_snapshot 返回的 UID。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID,
    name: BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器交互阻塞分析",
    description: "按 take_snapshot 返回的 UID 分析元素无法点击、填写或查看的常见原因。只读诊断，不执行修复；不接受选择器、XPath、坐标或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        expectedAction: {
          type: "string",
          enum: ["click", "fill", "view"],
          description: "期望诊断的交互动作，默认 click。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_ANALYZE_FORM_TOOL_ID,
    name: BROWSER_ANALYZE_FORM_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器表单分析",
    description: "分析当前页面或指定 UID 所属表单的字段数量、必填项、非法字段、禁用字段、错误文案和提交按钮状态。只读诊断，不读取字段原文值，不提交表单；不接受选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "可选。take_snapshot 返回的表单或表单内元素 UID；提供后只分析该元素所属表单。",
        },
        includeFieldDetails: {
          type: "boolean",
          description: "是否返回字段级摘要。字段摘要只包含标签和状态，不包含用户输入原文值。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID,
    name: BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器性能摘要",
    description: "读取当前受控页面的导航时序、资源耗时分组、慢资源和长任务摘要。只返回脱敏后的性能元数据，不读取响应体、Header、Cookie 或完整资源内容。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID,
    name: BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器聚合诊断",
    description: "一次性汇总当前受控页面的页面状态、Console、性能和最近 Network 错误/慢请求摘要。只返回脱敏后的现场元数据，不读取响应体、Header、Cookie 或完整资源内容。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_SCROLL_TOOL_ID,
    name: BROWSER_SCROLL_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器滚动页面",
    description: "滚动当前受控页面视口，或按 take_snapshot 返回的 UID 滚动指定可滚动元素。用于长页面、懒加载列表和隐藏内容观察；不接受选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right", "top", "bottom"],
          description: "滚动方向。top 和 bottom 会滚动到顶部或底部。",
        },
        amount: {
          type: "integer",
          minimum: 1,
          maximum: 5000,
          description: "滚动像素距离，默认 800；top 和 bottom 可省略。",
        },
        uid: {
          type: "string",
          description: "可选。来自 take_snapshot 的元素 UID；提供后滚动该元素，否则滚动当前视口。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功滚动后是否附带最新页面快照。",
        },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_HOVER_TOOL_ID,
    name: BROWSER_HOVER_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器悬停元素",
    description: "把鼠标移动到 take_snapshot 返回的 UID 元素中心，用于展开悬停菜单、提示层或触发 hover 状态。不接受选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功悬停后是否附带最新页面快照。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_DOUBLE_CLICK_TOOL_ID,
    name: BROWSER_DOUBLE_CLICK_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器双击元素",
    description: "双击 take_snapshot 返回的 UID 元素，用于触发编辑、打开条目等双击交互。不接受选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功双击后是否附带最新页面快照。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_CONTEXT_CLICK_TOOL_ID,
    name: BROWSER_CONTEXT_CLICK_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器右键元素",
    description: "右键 take_snapshot 返回的 UID 元素，仅用于打开上下文菜单；不会自动选择菜单项，也不接受选择器或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "take_snapshot 返回的元素 UID。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功右键后是否附带最新页面快照。",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_DRAG_TOOL_ID,
    name: BROWSER_DRAG_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器拖拽元素",
    description: "从 take_snapshot 返回的源 UID 拖拽到目标 UID，或拖拽有限像素偏移。属于高风险操作；不接受选择器、XPath、自定义脚本或绝对坐标。",
    parameters: {
      type: "object",
      properties: {
        sourceUid: {
          type: "string",
          description: "拖拽起点元素 UID，必须来自最近一次 take_snapshot。",
        },
        targetUid: {
          type: "string",
          description: "可选。拖拽目标元素 UID，必须来自最近一次 take_snapshot。不能和 deltaX/deltaY 同时提供。",
        },
        deltaX: {
          type: "integer",
          minimum: -2000,
          maximum: 2000,
          description: "可选。相对源元素中心的水平拖拽偏移，必须与 deltaY 同时提供。",
        },
        deltaY: {
          type: "integer",
          minimum: -2000,
          maximum: 2000,
          description: "可选。相对源元素中心的垂直拖拽偏移，必须与 deltaX 同时提供。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功拖拽后是否附带最新页面快照。",
        },
      },
      required: ["sourceUid"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_CLICK_TOOL_ID,
    name: BROWSER_CLICK_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    id: BROWSER_WAIT_FOR_STATE_TOOL_ID,
    name: BROWSER_WAIT_FOR_STATE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
    displayName: "浏览器等待状态",
    description: "等待当前受控页面 URL、readyState、take_snapshot UID 元素可见性或 Network 空闲达到目标状态。用于操作后稳定确认；不接受选择器、XPath 或自定义脚本。",
    parameters: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["url_contains", "ready_state", "element_visible", "element_hidden", "network_idle"],
          description: "要等待的状态类型。元素状态必须同时提供 take_snapshot 返回的 uid；Network 空闲不需要 value 或 uid。",
        },
        value: {
          type: "string",
          description: "url_contains 的匹配片段，或 ready_state 的目标值 loading、interactive、complete。",
        },
        uid: {
          type: "string",
          description: "等待元素可见或隐藏时必填，必须来自最近一次 take_snapshot 返回的 UID。",
        },
        timeout: {
          type: "number",
          minimum: 1,
          maximum: 30000,
          description: "等待超时时间，单位毫秒，默认 5000，最大 30000。",
        },
        includeSnapshot: {
          type: "boolean",
          description: "成功等待到状态后是否附带最新页面快照。",
        },
      },
      required: ["state"],
      additionalProperties: false,
    },
  },
  {
    id: BROWSER_NAVIGATE_PAGE_TOOL_ID,
    name: BROWSER_NAVIGATE_PAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control"],
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
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "Network 请求详情",
    description: "按请求 ID 读取脱敏后的请求头、请求体、响应头和响应体。若结果提示存在已脱敏字段且当前处于受控增强模式，必须先调用 boundary_request_user_choice 询问用户是否允许加载该边界，不能自行推断或还原敏感原文。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_CLEAR_REQUESTS_TOOL_ID,
    name: NETWORK_CLEAR_REQUESTS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "对比 Network 请求",
    description: "对比多条请求的 URL、Header 和 Body 字段，找出稳定字段、变化字段和疑似签名参数。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
    name: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "查找可疑参数",
    description: "从请求详情中识别疑似签名、时间戳、随机数、凭据和加密载荷字段。遇到已脱敏字段时，受控增强模式下必须通过 boundary_request_user_choice 显式询问用户后再继续围绕该边界分析。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
    name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
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
    requiredCapabilities: ["browser_control", "network_read"],
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
  {
    id: SOURCEMAP_LIST_CANDIDATES_TOOL_ID,
    name: SOURCEMAP_LIST_CANDIDATES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "列出 Source Map 候选",
    description: "列出当前已索引 JS 资源关联的 Source Map 候选，必要时可按严格同源规则读取外部 map。",
    parameters: {
      type: "object",
      properties: {
        resourceIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 100,
          description: "可选，限定要检查的 JS 资源 ID。",
        },
        allowSameOriginFetch: {
          type: "boolean",
          description: "是否允许本次工具调用读取同源外部 Source Map。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "最多返回的候选数量。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: SOURCEMAP_RESOLVE_LOCATION_TOOL_ID,
    name: SOURCEMAP_RESOLVE_LOCATION_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "解析 Source Map 位置",
    description: "把 JS bundle 中的一基行列位置映射到 Source Map 原始源码位置。",
    parameters: createSourceMapLocationSchema(),
  },
  {
    id: SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID,
    name: SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read"],
    displayName: "提取原始源码上下文",
    description: "按 JS bundle 的一基行列位置解析 Source Map，并从 sourcesContent 提取有限原始源码片段。",
    parameters: {
      type: "object",
      properties: {
        ...createSourceMapLocationProperties(),
        radius: {
          type: "integer",
          minimum: 80,
          maximum: 3000,
          description: "原始源码上下文半径。",
        },
      },
      required: ["resourceId", "line", "column"],
      additionalProperties: false,
    },
  },
  {
    id: RUNTIME_INSPECT_GLOBALS_TOOL_ID,
    name: RUNTIME_INSPECT_GLOBALS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
    displayName: "读取运行时全局摘要",
    description: "在用户显式开启运行时只读分析后，按安全路径读取当前页面公开全局对象摘要。不能传入任意 JavaScript。",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "要读取的公开全局路径，例如 window.__APP_CONFIG__ 或 __INITIAL_STATE__.user。",
        },
        maxDepth: {
          type: "integer",
          minimum: 1,
          maximum: 4,
          description: "对象摘要最大深度。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description: "每个对象最多返回的键或数组条目数量。",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    id: RUNTIME_SEARCH_MODULES_TOOL_ID,
    name: RUNTIME_SEARCH_MODULES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
    displayName: "搜索运行时模块摘要",
    description: "在用户显式开启运行时只读分析后，按关键词搜索常见 webpack/Vite 模块缓存摘要，不返回完整函数体。",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "要搜索的接口路径、参数名或函数关键词。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "最多返回的模块命中数量。",
        },
        radius: {
          type: "integer",
          minimum: 40,
          maximum: 500,
          description: "关键词附近摘要半径。",
        },
      },
      required: ["keywords"],
      additionalProperties: false,
    },
  },
  {
    id: RUNTIME_DESCRIBE_FUNCTION_TOOL_ID,
    name: RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
    displayName: "读取运行时函数摘要",
    description: "在用户显式开启运行时只读分析后，读取指定公开路径上的函数名称、参数数量和截断源码摘要。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "函数公开路径，例如 window.app.sign 或 __webpack_exports__.sign。不能是任意 JavaScript 表达式。",
        },
        radius: {
          type: "integer",
          minimum: 80,
          maximum: 1000,
          description: "函数源码摘要半径。",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "可选关键词，用于优先提取函数源码附近片段。",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    id: BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
    name: BOUNDARY_REQUEST_USER_CHOICE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "controlled_enhanced", "boundary_choice"],
    displayName: "请求用户边界确认",
    description: "在受控增强模式下，向用户提出边界确认问题并提供动态多选项；用户选择后只生成本轮一次性授权。任何工具结果提示已脱敏字段、敏感字段、截断摘要、请求重放沙箱、同源 JS/Source Map 上下文扩展、Runtime 或完全访问边界时，必须主动调用本工具询问用户，不能继续猜测、还原或输出敏感原文。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "要询问用户的明确中文问题。" },
        reason: { type: "string", description: "为什么需要用户确认边界。" },
        targetToolName: { type: "string", description: "可选。用户允许后要放行的下一步工具名，例如 network_get_request_details 或 replay_send_request；只要选项 grants 不为空，就必须提供该字段，否则不会生成可消费授权。" },
        targetToolArguments: { type: "object", description: "可选。用户允许后要放行的下一步工具参数；只要选项 grants 不为空，就必须提供该字段，且必须与后续实际工具调用参数一致。" },
        choices: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "选项 ID，只能包含字母、数字、下划线或短横线。" },
              title: { type: "string", description: "选项标题。" },
              description: { type: "string", description: "选项影响说明。" },
              risk: { type: "string", enum: ["low", "medium", "high"], description: "风险等级。" },
              grants: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "include_sensitive_field_in_current_tool_result",
                    "send_single_confirmed_replay_request_without_credentials",
                    "expand_runtime_summary_depth",
                    "expand_js_or_sourcemap_context",
                    "write_sensitive_result_to_chat_once",
                  ],
                },
                description: "该选项授予的一次性受控增强能力。",
              },
            },
            required: ["id", "title", "description", "risk", "grants"],
            additionalProperties: false,
          },
        },
        allowMultiple: { type: "boolean", description: "是否允许用户多选。" },
        expiresInMs: { type: "integer", minimum: 10000, maximum: 300000, description: "问题有效期，单位毫秒。" },
      },
      required: ["question", "reason", "choices"],
      additionalProperties: false,
    },
  },
  {
    id: REPLAY_PREPARE_REQUEST_TOOL_ID,
    name: REPLAY_PREPARE_REQUEST_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
    displayName: "生成请求重放草案",
    description: "基于已采集请求生成脱敏重放草案，不会发起网络请求。",
    parameters: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "由 network.list_requests 或 network.wait_for_requests 返回的请求 ID。" },
      },
      required: ["requestId"],
      additionalProperties: false,
    },
  },
  {
    id: REPLAY_SEND_REQUEST_TOOL_ID,
    name: REPLAY_SEND_REQUEST_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
    displayName: "发送请求重放草案",
    description: "发送已确认、未过期且无凭据的请求重放草案，返回脱敏截断响应摘要；未确认、过期、跨边界、敏感 Header 或超出沙箱限制时必须停止并请求用户边界确认。",
    parameters: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "replay.prepare_request 返回的草案 ID。" },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    id: REPLAY_COMPARE_RESPONSES_TOOL_ID,
    name: REPLAY_COMPARE_RESPONSES_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
    displayName: "对比请求重放响应",
    description: "对比原始采集响应摘要与请求重放响应摘要，只返回结构和字段差异。",
    parameters: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "已发送的请求重放草案 ID。" },
      },
      required: ["draftId"],
      additionalProperties: false,
    },
  },
  {
    id: FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
    name: FULL_ACCESS_EXECUTE_SCRIPT_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "full_access"],
    displayName: "完全访问执行脚本",
    description: "在当前完全访问页面上下文执行任意 JavaScript，并返回原始执行结果。该工具只在用户切换到完全访问模式后暴露，不做脱敏、只读限制或敏感信息过滤。",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "要在当前页面执行的 JavaScript 表达式或脚本。" },
        awaitPromise: { type: "boolean", description: "是否等待 Promise 结果，默认等待。" },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    id: FULL_ACCESS_FETCH_TOOL_ID,
    name: FULL_ACCESS_FETCH_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "full_access"],
    displayName: "完全访问页面请求",
    description: "在当前页面上下文发起任意 fetch 请求，默认 credentials=include，并返回原始响应摘要。该工具不套用请求重放沙箱限制。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "请求目标 URL，可为页面 fetch 支持的绝对或相对 URL。" },
        method: { type: "string", description: "请求方法，默认 GET。" },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "请求 Header 原样传入页面 fetch。",
        },
        body: { type: "string", description: "请求体原文。" },
        credentials: {
          type: "string",
          enum: ["include", "same-origin", "omit"],
          description: "fetch credentials，默认 include。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    id: FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID,
    name: FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "full_access"],
    displayName: "完全访问 Network 原文",
    description: "读取已采集 Network 请求和响应完整原文，不做脱敏、截断过滤或敏感字段屏蔽。",
    parameters: createNetworkRequestIdsSchema(),
  },
  {
    id: FULL_ACCESS_READ_STORAGE_TOOL_ID,
    name: FULL_ACCESS_READ_STORAGE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "full_access"],
    displayName: "完全访问读取存储",
    description: "读取当前页面可访问的 Cookie、localStorage、sessionStorage 和页面状态原文。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: FULL_ACCESS_REVOKE_TOOL_ID,
    name: FULL_ACCESS_REVOKE_TOOL_NAME,
    groupId: MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
    requiredCapabilities: ["browser_control", "full_access"],
    displayName: "撤销完全访问",
    description: "退出完全访问模式并清理当前运行态授权。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export const AVAILABLE_MODEL_TOOLS: ModelToolRegistryEntry[] = RAW_AVAILABLE_MODEL_TOOLS.map((tool) => ({
  ...tool,
  toolClassification: getRequiredToolClassification(tool.id),
}));

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MCP_TOOL_ID_PATTERN = /^mcp\.[^.]+\..+$/;

function getRequiredToolClassification(toolId: string): ModelToolClassification {
  const classification = TOOL_CLASSIFICATION_BY_ID[toolId];
  if (!classification) {
    throw new Error(`模型工具 ${toolId} 缺少结构化分类`);
  }

  return classification;
}

export function getRegisteredModelTools(mcpSettings?: McpSettings): ModelToolRegistryEntry[] {
  return mcpSettings ? [...AVAILABLE_MODEL_TOOLS, ...createMcpToolRegistryEntries(mcpSettings.servers)] : AVAILABLE_MODEL_TOOLS;
}

export function getModelToolGroups(tools: ModelToolRegistryEntry[] = getRegisteredModelTools()): ModelToolGroup[] {
  const systemTools = tools.filter((tool) => (tool.groupId ?? MODEL_TOOL_GROUP_SYSTEM_ID) === MODEL_TOOL_GROUP_SYSTEM_ID && !isBrowserAutomationToolId(tool.id));
  const browserTools = tools.filter((tool) => (tool.groupId ?? (isBrowserAutomationToolId(tool.id) ? MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID : MODEL_TOOL_GROUP_SYSTEM_ID)) === MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID);
  const mcpTools = tools.filter((tool) => (tool.groupId ?? "") === MODEL_TOOL_GROUP_MCP_REMOTE_ID);

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
    {
      id: MODEL_TOOL_GROUP_MCP_REMOTE_ID,
      label: "MCP 远程工具",
      tools: mcpTools,
    },
  ].filter((group) => group.tools.length > 0);
}

export function isBrowserAutomationToolId(toolId: string): boolean {
  return toolId.startsWith("browser.") ||
    toolId.startsWith("network.") ||
    toolId.startsWith("js.") ||
    toolId.startsWith("sourcemap.") ||
    toolId.startsWith("runtime.") ||
    toolId.startsWith("boundary.") ||
    toolId.startsWith("replay.") ||
    toolId.startsWith("full_access.");
}

export function isRuntimeReadonlyToolId(toolId: string): boolean {
  return toolId.startsWith("runtime.");
}

export function isControlledEnhancedToolId(toolId: string): boolean {
  return toolId.startsWith("boundary.") || toolId.startsWith("replay.");
}

export function isDebuggerRuntimeRequirement(runtime: ModelToolRuntimeRequirement): boolean {
  return runtime === "browser_control" || runtime === "controlled_enhanced" || runtime === "full_access";
}

export function isToolRuntimeAvailable(
  tool: ModelToolRegistryEntry,
  browserControlEnabled: boolean,
  browserAutomationMode: BrowserAutomationMode = "normal_restricted",
): boolean {
  const runtime = tool.toolClassification?.runtime;
  if (runtime === "local" || runtime === "external_web" || runtime === "mcp_remote" || runtime === undefined) {
    return true;
  }

  if (!browserControlEnabled) {
    return false;
  }

  if (runtime === "browser_control") {
    return true;
  }

  if (runtime === "controlled_enhanced") {
    return browserAutomationMode === "controlled_enhanced";
  }

  return browserAutomationMode === "full_access";
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

function createSourceMapLocationProperties(): Record<string, unknown> {
  return {
    resourceId: {
      type: "string",
      description: "由 js.list_resources、js.search_sources 或 sourcemap.list_candidates 返回的 JS 资源 ID。",
    },
    line: {
      type: "integer",
      minimum: 1,
      description: "JS bundle 中的一基行号。",
    },
    column: {
      type: "integer",
      minimum: 1,
      description: "JS bundle 中的一基列号。",
    },
    allowSameOriginFetch: {
      type: "boolean",
      description: "是否允许本次工具调用读取同源外部 Source Map。",
    },
  };
}

function createSourceMapLocationSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: createSourceMapLocationProperties(),
    required: ["resourceId", "line", "column"],
    additionalProperties: false,
  };
}

export function isValidModelToolId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return false;
  }

  return TOOL_ID_PATTERN.test(trimmedValue) || MCP_TOOL_ID_PATTERN.test(trimmedValue);
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

export function filterModelToolsByClassification(
  tools: ModelToolRegistryEntry[],
  filters: ModelToolClassificationFilters,
): ModelToolRegistryEntry[] {
  return tools.filter((tool) => {
    const classification = tool.toolClassification;
    if (!classification) {
      return false;
    }

    return (filters.runtime === undefined || classification.runtime === filters.runtime) &&
      (filters.risk === undefined || classification.risk === filters.risk) &&
      (filters.capability === undefined || classification.capabilities.includes(filters.capability));
  });
}
