import { afterEach, describe, expect, it } from "vitest";
import {
  clearMcpBearerToken,
  getMcpBearerToken,
  getMcpSettings,
  MCP_SETTINGS_KEY,
  normalizeMcpSettings,
  saveMcpBearerToken,
  saveMcpSettings,
} from "../../../src/shared/mcp/settings";
import { clearDatabase, getAppSetting, saveAppSetting } from "../../../src/shared/storage/repositories";

describe("MCP 配置", () => {
  afterEach(async () => {
    await clearDatabase();
  });

  it("归一化 MCP Server 配置并过滤非法 endpoint", () => {
    const settings = normalizeMcpSettings({
      servers: [
        {
          id: " server-1 ",
          name: " MySQL ",
          endpointUrl: " https://mcp.example.com/mcp ",
          enabled: true,
          tools: [
            {
              name: "query",
              description: "执行查询",
              inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "bad",
          name: "坏配置",
          endpointUrl: "file:///tmp/mcp.sock",
          enabled: true,
          tools: [],
          createdAt: 3,
          updatedAt: 4,
        },
      ],
    });

    expect(settings.servers).toEqual([
      {
        id: "server-1",
        name: "MySQL",
        endpointUrl: "https://mcp.example.com/mcp",
        enabled: true,
        tools: [
          {
            name: "query",
            description: "执行查询",
            inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
            disabledReason: undefined,
          },
        ],
        lastRefreshError: undefined,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  it("保存 Bearer Token 时单独写入敏感配置并允许清空", async () => {
    await saveMcpSettings({
      servers: [
        {
          id: "mysql",
          name: "MySQL",
          endpointUrl: "http://127.0.0.1:3000/mcp",
          enabled: true,
          tools: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await saveMcpBearerToken("mysql", "  secret-token  ");

    await expect(getMcpBearerToken("mysql")).resolves.toBe("secret-token");
    await expect(getAppSetting(MCP_SETTINGS_KEY)).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: "mysql" })],
    });

    await clearMcpBearerToken("mysql");

    await expect(getMcpBearerToken("mysql")).resolves.toBe("");
    await expect(getMcpSettings()).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: "mysql" })],
    });
  });

  it("读取历史脏数据时回退为空配置", async () => {
    await saveAppSetting({ key: MCP_SETTINGS_KEY, value: { servers: "bad" }, updatedAt: 1 });

    await expect(getMcpSettings()).resolves.toEqual({ servers: [] });
  });
});
