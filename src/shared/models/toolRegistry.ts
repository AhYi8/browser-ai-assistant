import type { ModelToolRegistryEntry } from "./types";

export const AVAILABLE_MODEL_TOOLS: ModelToolRegistryEntry[] = [];

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function getRegisteredModelTools(): ModelToolRegistryEntry[] {
  return AVAILABLE_MODEL_TOOLS;
}

export function isValidModelToolId(value: unknown): value is string {
  return typeof value === "string" && TOOL_ID_PATTERN.test(value.trim());
}

export function normalizeEnabledToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(isValidModelToolId)));
}

export function resolveEnabledModelTools(tools: ModelToolRegistryEntry[], enabledToolIds: string[]): ModelToolRegistryEntry[] {
  const enabledIds = new Set(enabledToolIds);
  return tools.filter((tool) => enabledIds.has(tool.id));
}
