import { describe, expect, it } from "vitest";
import { buildChatRequestMessages } from "../../../src/shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../../src/shared/chat/modelConfig";
import type { ChatMessage, ModelProvider, ProviderModel } from "../../../src/shared/types";

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
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMessage(id: string, role: ChatMessage["role"], content: string, createdAt: number): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "旧上下文",
    contextMode: "text",
  };
}

describe("聊天请求消息构造", () => {
  it("将模型系统提示、页面上下文、当前会话全部消息和本次用户消息一起提交", () => {
    const model = createModelConfig(createProvider(), createModel());
    const existingMessages = [
      createMessage("message-1", "user", "第一问", 1),
      createMessage("message-2", "assistant", "第一答", 2),
    ];
    const userMessage = createMessage("message-3", "user", "第二问", 3);
    userMessage.streamMode = true;
    userMessage.contextMode = "all";
    userMessage.matchedRuleId = "rule-1";

    const result = buildChatRequestMessages({
      model,
      pageContext: "当前页面正文",
      existingMessages,
      userMessage,
    });

    expect(result.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "你是网页助手\n\n当前页面上下文：\n当前页面正文" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
    ]);
    expect(result[0]).toMatchObject({
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: true,
      contextMode: "all",
      matchedRuleId: "rule-1",
      contextPrompt: "当前页面正文",
    });
    expect(result.slice(1)).toEqual([...existingMessages, userMessage]);
  });

  it("没有页面上下文时只使用模型系统提示", () => {
    const model = createModelConfig(createProvider(), createModel());
    const userMessage = createMessage("message-1", "user", "你好", 1);

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [],
      userMessage,
    });

    expect(result.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "你是网页助手" },
      { role: "user", content: "你好" },
    ]);
  });

  it("优先使用聊天偏好中的系统提示词作为首条 system 消息", () => {
    const model = createModelConfig(createProvider(), createModel());
    const userMessage = createMessage("message-1", "user", "你好", 1);

    const result = buildChatRequestMessages({
      model,
      pageContext: "当前页面正文",
      existingMessages: [],
      userMessage,
      systemPrompt: "你是更严格的网页分析助手",
    });

    expect(result.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "你是更严格的网页分析助手\n\n当前页面上下文：\n当前页面正文" },
      { role: "user", content: "你好" },
    ]);
    expect(result[0].systemPrompt).toBe("你是更严格的网页分析助手");
  });

  it("发送前按 max_token 预算裁剪页面上下文并保留系统提示词和用户输入", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 20 });
    const userMessage = createMessage("message-1", "user", "请总结", 1);

    const result = buildChatRequestMessages({
      model,
      pageContext: "页面上下文".repeat(100),
      existingMessages: [],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].content).toContain("你是网页助手");
    expect(result[0].content).toContain("当前页面上下文：");
    expect(result[0].content).toContain("页面上下文");
    expect(result[0].content.length).toBeLessThan(80);
    expect(result[0].contextPrompt.length).toBeLessThan("页面上下文".repeat(100).length);
    expect(result[1].content).toBe("请总结");
  });

  it("中文页面上下文使用更保守的字符预算避免过量保留", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 30 });
    const userMessage = createMessage("message-1", "user", "请总结", 1);

    const result = buildChatRequestMessages({
      model,
      pageContext: "中文内容".repeat(40),
      existingMessages: [],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].contextPrompt.length).toBeLessThanOrEqual(42);
  });

  it("历史消息中的思考过程参与上下文预算计算", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 18 });
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "简短回复", 1),
      thinking: "思考过程".repeat(20),
    };
    const userMessage = createMessage("message-2", "user", "继续", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "需要被裁剪的页面上下文".repeat(10),
      existingMessages: [assistantMessage],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].contextPrompt).toBe("");
  });

  it("max_token 足够时发送请求保留完整页面上下文", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 2048 });
    const userMessage = createMessage("message-1", "user", "请总结", 1);
    const pageContext = "完整页面上下文";

    const result = buildChatRequestMessages({
      model,
      pageContext,
      existingMessages: [],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].content).toContain(pageContext);
    expect(result[0].contextPrompt).toBe(pageContext);
  });

});
