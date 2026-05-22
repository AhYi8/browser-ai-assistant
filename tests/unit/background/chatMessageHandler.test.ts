import { describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
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
    ...overrides,
  };
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "页面内容",
    contextMode: "text",
  };
}

describe("聊天模型请求处理", () => {
  it("OpenAI-compatible 成功时返回解析后的正文和思考过程", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "<think>先分析</think>\n这是回答",
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "系统提示"), createMessage("user", "总结页面")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "这是回答",
      thinking: "先分析",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("模型接口失败时返回中文错误且不读取响应正文", async () => {
    const text = vi.fn().mockResolvedValue("bad key");
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text,
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型请求失败：401 Unauthorized",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("启用真实流式响应时返回不支持提示且不发起请求", async () => {
    const fetcher = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: true,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "当前版本暂不支持真实流式响应，请关闭流式响应后重试",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("Anthropic 文本 block 成功返回正文", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "回答" }],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.example.com/v1/messages",
        }),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "回答",
      thinking: undefined,
    });
  });

  it("Anthropic 混合非文本和畸形 block 时只拼接文本 block", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [
          { type: "tool_use", text: "不应拼接" },
          { type: "text", text: "第一段" },
          { type: "text" },
          null,
          { type: "text", text: "第二段" },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.example.com/v1/messages",
        }),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "第一段第二段",
      thinking: undefined,
    });
  });

  it("OpenAI content 非字符串时返回没有可用内容", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: { text: "错误结构" } } }],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
  });

  it("请求异常包含敏感信息时返回固定脱敏错误", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("https://api.example.com Authorization: Bearer sk-secret response bad key"));

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型请求失败，请稍后重试",
    });
  });
});
