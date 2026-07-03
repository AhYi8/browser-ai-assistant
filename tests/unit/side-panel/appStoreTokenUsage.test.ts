import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  clearDatabase,
  getChatSession,
  saveModelProvider,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

describe("appStore Token 用量", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  it("非流式聊天成功后会把 Token 用量追加到当前会话", async () => {
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "chat.send") {
        callback({
          ok: true,
          content: "AI 回复",
          tokenUsageEntries: [
            {
              id: "usage-chat-1",
              usageSchemaVersion: 1,
              source: "chat",
              modelId: "model-1",
              endpointType: "openai_chat",
              createdAt: 10,
              inputTokens: 11,
              outputTokens: 3,
              cacheWriteTokens: 0,
              cacheReadTokens: 4,
            },
          ],
        });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("统计 Token");

    const activeSessionId = useAppStore.getState().activeSessionId;
    expect(useAppStore.getState().chatSessions[0].tokenUsageEntries).toEqual([
      expect.objectContaining({
        id: "usage-chat-1",
        source: "chat",
        inputTokens: 11,
        outputTokens: 3,
        cacheReadTokens: 4,
      }),
    ]);
    await expect(getChatSession(activeSessionId)).resolves.toMatchObject({
      tokenUsageEntries: [
        expect.objectContaining({
          id: "usage-chat-1",
          inputTokens: 11,
          outputTokens: 3,
          cacheReadTokens: 4,
        }),
      ],
    });
  });

  it("流式端口收到 Token 用量事件后立即预览且最终完成后才持久化", async () => {
    let portMessageListener: ((message: unknown) => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          portMessageListener = listener;
        }),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage: vi.fn(),
      },
    });

    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: false,
      },
    }));
    useAppStore.getState().setStreamMode(true);

    const sendPromise = useAppStore.getState().sendChatMessage("统计流式 Token");
    await vi.waitFor(() => expect(portMessageListener).toBeTypeOf("function"));

    const usageEntry = {
      id: "usage-stream-1",
      usageSchemaVersion: 1,
      source: "tool_decision",
      modelId: "model-1",
      endpointType: "openai_chat",
      createdAt: 20,
      inputTokens: 20,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    };
    portMessageListener?.({ type: "token_usage", tokenUsageEntries: [usageEntry] });

    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0].tokenUsageEntries).toEqual([
        expect.objectContaining({
          id: "usage-stream-1",
          inputTokens: 20,
          outputTokens: 5,
        }),
      ]);
    });
    await expect(getChatSession(useAppStore.getState().activeSessionId)).resolves.not.toMatchObject({
      tokenUsageEntries: expect.any(Array),
    });

    portMessageListener?.({
      type: "complete",
      content: "AI 回复",
      tokenUsageEntries: [usageEntry],
    });
    await sendPromise;

    expect(useAppStore.getState().chatSessions[0].tokenUsageEntries).toHaveLength(1);
    await expect(getChatSession(useAppStore.getState().activeSessionId)).resolves.toMatchObject({
      tokenUsageEntries: [
        expect.objectContaining({
          id: "usage-stream-1",
          inputTokens: 20,
          outputTokens: 5,
        }),
      ],
    });
  });

  it("流式端口收到 Token 用量后失败不会持久化且会清理预览", async () => {
    let portMessageListener: ((message: unknown) => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          portMessageListener = listener;
        }),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage: vi.fn(),
      },
    });

    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: false,
      },
    }));
    useAppStore.getState().setStreamMode(true);

    const sendPromise = useAppStore.getState().sendChatMessage("统计失败 Token");
    await vi.waitFor(() => expect(portMessageListener).toBeTypeOf("function"));

    const usageEntry = {
      id: "usage-stream-failed",
      usageSchemaVersion: 1,
      source: "tool_decision",
      modelId: "model-1",
      endpointType: "openai_chat",
      createdAt: 30,
      inputTokens: 30,
      outputTokens: 6,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    };
    portMessageListener?.({ type: "token_usage", tokenUsageEntries: [usageEntry] });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0].tokenUsageEntries).toEqual([
        expect.objectContaining({ id: "usage-stream-failed" }),
      ]);
    });

    portMessageListener?.({ type: "error", message: "最终请求失败" });
    await sendPromise;

    expect(useAppStore.getState().chatSessions[0].tokenUsageEntries).toBeUndefined();
    await expect(getChatSession(useAppStore.getState().activeSessionId)).resolves.not.toMatchObject({
      tokenUsageEntries: expect.any(Array),
    });
  });
});

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
