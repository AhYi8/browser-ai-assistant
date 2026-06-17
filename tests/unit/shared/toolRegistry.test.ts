import { describe, expect, it } from "vitest";
import {
  BROWSER_CLICK_TOOL_ID,
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_FILL_TOOL_ID,
  BROWSER_FILL_TOOL_NAME,
  BROWSER_LIST_PAGES_TOOL_ID,
  BROWSER_LIST_PAGES_TOOL_NAME,
  BROWSER_NAVIGATE_PAGE_TOOL_ID,
  BROWSER_NAVIGATE_PAGE_TOOL_NAME,
  BROWSER_NEW_PAGE_TOOL_ID,
  BROWSER_NEW_PAGE_TOOL_NAME,
  BROWSER_PRESS_KEY_TOOL_ID,
  BROWSER_PRESS_KEY_TOOL_NAME,
  BROWSER_SELECT_PAGE_TOOL_ID,
  BROWSER_SELECT_PAGE_TOOL_NAME,
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  BROWSER_TAKE_SNAPSHOT_TOOL_NAME,
  BROWSER_WAIT_FOR_TOOL_ID,
  BROWSER_WAIT_FOR_TOOL_NAME,
  BROWSER_CLOSE_PAGE_TOOL_ID,
  BROWSER_CLOSE_PAGE_TOOL_NAME,
  CURRENT_TIME_TOOL_ID,
  CURRENT_TIME_TOOL_NAME,
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
  JS_EXTRACT_CONTEXT_TOOL_ID,
  JS_LIST_RESOURCES_TOOL_ID,
  JS_SEARCH_SOURCES_TOOL_ID,
  RUNTIME_DESCRIBE_FUNCTION_TOOL_ID,
  RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME,
  RUNTIME_INSPECT_GLOBALS_TOOL_ID,
  RUNTIME_INSPECT_GLOBALS_TOOL_NAME,
  RUNTIME_SEARCH_MODULES_TOOL_ID,
  RUNTIME_SEARCH_MODULES_TOOL_NAME,
  SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID,
  SOURCEMAP_LIST_CANDIDATES_TOOL_ID,
  SOURCEMAP_RESOLVE_LOCATION_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
  TAVILY_SEARCH_TOOL_NAME,
  getRegisteredModelTools,
  getModelToolGroups,
} from "../../../src/shared/models/toolRegistry";

describe("模型工具注册表", () => {
  it("注册 Tavily 搜索工具供工具调用菜单和 background allow-list 使用", () => {
    const tavilyTool = getRegisteredModelTools().find((tool) => tool.id === TAVILY_SEARCH_TOOL_ID);

    expect(tavilyTool).toMatchObject({
      id: TAVILY_SEARCH_TOOL_ID,
      name: TAVILY_SEARCH_TOOL_NAME,
      parameters: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
      },
    });
  });

  it("注册当前系统时间工具且不要求模型提供参数", () => {
    const currentTimeTool = getRegisteredModelTools().find((tool) => tool.id === CURRENT_TIME_TOOL_ID);

    expect(currentTimeTool).toMatchObject({
      id: CURRENT_TIME_TOOL_ID,
      name: CURRENT_TIME_TOOL_NAME,
      displayName: "当前系统时间",
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
  });

  it("注册浏览器页面快照工具且不接受模型参数", () => {
    const snapshotTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID);

    expect(snapshotTool).toMatchObject({
      id: BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      name: BROWSER_TAKE_SNAPSHOT_TOOL_NAME,
      displayName: "浏览器页面快照",
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
  });

  it("注册阶段三浏览器基础操作工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();
    const clickTool = tools.find((tool) => tool.id === BROWSER_CLICK_TOOL_ID);
    const fillTool = tools.find((tool) => tool.id === BROWSER_FILL_TOOL_ID);
    const pressKeyTool = tools.find((tool) => tool.id === BROWSER_PRESS_KEY_TOOL_ID);
    const waitForTool = tools.find((tool) => tool.id === BROWSER_WAIT_FOR_TOOL_ID);

    expect(clickTool).toMatchObject({
      id: BROWSER_CLICK_TOOL_ID,
      name: BROWSER_CLICK_TOOL_NAME,
      displayName: "浏览器点击元素",
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(clickTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });

    expect(fillTool).toMatchObject({
      id: BROWSER_FILL_TOOL_ID,
      name: BROWSER_FILL_TOOL_NAME,
      displayName: "浏览器填写元素",
      parameters: {
        type: "object",
        required: ["uid", "value"],
        additionalProperties: false,
      },
    });
    expect(fillTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      value: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });

    expect(pressKeyTool).toMatchObject({
      id: BROWSER_PRESS_KEY_TOOL_ID,
      name: BROWSER_PRESS_KEY_TOOL_NAME,
      displayName: "浏览器按键",
      parameters: {
        type: "object",
        required: ["key"],
        additionalProperties: false,
      },
    });
    expect(pressKeyTool?.parameters.properties).toMatchObject({
      key: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });

    expect(waitForTool).toMatchObject({
      id: BROWSER_WAIT_FOR_TOOL_ID,
      name: BROWSER_WAIT_FOR_TOOL_NAME,
      displayName: "浏览器等待文本",
      parameters: {
        type: "object",
        required: ["text"],
        additionalProperties: false,
      },
    });
    expect(waitForTool?.parameters.properties).toMatchObject({
      text: { type: "array", items: { type: "string" } },
      timeout: { type: "number", minimum: 1, maximum: 30000 },
    });
  });

  it("注册阶段四浏览器导航和多页面工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();
    const navigateTool = tools.find((tool) => tool.id === BROWSER_NAVIGATE_PAGE_TOOL_ID);
    const newPageTool = tools.find((tool) => tool.id === BROWSER_NEW_PAGE_TOOL_ID);
    const listPagesTool = tools.find((tool) => tool.id === BROWSER_LIST_PAGES_TOOL_ID);
    const selectPageTool = tools.find((tool) => tool.id === BROWSER_SELECT_PAGE_TOOL_ID);
    const closePageTool = tools.find((tool) => tool.id === BROWSER_CLOSE_PAGE_TOOL_ID);

    expect(navigateTool).toMatchObject({
      id: BROWSER_NAVIGATE_PAGE_TOOL_ID,
      name: BROWSER_NAVIGATE_PAGE_TOOL_NAME,
      displayName: "浏览器导航页面",
      parameters: {
        type: "object",
        required: ["action"],
        additionalProperties: false,
      },
    });
    expect(navigateTool?.parameters.properties).toMatchObject({
      action: { type: "string", enum: ["goto", "back", "forward", "reload"] },
      url: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });

    expect(newPageTool).toMatchObject({
      id: BROWSER_NEW_PAGE_TOOL_ID,
      name: BROWSER_NEW_PAGE_TOOL_NAME,
      displayName: "浏览器新建页面",
      parameters: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
      },
    });
    expect(newPageTool?.parameters.properties).toMatchObject({
      url: { type: "string" },
      background: { type: "boolean" },
      includeSnapshot: { type: "boolean" },
    });

    expect(listPagesTool).toMatchObject({
      id: BROWSER_LIST_PAGES_TOOL_ID,
      name: BROWSER_LIST_PAGES_TOOL_NAME,
      displayName: "浏览器列出页面",
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });

    expect(selectPageTool).toMatchObject({
      id: BROWSER_SELECT_PAGE_TOOL_ID,
      name: BROWSER_SELECT_PAGE_TOOL_NAME,
      displayName: "浏览器切换页面",
      parameters: {
        type: "object",
        required: ["index"],
        additionalProperties: false,
      },
    });
    expect(selectPageTool?.parameters.properties).toMatchObject({
      index: { type: "integer", minimum: 1 },
      includeSnapshot: { type: "boolean" },
    });

    expect(closePageTool).toMatchObject({
      id: BROWSER_CLOSE_PAGE_TOOL_ID,
      name: BROWSER_CLOSE_PAGE_TOOL_NAME,
      displayName: "浏览器关闭页面",
      parameters: {
        type: "object",
        required: ["index"],
        additionalProperties: false,
      },
    });
    expect(closePageTool?.parameters.properties).toMatchObject({
      index: { type: "integer", minimum: 1 },
    });
  });

  it("浏览器自动化工具归入浏览器自动化分组，便于检索和识别", () => {
    const groups = getModelToolGroups(getRegisteredModelTools());
    const browserGroup = groups.find((group) => group.id === "browser_automation");

    expect(browserGroup).toMatchObject({
      id: "browser_automation",
      label: "浏览器自动化",
    });
    expect(browserGroup?.tools.map((tool) => tool.id)).toEqual([
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
      BROWSER_FILL_TOOL_ID,
      BROWSER_PRESS_KEY_TOOL_ID,
      BROWSER_WAIT_FOR_TOOL_ID,
      BROWSER_NAVIGATE_PAGE_TOOL_ID,
      BROWSER_NEW_PAGE_TOOL_ID,
      BROWSER_LIST_PAGES_TOOL_ID,
      BROWSER_SELECT_PAGE_TOOL_ID,
      BROWSER_CLOSE_PAGE_TOOL_ID,
      NETWORK_LIST_REQUESTS_TOOL_ID,
      NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
      NETWORK_CLEAR_REQUESTS_TOOL_ID,
      NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
      NETWORK_COMPARE_REQUESTS_TOOL_ID,
      NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
      NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
      JS_LIST_RESOURCES_TOOL_ID,
      JS_SEARCH_SOURCES_TOOL_ID,
      JS_EXTRACT_CONTEXT_TOOL_ID,
      SOURCEMAP_LIST_CANDIDATES_TOOL_ID,
      SOURCEMAP_RESOLVE_LOCATION_TOOL_ID,
      SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID,
      RUNTIME_INSPECT_GLOBALS_TOOL_ID,
      RUNTIME_SEARCH_MODULES_TOOL_ID,
      RUNTIME_DESCRIBE_FUNCTION_TOOL_ID,
    ]);
  });

  it("注册 Network 自动化工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === NETWORK_LIST_REQUESTS_TOOL_ID)).toMatchObject({
      name: "network_list_requests",
      parameters: { type: "object", additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === NETWORK_GET_REQUEST_DETAILS_TOOL_ID)).toMatchObject({
      name: "network_get_request_details",
      parameters: { type: "object", required: ["requestIds"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === NETWORK_COMPARE_REQUESTS_TOOL_ID)).toMatchObject({
      name: "network_compare_requests",
      parameters: { type: "object", required: ["requestIds"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID)).toMatchObject({
      name: "network_find_parameter_candidates",
      parameters: { type: "object", required: ["requestIds"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID)).toMatchObject({
      name: "network_extract_js_candidates",
      parameters: { type: "object", additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === NETWORK_WAIT_FOR_REQUESTS_TOOL_ID)?.parameters.properties).toMatchObject({
      limit: { type: "integer", minimum: 1, maximum: 200 },
    });
  });

  it("注册 JS 源码检索工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === JS_LIST_RESOURCES_TOOL_ID)).toMatchObject({
      name: "js_list_resources",
      parameters: { type: "object", additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === JS_SEARCH_SOURCES_TOOL_ID)).toMatchObject({
      name: "js_search_sources",
      parameters: { type: "object", required: ["keywords"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === JS_EXTRACT_CONTEXT_TOOL_ID)).toMatchObject({
      name: "js_extract_context",
      parameters: { type: "object", required: ["resourceId", "position"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === JS_SEARCH_SOURCES_TOOL_ID)?.parameters.properties).toMatchObject({
      keywords: { type: "array", minItems: 1, maxItems: 20 },
      urls: { type: "array", maxItems: 20 },
      allowSameOriginFetch: { type: "boolean" },
    });
  });

  it("注册 Source Map 工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === SOURCEMAP_LIST_CANDIDATES_TOOL_ID)).toMatchObject({
      name: "sourcemap_list_candidates",
      parameters: { type: "object", additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === SOURCEMAP_RESOLVE_LOCATION_TOOL_ID)).toMatchObject({
      name: "sourcemap_resolve_location",
      parameters: { type: "object", required: ["resourceId", "line", "column"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID)).toMatchObject({
      name: "sourcemap_extract_original_context",
      parameters: { type: "object", required: ["resourceId", "line", "column"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID)?.parameters.properties).toMatchObject({
      resourceId: { type: "string" },
      line: { type: "integer", minimum: 1 },
      column: { type: "integer", minimum: 1 },
      allowSameOriginFetch: { type: "boolean" },
      radius: { type: "integer", minimum: 80, maximum: 3000 },
    });
  });

  it("注册运行时只读工具并声明高风险只读能力", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === RUNTIME_INSPECT_GLOBALS_TOOL_ID)).toMatchObject({
      name: RUNTIME_INSPECT_GLOBALS_TOOL_NAME,
      requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
      parameters: { type: "object", required: ["paths"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === RUNTIME_SEARCH_MODULES_TOOL_ID)).toMatchObject({
      name: RUNTIME_SEARCH_MODULES_TOOL_NAME,
      requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
      parameters: { type: "object", required: ["keywords"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === RUNTIME_DESCRIBE_FUNCTION_TOOL_ID)).toMatchObject({
      name: RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME,
      requiredCapabilities: ["browser_control", "network_read", "runtime_readonly"],
      parameters: { type: "object", required: ["path"], additionalProperties: false },
    });
  });

  it("对外工具函数名兼容 OpenAI-compatible 命名规则", () => {
    const tools = getRegisteredModelTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "network_list_requests",
        "network_get_request_details",
        "network_clear_requests",
        "network_wait_for_requests",
        "network_compare_requests",
        "network_find_parameter_candidates",
        "network_extract_js_candidates",
        "js_list_resources",
        "js_search_sources",
        "js_extract_context",
        "sourcemap_list_candidates",
        "sourcemap_resolve_location",
        "sourcemap_extract_original_context",
        "runtime_inspect_globals",
        "runtime_search_modules",
        "runtime_describe_function",
      ]),
    );
    expect(tools.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.name))).toBe(true);
  });

  it("注册工具列表返回稳定引用，避免设置页渲染时重复创建对象", () => {
    expect(getRegisteredModelTools()).toBe(getRegisteredModelTools());
  });
});
