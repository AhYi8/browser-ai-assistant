import { describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import { MODEL_OUTPUT_TRUNCATED_MESSAGE } from "../../../src/background/modelResponseStopReason";
import type { ModelToolRegistryEntry } from "../../../src/shared/models/types";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

const registeredModelToolsMock = vi.hoisted(() => ({
  tools: [] as ModelToolRegistryEntry[],
}));

const browserControlManagerMock = vi.hoisted(() => ({
  canExposeTakeSnapshotTool: vi.fn(),
  canExposeBrowserTool: vi.fn(),
  takeSnapshot: vi.fn(),
  executeBrowserTool: vi.fn(),
}));

vi.mock("../../../src/shared/models/toolRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared/models/toolRegistry")>();
  return {
    ...actual,
    getRegisteredModelTools: () => registeredModelToolsMock.tools,
  };
});

vi.mock("../../../src/background/browserControlMessageHandler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/background/browserControlMessageHandler")>();
  return {
    ...actual,
    browserControlManager: browserControlManagerMock,
  };
});

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
  beforeEach(() => {
    registeredModelToolsMock.tools = [];
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReset();
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReturnValue(true);
    browserControlManagerMock.canExposeBrowserTool.mockReset();
    browserControlManagerMock.canExposeBrowserTool.mockReturnValue(true);
    browserControlManagerMock.takeSnapshot.mockReset();
    browserControlManagerMock.executeBrowserTool.mockReset();
  });

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

  it("模型请求遇到可恢复失败时会按请求配置重试", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "重试成功",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "总结页面")],
        stream: false,
        retryCount: 5,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "重试成功",
      thinking: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("模型请求遇到可恢复失败时会回调重试进度", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 500, statusText: "Server Error" }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "重试成功" } }],
          }),
          { status: 200 },
        ),
      );
    const onRetryProgress = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "总结页面")],
        stream: false,
        retryCount: 5,
      },
      fetcher,
      { onRetryProgress },
    );

    expect(result).toMatchObject({ ok: true, content: "重试成功" });
    expect(onRetryProgress).toHaveBeenCalledWith({ currentRetry: 1, maxRetries: 5 });
  });

  it("非流式响应正文解析失败时会重新发起模型请求", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "解析重试成功",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "总结页面")],
        stream: false,
        retryCount: 1,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "解析重试成功",
      thinking: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("普通 OpenAI-compatible 非流式响应只把 reasoning_content 作为思考展示，不保存协议原文", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              reasoning_content: "先分析页面结构",
              content: "这是回答",
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "总结页面")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "这是回答",
      thinking: "先分析页面结构",
    });
  });

  it("DeepSeek reasoning 非流式响应会保留 reasoning_content 原文", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              reasoning_content: "先分析页面结构",
              content: "这是回答",
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          modelId: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          endpointUrl: "https://api.deepseek.com/v1/chat/completions",
        }),
        messages: [createMessage("user", "总结页面")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "这是回答",
      thinking: "先分析页面结构",
      reasoningContent: "先分析页面结构",
    });
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

  it("流式响应缺少响应体时返回中文错误", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: true,
        retryCount: 0,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("非流式响应达到 max_tokens 上限时返回截断错误且不重试", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ finish_reason: "length", message: { content: "半截回答" } }],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: false,
        retryCount: 5,
      },
      fetcher,
    );

    expect(result).toEqual({ ok: false, message: MODEL_OUTPUT_TRUNCATED_MESSAGE });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("OpenAI-compatible 流式响应会逐段回调并在完成时解析思考过程", async () => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"<think>先"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"分析</think>答"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"案"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }),
    });
    const onContentChunk = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: true,
      },
      fetcher,
      { onContentChunk },
    );

    expect(result).toEqual({
      ok: true,
      content: "答案",
      thinking: "先分析",
    });
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "<think>先");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "分析</think>答");
    expect(onContentChunk).toHaveBeenNthCalledWith(3, "案");
  });

  it("OpenAI-compatible 流式响应会逐段回调 reasoning_content 并在 content 前返回思考过程", async () => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"先分析"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"页面"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"正式"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }),
    });
    const onContentChunk = vi.fn();
    const onThinkingChunk = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: true,
      },
      fetcher,
      { onContentChunk, onThinkingChunk },
    );

    expect(result).toEqual({
      ok: true,
      content: "正式回答",
      thinking: "先分析页面",
    });
    expect(onThinkingChunk).toHaveBeenNthCalledWith(1, "先分析");
    expect(onThinkingChunk).toHaveBeenNthCalledWith(2, "页面");
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "正式");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "回答");
  });

  it("DeepSeek reasoning 流式响应会保存 reasoning_content 协议原文", async () => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"先分析"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          modelId: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          endpointUrl: "https://api.deepseek.com/v1/chat/completions",
        }),
        messages: [createMessage("user", "你好")],
        stream: true,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "回答",
      thinking: "先分析",
      reasoningContent: "先分析",
    });
  });

  it("Anthropic 流式响应只拼接 text_delta 文本片段", async () => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [
      encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第一段"}}\n\n'),
      encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第二段"}}\n\n'),
      encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }),
    });
    const onContentChunk = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.example.com/v1/messages",
        }),
        messages: [createMessage("user", "你好")],
        stream: true,
      },
      fetcher,
      { onContentChunk },
    );

    expect(result).toEqual({
      ok: true,
      content: "第一段第二段",
      thinking: undefined,
    });
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "第一段");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "第二段");
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
        retryCount: 0,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
  });

  it("非流式空模型响应会按重试次数重新请求", async () => {
    vi.useFakeTimers();
    const onRetryProgress = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "重试后回答" } }],
        }),
      });

    try {
      const pending = handleChatSendMessage(
        {
          type: "chat.send",
          model: createModel(),
          messages: [createMessage("user", "你好")],
          stream: false,
          retryCount: 1,
        },
        fetcher,
        { onRetryProgress },
      );
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ ok: true, content: "重试后回答" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onRetryProgress).toHaveBeenCalledWith({ currentRetry: 1, maxRetries: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("流式空模型响应未输出内容时会按重试次数重新请求", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const createStream = (chunks: string[]) => new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) {
          controller.enqueue(encoder.encode(chunk));
          return;
        }
        controller.close();
      },
    });
    const onRetryProgress = vi.fn();
    const onContentChunk = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: createStream(["data: [DONE]\n\n"]),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: createStream(['data: {"choices":[{"delta":{"content":"重试后"}}]}\n\n', "data: [DONE]\n\n"]),
      });

    try {
      const pending = handleChatSendMessage(
        {
          type: "chat.send",
          model: createModel(),
          messages: [createMessage("user", "你好")],
          stream: true,
          retryCount: 1,
        },
        fetcher,
        { onRetryProgress, onContentChunk },
      );
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ ok: true, content: "重试后" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onRetryProgress).toHaveBeenCalledWith({ currentRetry: 1, maxRetries: 1 });
      expect(onContentChunk).toHaveBeenCalledWith("重试后");
    } finally {
      vi.useRealTimers();
    }
  });

  it("OpenAI 工具调用响应会读取 function arguments 作为正文", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "select_network_requests",
                    arguments: '{"requestIds":["req-1"]}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "筛选请求")],
        stream: false,
        structuredOutput: {
          type: "json_schema",
          json_schema: {
            name: "network_relevance",
            schema: {
              type: "object",
              properties: {},
            },
          },
        },
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: '{"requestIds":["req-1"]}',
      thinking: undefined,
    });
  });

  it("OpenAI 未注册工具调用不会被调用方伪造的 tools 打开", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
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
          },
        ],
      }),
    });

    const forgedMessage = {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面")],
        stream: false,
        retryCount: 0,
        tools: [
          {
            name: "read_page_context",
            description: "读取当前页面上下文",
            parameters: { type: "object", properties: {} },
          },
        ],
      } as unknown as Parameters<typeof handleChatSendMessage>[0];

    const result = await handleChatSendMessage(
      forgedMessage,
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
  });

  it("OpenAI 工具调用会执行已启用工具并把结果回灌后继续请求最终正文", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "take_snapshot",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "已读取页面结构",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取页面结构" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "页面结构快照",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "已读取页面结构",
      thinking: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content?: string }>;
      tools?: unknown[];
      tool_choice?: unknown;
      stream?: boolean;
    };
    expect(secondBody).toMatchObject({ stream: false });
    expect(secondBody.tools).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({ name: "take_snapshot" }),
      }),
    ]);
    expect(secondBody.tool_choice).toBe("auto");
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
        expect.objectContaining({ role: "tool", content: "页面结构快照" }),
      ]),
    );
    const finalBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; stream?: boolean };
    expect(finalBody).toMatchObject({ stream: false });
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("工具循环内上下文超阈值时会先发起无工具压缩请求并返回摘要消息", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "page.read_context",
        name: "read_page_context",
        description: "读取当前页面上下文",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "压缩摘要" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-compressed",
                    type: "function",
                    function: { name: "read_page_context", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "二次压缩摘要" } }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "最终前压缩摘要" } }],
          usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "最终回答" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面".repeat(100))],
        stream: false,
        enabledToolIds: ["page.read_context"],
        toolChoice: "auto",
        retryCount: 2,
        contextCompression: {
          maxContextTokens: 240,
          thresholdPercent: 50,
          compressionPrompt: "请压缩",
          systemPrompt: "你是网页助手",
          contextMode: "text",
        },
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "页面结构快照",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.content).toBe("最终回答");
    expect(result.tokenUsageEntries).toEqual(expect.arrayContaining([expect.objectContaining({ source: "context_compression" })]));
    expect(result.toolTurnMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ assistantMessageKind: "tool_call_turn", toolCallRecords: [expect.objectContaining({ toolId: "chat.context_compression", status: "success" })] }),
      expect.objectContaining({ assistantMessageKind: "context_summary", content: "压缩摘要" }),
      expect.objectContaining({ assistantMessageKind: "tool_call_turn", toolCallRecords: [expect.objectContaining({ id: "call-compressed" })] }),
      expect.objectContaining({ assistantMessageKind: "context_summary", content: "二次压缩摘要" }),
      expect.objectContaining({ assistantMessageKind: "context_summary", content: "最终前压缩摘要" }),
    ]));
    const compressionBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; messages: Array<{ content?: string }> };
    expect(compressionBody.tools).toBeUndefined();
    expect(compressionBody.tool_choice).toBeUndefined();
    expect(compressionBody.messages.at(-1)?.content).toContain("读取页面");
    const decisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { tools?: unknown[]; messages: Array<{ role: string; content?: string }> };
    expect(decisionBody.tools).toEqual([expect.objectContaining({ type: "function" })]);
    expect(decisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("读取页面") }),
        expect.objectContaining({ role: "assistant", content: "压缩摘要" }),
        expect.objectContaining({ role: "user", content: "请基于以上压缩上下文继续当前任务。" }),
      ]),
    );
    const secondCompressionBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; messages: Array<{ content?: string }> };
    expect(secondCompressionBody.tools).toBeUndefined();
    expect(secondCompressionBody.tool_choice).toBeUndefined();
    expect(secondCompressionBody.messages.at(-1)?.content).toContain("页面结构快照");
    const finalCompressionBody = JSON.parse(String(fetcher.mock.calls[4][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; messages: Array<{ content?: string }> };
    expect(finalCompressionBody.tools).toBeUndefined();
    expect(finalCompressionBody.tool_choice).toBeUndefined();
    expect(finalCompressionBody.messages.at(-1)?.content).toContain("工具调用阶段已经结束");
  });

  it("携带任务策略设置时会先预选 Playbook 且不改变工具暴露边界", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取页面结构",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "{\"playbookId\":\"page_reading\",\"confidence\":\"high\",\"reason\":\"用户要求阅读当前页面\"}" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "take_snapshot", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "阶段收束" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已总结当前页面" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "帮我看看当前页面讲了什么")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
        automationPlaybookSettings: { disabledPlaybookIds: [] },
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "页面上下文",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "已总结当前页面",
      toolAttachments: [
        expect.objectContaining({
          kind: "automation-report",
          playbook: expect.objectContaining({
            playbookId: "page_reading",
            title: "页面阅读",
          }),
        }),
      ],
    });
    const selectionBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; messages: Array<{ content?: string }> };
    expect(selectionBody.tools).toBeUndefined();
    expect(JSON.stringify(selectionBody.messages)).toContain("候选 Playbook");
    const decisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { tools?: unknown[]; messages: Array<{ role: string; content?: string }> };
    expect(decisionBody.tools).toHaveLength(1);
    expect(JSON.stringify(decisionBody.messages)).toContain("当前选中的浏览器自动化任务策略：页面阅读");
    expect(JSON.stringify(decisionBody.messages)).not.toContain("候选 Playbook");
    const finalBody = JSON.parse(String(fetcher.mock.calls[3][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("未携带任务策略设置时不会额外执行 Playbook 预选", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "普通回复" } }] }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "帮我看看当前页面讲了什么")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(JSON.stringify(body)).not.toContain("候选 Playbook");
    }
  });

  it("OpenAI-compatible 正文中的 DSML 工具调用会转成工具调用并移除协议文本", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.navigate_page",
        name: "navigate_page",
        description: "导航页面",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string" },
            url: { type: "string" },
            includeSnapshot: { type: "boolean" },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  "现在让我也看一下单个帖子详情接口：",
                  "< | | DSML | | tool_calls>",
                  '< | | DSML | | invoke name="navigate_page">',
                  '< | | DSML | | parameter name="action" string="true">goto</ | | DSML | | parameter>',
                  '< | | DSML | | parameter name="url" string="true">https://linux.do/t/2385713.json</ | | DSML | | parameter>',
                  '< | | DSML | | parameter name="includeSnapshot" string="false">false</ | | DSML | | parameter>',
                  "</ | | DSML | | invoke>",
                  "</ | | DSML | | tool_calls>",
                ].join("\n"),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "页面已经重新读取。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "页面已经重新读取。" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "重新获取页面状态")],
        stream: false,
        enabledToolIds: ["browser.navigate_page"],
        toolChoice: "auto",
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "已导航到帖子详情",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "页面已经重新读取。",
      thinking: undefined,
    });
    expect(result.ok && result.toolTurnMessages?.[0].content).toBe("现在让我也看一下单个帖子详情接口：");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "现在让我也看一下单个帖子详情接口：",
          tool_calls: [
            expect.objectContaining({
              id: "dsml-tool-call-1",
              type: "function",
              function: expect.objectContaining({
                name: "navigate_page",
                arguments: "{\"action\":\"goto\",\"url\":\"https://linux.do/t/2385713.json\",\"includeSnapshot\":false}",
              }),
            }),
          ],
        }),
        expect.objectContaining({ role: "tool", content: "已导航到帖子详情" }),
      ]),
    );
    expect(JSON.stringify(secondBody.messages)).not.toContain("DSML");
    expect(JSON.stringify(secondBody.messages)).not.toContain("invoke name");
  });

  it("最终回答阶段即使模型再次输出 DSML 工具块也不会泄漏协议文本", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-snapshot",
                    type: "function",
                    function: { name: "take_snapshot", arguments: "{}" },
                  },
                ],
                content: "",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已拿到页面结构。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  "分析已经非常清晰了。让我再确认 serializeObject：",
                  "< | | DSML | | tool_calls>",
                  '< | | DSML | | invoke name="evaluate_script">',
                  '< | | DSML | | parameter name="function" string="true">() => $.fn.serializeObject</ | | DSML | | parameter>',
                  "</ | | DSML | | invoke>",
                  "</ | | DSML | | tool_calls>",
                ].join("\n"),
              },
            },
          ],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "继续分析")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "页面结构快照",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "分析已经非常清晰了。让我再确认 serializeObject：",
    });
    expect(result.ok && result.content).not.toContain("DSML");
    expect(result.ok && result.content).not.toContain("invoke name");
    expect(result.ok && result).not.toHaveProperty("toolCalls");
    const finalBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("OpenAI-compatible DSML 工具调用参数非法时沿用工具错误回灌", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  "<|tool_calls|>",
                  "<|invoke name=\"take_snapshot\"|>",
                  "不是 JSON",
                  "</|invoke|>",
                  "</|tool_calls|>",
                ].join("\n"),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已说明参数错误。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已说明参数错误。" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "重新获取页面状态")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "已说明参数错误。" });
    expect(browserControlManagerMock.takeSnapshot).not.toHaveBeenCalled();
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "工具 take_snapshot 参数无效：工具参数不是合法 JSON",
        }),
      ]),
    );
  });

  it("OpenAI-compatible 疑似 DSML 工具调用残片会作为错误工具结果回灌给模型继续决策", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: [
                  "我需要重新读取页面。",
                  "<｜tool_calls｜>",
                  "<｜invoke name=\"take_snapshot\"｜>",
                ].join("\n"),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具调用格式错误，我会改用当前可见信息总结。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具调用格式错误，我会改用当前可见信息总结。" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "重新获取页面状态")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "工具调用格式错误，我会改用当前可见信息总结。" });
    expect(browserControlManagerMock.takeSnapshot).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string; tool_calls?: unknown[] }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "我需要重新读取页面。",
          tool_calls: [
            expect.objectContaining({
              id: "dsml-tool-call-1",
              type: "function",
              function: expect.objectContaining({
                name: "take_snapshot",
                arguments: "{}",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          role: "tool",
          content: "工具 take_snapshot 参数无效：工具调用格式不完整",
          tool_call_id: "dsml-tool-call-1",
        }),
      ]),
    );
    expect(JSON.stringify(secondBody.messages)).not.toContain("<｜tool_calls｜>");
  });

  it("默认 background 执行器会把浏览器快照工具转发给浏览器控制管理器", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    ];
    browserControlManagerMock.takeSnapshot.mockResolvedValue({
      toolCallId: "call-1",
      name: "take_snapshot",
      content: "页面结构快照",
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "take_snapshot",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取页面结构" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取页面结构" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面结构")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "已读取页面结构" });
    expect(browserControlManagerMock.takeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "call-1", name: "take_snapshot", arguments: {} }),
    );
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", content: "页面结构快照" }),
      ]),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const finalBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { stream?: boolean; tools?: unknown[]; tool_choice?: unknown };
    expect(finalBody).toMatchObject({ stream: false });
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("默认 background 执行器会把阶段三浏览器操作工具转发给浏览器控制管理器", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.click",
        name: "click",
        description: "点击当前页面元素",
        parameters: {
          type: "object",
          properties: { uid: { type: "string" }, includeSnapshot: { type: "boolean" } },
          required: ["uid"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.executeBrowserTool.mockResolvedValue({
      toolCallId: "call-1",
      name: "click",
      content: "已点击元素 1_2。",
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "click",
                      arguments: "{\"uid\":\"1_2\",\"includeSnapshot\":true}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "按钮已点击" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "按钮已点击" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "点击提交按钮")],
        stream: false,
        enabledToolIds: ["browser.click"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "按钮已点击" });
    expect(browserControlManagerMock.executeBrowserTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "call-1", name: "click", arguments: { uid: "1_2", includeSnapshot: true } }),
    );
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", content: "已点击元素 1_2。" }),
      ]),
    );
  });

  it("流式浏览器自动化允许超过普通工具默认轮次后再用流式最终请求生成回复", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.click",
        name: "click",
        description: "点击当前页面元素",
        parameters: {
          type: "object",
          properties: { uid: { type: "string" }, includeSnapshot: { type: "boolean" } },
          required: ["uid"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.executeBrowserTool.mockImplementation(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `已点击元素 ${call.arguments.uid}。`,
    }));
    const toolResponses = Array.from({ length: 9 }, (_, index) => ({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: `call-${index + 1}`,
                  type: "function",
                  function: {
                    name: "click",
                    arguments: JSON.stringify({ uid: `1_${index + 1}` }),
                  },
                },
              ],
            },
          },
        ],
      }),
    }));
    const encoder = new TextEncoder();
    const finalStreamChunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"最终"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"回复"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const responseQueue = [
      ...toolResponses,
      {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策阶段最终回复" } }],
        }),
      },
      {
        ok: true,
        body: new ReadableStream({
          pull(controller) {
            const chunk = finalStreamChunks.shift();
            if (chunk) {
              controller.enqueue(chunk);
              return;
            }

            controller.close();
          },
        }),
      },
    ];
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(responseQueue.shift()));

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "连续操作页面")],
        stream: true,
        enabledToolIds: ["browser.click"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "最终回复" });
    expect(browserControlManagerMock.executeBrowserTool).toHaveBeenCalledTimes(9);
    expect(fetcher).toHaveBeenCalledTimes(11);
    for (const [, init] of fetcher.mock.calls.slice(0, -1)) {
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[]; stream?: boolean; tool_choice?: string };
      expect(body).toMatchObject({ stream: false, tool_choice: "auto" });
      expect(body.tools).toEqual([
        expect.objectContaining({
          type: "function",
          function: expect.objectContaining({ name: "click" }),
        }),
      ]);
    }
    const finalBody = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)) as { tools?: unknown[]; stream?: boolean; tool_choice?: string };
    expect(finalBody).toMatchObject({ stream: true });
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("最大工具决策轮次使用聊天请求中的偏好值", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.click",
        name: "click",
        description: "点击当前页面元素",
        parameters: {
          type: "object",
          properties: { uid: { type: "string" } },
          required: ["uid"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.executeBrowserTool.mockImplementation(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `已点击元素 ${call.arguments.uid}。`,
    }));
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-loop",
                  type: "function",
                  function: {
                    name: "click",
                    arguments: '{"uid":"1_1"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });
    const request = {
      type: "chat.send",
      model: createModel(),
      messages: [createMessage("user", "连续操作页面")],
      stream: false,
      enabledToolIds: ["browser.click"],
      toolChoice: "auto",
      browserAutomationMaxToolIterations: 2,
    } as unknown as Parameters<typeof handleChatSendMessage>[0];

    const result = await handleChatSendMessage(request, fetcher);

    expect(result).toEqual({ ok: false, message: "工具调用超过最大轮次，已停止本次请求。" });
    expect(browserControlManagerMock.executeBrowserTool).toHaveBeenCalledTimes(2);
  });

  it("最大工具决策轮次默认使用 32 轮保护", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.click",
        name: "click",
        description: "点击当前页面元素",
        parameters: {
          type: "object",
          properties: { uid: { type: "string" } },
          required: ["uid"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.executeBrowserTool.mockImplementation(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `已点击元素 ${call.arguments.uid}。`,
    }));
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-loop",
                  type: "function",
                  function: {
                    name: "click",
                    arguments: '{"uid":"1_1"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "连续操作页面")],
        stream: false,
        enabledToolIds: ["browser.click"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toEqual({ ok: false, message: "工具调用超过最大轮次，已停止本次请求。" });
    expect(browserControlManagerMock.executeBrowserTool).toHaveBeenCalledTimes(32);
    expect(fetcher).toHaveBeenCalledTimes(32);
  });

  it("非浏览器工具也会使用配置的最大工具决策轮次", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "page.read_context",
        name: "read_page_context",
        description: "读取页面上下文",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const executeTool = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面上下文",
    }));
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-loop",
                  type: "function",
                  function: {
                    name: "read_page_context",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "连续读取页面")],
        stream: false,
        enabledToolIds: ["page.read_context"],
        toolChoice: "auto",
        browserAutomationMaxToolIterations: 12,
      },
      fetcher,
      {},
      executeTool,
    );

    expect(result).toEqual({ ok: false, message: "工具调用超过最大轮次，已停止本次请求。" });
    expect(executeTool).toHaveBeenCalledTimes(12);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it("默认 background 执行器会把阶段四浏览器导航工具转发给浏览器控制管理器", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.navigate_page",
        name: "navigate_page",
        description: "导航当前受控页面",
        parameters: {
          type: "object",
          properties: { action: { type: "string" }, url: { type: "string" }, includeSnapshot: { type: "boolean" } },
          required: ["action"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.executeBrowserTool.mockResolvedValue({
      toolCallId: "call-1",
      name: "navigate_page",
      content: "已导航到 https://example.com/docs。",
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "navigate_page",
                      arguments: "{\"action\":\"goto\",\"url\":\"https://example.com/docs\"}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "页面已打开" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "页面已打开" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "打开文档页面")],
        stream: false,
        enabledToolIds: ["browser.navigate_page"],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({ ok: true, content: "页面已打开" });
    expect(browserControlManagerMock.executeBrowserTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "call-1", name: "navigate_page", arguments: { action: "goto", url: "https://example.com/docs" } }),
    );
  });

  it("暴露浏览器快照工具时追加浏览器控制系统提示", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "普通回答" } }],
      }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "你是网页助手"), createMessage("user", "读取页面结构")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(body.messages.some((message) => message.role === "system" && message.content?.includes("不要猜测 UID"))).toBe(true);
    expect(body.messages.some((message) => message.role === "system" && message.content?.includes("take_snapshot"))).toBe(true);
  });

  it("暴露阶段四浏览器工具时系统提示包含导航后 UID 失效和弹窗等待规则", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.navigate_page",
        name: "navigate_page",
        description: "导航当前受控页面",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["goto", "back", "forward", "reload"] },
            url: { type: "string" },
            includeSnapshot: { type: "boolean" },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "普通回答" } }],
      }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "你是网页助手"), createMessage("user", "打开页面")],
        stream: false,
        enabledToolIds: ["browser.navigate_page"],
        toolChoice: "auto",
      },
      fetcher,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    const systemPrompt = body.messages.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("导航、切换或新建页面后旧 UID 会失效");
    expect(systemPrompt).toContain("遇到网页 JS 弹窗时会等待用户手动处理");
  });

  it("background 未连接浏览器控制时即使 runtime 传入快照工具也不向模型暴露", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    ];
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReturnValue(false);
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "普通回答" } }],
      }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "你是网页助手"), createMessage("user", "读取页面结构")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; messages: Array<{ role: string; content?: string }> };
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages.some((message) => message.content?.includes("不要猜测 UID"))).toBe(false);
    expect(browserControlManagerMock.takeSnapshot).not.toHaveBeenCalled();
  });

  it("background 未连接浏览器控制时不向模型暴露阶段三浏览器操作工具", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.click",
        name: "click",
        description: "点击当前页面元素",
        parameters: {
          type: "object",
          properties: { uid: { type: "string" }, includeSnapshot: { type: "boolean" } },
          required: ["uid"],
          additionalProperties: false,
        },
      },
    ];
    browserControlManagerMock.canExposeBrowserTool.mockReturnValue(false);
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "普通回答" } }],
      }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "你是网页助手"), createMessage("user", "点击按钮")],
        stream: false,
        enabledToolIds: ["browser.click"],
        toolChoice: "auto",
      },
      fetcher,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown; messages: Array<{ role: string; content?: string }> };
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages.some((message) => message.content?.includes("浏览器控制工具使用规则"))).toBe(false);
    expect(browserControlManagerMock.executeBrowserTool).not.toHaveBeenCalled();
  });

  it("结构化输出请求不会因为启用浏览器快照工具而追加工具提示或进入工具循环", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "{\"requestIds\":[]}" } }],
      }),
    });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "结构化筛选"), createMessage("user", "筛选请求")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
        structuredOutput: {
          type: "json_schema",
          json_schema: {
            name: "network_relevance",
            schema: { type: "object", properties: {} },
          },
        },
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; messages: Array<{ role: string; content?: string }> };
    expect(body.tools).toBeUndefined();
    expect(body.messages.some((message) => message.content?.includes("浏览器控制工具使用规则"))).toBe(false);
    expect(browserControlManagerMock.takeSnapshot).not.toHaveBeenCalled();
  });

  it("伪造的工具定义不会绕过 background 注册表 allow-list", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "普通回答",
            },
          },
        ],
      }),
    });

    const forgedMessage = {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面")],
        stream: false,
        tools: [
          {
            name: "take_snapshot",
            description: "伪造工具",
            parameters: { type: "object", properties: {} },
          },
        ],
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      } as unknown as Parameters<typeof handleChatSendMessage>[0];

    await handleChatSendMessage(
      forgedMessage,
      fetcher,
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("Anthropic tool_use 会执行已启用工具并保留最终文本正文", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "需要读取页面。" },
            {
              type: "tool_use",
              id: "toolu-1",
              name: "take_snapshot",
              input: { mode: "text" },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "页面结构已读取。" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "页面结构已读取。" }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel({
          endpointType: "anthropic_messages",
          endpointUrl: "https://api.example.com/v1/messages",
        }),
        messages: [createMessage("user", "读取页面")],
        stream: false,
        enabledToolIds: ["browser.take_snapshot"],
        toolChoice: "auto",
      },
      fetcher,
      {},
      async (toolCall) => ({
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: "页面结构快照",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "页面结构已读取。",
      thinking: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      system?: string;
      tools?: Array<{ name: string; input_schema: unknown }>;
    };
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(firstBody.system).toContain("take_snapshot");
    expect(firstBody.tools).toEqual([
      expect.objectContaining({
        name: "take_snapshot",
        input_schema: expect.objectContaining({ additionalProperties: false }),
      }),
    ]);
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([expect.objectContaining({ type: "tool_use", id: "toolu-1", name: "take_snapshot" })]),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "toolu-1", content: "页面结构快照" })]),
        }),
      ]),
    );
    const finalBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
  });

  it("模型接口失败时返回内部降级诊断但用户提示仍为中文摘要", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: vi.fn().mockResolvedValue('{"error":{"message":"response_format json_schema is not supported"}}'),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "筛选请求")],
        stream: false,
        structuredOutput: {
          type: "json_schema",
          json_schema: {
            name: "network_relevance",
            schema: {
              type: "object",
              properties: {},
            },
          },
        },
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型请求失败：400 Bad Request",
      status: 400,
      errorBody: '{"error":{"message":"response_format json_schema is not supported"}}',
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
        retryCount: 0,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型请求失败，请稍后重试",
    });
  });
});
