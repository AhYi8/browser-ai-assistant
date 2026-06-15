import { describe, expect, it, vi } from "vitest";
import { BrowserNetworkToolExecutor } from "../../../src/background/browserControl/networkToolExecutor";
import type { ModelToolCall } from "../../../src/shared/models/types";
import type { NetworkRequestDetail } from "../../../src/shared/types";

function createToolCall(name: string, args: Record<string, unknown> = {}): ModelToolCall {
  return { id: `call-${name}`, name, arguments: args };
}

function createDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: "req-1",
    url: "https://api.example.com/search?q=apple&ts=1700000000&sign=abcdef1234567890abcdef1234567890",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    requestHeaders: [{ name: "X-Nonce", value: "nonce-1" }],
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    requestBody: undefined,
    responseBody: "{\"ok\":true}",
    truncated: false,
    redacted: true,
    ...partial,
  };
}

describe("Network 工具执行器", () => {
  it("list/get/clear/wait 工具复用后台 recorder 并产出 Network 附件", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => [createDetail()]),
      getDetails: vi.fn(async () => [createDetail()]),
      clear: vi.fn(),
      waitForRequests: vi.fn(async () => [createDetail({ id: "req-wait" })]),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await expect(executor.execute(createToolCall("network_list_requests", { urlIncludes: "search", limit: 10 }))).resolves.toMatchObject({
      content: expect.stringContaining("req-1"),
      toolAttachments: [expect.objectContaining({ kind: "network", sourceToolCallId: "call-network_list_requests" })],
    });
    await expect(executor.execute(createToolCall("network_get_request_details", { requestIds: ["req-1"] }))).resolves.toMatchObject({
      content: expect.stringContaining("Response body"),
      toolAttachments: [expect.objectContaining({ kind: "network", requests: [expect.objectContaining({ id: "req-1" })] })],
    });
    await expect(executor.execute(createToolCall("network_clear_requests"))).resolves.toMatchObject({
      content: "已清空当前受控页面的 Network 请求缓存。",
    });
    await expect(executor.execute(createToolCall("network_wait_for_requests", { urlIncludes: "submit", timeoutMs: 1000 }))).resolves.toMatchObject({
      content: expect.stringContaining("req-wait"),
    });
    expect(recorder.clear).toHaveBeenCalled();
    expect(recorder.waitForRequests).toHaveBeenCalledWith({ urlIncludes: "submit", method: undefined, resourceType: undefined, timeoutMs: 1000 });
  });

  it("list/wait 工具在执行器层限制 limit 上限，不能只依赖模型 schema", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => []),
      getDetails: vi.fn(),
      clear: vi.fn(),
      waitForRequests: vi.fn(async () => []),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await executor.execute(createToolCall("network_list_requests", { limit: 9999 }));
    await executor.execute(createToolCall("network_wait_for_requests", { limit: 9999, timeoutMs: 10 }));

    expect(recorder.listRequests).toHaveBeenCalledWith({ urlIncludes: undefined, method: undefined, resourceType: undefined, status: undefined, limit: 200 });
    expect(recorder.waitForRequests).toHaveBeenCalledWith({ urlIncludes: undefined, method: undefined, resourceType: undefined, status: undefined, limit: 200, timeoutMs: 10 });
  });

  it("compare/find/extract 工具输出逆向分析线索", async () => {
    const jsDetail = createDetail({
      id: "js-1",
      url: "https://example.com/assets/app.js",
      method: "GET",
      resourceType: "Script",
      mimeType: "application/javascript",
      responseBody: "function makeSign(){ return md5('/api/search' + timestamp + nonce); }",
    });
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => [
        createDetail({ id: "req-1" }),
        createDetail({ id: "req-2", url: "https://api.example.com/search?q=banana&ts=1700000001&sign=bbbbbb1234567890abcdef1234567890" }),
        jsDetail,
      ]),
      getDetails: vi.fn(async (ids: string[]) =>
        [
          createDetail({ id: ids[0] ?? "req-1" }),
          createDetail({ id: ids[1] ?? "req-2", url: "https://api.example.com/search?q=banana&ts=1700000001&sign=bbbbbb1234567890abcdef1234567890" }),
          jsDetail,
        ].filter((detail) => ids.includes(detail.id)),
      ),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await expect(executor.execute(createToolCall("network_compare_requests", { requestIds: ["req-1", "req-2"] }))).resolves.toMatchObject({
      content: expect.stringContaining("变化字段"),
    });
    await expect(executor.execute(createToolCall("network_compare_requests", { requestIds: ["req-1", "req-2"] }))).resolves.toMatchObject({
      content: expect.stringContaining("sign"),
    });
    await expect(executor.execute(createToolCall("network_find_parameter_candidates", { requestIds: ["req-1"] }))).resolves.toMatchObject({
      content: expect.stringContaining("疑似签名字段"),
    });
    await expect(executor.execute(createToolCall("network_extract_js_candidates", { keywords: ["sign", "md5"], urlIncludes: "/api/search" }))).resolves.toMatchObject({
      content: expect.stringContaining("app.js"),
    });
  });

  it("Network 兼容入口使用统一 JS 判定，避免把 json_data 误识别为 JS", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => [
        createDetail({
          id: "json-data",
          url: "https://example.com/api/json_data",
          resourceType: "XHR",
          mimeType: "application/json",
          responseBody: "{\"sign\":\"not-js\"}",
        }),
      ]),
      getDetails: vi.fn(async (ids: string[]) => ids.includes("json-data") ? [
        createDetail({
          id: "json-data",
          url: "https://example.com/api/json_data",
          resourceType: "XHR",
          mimeType: "application/json",
          responseBody: "{\"sign\":\"not-js\"}",
        }),
      ] : []),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    const result = await executor.execute(createToolCall("network_extract_js_candidates", { keywords: ["sign"] }));

    expect(result.content).toBe("未找到匹配的 JS 源码片段。");
    expect(result.toolAttachments).toBeUndefined();
  });

  it("指定 requestIds 提取 JS 候选时也不误判非 JS 扩展名响应", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(),
      getDetails: vi.fn(async () => [
        createDetail({
          id: "json-data",
          url: "https://example.com/api/data.json",
          resourceType: "XHR",
          mimeType: "application/json",
          responseBody: "{\"sign\":\"not-js\"}",
        }),
      ]),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    const result = await executor.execute(createToolCall("network_extract_js_candidates", { requestIds: ["json-data"], keywords: ["sign"] }));

    expect(result.content).toBe("未找到匹配的 JS 候选资源。");
  });

  it("非 JSON 且非表单请求体作为整体字段分析，避免 URLSearchParams 误拆纯文本", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(),
      getDetails: vi.fn(async () => [
        createDetail({ id: "req-1", requestBody: "plain-text-with-token=abc", requestHeaders: [{ name: "Content-Type", value: "text/plain" }] }),
        createDetail({ id: "req-2", requestBody: "plain-text-with-token=def", requestHeaders: [{ name: "Content-Type", value: "text/plain" }] }),
      ]),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    const result = await executor.execute(createToolCall("network_compare_requests", { requestIds: ["req-1", "req-2"] }));

    expect(result.content).toContain("body.body:");
    expect(result.content).not.toContain("body.plain-text-with-token:");
  });

  it("text/plain 即使内容是合法 JSON 也作为整体字段分析", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(),
      getDetails: vi.fn(async () => [
        createDetail({ id: "req-1", requestBody: "{\"token\":\"abc\"}", requestHeaders: [{ name: "Content-Type", value: "text/plain" }] }),
        createDetail({ id: "req-2", requestBody: "{\"token\":\"def\"}", requestHeaders: [{ name: "Content-Type", value: "text/plain" }] }),
      ]),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    const result = await executor.execute(createToolCall("network_compare_requests", { requestIds: ["req-1", "req-2"] }));

    expect(result.content).toContain("body.body:");
    expect(result.content).not.toContain("body.token:");
  });

  it("拒绝超长 requestIds，并截断过滤与关键词参数", async () => {
    const longText = "x".repeat(600);
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => []),
      getDetails: vi.fn(async () => []),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await expect(executor.execute(createToolCall("network_get_request_details", { requestIds: [longText] }))).resolves.toMatchObject({
      isError: true,
    });
    await executor.execute(createToolCall("network_list_requests", { urlIncludes: longText, method: longText, resourceType: longText }));
    await executor.execute(createToolCall("network_extract_js_candidates", { keywords: Array.from({ length: 30 }, (_, index) => `${longText}-${index}`) }));

    expect(recorder.listRequests).toHaveBeenCalledWith({
      urlIncludes: "x".repeat(200),
      method: "x".repeat(32),
      resourceType: "x".repeat(64),
      status: undefined,
      limit: undefined,
    });
    expect(recorder.getDetails).toHaveBeenCalledWith([]);
  });

  it("旧点号工具名仍可兼容执行，避免历史工具调用立刻失效", async () => {
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => [createDetail()]),
      getDetails: vi.fn(),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await expect(executor.execute(createToolCall("network.list_requests", { limit: 1 }))).resolves.toMatchObject({
      content: expect.stringContaining("req-1"),
    });
  });

  it("未启用 Network recorder 或参数非法时返回中文错误", async () => {
    const recorder = {
      isEnabled: vi.fn(() => false),
      listRequests: vi.fn(),
      getDetails: vi.fn(),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    await expect(executor.execute(createToolCall("network_list_requests"))).resolves.toMatchObject({
      isError: true,
      content: "Network 采集尚未启用，请先开启浏览器控制。",
    });
    recorder.isEnabled.mockReturnValue(true);
    await expect(executor.execute(createToolCall("network_get_request_details", { requestIds: [] }))).resolves.toMatchObject({
      isError: true,
      content: "requestIds 必须是包含 1 到 100 个非空字符串的数组。",
    });
  });

  it("network_clear_requests 之后不应继续暴露旧的 JS 索引结果", async () => {
    const jsDetail = createDetail({
      id: "js-1",
      url: "https://example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript",
      responseBody: "function makeSign(){ return 'old'; }",
    });
    const recorder = {
      isEnabled: vi.fn(() => true),
      listRequests: vi.fn(() => [jsDetail]),
      getDetails: vi.fn(async () => [jsDetail]),
      clear: vi.fn(),
      waitForRequests: vi.fn(),
    };
    const executor = new BrowserNetworkToolExecutor(recorder);

    const beforeClear = await executor.execute(createToolCall("network_extract_js_candidates", { keywords: ["makeSign"] }));
    expect(beforeClear.content).toContain("app.js");

    recorder.listRequests.mockReturnValue([]);
    recorder.getDetails.mockResolvedValue([]);
    await executor.execute(createToolCall("network_clear_requests"));

    const afterClear = await executor.execute(createToolCall("network_extract_js_candidates", { keywords: ["makeSign"] }));
    expect(afterClear.content).toBe("未找到匹配的 JS 源码片段。");
    expect(recorder.clear).toHaveBeenCalled();
  });
});
