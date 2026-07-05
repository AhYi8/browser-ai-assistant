import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase, saveChatSession } from "../../../src/shared/storage/repositories";
import type { ChatMessage, ChatSession, ChatTokenUsageEntry, ModelProvider, ProviderModel } from "../../../src/shared/types";

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

function createMessage(id: string, role: ChatMessage["role"], content: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
    ...partial,
  };
}

function createUsage(id: string, outputTokens: number, source: ChatTokenUsageEntry["source"] = "chat"): ChatTokenUsageEntry {
  return {
    id,
    usageSchemaVersion: 1,
    source,
    modelId: "model-1",
    endpointType: "openai_chat",
    createdAt: 1,
    inputTokens: 10,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
}

function createRuntimePort(options: {
  onStart?: (payload: unknown) => void;
  onDisconnect?: () => void;
} = {}) {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const port = {
    postMessage: vi.fn((message: { type: string; payload?: unknown }) => {
      if (message.type === "chat.stream.start") {
        options.onStart?.(message.payload);
      }
    }),
    disconnect: vi.fn(() => {
      options.onDisconnect?.();
      disconnectListeners.forEach((listener) => listener());
    }),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => {
        messageListeners.push(listener);
      }),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListeners.push(listener);
      }),
    },
  };

  return {
    port,
    emitMessage(message: unknown) {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
  };
}

async function waitUntil(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < 50; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe("appStore 聊天上下文压缩", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("达到最大聊天上下文 90% 时先压缩历史，再只带摘要和当前消息发起正式请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const oldUsage = createUsage("usage-old", 95);
    const session: ChatSession = {
      id: "session-1",
      title: "压缩会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: [oldUsage.id] }),
      ],
      tokenUsageEntries: [oldUsage],
    };
    const chatRequests: Array<{ type: string; tokenUsageSource?: string; messages?: ChatMessage[] }> = [];
    const sendMessage = vi.fn((message: { type: string; tokenUsageSource?: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type !== "chat.send") {
        callback(undefined);
        return undefined;
      }

      chatRequests.push(message);
      if (message.tokenUsageSource === "context_compression") {
        callback({
          ok: true,
          content: "压缩后的上下文摘要",
          tokenUsageEntries: [createUsage("usage-compression", 8, "context_compression")],
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "正式回答",
        tokenUsageEntries: [createUsage("usage-final", 6)],
      });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    await useAppStore.getState().sendChatMessage("当前问题");

    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[0].tokenUsageSource).toBe("context_compression");
    expect(chatRequests[0].messages?.[1]?.content).toContain("旧问题");
    const finalMessages = chatRequests[1].messages ?? [];
    expect(finalMessages.map((message) => message.content)).toEqual([
      "你是网页助手",
      "压缩后的上下文摘要",
      "当前问题",
    ]);
    expect(finalMessages.some((message) => message.content.includes("旧回答"))).toBe(false);
    const updatedSession = useAppStore.getState().chatSessions.find((item) => item.id === session.id);
    expect(updatedSession?.messages.map((message) => message.assistantMessageKind)).toContain("context_summary");
    expect(updatedSession?.messages.some((message) => message.toolCallRecords?.some((record) => record.toolId === "chat.context_compression" && record.status === "success" && record.resultSummary === "压缩后的上下文摘要"))).toBe(true);
    const summaryIndex = updatedSession?.messages.findIndex((message) => message.assistantMessageKind === "context_summary") ?? -1;
    expect(updatedSession?.messages[summaryIndex + 1]?.content).toBe("当前问题");
    expect(updatedSession?.messages.at(-1)?.content).toBe("正式回答");
  });

  it("压缩失败时会结束任务并保留原始历史", async () => {
    const provider = createProvider();
    const model = createModel();
    const session: ChatSession = {
      id: "session-failed",
      title: "压缩失败会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: ["usage-old"] }),
      ],
      tokenUsageEntries: [createUsage("usage-old", 95)],
    };
    const chatRequests: Array<{ type: string; tokenUsageSource?: string }> = [];
    const sendMessage = vi.fn((message: { type: string; tokenUsageSource?: string }, callback: (response: unknown) => void) => {
      if (message.type !== "chat.send") {
        callback(undefined);
        return undefined;
      }

      chatRequests.push(message);
      if (message.tokenUsageSource === "context_compression") {
        callback({ ok: false, message: "压缩失败，请稍后重试" });
        return undefined;
      }

      callback({ ok: true, content: "不应继续执行" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    await useAppStore.getState().sendChatMessage("当前问题");

    expect(chatRequests).toHaveLength(1);
    expect(useAppStore.getState().sending).toBe(false);
    expect(useAppStore.getState().chatTasksBySessionId[session.id]?.status).toBe("failed");
    expect(useAppStore.getState().failure?.message).toBe("压缩失败，请稍后重试");
    expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["旧问题", "旧回答", "当前问题", ""]);
    expect(useAppStore.getState().chatSessions[0]?.messages.at(-1)?.toolCallRecords?.[0]).toMatchObject({
      toolId: "chat.context_compression",
      status: "error",
      errorMessage: "压缩失败，请稍后重试",
    });
  });

  it("上下文压缩期间取消任务后不会继续发送正式请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const session: ChatSession = {
      id: "session-cancel-compression",
      title: "取消压缩会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: ["usage-old"] }),
      ],
      tokenUsageEntries: [createUsage("usage-old", 95)],
    };
    let compressionPayload: { tokenUsageSource?: string } | undefined;
    const portController = createRuntimePort({
      onStart(payload) {
        compressionPayload = payload as { tokenUsageSource?: string };
      },
    });
    const connect = vi.fn(() => portController.port);
    vi.stubGlobal("chrome", { runtime: { connect } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    const requestPromise = useAppStore.getState().sendChatMessage("当前问题");
    await waitUntil(() => expect(compressionPayload?.tokenUsageSource).toBe("context_compression"));

    useAppStore.getState().abortChatTask(session.id);
    await requestPromise;

    expect(connect).toHaveBeenCalledTimes(1);
    expect(portController.port.disconnect).toHaveBeenCalled();
    expect(useAppStore.getState().sending).toBe(false);
    expect(useAppStore.getState().chatTasksBySessionId[session.id]?.status).toBe("canceled");
    expect(useAppStore.getState().chatSessions[0]?.messages.some((message) => message.assistantMessageKind === "context_summary")).toBe(false);
    expect(useAppStore.getState().chatSessions[0]?.messages.at(-1)?.toolCallRecords?.[0]).toMatchObject({
      toolId: "chat.context_compression",
      status: "error",
      errorMessage: "已终止本次生成。",
    });
  });

  it("流式模式下同样会先压缩再发送正式流式请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const oldUsage = createUsage("usage-old", 95);
    const session: ChatSession = {
      id: "session-stream",
      title: "流式压缩会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: [oldUsage.id] }),
      ],
      tokenUsageEntries: [oldUsage],
    };
    let compressionPayload: { tokenUsageSource?: string } | undefined;
    let streamPayload: { messages?: ChatMessage[] } | undefined;
    const compressionPortController = createRuntimePort({
      onStart(payload) {
        compressionPayload = payload as { tokenUsageSource?: string };
        compressionPortController.emitMessage({
          type: "complete",
          content: "压缩后的上下文摘要",
          tokenUsageEntries: [createUsage("usage-compression", 8, "context_compression")],
        });
      },
    });
    const streamPortController = createRuntimePort({
      onStart(payload) {
        streamPayload = payload as { messages?: ChatMessage[] };
        streamPortController.emitMessage({ type: "complete", content: "正式回答" });
      },
    });
    const connect = vi.fn()
      .mockImplementationOnce(() => compressionPortController.port)
      .mockImplementationOnce(() => streamPortController.port);
    vi.stubGlobal("chrome", {
      runtime: {
        connect,
      },
    });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: true,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    await useAppStore.getState().sendChatMessage("当前问题");

    expect(connect).toHaveBeenCalledTimes(2);
    expect(compressionPayload?.tokenUsageSource).toBe("context_compression");
    expect(streamPayload?.messages?.map((message) => message.content)).toEqual([
      "你是网页助手",
      "压缩后的上下文摘要",
      "当前问题",
    ]);
    expect(useAppStore.getState().chatTasksBySessionId[session.id]?.status).toBe("completed");
    expect(useAppStore.getState().sending).toBe(false);
  });

  it("多次压缩时只从最新摘要边界继续累积上下文", async () => {
    const provider = createProvider();
    const model = createModel();
    const firstSummary = createMessage("message-summary-1", "assistant", "第一次摘要", {
      assistantMessageKind: "context_summary",
      tokenUsageEntryIds: ["usage-summary-1"],
    });
    const session: ChatSession = {
      id: "session-multi-summary",
      title: "多次压缩会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        firstSummary,
        createMessage("message-user-mid", "user", "中间问题"),
        createMessage("message-assistant-mid", "assistant", "中间回答", { tokenUsageEntryIds: ["usage-mid"] }),
      ],
      tokenUsageEntries: [createUsage("usage-summary-1", 5), createUsage("usage-mid", 88)],
    };
    const chatRequests: Array<{ type: string; tokenUsageSource?: string; messages?: ChatMessage[] }> = [];
    const sendMessage = vi.fn((message: { type: string; tokenUsageSource?: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type !== "chat.send") {
        callback(undefined);
        return undefined;
      }

      chatRequests.push(message);
      if (message.tokenUsageSource === "context_compression") {
        callback({
          ok: true,
          content: "第二次摘要",
          tokenUsageEntries: [createUsage("usage-summary-2", 6, "context_compression")],
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "最终回答",
        tokenUsageEntries: [createUsage("usage-final", 6)],
      });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    await useAppStore.getState().sendChatMessage("当前问题");

    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[0].messages?.[1]?.content).not.toContain("旧问题");
    expect(chatRequests[0].messages?.[1]?.content).toContain("第一次摘要");
    expect(chatRequests[0].messages?.[1]?.content).toContain("中间问题");
    expect(chatRequests[1].messages?.map((message) => message.content)).toEqual([
      "你是网页助手",
      "第二次摘要",
      "当前问题",
    ]);
  });

  it("排队跟进触发压缩失败时会保留队列项并复用已追加的用户消息", async () => {
    const provider = createProvider();
    const model = createModel();
    const oldUsage = createUsage("usage-old", 70);
    const firstUsage = {
      ...createUsage("usage-first", 2),
      inputTokens: 92,
    };
    const session: ChatSession = {
      id: "session-queue-compression-failed",
      title: "排队压缩失败会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: [oldUsage.id] }),
      ],
      tokenUsageEntries: [oldUsage],
    };
    let firstResponse: ((response: unknown) => void) | undefined;
    const chatRequests: Array<{ type: string; tokenUsageSource?: string; messages?: ChatMessage[] }> = [];
    const sendMessage = vi.fn((message: { type: string; tokenUsageSource?: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type !== "chat.send") {
        callback(undefined);
        return undefined;
      }

      chatRequests.push(message);
      if (message.tokenUsageSource === "context_compression") {
        callback({ ok: false, message: "压缩失败，请稍后重试" });
        return undefined;
      }
      if (!firstResponse) {
        firstResponse = callback;
        return undefined;
      }

      callback({ ok: true, content: "不应继续执行" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    await waitUntil(() => expect(firstResponse).toBeDefined());
    await useAppStore.getState().submitChatFollowUp("第二问", [], [], { behavior: "queue" });

    firstResponse?.({
      ok: true,
      content: "第一答",
      tokenUsageEntries: [firstUsage],
    });
    await firstSend;

    await waitUntil(() => expect(useAppStore.getState().failure?.message).toBe("压缩失败，请稍后重试"));
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1].tokenUsageSource).toBe("context_compression");
    await waitUntil(() =>
      expect(useAppStore.getState().followUpsBySessionId[session.id] ?? []).toEqual([
        expect.objectContaining({
          behavior: "queue",
          content: "第二问",
          userMessageId: expect.stringMatching(/^message-\d+-follow-up-user$/),
        }),
      ]),
    );
    const updatedSession = useAppStore.getState().chatSessions.find((item) => item.id === session.id);
    expect(updatedSession?.messages.filter((message) => message.content === "第二问")).toHaveLength(1);
    expect(updatedSession?.messages.at(-1)?.toolCallRecords?.[0]).toMatchObject({
      toolId: "chat.context_compression",
      status: "error",
      errorMessage: "压缩失败，请稍后重试",
    });
  });

  it("排队跟进触发压缩成功时会消费队列且不重复追加用户消息", async () => {
    const provider = createProvider();
    const model = createModel();
    const oldUsage = createUsage("usage-old", 70);
    const firstUsage = {
      ...createUsage("usage-first", 2),
      inputTokens: 92,
    };
    const session: ChatSession = {
      id: "session-queue-compression-success",
      title: "排队压缩成功会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: model.id,
      messages: [
        createMessage("message-user-old", "user", "旧问题"),
        createMessage("message-assistant-old", "assistant", "旧回答", { tokenUsageEntryIds: [oldUsage.id] }),
      ],
      tokenUsageEntries: [oldUsage],
    };
    let firstResponse: ((response: unknown) => void) | undefined;
    const chatRequests: Array<{ type: string; tokenUsageSource?: string; messages?: ChatMessage[] }> = [];
    const sendMessage = vi.fn((message: { type: string; tokenUsageSource?: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type !== "chat.send") {
        callback(undefined);
        return undefined;
      }

      chatRequests.push(message);
      if (message.tokenUsageSource === "context_compression") {
        callback({
          ok: true,
          content: "排队压缩摘要",
          tokenUsageEntries: [createUsage("usage-compression", 7, "context_compression")],
        });
        return undefined;
      }
      if (!firstResponse) {
        firstResponse = callback;
        return undefined;
      }

      callback({
        ok: true,
        content: "第二答",
        tokenUsageEntries: [createUsage("usage-second-final", 4)],
      });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveChatSession(session);
    const currentPreferences = useAppStore.getState().chatPreferences;
    useAppStore.setState({
      providers: [provider],
      models: [model],
      selectedModelId: model.id,
      activeSessionId: session.id,
      chatSessions: [session],
      streamMode: false,
      chatPreferences: {
        ...currentPreferences,
        maxTokens: 100,
        contextCompressionPrompt: "请压缩历史",
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
    });

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    await waitUntil(() => expect(firstResponse).toBeDefined());
    await useAppStore.getState().submitChatFollowUp("第二问", [], [], { behavior: "queue" });

    firstResponse?.({
      ok: true,
      content: "第一答",
      tokenUsageEntries: [firstUsage],
    });
    await firstSend;

    await waitUntil(() => expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.messages.at(-1)?.content).toBe("第二答"));
    expect(chatRequests).toHaveLength(3);
    expect(chatRequests[1].tokenUsageSource).toBe("context_compression");
    expect(chatRequests[2].messages?.map((message) => message.content)).toEqual([
      "你是网页助手",
      "排队压缩摘要",
      "第二问",
    ]);
    expect(useAppStore.getState().followUpsBySessionId[session.id]).toEqual([]);
    const updatedSession = useAppStore.getState().chatSessions.find((item) => item.id === session.id);
    expect(updatedSession?.messages.filter((message) => message.content === "第二问")).toHaveLength(1);
    expect(updatedSession?.messages.some((message) => message.assistantMessageKind === "context_summary" && message.content === "排队压缩摘要")).toBe(true);
  });
});
