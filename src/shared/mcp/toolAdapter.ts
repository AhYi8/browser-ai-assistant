import type { ModelToolRegistryEntry } from "../models/types";
import type { McpServerConfig, McpToolRuntimeMetadata } from "../types";

export const MODEL_TOOL_GROUP_MCP_REMOTE_ID = "mcp_remote";

const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export function createMcpToolId(serverId: string, toolName: string): string {
  return `mcp.${encodeMcpToolIdPart(serverId)}.${encodeURIComponent(toolName)}`;
}

export function parseMcpToolId(toolId: string): McpToolRuntimeMetadata | undefined {
  const match = toolId.match(/^mcp\.([^.]+)\.(.+)$/);
  if (!match) {
    return undefined;
  }

  try {
    return {
      serverId: decodeURIComponent(match[1]),
      toolName: decodeURIComponent(match[2]),
    };
  } catch {
    return undefined;
  }
}

export function createMcpToolName(serverId: string, toolName: string): string {
  const normalized = `mcp_${serverId}_${toolName}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^([^a-zA-Z_])/, "_$1")
    .slice(0, 64);
  return MODEL_TOOL_NAME_PATTERN.test(normalized) ? normalized : `mcp_tool_${hashText(`${serverId}:${toolName}`)}`;
}

export function createMcpToolRegistryEntries(servers: McpServerConfig[]): ModelToolRegistryEntry[] {
  const candidates = servers.flatMap((server) => {
    if (!server.enabled) {
      return [];
    }

    return server.tools
      .filter((tool) => !tool.disabledReason && isValidMcpInputSchema(tool.inputSchema))
      .map((tool) => ({
        id: createMcpToolId(server.id, tool.name),
        name: createMcpToolName(server.id, tool.name),
        nameSource: `${server.id}:${tool.name}`,
        groupId: MODEL_TOOL_GROUP_MCP_REMOTE_ID,
        displayName: `${server.name}.${tool.name}`,
        description: tool.description ?? `调用 MCP Server「${server.name}」提供的工具 ${tool.name}`,
        parameters: tool.inputSchema,
        toolClassification: {
          runtime: "mcp_remote" as const,
          capabilities: ["call_remote_tool" as const],
          risk: "medium" as const,
        },
      }));
  });

  const nameCounts = new Map<string, number>();
  candidates.forEach((candidate) => {
    nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
  });

  return candidates.map(({ nameSource, ...candidate }) => ({
    ...candidate,
    name: nameCounts.get(candidate.name)! > 1 ? createCollisionSafeMcpToolName(candidate.name, nameSource) : candidate.name,
  }));
}

export function isMcpToolId(toolId: string): boolean {
  return Boolean(parseMcpToolId(toolId));
}

function isValidMcpInputSchema(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "object";
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function encodeMcpToolIdPart(value: string): string {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

function createCollisionSafeMcpToolName(baseName: string, source: string): string {
  const suffix = `_${hashText(source)}`;
  return `${baseName.slice(0, 64 - suffix.length)}${suffix}`;
}
