import { describe, expect, it } from "vitest";
import { buildChatRequestMessages } from "../../../src/shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../../src/shared/chat/modelConfig";
import type { ChatMessage, ChatToolAttachment, ModelProvider, ProviderModel } from "../../../src/shared/types";

function createProvider(): ModelProvider {
  return {
    id: "provider-1",
    name: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createModel(): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "默认模型",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "已结合工具结果回答。",
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

function createNetworkAttachment(id: string, requestId: string, url: string, responseBody: string): ChatToolAttachment {
  return {
    id,
    kind: "network",
    title: "Network 请求详情",
    summary: "共 1 条请求，已脱敏。",
    sourceToolCallId: `call-${requestId}`,
    createdAt: 2,
    redacted: true,
    truncated: false,
    requests: [
      {
        id: requestId,
        url,
        method: "GET",
        status: 200,
        statusText: "OK",
        resourceType: "xhr",
        mimeType: "application/json",
        responseBody,
        truncated: false,
        redacted: true,
      },
    ],
  };
}

describe("最终回答工具附件上下文展开", () => {
  it("普通最终回答上的工具附件只作为 UI 引用保留，不展开到下一次请求上下文", () => {
    const model = createModelConfig(createProvider(), createModel());
    const attachment = createNetworkAttachment(
      "attachment-network-final",
      "req-final",
      "https://example.com/api/final",
      "最终回答引用的详情不应复活进后续模型上下文。",
    );
    const finalAssistantMessage = createMessage({
      id: "message-final",
      content: "已根据 req-final 完成最终分析。",
      toolAttachmentIds: [attachment.id],
    });
    const userMessage = createMessage({
      id: "message-user",
      role: "user",
      content: "继续追问",
      createdAt: 4,
    });

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [finalAssistantMessage],
      userMessage,
      toolAttachmentsById: { [attachment.id]: attachment },
    });

    expect(result[1].toolAttachmentIds).toEqual([attachment.id]);
    expect(result[1].content).toBe("已根据 req-final 完成最终分析。");
    expect(result[1].content).not.toContain("历史 Network 请求摘要");
    expect(result[1].content).not.toContain("https://example.com/api/final");
  });

  it("工具过程消息上的工具附件仍会展开到下一次请求上下文", () => {
    const model = createModelConfig(createProvider(), createModel());
    const attachment = createNetworkAttachment(
      "attachment-network-tool-turn",
      "req-tool-turn",
      "https://example.com/api/tool-turn",
      "工具过程详情只允许以摘要进入上下文。",
    );
    const toolTurnMessage = createMessage({
      id: "message-tool-turn",
      assistantMessageKind: "tool_call_turn",
      content: "",
      toolCallRecords: [
        {
          id: "call-req-tool-turn",
          toolId: "network.get_request_details",
          name: "network_get_request_details",
          displayName: "获取 Network 详情",
          arguments: { requestIds: ["req-tool-turn"] },
          status: "success",
          startedAt: 1,
          completedAt: 2,
          attachmentIds: [attachment.id],
        },
      ],
      toolAttachmentIds: [attachment.id],
    });
    const userMessage = createMessage({
      id: "message-user",
      role: "user",
      content: "继续分析",
      createdAt: 4,
    });

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [toolTurnMessage],
      userMessage,
      toolAttachmentsById: { [attachment.id]: attachment },
    });

    expect(result[1].content).toContain("历史 Network 请求摘要");
    expect(result[1].content).toContain("- req-tool-turn");
    expect(result[1].content).toContain("https://example.com/api/tool-turn");
    expect(result[1].content).not.toContain("工具过程详情只允许以摘要进入上下文。");
  });

  it("最新上下文摘要之后的最终回答引用旧附件时不会绕过压缩边界", () => {
    const model = createModelConfig(createProvider(), createModel());
    const attachment = createNetworkAttachment(
      "attachment-network-before-summary",
      "req-before-summary",
      "https://example.com/api/before-summary",
      "压缩边界之前的详情不能被最终回答附件引用带回。",
    );
    const summaryMessage = createMessage({
      id: "message-summary",
      assistantMessageKind: "context_summary",
      content: "已经压缩过旧工具结果，只保留结论索引。",
      createdAt: 2,
      toolAttachmentIds: [attachment.id],
    });
    const finalAssistantMessage = createMessage({
      id: "message-final",
      content: "最终回答引用 req-before-summary 作为 UI 证据。",
      createdAt: 3,
      toolAttachmentIds: [attachment.id],
    });
    const userMessage = createMessage({
      id: "message-user",
      role: "user",
      content: "继续追问",
      createdAt: 4,
    });

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [summaryMessage, finalAssistantMessage],
      userMessage,
      toolAttachmentsById: { [attachment.id]: attachment },
    });

    const serialized = result.map((message) => message.content).join("\n\n");
    expect(serialized).toContain("已经压缩过旧工具结果，只保留结论索引。");
    expect(serialized).toContain("最终回答引用 req-before-summary 作为 UI 证据。");
    expect(serialized).not.toContain("历史 Network 请求摘要");
    expect(serialized).not.toContain("https://example.com/api/before-summary");
  });

  it("上下文摘要消息上的工具附件不会展开到下一次请求上下文", () => {
    const model = createModelConfig(createProvider(), createModel());
    const attachment = createNetworkAttachment(
      "attachment-network-summary",
      "req-summary",
      "https://example.com/api/summary",
      "上下文摘要上的附件只用于排障，不应重新展开。",
    );
    const summaryMessage = createMessage({
      id: "message-summary",
      assistantMessageKind: "context_summary",
      content: "压缩摘要已保留必要结论。",
      createdAt: 2,
      toolAttachmentIds: [attachment.id],
    });
    const userMessage = createMessage({
      id: "message-user",
      role: "user",
      content: "继续追问",
      createdAt: 4,
    });

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [summaryMessage],
      userMessage,
      toolAttachmentsById: { [attachment.id]: attachment },
    });

    expect(result[1].toolAttachmentIds).toEqual([attachment.id]);
    expect(result[1].content).toBe("压缩摘要已保留必要结论。");
    expect(result[1].content).not.toContain("历史 Network 请求摘要");
    expect(result[1].content).not.toContain("https://example.com/api/summary");
  });
});
