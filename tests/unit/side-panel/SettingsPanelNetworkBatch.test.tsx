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

  it("聊天偏好中可以选择默认采集的 Network 请求类型", async () => {
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
    const allCheckbox = screen.getByRole("checkbox", { name: "采集全部 Network 请求类型" });
    const fetchXhrCheckbox = screen.getByRole("checkbox", { name: "采集 Fetch/XHR 请求" });
    expect(allCheckbox).toBeChecked();

    await userEvent.click(fetchXhrCheckbox);

    expect(updateChatPreferences).toHaveBeenLastCalledWith({ networkRequestTypeFilters: ["fetch_xhr"] });
    expect(allCheckbox).not.toBeChecked();
    expect(fetchXhrCheckbox).toBeChecked();
  });

  it("取消最后一个具体 Network 请求类型后回退为采集全部", async () => {
    const updateChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        networkRequestTypeFilters: ["fetch_xhr"],
      },
      updateChatPreferences,
    }));

    render(<SettingsPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "采集 Fetch/XHR 请求" }));

    expect(updateChatPreferences).toHaveBeenLastCalledWith({ networkRequestTypeFilters: ["all"] });
    expect(screen.getByRole("checkbox", { name: "采集全部 Network 请求类型" })).toBeChecked();
  });

  it("从具体 Network 请求类型点击 All 时重置为采集全部", async () => {
    const updateChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        networkRequestTypeFilters: ["fetch_xhr", "img"],
      },
      updateChatPreferences,
    }));

    render(<SettingsPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "采集全部 Network 请求类型" }));

    expect(updateChatPreferences).toHaveBeenLastCalledWith({ networkRequestTypeFilters: ["all"] });
    expect(screen.getByRole("checkbox", { name: "采集 Fetch/XHR 请求" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "采集 Img 请求" })).not.toBeChecked();
  });

  it("点击已选中的 All 不重复保存无效状态", async () => {
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
    await userEvent.click(screen.getByRole("checkbox", { name: "采集全部 Network 请求类型" }));

    expect(updateChatPreferences).not.toHaveBeenCalled();
  });
});
