import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../../../src/side-panel/components/SettingsPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase } from "../../../src/shared/storage/repositories";

describe("SettingsPanel Network 筛选分组设置", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("聊天偏好中可以修改 Network 筛选每组请求数", async () => {
    const updateChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState({ updateChatPreferences });

    render(<SettingsPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));
    const input = screen.getByRole("spinbutton", { name: "全局 Network 筛选每组请求数" });
    expect(input).toHaveDisplayValue("50");

    await userEvent.clear(input);
    await userEvent.type(input, "40");

    expect(updateChatPreferences).toHaveBeenLastCalledWith({ networkRelevanceBatchSize: 40 });
  });
});
