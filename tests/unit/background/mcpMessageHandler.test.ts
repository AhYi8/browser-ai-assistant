import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "../../../src/background/mcpMessageHandler";
import { saveMcpBearerToken, saveMcpSettings } from "../../../src/shared/mcp/settings";
import { clearDatabase } from "../../../src/shared/storage/repositories";

describe("background MCP 消息处理", () => {
  afterEach(async () => {
    await clearDatabase();
    vi.restoreAllMocks();
  });

  it("刷新工具只使用本地保存的 Server 配置和 Bearer Token", async () => {
    await saveMcpSettings({
      servers: [
        {
          id: "mysql",
          name: "MySQL",
          endpointUrl: "https://trusted.example.com/mcp",
          enabled: true,
          tools: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await saveMcpBearerToken("mysql", "secret");
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18", capabilities: {} },
      }, { "Mcp-Session-Id": "session-1" }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      }));

    await expect(handleMcpMessage({ type: "mcp.listTools", serverId: "mysql" })).resolves.toEqual({ ok: true, tools: [] });

    expect(fetchSpy).toHaveBeenCalledWith("https://trusted.example.com/mcp", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer secret" }),
    }));
    expect(fetchSpy).not.toHaveBeenCalledWith("https://evil.example.com/mcp", expect.anything());
  });

  it("未保存或未启用的 MCP Server 不会触发远程请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(handleMcpMessage({ type: "mcp.listTools", serverId: "missing" })).resolves.toEqual({
      ok: false,
      message: "MCP Server 未启用",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
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
