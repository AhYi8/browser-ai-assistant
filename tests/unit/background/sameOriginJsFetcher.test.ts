import { describe, expect, it, vi } from "vitest";
import { SameOriginJsFetcher } from "../../../src/background/browserControl/sameOriginJsFetcher";

describe("同源 JS 补位读取器", () => {
  it("只读取当前页面同源 JS 文本并拒绝跨域重定向", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("console.log('/api/search')", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }))
      .mockResolvedValueOnce(new Response("console.log('evil')", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }));
    Object.defineProperty(fetcher.mock.results, "unused", { value: true });
    const wrappedFetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetcher(input, init);
      Object.defineProperty(response, "url", { value: input.toString().includes("redirect") ? "https://evil.example/app.js" : input.toString() });
      return response;
    });
    const jsFetcher = new SameOriginJsFetcher(wrappedFetcher as unknown as typeof fetch);

    await expect(jsFetcher.fetch("https://example.com/app.js", "https://example.com/page")).resolves.toMatchObject({
      ok: true,
      resource: expect.objectContaining({
        source: "same-origin-fetch",
        url: "https://example.com/app.js",
        content: "console.log('/api/search')",
      }),
    });
    await expect(jsFetcher.fetch("https://example.com/redirect.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位拒绝跨域重定向。",
    });
    expect(wrappedFetcher).toHaveBeenCalledWith("https://example.com/app.js", expect.objectContaining({ credentials: "omit" }));
  });

  it("拒绝非法协议、跨域 URL、非 JS MIME 和过大响应", async () => {
    const jsFetcher = new SameOriginJsFetcher(vi.fn(async () =>
      new Response("x".repeat(1024 * 1024 + 1), { status: 200, headers: { "Content-Type": "application/javascript" } }),
    ) as unknown as typeof fetch);

    await expect(jsFetcher.fetch("data:text/javascript,alert(1)", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位只允许 http 或 https URL。",
    });
    await expect(jsFetcher.fetch("https://cdn.example.com/app.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位只允许读取当前页面同源资源。",
    });
    await expect(jsFetcher.fetch("https://example.com/app.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位响应超过大小上限。",
    });
  });

  it("同源补位资源 ID 使用 URL 本身，避免简单哈希碰撞覆盖资源", async () => {
    const jsFetcher = new SameOriginJsFetcher(vi.fn(async (input: RequestInfo | URL) => {
      const response = new Response(`console.log(${JSON.stringify(input.toString())})`, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
      Object.defineProperty(response, "url", { value: input.toString() });
      return response;
    }) as unknown as typeof fetch);

    await expect(jsFetcher.fetch("https://example.com/a.js?x=1", "https://example.com/page")).resolves.toMatchObject({
      ok: true,
      resource: expect.objectContaining({ id: "same-origin-js:https://example.com/a.js?x=1" }),
    });
  });

  it("同源补位不应自动跟随跨域重定向，且要拒绝非 JS MIME 与超大响应", async () => {
    const redirected = new Response("console.log('evil')", {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
      },
    });
    Object.defineProperty(redirected, "url", { value: "https://evil.example/app.js" });

    const jsFetcher = new SameOriginJsFetcher(vi.fn(async () => redirected) as unknown as typeof fetch);

    await expect(jsFetcher.fetch("https://example.com/redirect.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位拒绝跨域重定向。",
    });

    const jsonFetcher = new SameOriginJsFetcher(vi.fn(async () =>
      new Response("{\"ok\":true}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch);

    await expect(jsonFetcher.fetch("https://example.com/app.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位只接受 JavaScript 文本资源。",
    });

    const text = vi.fn(async () => "x");
    const largeResponse = {
      ok: true,
      status: 200,
      type: "basic",
      url: "https://example.com/large.js",
      headers: new Headers({
        "Content-Type": "application/javascript",
        "Content-Length": String(1024 * 1024 + 1),
      }),
      text,
    } as unknown as Response;
    const largeFetcher = new SameOriginJsFetcher(vi.fn(async () => largeResponse) as unknown as typeof fetch);

    await expect(largeFetcher.fetch("https://example.com/large.js", "https://example.com/page")).resolves.toMatchObject({
      ok: false,
      message: "同源 JS 补位响应超过大小上限。",
    });
    expect(text).not.toHaveBeenCalled();
  });
});
