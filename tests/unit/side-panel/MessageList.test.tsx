import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { CONTEXT_COMPRESSION_TOOL_ID } from "../../../src/shared/chat/contextCompression";
import { MessageList } from "../../../src/side-panel/components/MessageList";
import type { ChatMessage } from "../../../src/shared/types";

type MessageListProps = ComponentProps<typeof MessageList>;

function createChatMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
  };
}

function createToolCallMessage(id: string): ChatMessage {
  return {
    ...createChatMessage(id, "正在检查页面"),
    assistantMessageKind: "tool_call_turn",
    toolCallRecords: [
      {
        id: `${id}-tool-call`,
        toolId: "browser.take_snapshot",
        name: "browser_take_snapshot",
        displayName: "浏览器页面快照",
        arguments: {},
        status: "success",
        startedAt: 1,
        completedAt: 2,
        resultSummary: "已截取页面快照",
      },
    ],
  };
}

function createContextSummaryMessage(id: string): ChatMessage {
  return {
    ...createChatMessage(id, "压缩后的摘要"),
    assistantMessageKind: "context_summary",
  };
}

function createMessageListElement(props: Partial<MessageListProps>) {
  return (
    <MessageList
      messages={[]}
      retryProgressByMessageId={{}}
      toolCallDisplayMode="assistant_grouped"
      showToolCallProcessInAssistantMode
      onRegenerateMessage={vi.fn()}
      onEditAndRegenerateUserMessage={vi.fn()}
      regenerating={false}
      {...props}
    />
  );
}

function renderMessageList(messages: ChatMessage[], props: Partial<MessageListProps> = {}) {
  return render(createMessageListElement({ messages, ...props }));
}

function setScrollMetrics(element: HTMLElement, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  element.scrollTop = metrics.scrollTop;
}

describe("MessageList 滚动跟随", () => {
  it("消息列表已经触底时追加消息会继续滚动到底部", () => {
    const { rerender } = renderMessageList([createChatMessage("message-1", "第一条消息")]);
    const messageList = screen.getByLabelText("消息列表");
    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 300 });
    fireEvent.scroll(messageList);

    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 720, scrollTop: 300 });
    rerender(createMessageListElement({
      messages: [
        createChatMessage("message-1", "第一条消息"),
        createChatMessage("message-2", "第二条消息"),
      ],
    }));

    expect(messageList.scrollTop).toBe(720);
  });

  it("消息列表未触底时追加消息不会抢走用户当前滚动位置", () => {
    const { rerender } = renderMessageList([createChatMessage("message-1", "第一条消息")]);
    const messageList = screen.getByLabelText("消息列表");
    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(messageList);

    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 720, scrollTop: 120 });
    rerender(createMessageListElement({
      messages: [
        createChatMessage("message-1", "第一条消息"),
        createChatMessage("message-2", "第二条消息"),
      ],
    }));

    expect(messageList.scrollTop).toBe(120);
  });

  it("消息列表距离底部 8px 内时视为已触底并继续跟随", () => {
    const { rerender } = renderMessageList([createChatMessage("message-1", "第一条消息")]);
    const messageList = screen.getByLabelText("消息列表");
    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 292 });
    fireEvent.scroll(messageList);

    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 720, scrollTop: 292 });
    rerender(createMessageListElement({
      messages: [
        createChatMessage("message-1", "第一条消息"),
        createChatMessage("message-2", "第二条消息"),
      ],
    }));

    expect(messageList.scrollTop).toBe(720);
  });

  it("用户未触底时切换工具过程展示偏好不会抢走当前滚动位置", () => {
    const messages = [createChatMessage("message-1", "第一条消息"), createToolCallMessage("message-tool")];
    const { rerender } = renderMessageList(messages, { showToolCallProcessInAssistantMode: false });
    const messageList = screen.getByLabelText("消息列表");
    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(messageList);

    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 680, scrollTop: 120 });
    rerender(createMessageListElement({ messages, showToolCallProcessInAssistantMode: true }));

    expect(messageList.scrollTop).toBe(120);
  });

  it("消息列表已经触底时重试状态更新会继续滚动到底部", () => {
    const retryMessage = { ...createChatMessage("message-retry", ""), streaming: true };
    const { rerender } = renderMessageList([retryMessage]);
    const messageList = screen.getByLabelText("消息列表");
    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 300 });
    fireEvent.scroll(messageList);

    setScrollMetrics(messageList, { clientHeight: 200, scrollHeight: 620, scrollTop: 300 });
    rerender(createMessageListElement({
      messages: [retryMessage],
      retryProgressByMessageId: {
        "message-retry": {
          currentRetry: 1,
          maxRetries: 5,
        },
      },
    }));

    expect(messageList.scrollTop).toBe(620);
  });

  it("上下文压缩会显示为独立工具调用行并隐藏摘要消息正文", () => {
    renderMessageList([
      createChatMessage("message-1", "第一条消息"),
      {
        ...createChatMessage("message-compress", ""),
        assistantMessageKind: "tool_call_turn",
        toolCallRecords: [
          {
            id: "tool-compress",
            toolId: CONTEXT_COMPRESSION_TOOL_ID,
            name: "context_compression",
            displayName: "上下文压缩",
            arguments: {
              maxContextTokens: 100000,
              thresholdPercent: 90,
              triggerThresholdTokens: 90000,
              estimatedContextTokens: 36000,
              scopedMessageCount: 6,
            },
            status: "running",
            startedAt: 1,
          },
        ],
      },
      createContextSummaryMessage("message-summary"),
    ]);

    expect(screen.getByRole("button", { name: "正在进行上下文压缩（实际请求上下文 36k/100k，阈值 90k）" })).toBeInTheDocument();
    expect(screen.queryByText("压缩后的摘要")).not.toBeInTheDocument();
  });

  it("工具循环内上下文压缩会标出运行中上下文估算", () => {
    renderMessageList([
      {
        ...createChatMessage("message-compress", ""),
        assistantMessageKind: "tool_call_turn",
        toolCallRecords: [
          {
            id: "tool-compress",
            toolId: CONTEXT_COMPRESSION_TOOL_ID,
            name: "context_compression",
            displayName: "上下文压缩",
            arguments: {
              maxContextTokens: 100000,
              thresholdPercent: 90,
              triggerThresholdTokens: 90000,
              estimatedContextTokens: 92000,
              temporaryMessageCount: 12,
            },
            status: "success",
            startedAt: 1,
            completedAt: 2,
          },
        ],
      },
    ]);

    expect(screen.getByRole("button", { name: "上下文压缩（运行中上下文 92k/100k，阈值 90k）" })).toBeInTheDocument();
  });

  it("上下文压缩不受工具过程开关控制且不显示已调用前缀", () => {
    renderMessageList(
      [
        {
          ...createChatMessage("message-compress-legacy", ""),
          assistantMessageKind: "tool_call_turn",
          toolCallRecords: [
            {
              id: "tool-compress-legacy",
              toolId: "context_compression",
              name: "context_compression",
              displayName: "上下文压缩",
              arguments: {},
              status: "success",
              startedAt: 1,
              completedAt: 2,
            },
          ],
        },
      ],
      { showToolCallProcessInAssistantMode: false },
    );

    expect(screen.getByRole("button", { name: "上下文压缩" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已调用 上下文压缩" })).not.toBeInTheDocument();
  });
});
