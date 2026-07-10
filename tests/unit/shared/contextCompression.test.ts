import { describe, expect, it } from "vitest";
import {
  createContextSummaryMessage,
  estimateChatContextTokens,
  estimateModelRequestContextTokens,
  estimateTextTokens,
  getMessagesFromLatestContextSummary,
  normalizeContextCompressionThresholdPercent,
  shouldCompressChatContext,
} from "../../../src/shared/chat/contextCompression";
import type { ModelRequestMessage } from "../../../src/shared/models/types";
import type { ChatMessage, ChatTokenUsageEntry, ModelConfig } from "../../../src/shared/types";
import { formatToolAttachmentForPrompt } from "../../../src/shared/toolArtifacts";

function createMessage(id: string, role: ChatMessage["role"], content: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role,
    content,
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

function createUsage(id: string, outputTokens: number, source: ChatTokenUsageEntry["source"] = "chat"): ChatTokenUsageEntry {
  return {
    id,
    usageSchemaVersion: 1,
    source,
    modelId: "model-1",
    endpointType: "openai_chat",
    createdAt: 1,
    inputTokens: 1000,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
}

function createModel(): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "模型",
    displayName: "模型",
    channelName: "渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("聊天上下文压缩预算", () => {
  it("只从最新压缩摘要开始读取上下文消息", () => {
    const firstSummary = createMessage("summary-1", "assistant", "第一次摘要", { assistantMessageKind: "context_summary" });
    const secondSummary = createMessage("summary-2", "assistant", "第二次摘要", { assistantMessageKind: "context_summary" });
    const messages = [
      createMessage("user-old", "user", "旧问题"),
      firstSummary,
      createMessage("user-mid", "user", "中间问题"),
      secondSummary,
      createMessage("user-new", "user", "新问题"),
    ];

    expect(getMessagesFromLatestContextSummary(messages).map((message) => message.id)).toEqual(["summary-2", "user-new"]);
  });

  it("累计 usage 很大但最新摘要后的上下文很小时不会触发压缩", () => {
    const messages = [
      createMessage("assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: ["usage-old"] }),
      createMessage("summary", "assistant", "短摘要", { assistantMessageKind: "context_summary", tokenUsageEntryIds: ["usage-summary"] }),
      createMessage("user-new", "user", "继续"),
    ];

    expect(
      shouldCompressChatContext({
        maxContextTokens: 100,
        systemPrompt: "你是网页助手",
        pageContext: "",
        messages,
        tokenUsageEntries: [createUsage("usage-old", 100000), createUsage("usage-summary", 5, "context_compression")],
      }),
    ).toBe(false);
  });

  it("最新摘要后的消息达到 90% 阈值时触发压缩", () => {
    const messages = [
      createMessage("summary", "assistant", "短摘要", { assistantMessageKind: "context_summary", tokenUsageEntryIds: ["usage-summary"] }),
      createMessage("assistant-new", "assistant", "新回答", { tokenUsageEntryIds: ["usage-new"] }),
    ];

    expect(
      shouldCompressChatContext({
        maxContextTokens: 100,
        systemPrompt: "",
        pageContext: "",
        messages,
        tokenUsageEntries: [createUsage("usage-summary", 5), createUsage("usage-new", 90)],
      }),
    ).toBe(true);
  });

  it("可以使用自定义百分比阈值判断是否压缩", () => {
    const messages = [
      createMessage("summary", "assistant", "短摘要", { assistantMessageKind: "context_summary" }),
      createMessage("user-new", "user", "中文内容".repeat(43)),
    ];

    const input = {
      maxContextTokens: 100,
      systemPrompt: "",
      pageContext: "",
      messages,
    };

    expect(shouldCompressChatContext({ ...input, thresholdPercent: 90 })).toBe(false);
    expect(shouldCompressChatContext({ ...input, thresholdPercent: 80 })).toBe(true);
  });

  it("会归一化自动压缩百分比阈值的异常输入", () => {
    expect(normalizeContextCompressionThresholdPercent(undefined)).toBe(90);
    expect(normalizeContextCompressionThresholdPercent(null)).toBe(90);
    expect(normalizeContextCompressionThresholdPercent("")).toBe(90);
    expect(normalizeContextCompressionThresholdPercent("abc")).toBe(90);
    expect(normalizeContextCompressionThresholdPercent(0)).toBe(1);
    expect(normalizeContextCompressionThresholdPercent(-10)).toBe(1);
    expect(normalizeContextCompressionThresholdPercent(101)).toBe(100);
    expect(normalizeContextCompressionThresholdPercent(80.6)).toBe(81);
  });

  it("优先使用最新真实响应输入规模估算当前上下文", () => {
    const messages = [
      createMessage("user-old", "user", "旧问题"),
      createMessage("assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: ["usage-old"] }),
      createMessage("user-new", "user", "继续"),
    ];
    const usage = {
      ...createUsage("usage-old", 10),
      inputTokens: 460000,
      cacheReadTokens: 20000,
      cacheWriteTokens: 0,
    };

    expect(
      shouldCompressChatContext({
        maxContextTokens: 512000,
        systemPrompt: "",
        pageContext: "",
        messages,
        tokenUsageEntries: [usage],
      }),
    ).toBe(true);
  });

  it("最大聊天上下文为 100k 且阈值 90% 时 20k 上下文不会触发压缩", () => {
    const messages = [
      createMessage("user-old", "user", "旧问题"),
      createMessage("assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: ["usage-old"] }),
      createMessage("user-new", "user", "继续"),
    ];
    const usage = {
      ...createUsage("usage-old", 10),
      inputTokens: 20000,
      outputTokens: 800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    expect(
      shouldCompressChatContext({
        maxContextTokens: 100000,
        thresholdPercent: 90,
        systemPrompt: "",
        pageContext: "",
        messages,
        tokenUsageEntries: [usage],
      }),
    ).toBe(false);
  });

  it("工具循环即时上下文估算不会重复计入工具附件", () => {
    const toolMessage: ModelRequestMessage = {
      role: "tool",
      toolCallId: "call-search",
      name: "tavily_search",
      content: "搜索结果摘要",
      toolAttachments: [
        {
          id: "attachment-search",
          kind: "web-search",
          title: "网络搜索结果",
          summary: "搜索结果摘要",
          sourceToolCallId: "call-search",
          createdAt: 1,
          redacted: false,
          truncated: false,
          provider: "tavily",
          query: "Clash Verge",
          results: [
            { title: "结果", url: "https://example.com", content: "很长的附件内容".repeat(1000) },
          ],
        },
      ],
    };

    expect(estimateModelRequestContextTokens([toolMessage])).toBeLessThan(100);
  });

  it("工具循环即时上下文估算不会重复计入已展开到历史助手内容里的工具附件", () => {
    const webSearchAttachment = {
      id: "attachment-search",
      kind: "web-search" as const,
      title: "网络搜索结果",
      summary: "搜索结果摘要",
      sourceToolCallId: "call-search",
      createdAt: 1,
      redacted: false,
      truncated: false,
      provider: "tavily" as const,
      query: "Clash Verge",
      results: [
        { title: "结果", url: "https://example.com", content: "很长的附件内容".repeat(1000) },
      ],
    };
    const expandedContent = formatToolAttachmentForPrompt(webSearchAttachment) ?? "";
    const message = createMessage("assistant-search", "assistant", expandedContent, {
      assistantMessageKind: "tool_call_turn",
      toolCallRecords: [
        {
          id: "call-search",
          toolId: "tavily_search",
          name: "tavily_search",
          displayName: "网络搜索",
          arguments: { query: "Clash Verge" },
          status: "success",
          startedAt: 1,
          completedAt: 2,
          attachmentIds: [webSearchAttachment.id],
        },
      ],
      toolAttachments: [webSearchAttachment],
    });

    expect(estimateModelRequestContextTokens([message])).toBe(estimateTextTokens(expandedContent));
  });

  it("缺少 usage 的旧消息使用文本估算兜底", () => {
    const tokens = estimateChatContextTokens({
      systemPrompt: "",
      pageContext: "",
      messages: [createMessage("user-1", "user", "中文内容".repeat(10))],
    });

    expect(tokens).toBeGreaterThan(0);
  });

  it("压缩摘要消息会绑定压缩请求 usage", () => {
    const usage = createUsage("usage-compression", 12);
    const message = createContextSummaryMessage({
      content: "压缩后的上下文",
      createdAt: 2,
      model: createModel(),
      systemPrompt: "你是网页助手",
      contextMode: "text",
      tokenUsageEntries: [usage],
    });

    expect(message.assistantMessageKind).toBe("context_summary");
    expect(message.tokenUsageEntryIds).toEqual(["usage-compression"]);
  });
});
