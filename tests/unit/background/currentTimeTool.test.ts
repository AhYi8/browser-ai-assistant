import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import { CURRENT_TIME_TOOL_ID } from "../../../src/shared/models/toolRegistry";
import { clearDatabase } from "../../../src/shared/storage/repositories";
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

describe("当前系统时间工具调用", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await clearDatabase();
  });

  it("模型调用当前系统时间工具时只把结果回灌给模型，不生成 AI 消息附件", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T03:04:05.678Z"));
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
                    id: "call-time-1",
                    type: "function",
                    function: {
                      name: "get_current_time",
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
          choices: [{ message: { content: "现在是 2026 年 6 月 11 日。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "现在是 2026 年 6 月 11 日。" } }],
        }),
      });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("今天是几号")],
        stream: false,
        enabledToolIds: [CURRENT_TIME_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
    );

    expect(result).toMatchObject({
      ok: true,
      content: "现在是 2026 年 6 月 11 日。",
      toolTurnMessages: [
        expect.objectContaining({
          toolCallRecords: [
            expect.objectContaining({
              toolId: CURRENT_TIME_TOOL_ID,
              name: "get_current_time",
              status: "success",
            }),
          ],
        }),
      ],
    });
    expect(result).not.toHaveProperty("toolCallRecords");
    expect(result).not.toHaveProperty("toolAttachments");
    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(toolDecisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("ISO 时间：2026-06-11T03:04:05.678Z"),
        }),
      ]),
    );
    const finalModelBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as { tools?: unknown[]; tool_choice?: unknown };
    expect(finalModelBody.tools).toBeUndefined();
    expect(finalModelBody.tool_choice).toBeUndefined();
  });

  it("当前系统时间工具收到额外参数时拒绝执行并把中文错误回灌给模型", async () => {
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
                    id: "call-time-1",
                    type: "function",
                    function: {
                      name: "get_current_time",
                      arguments: '{"locale":"en-US"}',
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
        messages: [createMessage("当前时间")],
        stream: false,
        enabledToolIds: [CURRENT_TIME_TOOL_ID],
        toolChoice: "auto",
      },
      fetcher,
    );

    const toolDecisionBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    expect(toolDecisionBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "当前系统时间工具不接受任何参数",
        }),
      ]),
    );
  });
});
