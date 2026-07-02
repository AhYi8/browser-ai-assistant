import { describe, expect, it } from "vitest";
import {
  createMcpToolId,
  createMcpToolName,
  createMcpToolRegistryEntries,
  parseMcpToolId,
} from "../../../src/shared/mcp/toolAdapter";
import type { McpServerConfig } from "../../../src/shared/types";

const server: McpServerConfig = {
  id: "mysql-local",
  name: "本机 MySQL",
  endpointUrl: "http://127.0.0.1:3000/mcp",
  enabled: true,
  tools: [
    {
      name: "query.sql",
      description: "查询 SQL",
      inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
    },
    {
      name: "bad",
      inputSchema: { type: "string" },
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe("MCP 工具适配", () => {
  it("把已发现 MCP 工具映射为独立 mcp_remote 工具", () => {
    const tools = createMcpToolRegistryEntries([server]);

    expect(tools).toEqual([
      expect.objectContaining({
        id: createMcpToolId("mysql-local", "query.sql"),
        name: createMcpToolName("mysql-local", "query.sql"),
        groupId: "mcp_remote",
        displayName: "本机 MySQL.query.sql",
        toolClassification: {
          runtime: "mcp_remote",
          capabilities: ["call_remote_tool"],
          risk: "medium",
        },
      }),
    ]);
    expect(tools[0]?.parameters).toEqual({ type: "object", properties: { sql: { type: "string" } }, required: ["sql"] });
  });

  it("MCP 工具 ID 可反解 server 和工具名", () => {
    expect(parseMcpToolId(createMcpToolId("mysql-local", "query.sql"))).toEqual({
      serverId: "mysql-local",
      toolName: "query.sql",
    });
  });

  it("MCP 工具 ID 可以正确处理包含点号的 serverId", () => {
    const toolId = createMcpToolId("mysql.local", "query.sql");

    expect(toolId).toBe("mcp.mysql%2Elocal.query.sql");
    expect(parseMcpToolId(toolId)).toEqual({
      serverId: "mysql.local",
      toolName: "query.sql",
    });
  });

  it("禁用 server 不暴露工具", () => {
    expect(createMcpToolRegistryEntries([{ ...server, enabled: false }])).toEqual([]);
  });

  it("MCP 模型侧工具名冲突时会追加稳定后缀", () => {
    const tools = createMcpToolRegistryEntries([
      {
        ...server,
        id: "mysql-local",
        tools: [
          {
            name: "query.sql",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
      {
        ...server,
        id: "mysql.local",
        tools: [
          {
            name: "query_sql",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    ]);

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).not.toBe(tools[1]?.name);
    expect(tools.map((tool) => tool.name)).toEqual([
      expect.stringMatching(/^mcp_mysql_local_query_sql_[a-z0-9]+$/),
      expect.stringMatching(/^mcp_mysql_local_query_sql_[a-z0-9]+$/),
    ]);
  });
});
