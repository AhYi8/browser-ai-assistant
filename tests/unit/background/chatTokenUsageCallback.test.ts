import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import type { ModelToolRegistryEntry } from "../../../src/shared/models/types";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

const registeredModelToolsMock = vi.hoisted(() => ({
  tools: [] as ModelToolRegistryEntry[],
}));

vi.mock("../../../src/shared/models/toolRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared/models/toolRegistry")>();
  return {
    ...actual,
    getRegisteredModelTools: () => registeredModelToolsMock.tools,
  };
});

describe("聊天 Token 用量回调", () => {
  beforeEach(() => {
    registeredModelToolsMock.tools = [];
  });

  it("工具决策和最终回答完成后会立即通过回调报告 Token 用量", async () => {
    registeredModelToolsMock.tools = [
      {
        id: "page.read_context",
        name: "read_page_context",
        description: "读取当前页面结构",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已经不需要工具" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "最终回答" } }],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 30,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
      });
    const onTokenUsageEntries = vi.fn();

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "读取页面")],
        stream: false,
        enabledToolIds: ["page.read_context"],
        toolChoice: "auto",
      },
      fetcher,
      { onTokenUsageEntries },
      vi.fn(),
    );

    expect(result).toMatchObject({
      ok: true,
      content: "最终回答",
    });
    expect(onTokenUsageEntries).toHaveBeenCalledTimes(2);
    expect(onTokenUsageEntries).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        source: "tool_decision",
        inputTokens: 100,
        outputTokens: 20,
      }),
    ]);
    expect(onTokenUsageEntries).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        source: "tool_final",
        inputTokens: 150,
        outputTokens: 30,
      }),
    ]);
    expect(result.ok ? result.tokenUsageEntries : []).toEqual([
      expect.objectContaining({ source: "tool_decision" }),
      expect.objectContaining({ source: "tool_final" }),
    ]);
  });
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
