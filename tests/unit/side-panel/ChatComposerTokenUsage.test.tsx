import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatComposer } from "../../../src/side-panel/components/ChatComposer";
import { useAppStore } from "../../../src/side-panel/state/appStore";

describe("ChatComposer Token 用量", () => {
  afterEach(() => {
    useAppStore.getState().reset();
  });

  it("展示当前会话累计 Token 用量汇总", () => {
    useAppStore.setState({
      activeSessionId: "session-token-usage",
      chatSessions: [
        {
          id: "session-token-usage",
          title: "Token 会话",
          archived: false,
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
          messages: [
            {
              id: "message-user-1",
              role: "user",
              content: "中文上下文",
              createdAt: 1,
              modelId: "model-1",
              endpointType: "openai_chat",
              streamMode: false,
              systemPrompt: "你是网页助手",
              contextPrompt: "",
              contextMode: "text",
            },
          ],
          tokenUsageEntries: [
            {
              id: "usage-chat-1",
              usageSchemaVersion: 1,
              source: "chat",
              modelId: "model-1",
              endpointType: "openai_chat",
              createdAt: 1,
              inputTokens: 1500,
              outputTokens: 42,
              cacheWriteTokens: 20,
              cacheReadTokens: 300,
            },
          ],
        },
      ],
    });

    render(<ChatComposer canSend matchedRuleLabel="" />);

    const meter = screen.getByRole("progressbar", { name: "Token 用量" });
    expect(meter).not.toHaveAttribute("title");
    expect(meter).toHaveAttribute("aria-valuemax", String(useAppStore.getState().chatPreferences.maxTokens));
    expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(meter.closest(".token-usage-meter-wrap")).not.toHaveTextContent("输入 1.5k");
    expect(meter.closest(".context-strip")).toBeNull();
    expect(meter.closest(".composer-submit-group")).toContainElement(screen.getByRole("button", { name: "发送" }));

    const tooltipId = meter.getAttribute("aria-describedby");
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(within(tooltip as HTMLElement).getByText("输入")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("1.5k")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("输出")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("42")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("写入")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("20")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("读取")).toBeInTheDocument();
    expect(within(tooltip as HTMLElement).getByText("300")).toBeInTheDocument();
  });

  it("没有会话用量时展示空态", () => {
    render(<ChatComposer canSend matchedRuleLabel="" />);

    const meter = screen.getByRole("progressbar", { name: "Token 用量" });
    const tooltipId = meter.getAttribute("aria-describedby");
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;
    expect(tooltip).toHaveTextContent("暂无累计 Token 用量");
  });

  it("发送中且尚无用量时展示统计中", () => {
    useAppStore.setState({ sending: true });

    render(<ChatComposer canSend matchedRuleLabel="" />);

    const meter = screen.getByRole("progressbar", { name: "Token 用量" });
    const tooltipId = meter.getAttribute("aria-describedby");
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;
    expect(tooltip).toHaveTextContent("Token 统计中");
  });

  it("当前上下文 Token 数会包含输入框草稿", () => {
    render(<ChatComposer canSend matchedRuleLabel="" />);
    const meter = screen.getByRole("progressbar", { name: "Token 用量" });
    const before = meter.getAttribute("aria-valuenow");

    const editor = screen.getByRole("textbox", { name: "对话输入" });
    editor.textContent = "新的草稿内容".repeat(40);
    fireEvent.input(editor);

    expect(meter.getAttribute("aria-valuenow")).not.toBe(before);
  });
});
