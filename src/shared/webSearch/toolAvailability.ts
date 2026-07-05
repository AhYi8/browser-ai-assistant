import { TAVILY_SEARCH_TOOL_ID } from "../models/toolRegistry";
import type { ModelToolRegistryEntry } from "../models/types";
import type { WebSearchSettings } from "../types";
import { parseTavilyApiKeys } from "./tavily";

export function isTavilySearchConfigured(settings: WebSearchSettings): boolean {
  return parseTavilyApiKeys(settings.tavily.apiKeysText).length > 0;
}

export function isModelToolConfigured(tool: ModelToolRegistryEntry, settings: WebSearchSettings): boolean {
  if (tool.id === TAVILY_SEARCH_TOOL_ID) {
    return isTavilySearchConfigured(settings);
  }

  return true;
}

export function filterConfiguredModelTools<T extends ModelToolRegistryEntry>(tools: T[], settings: WebSearchSettings): T[] {
  return tools.filter((tool) => isModelToolConfigured(tool, settings));
}
