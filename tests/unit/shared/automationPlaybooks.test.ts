import { describe, expect, it } from "vitest";
import {
  getEnabledAutomationPlaybooks,
  getRegisteredAutomationPlaybooks,
  normalizeAutomationPlaybookSettings,
  shouldRunAutomationPlaybookSelection,
} from "../../../src/shared/automationPlaybooks";

describe("浏览器自动化 Playbook 注册表", () => {
  it("内置六类任务策略字段完整且默认启用", () => {
    const playbooks = getRegisteredAutomationPlaybooks();

    expect(playbooks.map((playbook) => playbook.id)).toEqual([
      "page_reading",
      "multi_page_synthesis",
      "form_interaction",
      "site_diagnostics",
      "network_api_analysis",
      "source_runtime_analysis",
    ]);
    expect(new Set(playbooks.map((playbook) => playbook.id)).size).toBe(playbooks.length);
    for (const playbook of playbooks) {
      expect(playbook).toMatchObject({
        source: "builtin",
        defaultEnabled: true,
        title: expect.any(String),
        description: expect.any(String),
        prompt: expect.stringContaining("任务策略"),
      });
      expect(playbook.tags.length).toBeGreaterThan(0);
      expect(playbook.recommendedCapabilities.length).toBeGreaterThan(0);
      expect(playbook.selectionHints.length).toBeGreaterThan(0);
    }
  });

  it("设置归一化会忽略未知 ID 和非法类型", () => {
    const settings = normalizeAutomationPlaybookSettings({
      disabledPlaybookIds: ["page_reading", "missing", 42, "network_api_analysis"],
    });

    expect(settings).toEqual({
      disabledPlaybookIds: ["page_reading", "network_api_analysis"],
    });
    expect(normalizeAutomationPlaybookSettings({ disabledPlaybookIds: "bad" })).toEqual({
      disabledPlaybookIds: [],
    });
  });

  it("禁用后的 Playbook 不参与候选选择", () => {
    const enabled = getEnabledAutomationPlaybooks({
      disabledPlaybookIds: ["page_reading", "source_runtime_analysis"],
    });

    expect(enabled.map((playbook) => playbook.id)).not.toContain("page_reading");
    expect(enabled.map((playbook) => playbook.id)).not.toContain("source_runtime_analysis");
    expect(enabled.map((playbook) => playbook.id)).toContain("network_api_analysis");
  });

  it("只有浏览器现场相关需求才触发预选", () => {
    expect(shouldRunAutomationPlaybookSelection("帮我看看当前页面为什么报错")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("分析这个接口参数怎么生成")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("总结这个网页内容")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("React useMemo 是什么")).toBe(false);
    expect(shouldRunAutomationPlaybookSelection("当前时间是多少")).toBe(false);
    expect(shouldRunAutomationPlaybookSelection("JS 的闭包是什么")).toBe(false);
  });
});
