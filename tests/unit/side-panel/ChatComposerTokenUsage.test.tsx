import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatComposer } from "../../../src/side-panel/components/ChatComposer";
import { useAppStore } from "../../../src/side-panel/state/appStore";

describe("ChatComposer Token 用量", () => {
  afterEach(() => {
    useAppStore.getState().reset();
  });

  it("展示当前会话 Token 用量汇总", () => {
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
          messages: [],
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

    const meter = screen.getByLabelText("当前会话 Token 用量");
    expect(meter).toHaveTextContent("输入 1.5k");
    expect(meter).toHaveTextContent("输出 42");
    expect(meter).toHaveTextContent("写入 20");
    expect(meter).toHaveTextContent("读取 300");
  });

  it("没有会话用量时展示空态", () => {
    render(<ChatComposer canSend matchedRuleLabel="" />);

    expect(screen.getByLabelText("当前会话 Token 用量")).toHaveTextContent("Token 暂无");
  });

  it("发送中且尚无用量时展示统计中", () => {
    useAppStore.setState({ sending: true });

    render(<ChatComposer canSend matchedRuleLabel="" />);

    expect(screen.getByLabelText("当前会话 Token 用量")).toHaveTextContent("Token 统计中");
  });
});
