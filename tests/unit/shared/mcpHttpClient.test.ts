import { describe, expect, it, vi } from "vitest";
import { callMcpTool, listMcpTools } from "../../../src/shared/mcp/httpClient";
import type { McpServerConfig } from "../../../src/shared/types";

const server: McpServerConfig = {
  id: "mysql",
  name: "MySQL",
  endpointUrl: "https://mcp.example.com/mcp",
  enabled: true,
  tools: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("MCP HTTP client", () => {
  it("初始化后通过 tools/list 读取工具并携带 Bearer Token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mcp", version: "1.0.0" } },
      }, { "Mcp-Session-Id": "session-1" }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [
            {
              name: "query",
              description: "执行 SQL 查询",
              inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
            },
          ],
        },
      }));

    const result = await listMcpTools({ server, bearerToken: "secret", fetcher });

    expect(result).toEqual([
      {
        name: "query",
        description: "执行 SQL 查询",
        inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      },
    ]);
    expect(fetcher).toHaveBeenNthCalledWith(1, server.endpointUrl, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer secret",
        Accept: "application/json, text/event-stream",
      }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, server.endpointUrl, expect.objectContaining({
      headers: expect.objectContaining({ "Mcp-Session-Id": "session-1" }),
    }));
    const initializedBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { id?: unknown; method: string; params?: unknown };
    expect(initializedBody).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(fetcher).toHaveBeenNthCalledWith(3, server.endpointUrl, expect.objectContaining({
      headers: expect.objectContaining({ "Mcp-Session-Id": "session-1" }),
    }));
    const listBody = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { method: string; params?: unknown };
    expect(listBody).toMatchObject({ method: "tools/list" });
    expect(listBody).not.toHaveProperty("params");
  });

  it("2025-03-26 Server 的 tools/list 会发送空 cursor 分页参数", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } } },
      }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      }));

    await listMcpTools({ server, fetcher });

    const listBody = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { method: string; params?: unknown };
    expect(listBody).toMatchObject({
      method: "tools/list",
      params: { cursor: "" },
    });
  });

  it("调用 tools/call 并把 SSE JSON-RPC 响应解析为文本", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(new Response("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"结果 A\"}]}}\n\n", {
        headers: { "content-type": "text/event-stream" },
      }));

    const result = await callMcpTool({ server, toolName: "query", arguments: { sql: "select 1" }, fetcher });

    expect(result).toBe("结果 A");
    const body = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { method: string; params: unknown };
    expect(body).toMatchObject({
      method: "tools/call",
      params: { name: "query", arguments: { sql: "select 1" } },
    });
  });

  it("远端错误时返回固定中文错误且不泄露 token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("token=secret", { status: 401, statusText: "Unauthorized" }));

    await expect(listMcpTools({ server, bearerToken: "secret", fetcher })).rejects.toThrow("MCP 请求失败：401 Unauthorized");
  });
  it("MCP 请求默认会在超时后取消并返回中文错误", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const request = expect(listMcpTools({ server, fetcher })).rejects.toThrow("MCP 请求超时");
    await vi.advanceTimersByTimeAsync(30000);

    await request;
    vi.useRealTimers();
  });

  it("外部取消信号会中止 MCP 请求", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const request = expect(listMcpTools({ server, fetcher, signal: controller.signal })).rejects.toThrow("MCP 请求已取消");
    controller.abort();

    await request;
  });
});

function createJsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
