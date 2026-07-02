import { listMcpTools } from "../shared/mcp/httpClient";
import { getMcpBearerToken, getMcpSettings } from "../shared/mcp/settings";

export interface McpListToolsMessage {
  type: "mcp.listTools";
  serverId: string;
}

export type McpListToolsResponse =
  | { ok: true; tools: Awaited<ReturnType<typeof listMcpTools>> }
  | { ok: false; message: string };

export type McpMessage = McpListToolsMessage;

export async function handleMcpMessage(message: McpMessage): Promise<McpListToolsResponse> {
  try {
    const server = (await getMcpSettings()).servers.find((item) => item.id === message.serverId);
    if (!server?.enabled) {
      return { ok: false, message: "MCP Server 未启用" };
    }

    const bearerToken = await getMcpBearerToken(server.id);
    const tools = await listMcpTools({ server, bearerToken });
    return { ok: true, tools };
  } catch {
    return { ok: false, message: "MCP 工具刷新失败，请检查服务地址或鉴权配置" };
  }
}
