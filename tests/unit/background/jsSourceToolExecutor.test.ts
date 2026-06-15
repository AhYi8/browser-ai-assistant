import { describe, expect, it, vi } from "vitest";
import { JsSourceToolExecutor } from "../../../src/background/browserControl/jsSourceToolExecutor";
import type { ModelToolCall } from "../../../src/shared/models/types";
import type { NetworkRequestDetail } from "../../../src/shared/types";

function createToolCall(name: string, args: Record<string, unknown> = {}): ModelToolCall {
  return { id: `call-${name}`, name, arguments: args };
}

function createJsDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: "script-1",
    url: "https://example.com/assets/app.js",
    method: "GET",
    status: 200,
    mimeType: "application/javascript",
    resourceType: "Script",
    responseBody: "function makeSign(){ return md5('/api/search' + timestamp); }",
    truncated: false,
    redacted: true,
    ...partial,
  };
}

describe("JS 源码工具执行器", () => {
  it("列出、搜索并提取已采集 JS 资源，同时产出 js-source 附件", async () => {
    const executor = new JsSourceToolExecutor({
      recorder: {
        isEnabled: true,
        listRequests: vi.fn(() => [createJsDetail()]),
        getDetails: vi.fn(async () => [createJsDetail()]),
      },
      getCurrentPageUrl: vi.fn(async () => "https://example.com/page"),
      fetcher: { fetch: vi.fn() },
    });

    await expect(executor.execute(createToolCall("js_list_resources"))).resolves.toMatchObject({
      content: expect.stringContaining("script-1"),
      toolAttachments: [expect.objectContaining({ kind: "js-source" })],
    });
    const searchResult = await executor.execute(createToolCall("js_search_sources", { keywords: ["/api/search", "md5"] }));
    expect(searchResult).toMatchObject({
      content: expect.stringContaining("makeSign"),
      toolAttachments: [expect.objectContaining({ kind: "js-source" })],
    });
    expect(searchResult.toolAttachments?.[0]).toMatchObject({
      jsMatches: expect.arrayContaining([expect.objectContaining({ resourceId: "script-1" })]),
    });
    await expect(executor.execute(createToolCall("js_extract_context", { resourceId: "script-1", position: 20 }))).resolves.toMatchObject({
      content: expect.stringContaining("makeSign"),
      toolAttachments: [expect.objectContaining({ kind: "js-source", contexts: [expect.objectContaining({ resourceId: "script-1" })] })],
    });
  });

  it("搜索时按需执行同源补位，部分失败不阻断成功资源", async () => {
    const executor = new JsSourceToolExecutor({
      recorder: {
        isEnabled: true,
        listRequests: vi.fn(() => []),
        getDetails: vi.fn(async () => []),
      },
      getCurrentPageUrl: vi.fn(async () => "https://example.com/page"),
      fetcher: {
        fetch: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            resource: {
              id: "same-origin-app",
              source: "same-origin-fetch",
              url: "https://example.com/app.js",
              mimeType: "application/javascript",
              content: "const api = '/api/search';",
              fetchedAt: 1,
            },
          })
          .mockResolvedValueOnce({ ok: false, url: "https://example.com/missing.js", message: "同源 JS 补位读取失败。" }),
      },
    });

    const result = await executor.execute(createToolCall("js_search_sources", {
      keywords: ["/api/search"],
      urls: ["https://example.com/app.js", "https://example.com/missing.js"],
      allowSameOriginFetch: true,
    }));

    expect(result).toMatchObject({
      content: expect.stringContaining("same-origin-fetch"),
      toolAttachments: [expect.objectContaining({ kind: "js-source", failedFetches: [expect.objectContaining({ message: "同源 JS 补位读取失败。" })] })],
    });
  });

  it("未启用 Network recorder 或参数非法时返回中文错误", async () => {
    const recorder = {
        isEnabled: false,
        listRequests: vi.fn(),
        getDetails: vi.fn(),
      };
    const executor = new JsSourceToolExecutor({
      recorder,
      getCurrentPageUrl: vi.fn(async () => "https://example.com/page"),
      fetcher: { fetch: vi.fn() },
    });

    await expect(executor.execute(createToolCall("js_search_sources", { keywords: ["sign"] }))).resolves.toMatchObject({
      isError: true,
      content: "JS 源码检索依赖 Network 采集，请先开启浏览器控制。",
    });
    recorder.isEnabled = true;
    await expect(executor.execute(createToolCall("js_search_sources", { keywords: [] }))).resolves.toMatchObject({
      isError: true,
      content: "keywords 必须是包含 1 到 20 个非空字符串的数组。",
    });
  });
});
