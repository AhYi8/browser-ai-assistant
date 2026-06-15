import { describe, expect, it, vi } from "vitest";
import {
  appendBrowserControlPromptIfNeeded,
  createBackgroundToolExecutor,
  createModelToolDefinition,
  normalizeBrowserAutomationMaxToolIterations,
  shouldExposeTool,
} from "../../../src/background/backgroundToolRuntime";
import type { ModelRequestMessage, ModelToolCall, ModelToolRegistryEntry } from "../../../src/shared/models/types";
import type { ModelConfig } from "../../../src/shared/types";

const browserControlManagerMock = vi.hoisted(() => ({
  canExposeTakeSnapshotTool: vi.fn(),
  canExposeBrowserTool: vi.fn(),
  canExposeNetworkTool: vi.fn(),
  takeSnapshot: vi.fn(),
  executeBrowserTool: vi.fn(),
  executeNetworkTool: vi.fn(),
  executeJsSourceTool: vi.fn(),
}));

const executeTavilySearchFromSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/background/browserControlMessageHandler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/background/browserControlMessageHandler")>();
  return {
    ...actual,
    browserControlManager: browserControlManagerMock,
  };
});

vi.mock("../../../src/background/webSearchMessageHandler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/background/webSearchMessageHandler")>();
  return {
    ...actual,
    executeTavilySearchFromSettings: executeTavilySearchFromSettingsMock,
  };
});

function createModel(): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMessage(role: "system" | "user", content: string): ModelRequestMessage {
  if (role === "system") {
    return { role, content };
  }

  return {
    id: "user-1",
    role,
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
  };
}

function createToolCall(name: string, args: Record<string, unknown> = {}): ModelToolCall {
  return { id: `call-${name}`, name, arguments: args };
}

describe("background 工具运行时封装", () => {
  beforeEach(() => {
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReset();
    browserControlManagerMock.canExposeBrowserTool.mockReset();
    browserControlManagerMock.canExposeNetworkTool.mockReset();
    browserControlManagerMock.takeSnapshot.mockReset();
    browserControlManagerMock.executeBrowserTool.mockReset();
    browserControlManagerMock.executeNetworkTool.mockReset();
    browserControlManagerMock.executeJsSourceTool.mockReset();
    executeTavilySearchFromSettingsMock.mockReset();
  });

  it("按浏览器控制连接状态过滤可暴露工具", () => {
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReturnValue(false);
    browserControlManagerMock.canExposeBrowserTool.mockReturnValue(true);
    browserControlManagerMock.canExposeNetworkTool.mockReturnValue(true);

    expect(shouldExposeTool({ id: "browser.take_snapshot", name: "take_snapshot", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "browser.click", name: "click", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "network.list_requests", name: "network_list_requests", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "js.search_sources", name: "js_search_sources", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "system.current_time", name: "get_current_time", parameters: {} })).toBe(true);
  });

  it("浏览器控制未授权时不暴露浏览器操作工具", () => {
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReturnValue(false);
    browserControlManagerMock.canExposeBrowserTool.mockReturnValue(false);
    browserControlManagerMock.canExposeNetworkTool.mockReturnValue(false);

    expect(shouldExposeTool({ id: "browser.take_snapshot", name: "take_snapshot", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "browser.click", name: "click", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "network.list_requests", name: "network_list_requests", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "js.search_sources", name: "js_search_sources", parameters: {} })).toBe(false);
  });

  it("生成模型工具定义时只透传模型需要的 schema 字段", () => {
    const tool: ModelToolRegistryEntry = {
      id: "browser.click",
      name: "click",
      displayName: "点击",
      groupId: "browser",
      description: "点击当前页面元素",
      parameters: { type: "object", properties: { uid: { type: "string" } } },
    };

    expect(createModelToolDefinition(tool)).toEqual({
      name: "click",
      description: "点击当前页面元素",
      parameters: { type: "object", properties: { uid: { type: "string" } } },
    });
  });

  it("浏览器工具启用时追加控制提示到已有 system 消息", () => {
    const result = appendBrowserControlPromptIfNeeded(
      [createMessage("system", "你是网页助手"), createMessage("user", "读取页面")],
      [{ id: "browser.take_snapshot", name: "take_snapshot", parameters: {} }],
    );

    expect(result[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("不要猜测 UID"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining("遇到网页 JS 弹窗时会等待用户手动处理"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining("仅当用户明确要求读取、分析、操作当前页面"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining("优先使用当前受控页面"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining("一般知识、开发建议或未指向当前浏览器现场的问题不要调用浏览器工具"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining("当前页面信息不足时，先使用 list_pages 或 select_page"),
    });
    expect(result[0]).toMatchObject({
      content: expect.not.stringContaining("Tavily 搜索"),
    });
  });

  it("浏览器工具和 Tavily 同时可用时才提示网络搜索兜底", () => {
    const result = appendBrowserControlPromptIfNeeded(
      [createMessage("system", "你是网页助手"), createMessage("user", "读取页面")],
      [
        { id: "browser.take_snapshot", name: "take_snapshot", parameters: {} },
        { id: "web_search.tavily", name: "tavily_search", parameters: {} },
      ],
    );

    expect(result[0]).toMatchObject({
      content: expect.stringContaining("Tavily 搜索只作为公开资料或当前页面无法访问时的兜底"),
    });
  });

  it("未启用浏览器工具时不追加浏览器控制调度提示", () => {
    const messages = [createMessage("system", "你是网页助手"), createMessage("user", "读取页面")];
    const result = appendBrowserControlPromptIfNeeded(messages, [{ id: "web_search.tavily", name: "tavily_search", parameters: {} }]);

    expect(result).toBe(messages);
    expect(result[0]).toMatchObject({
      content: expect.not.stringContaining("优先使用当前受控页面"),
    });
  });

  it("浏览器自动化最大轮次只接受有限数字，否则回退默认 32", () => {
    expect(normalizeBrowserAutomationMaxToolIterations(2.6)).toBe(3);
    expect(normalizeBrowserAutomationMaxToolIterations("5")).toBe(5);
    expect(normalizeBrowserAutomationMaxToolIterations("bad")).toBe(32);
  });

  it("background 执行器分发浏览器、当前时间、Tavily 和未知工具", async () => {
    browserControlManagerMock.takeSnapshot.mockResolvedValue({ toolCallId: "call-take_snapshot", name: "take_snapshot", content: "快照" });
    browserControlManagerMock.executeBrowserTool.mockResolvedValue({ toolCallId: "call-click", name: "click", content: "已点击" });
    browserControlManagerMock.executeNetworkTool.mockResolvedValue({ toolCallId: "call-network_list_requests", name: "network_list_requests", content: "Network 列表" });
    browserControlManagerMock.executeJsSourceTool.mockResolvedValue({ toolCallId: "call-js_search_sources", name: "js_search_sources", content: "JS 搜索" });
    executeTavilySearchFromSettingsMock.mockResolvedValue({
      ok: true,
      attachment: {
        id: "web-1",
        kind: "web-search",
        title: "网络搜索结果",
        summary: "",
        provider: "tavily",
        query: "Codex",
        results: [],
        createdAt: 1,
        redacted: false,
        truncated: false,
      },
    });
    const executor = createBackgroundToolExecutor({ model: createModel(), tavily: undefined }, vi.fn() as unknown as typeof fetch);

    await expect(executor(createToolCall("take_snapshot"), { id: "browser.take_snapshot", name: "take_snapshot", parameters: {} })).resolves.toMatchObject({
      content: "快照",
    });
    await expect(executor(createToolCall("click"), { id: "browser.click", name: "click", parameters: {} })).resolves.toMatchObject({
      content: "已点击",
    });
    await expect(executor(createToolCall("network_list_requests"), { id: "network.list_requests", name: "network_list_requests", parameters: {} })).resolves.toMatchObject({
      content: "Network 列表",
    });
    await expect(executor(createToolCall("js_search_sources", { keywords: ["sign"] }), { id: "js.search_sources", name: "js_search_sources", parameters: {} })).resolves.toMatchObject({
      content: "JS 搜索",
    });
    await expect(executor(createToolCall("get_current_time"), { id: "system.current_time", name: "get_current_time", parameters: {} })).resolves.toMatchObject({
      content: expect.stringContaining("当前系统时间："),
    });
    await expect(executor(createToolCall("tavily_search", { query: "Codex" }), { id: "web.tavily_search", name: "tavily_search", parameters: {} })).resolves.toMatchObject({
      toolAttachments: [expect.objectContaining({ kind: "web-search", sourceToolCallId: "call-tavily_search" })],
    });
    await expect(executor(createToolCall("unknown_tool"), { id: "unknown", name: "unknown_tool", parameters: {} })).resolves.toEqual({
      toolCallId: "call-unknown_tool",
      name: "unknown_tool",
      content: "工具 unknown_tool 暂未实现，已拒绝执行。",
      isError: true,
    });
  });

  it("Tavily 工具拒绝空 query 和额外参数", async () => {
    const executor = createBackgroundToolExecutor({ model: createModel(), tavily: undefined }, vi.fn() as unknown as typeof fetch);
    const tool = { id: "web.tavily_search", name: "tavily_search", parameters: {} };

    await expect(executor(createToolCall("tavily_search", {}), tool)).resolves.toMatchObject({
      content: "Tavily 搜索问题不能为空",
      isError: true,
    });
    await expect(executor(createToolCall("tavily_search", { query: "Codex", max_results: 3 }), tool)).resolves.toMatchObject({
      content: "Tavily 搜索工具只接受 query 参数",
      isError: true,
    });
    expect(executeTavilySearchFromSettingsMock).not.toHaveBeenCalled();
  });
});
