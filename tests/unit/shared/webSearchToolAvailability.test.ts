import { describe, expect, it } from "vitest";
import { TAVILY_SEARCH_TOOL_ID, getRegisteredModelTools } from "../../../src/shared/models/toolRegistry";
import { filterConfiguredModelTools, isTavilySearchConfigured } from "../../../src/shared/webSearch/toolAvailability";
import type { WebSearchSettings } from "../../../src/shared/types";

function createSettings(apiKeysText: string): WebSearchSettings {
  return {
    provider: "tavily",
    tavily: {
      apiKeysText,
      apiKeyStrategy: "round_robin",
      includeAnswer: "basic",
      includeRawContent: false,
      maxResults: 5,
    },
    updatedAt: 1,
  };
}

describe("Tavily 工具可用性", () => {
  it("未配置 Tavily API Key 时过滤 Tavily 工具", () => {
    const tools = filterConfiguredModelTools(getRegisteredModelTools(), createSettings("  "));

    expect(isTavilySearchConfigured(createSettings("  "))).toBe(false);
    expect(tools.some((tool) => tool.id === TAVILY_SEARCH_TOOL_ID)).toBe(false);
  });

  it("配置 Tavily API Key 后保留 Tavily 工具", () => {
    const tools = filterConfiguredModelTools(getRegisteredModelTools(), createSettings("tvly-1, tvly-2"));

    expect(isTavilySearchConfigured(createSettings("tvly-1"))).toBe(true);
    expect(tools.some((tool) => tool.id === TAVILY_SEARCH_TOOL_ID)).toBe(true);
  });
});
