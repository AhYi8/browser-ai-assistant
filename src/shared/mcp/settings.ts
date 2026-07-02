import { getAppSetting, saveAppSetting } from "../storage/repositories";
import type { McpDiscoveredTool, McpServerConfig, McpSettings } from "../types";

export const MCP_SETTINGS_KEY = "mcpSettings";
export const MCP_BEARER_TOKEN_SETTING_PREFIX = "mcpBearerToken:";

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  servers: [],
};

export function normalizeMcpSettings(value: unknown): McpSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_MCP_SETTINGS;
  }

  const source = value as Partial<McpSettings>;
  if (!Array.isArray(source.servers)) {
    return DEFAULT_MCP_SETTINGS;
  }

  const servers = source.servers
    .map(normalizeMcpServerConfig)
    .filter((server): server is McpServerConfig => Boolean(server));
  return { servers };
}

export async function getMcpSettings(): Promise<McpSettings> {
  return normalizeMcpSettings(await getAppSetting(MCP_SETTINGS_KEY));
}

export async function saveMcpSettings(settings: McpSettings): Promise<void> {
  await saveAppSetting({
    key: MCP_SETTINGS_KEY,
    value: normalizeMcpSettings(settings),
    updatedAt: Date.now(),
  });
}

export async function getMcpBearerToken(serverId: string): Promise<string> {
  const value = await getAppSetting<string>(createMcpBearerTokenSettingKey(serverId));
  return typeof value === "string" ? value : "";
}

export async function saveMcpBearerToken(serverId: string, token: string): Promise<void> {
  await saveAppSetting({
    key: createMcpBearerTokenSettingKey(serverId),
    value: token.trim(),
    updatedAt: Date.now(),
  });
}

export async function clearMcpBearerToken(serverId: string): Promise<void> {
  await saveMcpBearerToken(serverId, "");
}

export function createMcpBearerTokenSettingKey(serverId: string): string {
  return `${MCP_BEARER_TOKEN_SETTING_PREFIX}${serverId.trim()}`;
}

function normalizeMcpServerConfig(value: unknown): McpServerConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Partial<McpServerConfig>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const endpointUrl = normalizeHttpUrl(source.endpointUrl);
  if (!id || !name || !endpointUrl) {
    return undefined;
  }

  return {
    id,
    name,
    endpointUrl,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    tools: Array.isArray(source.tools) ? source.tools.map(normalizeMcpDiscoveredTool).filter((tool): tool is McpDiscoveredTool => Boolean(tool)) : [],
    lastRefreshError: typeof source.lastRefreshError === "string" && source.lastRefreshError.trim() ? source.lastRefreshError.trim() : undefined,
    createdAt: normalizeTimestamp(source.createdAt),
    updatedAt: normalizeTimestamp(source.updatedAt),
  };
}

function normalizeMcpDiscoveredTool(value: unknown): McpDiscoveredTool | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Partial<McpDiscoveredTool>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) {
    return undefined;
  }

  return {
    name,
    description: typeof source.description === "string" && source.description.trim() ? source.description.trim() : undefined,
    inputSchema: isObjectRecord(source.inputSchema) ? source.inputSchema : {},
    disabledReason: typeof source.disabledReason === "string" && source.disabledReason.trim() ? source.disabledReason.trim() : undefined,
  };
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
