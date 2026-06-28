import { describe, expect, it } from "vitest";
import {
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_NAME,
  BROWSER_CLICK_TOOL_ID,
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID,
  BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME,
  BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID,
  BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME,
  BROWSER_ANALYZE_FORM_TOOL_ID,
  BROWSER_ANALYZE_FORM_TOOL_NAME,
  BROWSER_CONTEXT_CLICK_TOOL_ID,
  BROWSER_CONTEXT_CLICK_TOOL_NAME,
  BROWSER_DOUBLE_CLICK_TOOL_ID,
  BROWSER_DOUBLE_CLICK_TOOL_NAME,
  BROWSER_EXTRACT_CONTENT_TOOL_ID,
  BROWSER_EXTRACT_CONTENT_TOOL_NAME,
  BROWSER_DRAG_TOOL_ID,
  BROWSER_DRAG_TOOL_NAME,
  BROWSER_FILL_TOOL_ID,
  BROWSER_FILL_TOOL_NAME,
  BROWSER_FIND_ELEMENTS_TOOL_ID,
  BROWSER_FIND_ELEMENTS_TOOL_NAME,
  BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID,
  BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME,
  BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID,
  BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME,
  BROWSER_GET_PAGE_STATE_TOOL_ID,
  BROWSER_GET_PAGE_STATE_TOOL_NAME,
  BROWSER_HOVER_TOOL_ID,
  BROWSER_HOVER_TOOL_NAME,
  BROWSER_INSPECT_ELEMENT_TOOL_ID,
  BROWSER_INSPECT_ELEMENT_TOOL_NAME,
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
  BROWSER_SCREENSHOT_TOOL_ID,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SCROLL_TOOL_ID,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  BROWSER_TAKE_SNAPSHOT_TOOL_NAME,
  BROWSER_WAIT_FOR_TOOL_ID,
  BROWSER_WAIT_FOR_TOOL_NAME,
  BROWSER_WAIT_FOR_STATE_TOOL_ID,
  BROWSER_WAIT_FOR_STATE_TOOL_NAME,
  BROWSER_CLOSE_PAGE_TOOL_ID,
  BROWSER_CLOSE_PAGE_TOOL_NAME,
  CURRENT_TIME_TOOL_ID,
  CURRENT_TIME_TOOL_NAME,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_NAME,
  FULL_ACCESS_FETCH_TOOL_ID,
  FULL_ACCESS_FETCH_TOOL_NAME,
  FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID,
  FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_NAME,
  FULL_ACCESS_READ_STORAGE_TOOL_ID,
  FULL_ACCESS_READ_STORAGE_TOOL_NAME,
  FULL_ACCESS_REVOKE_TOOL_ID,
  FULL_ACCESS_REVOKE_TOOL_NAME,
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
  REPLAY_COMPARE_RESPONSES_TOOL_ID,
  REPLAY_COMPARE_RESPONSES_TOOL_NAME,
  REPLAY_PREPARE_REQUEST_TOOL_ID,
  REPLAY_PREPARE_REQUEST_TOOL_NAME,
  REPLAY_SEND_REQUEST_TOOL_ID,
  REPLAY_SEND_REQUEST_TOOL_NAME,
  SOURCEMAP_EXTRACT_ORIGINAL_CONTEXT_TOOL_ID,
  SOURCEMAP_LIST_CANDIDATES_TOOL_ID,
  SOURCEMAP_RESOLVE_LOCATION_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
  TAVILY_SEARCH_TOOL_NAME,
  MODEL_TOOL_CAPABILITY_VALUES,
  MODEL_TOOL_RUNTIME_VALUES,
  MODEL_TOOL_RISK_VALUES,
  filterModelToolsByClassification,
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

  it("注册浏览器页面状态工具且声明低风险观察分类", () => {
    const pageStateTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_GET_PAGE_STATE_TOOL_ID);

    expect(pageStateTool).toMatchObject({
      id: BROWSER_GET_PAGE_STATE_TOOL_ID,
      name: BROWSER_GET_PAGE_STATE_TOOL_NAME,
      displayName: "浏览器页面状态",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page"],
        risk: "low",
      },
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
  });

  it("注册浏览器内容提取工具且普通浏览器控制模式可用", () => {
    const extractTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_EXTRACT_CONTENT_TOOL_ID);

    expect(extractTool).toMatchObject({
      id: BROWSER_EXTRACT_CONTENT_TOOL_ID,
      name: BROWSER_EXTRACT_CONTENT_TOOL_NAME,
      displayName: "浏览器内容提取",
      requiredCapabilities: ["browser_control"],
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
    expect(extractTool?.parameters.properties).toMatchObject({
      mode: { type: "string", enum: ["text", "html"] },
      source: { type: "string", enum: ["auto_rule", "document", "selector"] },
      selectorType: { type: "string", enum: ["css", "xpath"] },
      selector: { type: "string" },
      maxLength: { type: "integer", minimum: 500, maximum: 200000 },
    });
  });

  it("注册浏览器 Console 消息工具且声明现场分析分类", () => {
    const consoleTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID);

    expect(consoleTool).toMatchObject({
      id: BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID,
      name: BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME,
      displayName: "浏览器 Console 消息",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page", "analyze_site"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
  });

  it("注册浏览器元素检查工具且只接受 UID 参数", () => {
    const inspectTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_INSPECT_ELEMENT_TOOL_ID);

    expect(inspectTool).toMatchObject({
      id: BROWSER_INSPECT_ELEMENT_TOOL_ID,
      name: BROWSER_INSPECT_ELEMENT_TOOL_NAME,
      displayName: "浏览器检查元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page", "analyze_site"],
        risk: "low",
      },
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(inspectTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
    });
  });

  it("注册浏览器元素查找工具且限制查询策略和数量", () => {
    const findTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_FIND_ELEMENTS_TOOL_ID);

    expect(findTool).toMatchObject({
      id: BROWSER_FIND_ELEMENTS_TOOL_ID,
      name: BROWSER_FIND_ELEMENTS_TOOL_NAME,
      displayName: "浏览器查找元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page"],
        risk: "low",
      },
      parameters: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
      },
    });
    expect(findTool?.parameters.properties).toMatchObject({
      query: { type: "string" },
      strategy: { type: "string", enum: ["text", "role", "label", "placeholder", "css"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    });
  });

  it("注册浏览器截图工具且限制截图目标", () => {
    const screenshotTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_SCREENSHOT_TOOL_ID);

    expect(screenshotTool).toMatchObject({
      id: BROWSER_SCREENSHOT_TOOL_ID,
      name: BROWSER_SCREENSHOT_TOOL_NAME,
      displayName: "浏览器截图",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
    expect(screenshotTool?.parameters.properties).toMatchObject({
      target: { type: "string", enum: ["viewport", "element"] },
      uid: { type: "string" },
    });
  });

  it("注册阶段三浏览器基础操作工具并收紧参数 schema", () => {
    const tools = getRegisteredModelTools();
    const clickTool = tools.find((tool) => tool.id === BROWSER_CLICK_TOOL_ID);
    const fillTool = tools.find((tool) => tool.id === BROWSER_FILL_TOOL_ID);
    const pressKeyTool = tools.find((tool) => tool.id === BROWSER_PRESS_KEY_TOOL_ID);
    const waitForTool = tools.find((tool) => tool.id === BROWSER_WAIT_FOR_TOOL_ID);
    const waitForStateTool = tools.find((tool) => tool.id === BROWSER_WAIT_FOR_STATE_TOOL_ID);

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

    expect(waitForStateTool).toMatchObject({
      id: BROWSER_WAIT_FOR_STATE_TOOL_ID,
      name: BROWSER_WAIT_FOR_STATE_TOOL_NAME,
      displayName: "浏览器等待状态",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page", "operate_page"],
        risk: "low",
      },
      parameters: {
        type: "object",
        required: ["state"],
        additionalProperties: false,
      },
    });
    expect(waitForStateTool?.parameters.properties).toMatchObject({
      state: { type: "string", enum: ["url_contains", "ready_state", "element_visible", "element_hidden", "network_idle"] },
      value: { type: "string" },
      uid: { type: "string" },
      timeout: { type: "number", minimum: 1, maximum: 30000 },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册浏览器滚动工具并限制滚动目标", () => {
    const scrollTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_SCROLL_TOOL_ID);

    expect(scrollTool).toMatchObject({
      id: BROWSER_SCROLL_TOOL_ID,
      name: BROWSER_SCROLL_TOOL_NAME,
      displayName: "浏览器滚动页面",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["operate_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: ["direction"],
        additionalProperties: false,
      },
    });
    expect(scrollTool?.parameters.properties).toMatchObject({
      direction: { type: "string", enum: ["up", "down", "left", "right", "top", "bottom"] },
      amount: { type: "integer", minimum: 1, maximum: 5000 },
      uid: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册浏览器悬停工具且只接受快照 UID", () => {
    const hoverTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_HOVER_TOOL_ID);

    expect(hoverTool).toMatchObject({
      id: BROWSER_HOVER_TOOL_ID,
      name: BROWSER_HOVER_TOOL_NAME,
      displayName: "浏览器悬停元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["operate_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(hoverTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册浏览器双击工具且只接受快照 UID", () => {
    const doubleClickTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_DOUBLE_CLICK_TOOL_ID);

    expect(doubleClickTool).toMatchObject({
      id: BROWSER_DOUBLE_CLICK_TOOL_ID,
      name: BROWSER_DOUBLE_CLICK_TOOL_NAME,
      displayName: "浏览器双击元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["operate_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(doubleClickTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册浏览器右键工具且只接受快照 UID", () => {
    const contextClickTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_CONTEXT_CLICK_TOOL_ID);

    expect(contextClickTool).toMatchObject({
      id: BROWSER_CONTEXT_CLICK_TOOL_ID,
      name: BROWSER_CONTEXT_CLICK_TOOL_NAME,
      displayName: "浏览器右键元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["operate_page"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(contextClickTool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册浏览器拖拽工具且只接受快照 UID 或有限偏移", () => {
    const dragTool = getRegisteredModelTools().find((tool) => tool.id === BROWSER_DRAG_TOOL_ID);

    expect(dragTool).toMatchObject({
      id: BROWSER_DRAG_TOOL_ID,
      name: BROWSER_DRAG_TOOL_NAME,
      displayName: "浏览器拖拽元素",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["operate_page"],
        risk: "high",
      },
      parameters: {
        type: "object",
        required: ["sourceUid"],
        additionalProperties: false,
      },
    });
    expect(dragTool?.parameters.properties).toMatchObject({
      sourceUid: { type: "string" },
      targetUid: { type: "string" },
      deltaX: { type: "integer", minimum: -2000, maximum: 2000 },
      deltaY: { type: "integer", minimum: -2000, maximum: 2000 },
      includeSnapshot: { type: "boolean" },
    });
  });

  it("注册交互阻塞分析工具且只接受快照 UID", () => {
    const tool = getRegisteredModelTools().find((item) => item.id === BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID);

    expect(tool).toMatchObject({
      id: BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID,
      name: BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME,
      displayName: "浏览器交互阻塞分析",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["analyze_site"],
        risk: "low",
      },
      parameters: {
        type: "object",
        required: ["uid"],
        additionalProperties: false,
      },
    });
    expect(tool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      expectedAction: { type: "string", enum: ["click", "fill", "view"] },
    });
  });

  it("注册表单分析工具且只接受可选快照 UID", () => {
    const tool = getRegisteredModelTools().find((item) => item.id === BROWSER_ANALYZE_FORM_TOOL_ID);

    expect(tool).toMatchObject({
      id: BROWSER_ANALYZE_FORM_TOOL_ID,
      name: BROWSER_ANALYZE_FORM_TOOL_NAME,
      displayName: "浏览器表单分析",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["analyze_site"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
      },
    });
    expect(tool?.parameters.properties).toMatchObject({
      uid: { type: "string" },
      includeFieldDetails: { type: "boolean" },
    });
  });

  it("注册性能摘要工具且不接受模型参数", () => {
    const tool = getRegisteredModelTools().find((item) => item.id === BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID);

    expect(tool).toMatchObject({
      id: BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID,
      name: BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME,
      displayName: "浏览器性能摘要",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["analyze_site"],
        risk: "low",
      },
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });
  });

  it("注册浏览器聚合诊断工具且不接受模型参数", () => {
    const tool = getRegisteredModelTools().find((item) => item.id === BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID);

    expect(tool).toMatchObject({
      id: BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID,
      name: BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME,
      displayName: "浏览器聚合诊断",
      toolClassification: {
        runtime: "browser_control",
        capabilities: ["observe_page", "analyze_site", "deliver_result"],
        risk: "medium",
      },
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
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
      BROWSER_GET_PAGE_STATE_TOOL_ID,
      BROWSER_EXTRACT_CONTENT_TOOL_ID,
      BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID,
      BROWSER_INSPECT_ELEMENT_TOOL_ID,
      BROWSER_FIND_ELEMENTS_TOOL_ID,
      BROWSER_SCREENSHOT_TOOL_ID,
      BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_ID,
      BROWSER_ANALYZE_FORM_TOOL_ID,
      BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_ID,
      BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID,
      BROWSER_SCROLL_TOOL_ID,
      BROWSER_HOVER_TOOL_ID,
      BROWSER_DOUBLE_CLICK_TOOL_ID,
      BROWSER_CONTEXT_CLICK_TOOL_ID,
      BROWSER_DRAG_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
      BROWSER_FILL_TOOL_ID,
      BROWSER_PRESS_KEY_TOOL_ID,
      BROWSER_WAIT_FOR_TOOL_ID,
      BROWSER_WAIT_FOR_STATE_TOOL_ID,
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
      BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
      REPLAY_PREPARE_REQUEST_TOOL_ID,
      REPLAY_SEND_REQUEST_TOOL_ID,
      REPLAY_COMPARE_RESPONSES_TOOL_ID,
      FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
      FULL_ACCESS_FETCH_TOOL_ID,
      FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID,
      FULL_ACCESS_READ_STORAGE_TOOL_ID,
      FULL_ACCESS_REVOKE_TOOL_ID,
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

  it("注册受控增强边界确认与请求重放工具并声明能力边界", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)).toMatchObject({
      name: BOUNDARY_REQUEST_USER_CHOICE_TOOL_NAME,
      requiredCapabilities: ["browser_control", "controlled_enhanced", "boundary_choice"],
      parameters: { type: "object", required: ["question", "reason", "choices"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === REPLAY_PREPARE_REQUEST_TOOL_ID)).toMatchObject({
      name: REPLAY_PREPARE_REQUEST_TOOL_NAME,
      requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
      parameters: { type: "object", required: ["requestId"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === REPLAY_SEND_REQUEST_TOOL_ID)).toMatchObject({
      name: REPLAY_SEND_REQUEST_TOOL_NAME,
      requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
      parameters: { type: "object", required: ["draftId"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === REPLAY_COMPARE_RESPONSES_TOOL_ID)).toMatchObject({
      name: REPLAY_COMPARE_RESPONSES_TOOL_NAME,
      requiredCapabilities: ["browser_control", "controlled_enhanced", "request_replay"],
      parameters: { type: "object", required: ["draftId"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)?.parameters.properties).toMatchObject({
      choices: { type: "array", minItems: 2, maxItems: 6 },
    });
    expect(tools.find((tool) => tool.id === BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)?.description).toContain("任何工具结果提示已脱敏字段");
    expect(tools.find((tool) => tool.id === NETWORK_GET_REQUEST_DETAILS_TOOL_ID)?.description).toContain("必须先调用 boundary_request_user_choice");
  });

  it("注册完全访问工具并声明最高权限能力", () => {
    const tools = getRegisteredModelTools();

    expect(tools.find((tool) => tool.id === FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID)).toMatchObject({
      name: FULL_ACCESS_EXECUTE_SCRIPT_TOOL_NAME,
      requiredCapabilities: ["browser_control", "full_access"],
      parameters: { type: "object", required: ["script"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === FULL_ACCESS_FETCH_TOOL_ID)).toMatchObject({
      name: FULL_ACCESS_FETCH_TOOL_NAME,
      requiredCapabilities: ["browser_control", "full_access"],
      parameters: { type: "object", required: ["url"], additionalProperties: false },
    });
    expect(tools.find((tool) => tool.id === FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_ID)).toMatchObject({
      name: FULL_ACCESS_GET_NETWORK_DETAILS_TOOL_NAME,
      requiredCapabilities: ["browser_control", "full_access"],
    });
    expect(tools.find((tool) => tool.id === FULL_ACCESS_READ_STORAGE_TOOL_ID)).toMatchObject({
      name: FULL_ACCESS_READ_STORAGE_TOOL_NAME,
      requiredCapabilities: ["browser_control", "full_access"],
    });
    expect(tools.find((tool) => tool.id === FULL_ACCESS_REVOKE_TOOL_ID)).toMatchObject({
      name: FULL_ACCESS_REVOKE_TOOL_NAME,
      requiredCapabilities: ["browser_control", "full_access"],
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
        "boundary_request_user_choice",
        "replay_prepare_request",
        "replay_send_request",
        "replay_compare_responses",
        "full_access_execute_script",
        "full_access_fetch",
        "full_access_get_network_details",
        "full_access_read_storage",
        "full_access_revoke",
      ]),
    );
    expect(tools.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.name))).toBe(true);
  });

  it("注册工具列表返回稳定引用，避免设置页渲染时重复创建对象", () => {
    expect(getRegisteredModelTools()).toBe(getRegisteredModelTools());
  });

  it("所有注册工具都声明结构化分类且分类值来自固定枚举", () => {
    const tools = getRegisteredModelTools();

    expect(tools.every((tool) => Boolean(tool.toolClassification))).toBe(true);
    for (const tool of tools) {
      expect(MODEL_TOOL_RUNTIME_VALUES).toContain(tool.toolClassification?.runtime);
      expect(MODEL_TOOL_RISK_VALUES).toContain(tool.toolClassification?.risk);
      expect(tool.toolClassification?.capabilities.length).toBeGreaterThan(0);
      for (const capability of tool.toolClassification?.capabilities ?? []) {
        expect(MODEL_TOOL_CAPABILITY_VALUES).toContain(capability);
      }
    }
  });

  it("现有工具分类矩阵覆盖本地、公开搜索、浏览器控制、受控增强和完全访问边界", () => {
    const tools = getRegisteredModelTools();
    const classificationById = new Map(tools.map((tool) => [tool.id, tool.toolClassification]));

    expect(classificationById.get(CURRENT_TIME_TOOL_ID)).toEqual({
      runtime: "local",
      capabilities: ["system_context"],
      risk: "low",
    });
    expect(classificationById.get(TAVILY_SEARCH_TOOL_ID)).toEqual({
      runtime: "external_web",
      capabilities: ["search_public_web"],
      risk: "low",
    });
    expect(classificationById.get(BROWSER_TAKE_SNAPSHOT_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page"],
      risk: "low",
    });
    expect(classificationById.get(BROWSER_GET_PAGE_STATE_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page"],
      risk: "low",
    });
    expect(classificationById.get(BROWSER_EXTRACT_CONTENT_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_GET_CONSOLE_MESSAGES_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page", "analyze_site"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_INSPECT_ELEMENT_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page", "analyze_site"],
      risk: "low",
    });
    expect(classificationById.get(BROWSER_FIND_ELEMENTS_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page"],
      risk: "low",
    });
    expect(classificationById.get(BROWSER_SCREENSHOT_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_SCROLL_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_HOVER_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_DOUBLE_CLICK_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_CONTEXT_CLICK_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_DRAG_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "high",
    });
    expect(classificationById.get(BROWSER_COLLECT_DIAGNOSTICS_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page", "analyze_site", "deliver_result"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_CLICK_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["operate_page"],
      risk: "medium",
    });
    expect(classificationById.get(BROWSER_WAIT_FOR_STATE_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page", "operate_page"],
      risk: "low",
    });
    expect(classificationById.get(NETWORK_GET_REQUEST_DETAILS_TOOL_ID)).toEqual({
      runtime: "browser_control",
      capabilities: ["observe_page", "analyze_site"],
      risk: "medium",
    });
    expect(classificationById.get(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)).toEqual({
      runtime: "controlled_enhanced",
      capabilities: ["confirm_boundary"],
      risk: "high",
    });
    expect(classificationById.get(REPLAY_SEND_REQUEST_TOOL_ID)).toEqual({
      runtime: "controlled_enhanced",
      capabilities: ["analyze_site", "confirm_boundary"],
      risk: "high",
    });
    expect(classificationById.get(FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID)).toEqual({
      runtime: "full_access",
      capabilities: ["observe_page", "operate_page", "analyze_site"],
      risk: "critical",
    });
  });

  it("可以按运行要求、能力和风险组合筛选工具", () => {
    const tools = getRegisteredModelTools();

    expect(filterModelToolsByClassification(tools, {
      runtime: "browser_control",
      capability: "observe_page",
      risk: "low",
    }).map((tool) => tool.id)).toEqual([
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_GET_PAGE_STATE_TOOL_ID,
      BROWSER_INSPECT_ELEMENT_TOOL_ID,
      BROWSER_FIND_ELEMENTS_TOOL_ID,
      BROWSER_WAIT_FOR_TOOL_ID,
      BROWSER_WAIT_FOR_STATE_TOOL_ID,
      BROWSER_LIST_PAGES_TOOL_ID,
      NETWORK_LIST_REQUESTS_TOOL_ID,
      NETWORK_CLEAR_REQUESTS_TOOL_ID,
      NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
    ]);

    expect(filterModelToolsByClassification(tools, {
      capability: "confirm_boundary",
    }).map((tool) => tool.id)).toEqual([
      BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
      REPLAY_PREPARE_REQUEST_TOOL_ID,
      REPLAY_SEND_REQUEST_TOOL_ID,
      FULL_ACCESS_REVOKE_TOOL_ID,
    ]);
  });
});
