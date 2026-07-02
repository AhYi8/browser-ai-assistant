import { describe, expect, it } from "vitest";
import {
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  BROWSER_CLICK_TOOL_ID,
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  CURRENT_TIME_TOOL_ID,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
  REPLAY_SEND_REQUEST_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
  isToolRuntimeAvailable,
  normalizeEnabledToolIds,
} from "../../../src/shared/models/toolRegistry";
import type { ModelToolRegistryEntry } from "../../../src/shared/models/types";
import { resolveRuntimeEnabledToolIds } from "../../../src/side-panel/state/appStorePreferences";

describe("聊天偏好工具运行态过滤", () => {
  it("只保留当前运行态真实可用的已启用工具", () => {
    const enabledToolIds = [
      CURRENT_TIME_TOOL_ID,
      TAVILY_SEARCH_TOOL_ID,
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
      BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
      REPLAY_SEND_REQUEST_TOOL_ID,
      FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
    ];

    expect(resolveRuntimeEnabledToolIds(enabledToolIds, false, "normal_restricted")).toEqual([
      CURRENT_TIME_TOOL_ID,
      TAVILY_SEARCH_TOOL_ID,
    ]);
    expect(resolveRuntimeEnabledToolIds(enabledToolIds, true, "normal_restricted")).toEqual([
      CURRENT_TIME_TOOL_ID,
      TAVILY_SEARCH_TOOL_ID,
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
    ]);
    expect(resolveRuntimeEnabledToolIds(enabledToolIds, true, "controlled_enhanced")).toEqual([
      CURRENT_TIME_TOOL_ID,
      TAVILY_SEARCH_TOOL_ID,
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
      BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
      REPLAY_SEND_REQUEST_TOOL_ID,
    ]);
    expect(resolveRuntimeEnabledToolIds(enabledToolIds, true, "full_access")).toEqual([
      CURRENT_TIME_TOOL_ID,
      TAVILY_SEARCH_TOOL_ID,
      BROWSER_TAKE_SNAPSHOT_TOOL_ID,
      BROWSER_CLICK_TOOL_ID,
      FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
    ]);
  });

  it("开启浏览器控制不会自动追加用户未启用的浏览器工具", () => {
    expect(resolveRuntimeEnabledToolIds([TAVILY_SEARCH_TOOL_ID], true, "full_access")).toEqual([TAVILY_SEARCH_TOOL_ID]);
  });

  it("MCP 远程工具不受浏览器自动化开关和模式影响", () => {
    const mcpTool: ModelToolRegistryEntry = {
      id: "mcp.mysql.query",
      name: "mcp_mysql_query",
      parameters: { type: "object", properties: {} },
      toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
    };

    expect(isToolRuntimeAvailable(mcpTool, false, "normal_restricted")).toBe(true);
    expect(isToolRuntimeAvailable(mcpTool, true, "normal_restricted")).toBe(true);
    expect(isToolRuntimeAvailable(mcpTool, true, "controlled_enhanced")).toBe(true);
    expect(isToolRuntimeAvailable(mcpTool, true, "full_access")).toBe(true);
  });

  it("MCP 工具 ID 包含大写字母时不会在过滤中被抛弃", () => {
    expect(normalizeEnabledToolIds(["browser.take_snapshot", "mcp.mysql.getAllRecipes", "mcp.mysql.query", "../bad"])).toEqual([
      "browser.take_snapshot",
      "mcp.mysql.getAllRecipes",
      "mcp.mysql.query",
    ]);
  });
});
