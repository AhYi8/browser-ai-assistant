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

  it("发送含 Prompt 调用的用户消息时只在 user 内容中展开 Prompt 快照", () => {
    const model = createModelConfig(createProvider(), createModel());
    const userMessage = {
      ...createMessage("message-1", "user", "请结合当前页面输出建议", 1),
      promptInvocations: [
        {
          promptId: "prompt-risk",
          title: "风险审查",
          contentSnapshot: "从安全、隐私和可维护性三个角度审查。",
        },
        {
          promptId: "prompt-action",
          title: "行动清单",
          contentSnapshot: "最后输出三条可执行行动。",
        },
      ],
    };

    const result = buildChatRequestMessages({
      model,
      pageContext: "当前页面正文",
      existingMessages: [],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].content).toBe("你是网页助手\n\n当前页面上下文：\n当前页面正文");
    expect(result[0].content).not.toContain("从安全、隐私和可维护性三个角度审查");
    expect(result[1]).toMatchObject({
      role: "user",
      content: [
        "已调用提示词：",
        "1. 风险审查",
        "从安全、隐私和可维护性三个角度审查。",
        "",
        "2. 行动清单",
        "最后输出三条可执行行动。",
        "",
        "用户输入：",
        "请结合当前页面输出建议",
      ].join("\n"),
    });
    expect(userMessage.content).toBe("请结合当前页面输出建议");
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

  it("当前用户消息的 Prompt 快照和图片附件会参与页面上下文预算计算", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 1200 });
    const userMessage: ChatMessage = {
      ...createMessage("message-1", "user", "请结合附件分析", 1),
      promptInvocations: [
        {
          promptId: "prompt-1",
          title: "长 Prompt",
          contentSnapshot: "补充约束".repeat(500),
        },
      ],
      attachments: [
        {
          id: "image-1",
          name: "截图.png",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,QUJD",
        },
      ],
    };

    const result = buildChatRequestMessages({
      model,
      pageContext: "应被图片和 Prompt 预算挤掉的页面上下文".repeat(20),
      existingMessages: [],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].contextPrompt).toBe("");
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

  it("历史消息中的 reasoningContent 参与上下文预算计算", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 18 });
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "简短回复", 1),
      reasoningContent: "原始思考".repeat(20),
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

  it("thinking 与 reasoningContent 相同时预算不重复计算", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 30 });
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "简短回复", 1),
      thinking: "同一段思考",
      reasoningContent: "同一段思考",
    };
    const userMessage = createMessage("message-2", "user", "继续", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "中文内容".repeat(40),
      existingMessages: [assistantMessage],
      userMessage,
      systemPrompt: "你是网页助手",
    });

    expect(result[0].contextPrompt.length).toBeGreaterThan(0);
  });

  it("后续请求会携带历史 AI 消息中的 Network 附件详情且不修改原消息", () => {
    const model = createModelConfig(createProvider(), createModel());
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "登录接口返回 500。", 1),
      assistantMessageKind: "tool_call_turn",
      networkContextAttachment: {
        id: "network-1",
        title: "Network 请求详情",
        summary: "已注入 1 个 Network 请求：POST 500 https://api.example.com/login",
        createdAt: 2,
        redacted: true,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: "https://api.example.com/login?token=[已脱敏]&safe=1",
            method: "POST",
            status: 500,
            requestHeaders: [{ name: "Authorization", value: "[已脱敏]" }],
            responseBody: "{\"error\":\"failed\"}",
            redacted: true,
            truncated: false,
          },
        ],
      },
    } satisfies ChatMessage;
    const userMessage = createMessage("message-2", "user", "继续分析", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [assistantMessage],
      userMessage,
    });

    expect(result[1].content).toContain("后续追问可参考以下历史 Network 请求摘要");
    expect(result[1].content).toContain("req-1");
    expect(result[1].content).toContain("POST 500");
    expect(result[1].content).toContain("https://api.example.com/login?token=[已脱敏]&safe=1");
    expect(result[1].content).toContain("requestHeaders[Authorization]");
    expect(result[1].content).not.toContain("{\"error\":\"failed\"}");
    expect(assistantMessage.content).toBe("登录接口返回 500。");
  });

  it("后续请求展开历史 Network 附件前会重新脱敏脏数据", () => {
    const model = createModelConfig(createProvider(), createModel());
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "旧版本保存的接口分析。", 1),
      assistantMessageKind: "tool_call_turn",
      networkContextAttachment: {
        id: "network-1",
        title: "Network 请求详情",
        summary: "旧附件",
        createdAt: 2,
        redacted: false,
        truncated: false,
        requests: [
          {
            id: "req-unsafe",
            url: "https://api.example.com/login?token=secret-token&safe=1",
            method: "POST",
            status: 500,
            requestHeaders: [
              { name: "Authorization", value: "Bearer secret-token" },
              { name: "Cookie", value: "sid=secret-cookie" },
            ],
            requestBody: "{\"password\":\"123456\",\"name\":\"张三\"}",
            responseBody: "{\"access_token\":\"secret-token\",\"message\":\"failed\"}",
            redacted: false,
            truncated: false,
          },
        ],
      },
    } satisfies ChatMessage;
    const userMessage = createMessage("message-2", "user", "继续分析", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [assistantMessage],
      userMessage,
    });
    const expandedContent = result[1].content;

    expect(expandedContent).toContain("token=[已脱敏]");
    expect(expandedContent).toContain("req-unsafe");
    expect(expandedContent).toContain("requestHeaders[Authorization, Cookie]");
    expect(expandedContent).toContain("requestBody[password, name]");
    expect(expandedContent).toContain("responseBody[access_token, message]");
    expect(expandedContent).not.toContain("secret-token");
    expect(expandedContent).not.toContain("secret-cookie");
    expect(expandedContent).not.toContain("123456");
  });

  it("历史 Network 附件详情参与页面上下文预算计算", () => {
    const model = createModelConfig(createProvider(), { ...createModel(), maxTokens: 60 });
    const assistantMessage = {
      ...createMessage("message-1", "assistant", "已分析接口。", 1),
      assistantMessageKind: "tool_call_turn",
      networkContextAttachment: {
        id: "network-1",
        title: "Network 请求详情",
        summary: "已注入 1 个 Network 请求",
        createdAt: 2,
        redacted: false,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: `https://api.example.com/login?trace=${"x".repeat(160)}`,
            method: "POST",
            status: 500,
            responseBody: "接口响应".repeat(40),
            redacted: false,
            truncated: false,
          },
        ],
      },
    } satisfies ChatMessage;
    const userMessage = createMessage("message-2", "user", "继续分析", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "需要被裁剪的页面上下文".repeat(20),
      existingMessages: [assistantMessage],
      userMessage,
    });

    expect(result[0].contextPrompt).toBe("");
    expect(result[1].content).toContain("历史 Network 请求摘要");
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

describe("网络搜索上下文消息构造", () => {
  it("后续请求会携带历史 AI 消息中的网络搜索附件且不修改原消息", () => {
    const model = createModelConfig(createProvider(), createModel());
    const assistantMessage = {
      ...createMessage("message-search-assistant", "assistant", "根据搜索结果，Tavily 提供 Web 搜索能力。", 1),
      assistantMessageKind: "tool_call_turn",
      toolAttachments: [
        {
          id: "tool-attachment-search",
          kind: "web-search",
          title: "网络搜索结果",
          summary: "搜索问题：Tavily API",
          provider: "tavily",
          query: "Tavily API",
          answer: "Tavily 是搜索 API。",
          results: [
            {
              title: "Tavily Docs",
              url: "https://docs.tavily.com/search",
              content: "官方文档内容",
              score: 0.9,
              publishedDate: "2026-01-01",
            },
          ],
          createdAt: 2,
          redacted: false,
          truncated: false,
        },
      ],
    } satisfies ChatMessage;
    const userMessage = createMessage("message-search-user", "user", "继续分析", 2);

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [assistantMessage],
      userMessage,
    });

    expect(result[1].content).toContain("后续追问可参考以下历史网络搜索摘要：");
    expect(result[1].content).toContain("查询：Tavily API");
    expect(result[1].content).toContain("Tavily Docs");
    expect(result[1].content).toContain("https://docs.tavily.com/search");
    expect(assistantMessage.content).toBe("根据搜索结果，Tavily 提供 Web 搜索能力。");
  });
});
