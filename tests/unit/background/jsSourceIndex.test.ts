import { describe, expect, it } from "vitest";
import { JsSourceIndex, isJavaScriptDetail, isJavaScriptMetaLike } from "../../../src/background/browserControl/jsSourceIndex";
import type { NetworkRequestDetail } from "../../../src/shared/types";

function createJsDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: "script-1",
    url: "https://example.com/assets/app.js",
    method: "GET",
    status: 200,
    mimeType: "application/javascript",
    resourceType: "Script",
    responseBody: "const path = '/api/search';\nfunction makeSign(){ return md5(path + timestamp + nonce); }\n",
    truncated: false,
    redacted: true,
    ...partial,
  };
}

describe("JS 源码索引", () => {
  it("只索引已采集的 JS 文本资源并计算搜索命中位置", () => {
    const index = new JsSourceIndex();

    index.upsertNetworkDetails([
      createJsDetail(),
      createJsDetail({
        id: "json-1",
        url: "https://example.com/api/search",
        mimeType: "application/json",
        resourceType: "XHR",
        responseBody: "{\"ok\":true}",
      }),
    ]);

    expect(index.listResources()).toEqual([
      expect.objectContaining({
        id: "script-1",
        source: "network",
        searchable: true,
        url: "https://example.com/assets/app.js",
      }),
    ]);
    expect(index.search(["/api/search", "md5"], { maxMatches: 10 }).matches).toEqual([
      expect.objectContaining({ resourceId: "script-1", term: "/api/search", line: 1, column: 15 }),
      expect.objectContaining({ resourceId: "script-1", term: "md5", line: 2, column: 29 }),
    ]);
  });

  it("提取上下文时限制片段大小并对敏感赋值做兜底脱敏", () => {
    const index = new JsSourceIndex();
    index.upsertFetchedResource({
      id: "same-origin-1",
      source: "same-origin-fetch",
      url: "https://example.com/assets/auth.js",
      mimeType: "application/javascript",
      content: "const token = 'secret-token';\nexport function sign(){ return token; }\n",
      fetchedAt: 1,
    });

    const context = index.extractContext("same-origin-1", 10, { radius: 80 });

    expect(context).toMatchObject({
      resourceId: "same-origin-1",
      source: "same-origin-fetch",
      snippet: expect.stringContaining("token = \"[已脱敏]\""),
      redacted: true,
    });
    expect(context?.snippet).not.toContain("secret-token");
  });
  it("JS 判定只参考 pathname、resourceType 和可信 MIME，不被 query 中的 .js 误导", () => {
    const queryLooksLikeJs = createJsDetail({
      id: "query-js",
      url: "https://example.com/api/search?next=/assets/app.js",
      resourceType: "XHR",
      mimeType: "application/json",
      responseBody: "{\"sign\":\"not-js\"}",
    });

    expect(isJavaScriptDetail(queryLooksLikeJs)).toBe(false);
    expect(isJavaScriptMetaLike(queryLooksLikeJs)).toBe(false);
    expect(isJavaScriptDetail(createJsDetail({
      url: "https://example.com/assets/app.js?from=api",
      resourceType: "XHR",
      mimeType: undefined,
    }))).toBe(true);
    expect(isJavaScriptDetail(createJsDetail({
      url: "https://example.com/api/module",
      resourceType: "XHR",
      mimeType: "text/javascript; charset=utf-8",
    }))).toBe(true);
  });
});
