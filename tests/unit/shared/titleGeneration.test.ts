import { describe, expect, it, vi } from "vitest";
import { formatLocalDateTime } from "../../../src/shared/utils/date";
import { generateSessionTitle } from "../../../src/shared/models/titleGeneration";
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

  it("未配置标题模型时使用网站标题和本地时间", async () => {
    const title = await generateSessionTitle({
      siteTitle: "示例网站",
      now: new Date(2026, 4, 19, 20, 30, 15),
      messages,
      titleModel: undefined,
      requestTitle: vi.fn(),
    });

    expect(title).toBe("示例网站 2026-05-19 20:30:15");
  });

  it("标题生成失败时使用默认名", async () => {
    const title = await generateSessionTitle({
      siteTitle: "示例网站",
      now: new Date(2026, 4, 19, 20, 30, 15),
      messages,
      titleModel: createTitleModel(),
      requestTitle: vi.fn().mockRejectedValue(new Error("请求失败")),
    });

    expect(title).toBe("示例网站 2026-05-19 20:30:15");
  });

  it("标题生成成功时使用模型返回的标题", async () => {
    const requestTitle = vi.fn().mockResolvedValue("页面摘要讨论");

    const title = await generateSessionTitle({
      siteTitle: "示例网站",
      now: new Date(2026, 4, 19, 20, 30, 15),
      messages,
      titleModel: createTitleModel(),
      requestTitle,
    });

    expect(title).toBe("页面摘要讨论");
    expect(requestTitle).toHaveBeenCalledWith(createTitleModel(), messages);
  });
});
