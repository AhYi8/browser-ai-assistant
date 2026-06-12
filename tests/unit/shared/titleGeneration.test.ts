import { describe, expect, it, vi } from "vitest";
import {
  createTitleGenerationMessages,
  generateSessionTitle,
  parseGeneratedTitle,
} from "../../../src/shared/models/titleGeneration";
import { formatLocalDateTime } from "../../../src/shared/utils/date";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

const messages: ChatMessage[] = [
  {
    id: "message-1",
    role: "user",
    content: "总结这个网页",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "网页内容",
    contextMode: "text",
  },
];

function createTitleModel(): ModelConfig {
  return {
    id: "title-model",
    providerId: "provider-1",
    name: "标题模型",
    displayName: "标题模型",
    channelName: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-title",
    temperature: 0.2,
    maxTokens: 64,
    systemPrompt: "生成标题",
    isTitleModel: true,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("标题生成", () => {
  it("按本地时区格式化 24 小时时间", () => {
    const date = new Date(2026, 4, 19, 9, 8, 7);

    expect(formatLocalDateTime(date)).toBe("2026-05-19 09:08:07");
  });

  it("未配置标题模型时保持当前默认标题且不请求模型", async () => {
    const requestTitle = vi.fn();

    const title = await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: undefined,
      requestTitle,
    });

    expect(title).toBe("总结这个网页");
    expect(requestTitle).not.toHaveBeenCalled();
  });

  it("标题生成失败时使用默认名", async () => {
    const title = await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: createTitleModel(),
      requestTitle: vi.fn().mockRejectedValue(new Error("请求失败")),
    });

    expect(title).toBe("总结这个网页");
  });

  it("标题生成成功时只使用 JSON 响应中的 title 字段", async () => {
    const requestTitle = vi.fn().mockResolvedValue('{"title":"页面摘要讨论"}');

    const title = await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: createTitleModel(),
      requestTitle,
    });

    expect(title).toBe("页面摘要讨论");
    expect(requestTitle).toHaveBeenCalledWith(createTitleModel(), messages, undefined);
  });

  it("标题生成会把 AI 请求重试次数传给请求函数", async () => {
    const requestTitle = vi.fn().mockResolvedValue('{"title":"页面摘要讨论"}');

    await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: createTitleModel(),
      retryCount: 5,
      requestTitle,
    });

    expect(requestTitle).toHaveBeenCalledWith(createTitleModel(), messages, 5);
  });

  it("标题模型返回非 JSON 文本时使用默认名", async () => {
    const title = await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: createTitleModel(),
      requestTitle: vi.fn().mockResolvedValue("页面摘要讨论"),
    });

    expect(title).toBe("总结这个网页");
  });

  it("标题模型返回空标题时使用默认名", async () => {
    const title = await generateSessionTitle({
      fallbackTitle: "总结这个网页",
      messages,
      titleModel: createTitleModel(),
      requestTitle: vi.fn().mockResolvedValue('{"title":"   "}'),
    });

    expect(title).toBe("总结这个网页");
  });

  it("构造标题请求消息时包含网页上下文和首条用户消息", () => {
    const titleMessages = createTitleGenerationMessages({
      userContent: "总结这个网页",
      pageContext: "网页正文内容",
      assistantContent: "AI 回复内容",
    });

    expect(titleMessages).toHaveLength(2);
    expect(titleMessages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining('{"title":"标题"}'),
    });
    expect(titleMessages[0].content).toContain("只返回一个 JSON 对象");
    expect(titleMessages[1].content).toContain("网页上下文：网页正文内容");
    expect(titleMessages[1].content).toContain("用户消息：总结这个网页");
    expect(titleMessages[1].content).toContain("助手回复：AI 回复内容");
  });

  it("解析标题时限制长度并去除空白", () => {
    expect(parseGeneratedTitle(`{"title":"  页面摘要讨论  "}`)).toBe("页面摘要讨论");
    expect(parseGeneratedTitle(JSON.stringify({ title: "一".repeat(80) }))).toHaveLength(60);
    expect(parseGeneratedTitle("```json\n{\"title\":\"页面摘要讨论\"}\n```")).toBeUndefined();
  });
});
