import { describe, expect, it } from "vitest";
import {
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  BROWSER_CLICK_TOOL_ID,
  BROWSER_TAKE_SNAPSHOT_TOOL_ID,
  CURRENT_TIME_TOOL_ID,
  FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID,
  REPLAY_SEND_REQUEST_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
} from "../../../src/shared/models/toolRegistry";
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
});
