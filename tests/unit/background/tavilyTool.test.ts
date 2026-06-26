import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import { TAVILY_SEARCH_TOOL_ID } from "../../../src/shared/models/toolRegistry";
import { clearDatabase, saveAppSetting } from "../../../src/shared/storage/repositories";
import type { ChatMessage, ModelConfig, WebSearchSettings } from "../../../src/shared/types";

const settings: WebSearchSettings = {
  provider: "tavily",
  tavily: {
    apiKeysText: "tvly-1",
    apiKeyStrategy: "round_robin",
    includeAnswer: "basic",
    includeRawContent: false,
    maxResults: 5,
  },
  updatedAt: 1,
};

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

function createMessage(content: string): ChatMessage {
  return {
    id: "user-1",
    role: "user",
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
  };
}

describe("Tavily 工具调用", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearDatabase();
  });

  it("模型调用 Tavily 工具时执行搜索并把附件随最终响应返回", async () => {
    await saveAppSetting({ key: "webSearchSettings", value: settings, updatedAt: 1 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "我需要先搜索 Tavily API 的资料",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "tavily_search",
                      arguments: '{"query":"Tavily API"}',
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
          answer: "Tavily 是搜索 API。",
          results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已结合搜索结果回答。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已结合搜索结果回答。" } }],
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
        messages: [createMessage("Tavily API 是什么")],
        stream: false,
        enabledToolIds: [TAVILY_SEARCH_TOOL_ID],
        toolChoice: "auto",
        tavily: {
          includeAnswer: "advanced",
          includeRawContent: "markdown",
          maxResults: 12,
        },
      },
      fetcher,
    );

    expect(result).toMatchObject({
      ok: true,
      content: "已结合搜索结果回答。",
      toolTurnMessages: [
        expect.objectContaining({
          toolAttachments: [
            expect.objectContaining({
              kind: "web-search",
              provider: "tavily",
              query: "Tavily API",
              answer: "Tavily 是搜索 API。",
            }),
          ],
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Tavily 工具调用应返回成功结果");
    }
    expect(result.toolTurnMessages).toHaveLength(1);
    expect(result.toolAttachments).toEqual([
      expect.objectContaining({
        kind: "web-search",
        provider: "tavily",
        query: "Tavily API",
        answer: "Tavily 是搜索 API。",
      }),
    ]);
    expect(fetcher.mock.calls[1][0]).toBe("https://api.tavily.com/search");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      query: "Tavily API",
      include_answer: "advanced",
      include_raw_content: "markdown",
      max_results: 12,
    });
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as {
      messages: Array<{ role: string; content?: string; reasoning_content?: string }>;
    };
    expect(toolDecisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "我需要先搜索 Tavily API 的资料",
        }),
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("Tavily Docs"),
        }),
      ]),
    );
    const finalModelBody = JSON.parse(String(fetcher.mock.calls[3][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalModelBody.tools).toBeUndefined();
    expect(finalModelBody.tool_choice).toBeUndefined();
  });

  it("启用 Tavily 工具且请求流式时先跑完工具链再使用真实流式最终回答", async () => {
    await saveAppSetting({ key: "webSearchSettings", value: settings, updatedAt: 1 });
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"结合"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"搜索回答"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
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
                reasoning_content: "我需要先搜索 Tavily API 的资料",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "tavily_search",
                      arguments: '{"query":"Tavily API"}',
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
          answer: "Tavily 是搜索 API。",
          results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
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
        body: new ReadableStream({
          pull(controller) {
            const chunk = streamChunks.shift();
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
          modelId: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          endpointUrl: "https://api.deepseek.com/v1/chat/completions",
        }),
        messages: [createMessage("Tavily API 是什么")],
        stream: true,
        enabledToolIds: [TAVILY_SEARCH_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
      { onContentChunk },
    );

    expect(result).toMatchObject({
      ok: true,
      content: "结合搜索回答",
      toolTurnMessages: [
        expect.objectContaining({
          toolAttachments: [
            expect.objectContaining({
              kind: "web-search",
              provider: "tavily",
              query: "Tavily API",
            }),
          ],
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Tavily 流式工具调用应返回成功结果");
    }
    expect(result.toolTurnMessages).toHaveLength(1);
    expect(result.toolAttachments).toEqual([
      expect.objectContaining({
        kind: "web-search",
        provider: "tavily",
        query: "Tavily API",
        answer: "Tavily 是搜索 API。",
      }),
    ]);
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "结合");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "搜索回答");
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { stream: boolean; tool_choice?: string };
    const secondDecisionBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { stream: boolean; tool_choice?: string };
    const finalModelBody = JSON.parse(String(fetcher.mock.calls[3][1]?.body)) as {
      stream: boolean;
      tool_choice?: string;
      tools?: unknown[];
      messages: Array<{ role: string; reasoning_content?: string }>;
    };
    expect(toolDecisionBody).toMatchObject({
      stream: false,
      tool_choice: "auto",
    });
    expect(secondDecisionBody).toMatchObject({
      stream: false,
      tool_choice: "auto",
    });
    expect(finalModelBody).toMatchObject({
      stream: true,
    });
    expect(finalModelBody.tools).toBeUndefined();
    expect(finalModelBody.tool_choice).toBeUndefined();
    expect(finalModelBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "我需要先搜索 Tavily API 的资料",
        }),
      ]),
    );
  });

  it("启用 Tavily 工具但模型未调用工具时仍重新发起流式最终回答", async () => {
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"无需"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"搜索"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策阶段回答" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          pull(controller) {
            const chunk = streamChunks.shift();
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
        model: createModel(),
        messages: [createMessage("普通问题")],
        stream: true,
        enabledToolIds: [TAVILY_SEARCH_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "无需搜索",
      thinking: undefined,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { stream: boolean; tool_choice?: string };
    const finalModelBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { stream: boolean; tool_choice?: string; tools?: unknown[] };
    expect(toolDecisionBody).toMatchObject({
      stream: false,
      tool_choice: "auto",
    });
    expect(finalModelBody).toMatchObject({
      stream: true,
    });
    expect(finalModelBody.tools).toBeUndefined();
    expect(finalModelBody.tool_choice).toBeUndefined();
  });

  it("Tavily 工具参数包含额外字段时拒绝执行并把中文错误回灌给模型", async () => {
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
                      name: "tavily_search",
                      arguments: '{"query":"Tavily API","max_results":10}',
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
          choices: [{ message: { content: "参数已拒绝。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "参数已拒绝。" } }],
        }),
      });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("Tavily API 是什么")],
        stream: false,
        enabledToolIds: [TAVILY_SEARCH_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(toolDecisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "Tavily 搜索工具只接受 query 参数",
        }),
      ]),
    );
    const finalModelBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalModelBody.tools).toBeUndefined();
    expect(finalModelBody.tool_choice).toBeUndefined();
  });

  it("缺少 Tavily API Key 时把配置错误作为工具结果回灌", async () => {
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
                      name: "tavily_search",
                      arguments: '{"query":"Tavily API"}',
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
          choices: [{ message: { content: "请先配置后再搜索。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "请先配置后再搜索。" } }],
        }),
      });

    await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("Tavily API 是什么")],
        stream: false,
        enabledToolIds: [TAVILY_SEARCH_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("https://api.tavily.com/search");
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(toolDecisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "请先配置 Tavily API Key",
        }),
      ]),
    );
  });
});
