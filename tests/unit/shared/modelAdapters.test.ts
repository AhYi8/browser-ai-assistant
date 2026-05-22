import { describe, expect, it, vi } from "vitest";
import { createAnthropicMessagesPayload } from "../../../src/shared/models/anthropicMessagesAdapter";
import { createListModelsRequest, parseModelListResponse, testProviderModel } from "../../../src/shared/models/modelCatalog";
import { createOpenAIChatPayload } from "../../../src/shared/models/openaiChatAdapter";
import { validateModelConfig } from "../../../src/shared/models/modelValidation";
import type { ChatMessage, ModelConfig, ModelProvider, ProviderModel } from "../../../src/shared/types";

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "测试模型",
    displayName: "测试模型",
    channelName: "测试渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.2,
    maxTokens: 256,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    name: "测试渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProviderModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "测试模型",
    modelId: "gpt-test",
    temperature: 0.2,
    maxTokens: 256,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const messages: ChatMessage[] = [
  {
    id: "message-1",
    role: "system",
    content: "网页上下文",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "网页上下文",
    contextMode: "text",
  },
  {
    id: "message-2",
    role: "user",
    content: "总结页面",
    createdAt: 2,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "网页上下文",
    contextMode: "text",
  },
];

describe("模型适配器", () => {
  it("构造 OpenAI-compatible Chat Completions 请求", () => {
    const payload = createOpenAIChatPayload(createModel(), messages, true);

    expect(payload).toEqual({
      url: "https://api.example.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: {
        model: "gpt-test",
        messages: [
          { role: "system", content: "网页上下文" },
          { role: "user", content: "总结页面" },
        ],
        temperature: 0.2,
        max_tokens: 256,
        stream: true,
      },
    });
  });

  it("构造 Anthropic Messages 请求并将 system 放到顶层", () => {
    const model = createModel({
      endpointType: "anthropic_messages",
      endpointUrl: "https://api.anthropic.com/v1/messages",
      modelId: "claude-test",
    });

    const payload = createAnthropicMessagesPayload(model, messages, false);

    expect(payload).toEqual({
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "sk-test",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "claude-test",
        system: "网页上下文",
        messages: [{ role: "user", content: "总结页面" }],
        temperature: 0.2,
        max_tokens: 256,
        stream: false,
      },
    });
  });

  it("API Key 校验失败时返回结构化错误", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const result = await validateModelConfig(createModel(), fetcher);

    expect(result).toEqual({
      ok: false,
      message: "API Key 校验失败：401 Unauthorized",
    });
  });

  it("构造 OpenAI-compatible 模型列表请求", () => {
    expect(createListModelsRequest(createProvider())).toEqual({
      url: "https://api.example.com/v1/models",
      headers: {
        Authorization: "Bearer sk-test",
      },
    });
  });

  it("构造 Anthropic 模型列表请求", () => {
    expect(
      createListModelsRequest(
        createProvider({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.anthropic.com/v1/messages",
        }),
      ),
    ).toEqual({
      url: "https://api.anthropic.com/v1/models",
      headers: {
        "x-api-key": "sk-test",
        "anthropic-version": "2023-06-01",
      },
    });
  });

  it("解析模型列表响应并过滤无效项", () => {
    expect(
      parseModelListResponse({
        data: [{ id: "gpt-4.1" }, { id: "" }, { id: "gpt-4.1-mini", display_name: "GPT-4.1 mini" }],
      }),
    ).toEqual([
      { id: "gpt-4.1", displayName: "gpt-4.1" },
      { id: "gpt-4.1-mini", displayName: "GPT-4.1 mini" },
    ]);
  });

  it("测试渠道模型成功时返回结构化结果", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });

    const result = await testProviderModel(createProvider(), createProviderModel(), fetcher);

    expect(result).toEqual({ ok: true, message: "模型测试通过" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
