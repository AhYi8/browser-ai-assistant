import { describe, expect, it, vi } from "vitest";
import { createAnthropicMessagesPayload } from "../../../src/shared/models/anthropicMessagesAdapter";
import { createListModelsRequest, createModelConfig, parseModelListResponse, testProviderModel } from "../../../src/shared/models/modelCatalog";
import { createModelRequestPayload } from "../../../src/shared/models/modelRequestPayload";
import { createOpenAIChatPayload } from "../../../src/shared/models/openaiChatAdapter";
import { validateModelConfig } from "../../../src/shared/models/modelValidation";
import type { ModelRequestMessage, ModelToolDefinition } from "../../../src/shared/models/types";
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

const toolDefinition: ModelToolDefinition = {
  name: "read_page_context",
  description: "读取当前页面上下文",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["text", "all"],
      },
    },
    required: ["mode"],
    additionalProperties: false,
  },
};

const toolMessages: ModelRequestMessage[] = [
  {
    id: "user-tool-1",
    role: "user",
    content: "读取页面",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
  },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call-1",
        name: "read_page_context",
        arguments: { mode: "text" },
      },
    ],
  },
  {
    role: "tool",
    toolCallId: "call-1",
    name: "read_page_context",
    content: "页面标题：示例",
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

  it("OpenAI-compatible 请求将用户图片附件转换为 image_url 内容块", () => {
    const payload = createOpenAIChatPayload(
      createModel(),
      [
        {
          ...messages[1],
          content: "识别图片",
          attachments: [
            {
              id: "image-1",
              name: "页面截图.png",
              mediaType: "image/png",
              dataUrl: "data:image/png;base64,QUJD",
            },
          ],
        },
      ],
      false,
    );

    expect(payload.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "识别图片" },
            { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
          ],
        },
      ],
    });
  });

  it("OpenAI-compatible 请求支持 JSON Schema 结构化输出", () => {
    const payload = createOpenAIChatPayload(createModel(), messages, false, {
      type: "json_schema",
      json_schema: {
        name: "network_relevance",
        strict: true,
        schema: {
          type: "object",
          properties: {
            requestIds: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["requestIds"],
          additionalProperties: false,
        },
      },
    });

    expect(payload.body).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: expect.objectContaining({
          name: "network_relevance",
          strict: true,
        }),
      },
    });
  });

  it("模型请求构造只向 OpenAI-compatible 分支透传结构化输出参数", () => {
    const structuredOutput = {
      type: "json_schema" as const,
      json_schema: {
        name: "network_relevance",
        strict: true,
        schema: {
          type: "object",
          properties: {
            requestIds: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["requestIds"],
          additionalProperties: false,
        },
      },
    };

    const openAiPayload = createModelRequestPayload(createModel(), messages, false, structuredOutput);
    expect(openAiPayload.body).toMatchObject({
      response_format: structuredOutput,
    });

    const anthropicPayload = createModelRequestPayload(
      createModel({
        endpointType: "anthropic_messages",
        endpointUrl: "https://api.anthropic.com/v1/messages",
      }),
      messages,
      false,
      structuredOutput,
    );
    expect(anthropicPayload.body).not.toHaveProperty("response_format");
  });

  it("OpenAI-compatible 请求支持通过工具调用约束结构化输出", () => {
    const payload = createOpenAIChatPayload(createModel(), messages, false, {
      type: "tool",
      tool: {
        name: "select_network_requests",
        description: "筛选相关请求",
        parameters: {
          type: "object",
          properties: {
            requestIds: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["requestIds"],
          additionalProperties: false,
        },
      },
    });

    expect(payload.body).toMatchObject({
      tools: [
        {
          type: "function",
          function: expect.objectContaining({
            name: "select_network_requests",
          }),
        },
      ],
      tool_choice: {
        type: "function",
        function: {
          name: "select_network_requests",
        },
      },
    });
    expect(payload.body).not.toHaveProperty("response_format");
  });

  it("OpenAI-compatible 请求支持通用工具定义和工具调用历史消息", () => {
    const payload = createOpenAIChatPayload(createModel(), toolMessages, false, undefined, {
      tools: [toolDefinition],
      toolChoice: "auto",
    });

    expect(payload.body).toMatchObject({
      tools: [
        {
          type: "function",
          function: toolDefinition,
        },
      ],
      tool_choice: "auto",
      messages: [
        { role: "user", content: "读取页面" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "read_page_context",
                arguments: '{"mode":"text"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          name: "read_page_context",
          content: "页面标题：示例",
        },
      ],
    });
  });

  it("OpenAI-compatible 渠道只保存基础端点时自动补全 Chat Completions 路径", () => {
    const payload = createOpenAIChatPayload(
      createModel({
        endpointUrl: "https://api.example.com",
      }),
      messages,
      true,
    );

    expect(payload.url).toBe("https://api.example.com/v1/chat/completions");
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

  it("Anthropic 请求将用户图片附件转换为 base64 image 内容块", () => {
    const payload = createAnthropicMessagesPayload(
      createModel({
        endpointType: "anthropic_messages",
        endpointUrl: "https://api.anthropic.com/v1/messages",
        modelId: "claude-test",
      }),
      [
        {
          ...messages[1],
          endpointType: "anthropic_messages",
          content: "识别图片",
          attachments: [
            {
              id: "image-1",
              name: "页面截图.png",
              mediaType: "image/png",
              dataUrl: "data:image/png;base64,QUJD",
            },
          ],
        },
      ],
      false,
    );

    expect(payload.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "识别图片" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "QUJD",
              },
            },
          ],
        },
      ],
    });
  });

  it("Anthropic 请求遇到非法图片 dataUrl 时抛出明确错误", () => {
    expect(() =>
      createAnthropicMessagesPayload(
        createModel({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.anthropic.com/v1/messages",
          modelId: "claude-test",
        }),
        [
          {
            ...messages[1],
            endpointType: "anthropic_messages",
            content: "识别图片",
            attachments: [
              {
                id: "image-invalid",
                name: "损坏.png",
                mediaType: "image/png",
                dataUrl: "not-a-data-url",
              },
            ],
          },
        ],
        false,
      ),
    ).toThrow("图片附件 dataUrl 格式无效");
  });

  it("Anthropic 渠道只保存基础端点时自动补全 Messages 路径", () => {
    const model = createModel({
      endpointType: "anthropic_messages",
      endpointUrl: "https://api.anthropic.com",
      modelId: "claude-test",
    });

    const payload = createAnthropicMessagesPayload(model, messages, false);

    expect(payload.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("Anthropic 请求支持通用工具定义和 tool_use/tool_result 历史消息", () => {
    const payload = createAnthropicMessagesPayload(
      createModel({
        endpointType: "anthropic_messages",
        endpointUrl: "https://api.anthropic.com/v1/messages",
        modelId: "claude-test",
      }),
      toolMessages,
      false,
      {
        tools: [toolDefinition],
        toolChoice: "auto",
      },
    );

    expect(payload.body).toMatchObject({
      tools: [
        {
          name: "read_page_context",
          description: "读取当前页面上下文",
          input_schema: toolDefinition.parameters,
        },
      ],
      tool_choice: { type: "auto" },
      messages: [
        { role: "user", content: "读取页面" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "read_page_context",
              input: { mode: "text" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              content: "页面标题：示例",
            },
          ],
        },
      ],
    });
  });

  it("创建聊天模型配置时允许用聊天偏好覆盖采样参数", () => {
    const model = createModelConfig(createProvider(), createProviderModel(), {
      systemPrompt: "全局系统提示",
      temperature: 0.4,
      maxTokens: 2048,
      topK: 20,
    });

    expect(model).toMatchObject({
      systemPrompt: "全局系统提示",
      temperature: 0.4,
      maxTokens: 2048,
      topK: 20,
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
    expect(createListModelsRequest(createProvider({ endpointUrl: "https://api.example.com" }))).toEqual({
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
