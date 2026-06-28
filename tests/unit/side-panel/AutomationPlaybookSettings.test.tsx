import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutomationPlaybookSettings } from "../../../src/side-panel/components/settings/AutomationPlaybookSettings";
import { useAppStore } from "../../../src/side-panel/state/appStore";

describe("任务策略设置", () => {
  it("展示内置 Playbook 并支持启用禁用", async () => {
    const user = userEvent.setup();
    const updateAutomationPlaybookSettings = vi.fn(async () => undefined);
    useAppStore.setState({
      automationPlaybookSettings: { disabledPlaybookIds: [] },
      updateAutomationPlaybookSettings,
    });

    render(<AutomationPlaybookSettings />);

    expect(screen.getByRole("heading", { name: "任务策略" })).toBeInTheDocument();
    expect(screen.getByText("页面阅读")).toBeInTheDocument();
    expect(screen.getByText("Network/API 分析")).toBeInTheDocument();
    expect(screen.getByText("源码/运行时分析")).toBeInTheDocument();
    expect(screen.queryByText("克隆")).not.toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "启用任务策略 页面阅读" }));

    await waitFor(() => {
      expect(updateAutomationPlaybookSettings).toHaveBeenCalledWith({
        disabledPlaybookIds: ["page_reading"],
      });
    });
  });

  it("可查看不可编辑策略的完整详细信息", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      automationPlaybookSettings: { disabledPlaybookIds: [] },
      updateAutomationPlaybookSettings: vi.fn(async () => undefined),
    });

    render(<AutomationPlaybookSettings />);

    await user.click(screen.getByRole("button", { name: "查看任务策略 页面阅读 详细信息" }));

    expect(screen.getByRole("region", { name: "页面阅读详细信息" })).toBeInTheDocument();
    expect(screen.getByText("策略 ID")).toBeInTheDocument();
    expect(screen.getByText("page_reading")).toBeInTheDocument();
    expect(screen.getByText("适用提示")).toBeInTheDocument();
    expect(screen.getByText("当前页面是什么")).toBeInTheDocument();
    expect(screen.getByText("完整策略提示")).toBeInTheDocument();
    expect(screen.getByText(/优先使用当前受控页面作为事实来源/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
});
