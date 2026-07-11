import { describe, expect, it } from "vitest";
import { estimateChatContextTokens, estimateTextTokens } from "../../../src/shared/chat/contextCompression";
import type { ChatMessage, ChatToolAttachment } from "../../../src/shared/types";

function createMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "最终回答正文",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
    ...partial,
  };
}

function createNetworkAttachment(): ChatToolAttachment {
  return {
    id: "attachment-network-final",
    kind: "network",
    title: "Network 请求详情",
    summary: "共 1 条请求，已脱敏。",
    sourceToolCallId: "call-network-final",
    createdAt: 2,
    redacted: true,
    truncated: false,
    requests: [
      {
        id: "req-final",
        url: "https://example.com/api/final",
        method: "GET",
        status: 200,
        statusText: "OK",
        resourceType: "xhr",
        mimeType: "application/json",
        responseBody: "最终回答引用的详情不应复活进后续模型上下文。".repeat(100),
        truncated: false,
        redacted: true,
      },
    ],
  };
}

describe("最终回答工具附件压缩估算", () => {
  it("上下文压缩估算不会把普通最终回答的 UI 工具附件计入模型上下文", () => {
    const attachment = createNetworkAttachment();
    const finalMessage = createMessage({
      id: "assistant-final",
      content: "最终回答正文",
      toolAttachmentIds: [attachment.id],
    });
    const toolTurnMessage = createMessage({
      id: "assistant-tool-turn",
      assistantMessageKind: "tool_call_turn",
      content: "工具过程正文",
      toolAttachmentIds: [attachment.id],
      toolCallRecords: [
        {
          id: "call-network-final",
          toolId: "network.get_request_details",
          name: "network_get_request_details",
          displayName: "获取 Network 详情",
          arguments: { requestIds: ["req-final"] },
          status: "success",
          startedAt: 1,
          completedAt: 2,
          attachmentIds: [attachment.id],
        },
      ],
    });

    const finalMessageTokens = estimateChatContextTokens({
      systemPrompt: "",
      pageContext: "",
      messages: [finalMessage],
      toolAttachmentsById: { [attachment.id]: attachment },
    });
    const toolTurnTokens = estimateChatContextTokens({
      systemPrompt: "",
      pageContext: "",
      messages: [toolTurnMessage],
      toolAttachmentsById: { [attachment.id]: attachment },
    });

    expect(finalMessageTokens).toBe(estimateTextTokens("最终回答正文"));
    expect(toolTurnTokens).toBeGreaterThan(finalMessageTokens);
  });
});
