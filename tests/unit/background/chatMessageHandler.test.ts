import { describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
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
      .mockResolvedValueOnce(new Response("busy", { status: 500, statusText: "Server Error" }))
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
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(secondBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
        expect.objectContaining({ role: "tool", content: "页面结构快照" }),
      ]),
    );
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
    expect(fetcher).toHaveBeenCalledTimes(2);
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
