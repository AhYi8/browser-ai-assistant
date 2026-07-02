import { describe, expect, it, vi } from "vitest";
import { createBackgroundToolExecutor } from "../../../src/background/backgroundToolRuntime";
import { createMcpToolId, createMcpToolName } from "../../../src/shared/mcp/toolAdapter";
import type { ModelToolCall, ModelToolRegistryEntry } from "../../../src/shared/models/types";

describe("background MCP 工具执行", () => {
  it("只允许执行已发现且启用的 MCP 工具", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "查询结果" }] },
      }));
    const executor = createBackgroundToolExecutor({
      model: createModel(),
      mcp: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "https://mcp.example.com/mcp",
            enabled: true,
            tools: [
              {
                name: "query",
                description: "查询",
                inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        bearerTokens: { mysql: "secret" },
      },
    }, fetcher);
    const tool: ModelToolRegistryEntry = {
      id: createMcpToolId("mysql", "query"),
      name: createMcpToolName("mysql", "query"),
      displayName: "MySQL / query",
      parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
    };
    const call: ModelToolCall = { id: "call-1", name: tool.name, arguments: { sql: "select 1" } };

    await expect(executor(call, tool)).resolves.toEqual({
      toolCallId: "call-1",
      name: tool.name,
      content: "查询结果",
    });
  });

  it("MCP 工具不在发现缓存中时拒绝执行", async () => {
    const executor = createBackgroundToolExecutor({
      model: createModel(),
      mcp: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "https://mcp.example.com/mcp",
            enabled: true,
            tools: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        bearerTokens: {},
      },
    }, vi.fn<typeof fetch>());
    const tool: ModelToolRegistryEntry = {
      id: createMcpToolId("mysql", "query"),
      name: createMcpToolName("mysql", "query"),
      parameters: { type: "object", properties: {} },
      toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
    };

    await expect(executor({ id: "call-1", name: tool.name, arguments: {} }, tool)).resolves.toMatchObject({
      toolCallId: "call-1",
      name: tool.name,
      isError: true,
      content: "MCP 工具未在当前发现列表中，已拒绝执行。",
    });
  });
});

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}

function createModel() {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "模型",
    modelId: "gpt-test",
    name: "gpt-test",
    channelName: "渠道",
    endpointType: "openai_chat" as const,
    endpointUrl: "https://api.example.com",
    apiKey: "sk-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}
