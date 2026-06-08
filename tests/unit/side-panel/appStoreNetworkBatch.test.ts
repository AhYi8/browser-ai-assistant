import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase, saveAppSetting, saveChatSession, saveModelProvider, saveProviderModel } from "../../../src/shared/storage/repositories";
import type { ChatMessage, ChatSession, ModelProvider, NetworkRequestDetail, NetworkRequestMeta, ProviderModel } from "../../../src/shared/types";

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

function createRequest(index: number): NetworkRequestMeta {
  return {
    id: `req-${index}`,
    url: `https://api.example.com/items/${index}`,
    method: "GET",
    status: 200,
    resourceType: "fetch",
  };
}

function createDetail(request: NetworkRequestMeta): NetworkRequestDetail {
  return {
    ...request,
    statusText: "OK",
    mimeType: "application/json",
    durationMs: 100,
    requestHeaders: [],
    responseHeaders: [],
    responseBody: "{}",
    truncated: false,
    redacted: false,
  };
}

function createChatMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "分析接口",
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

function createChatSession(partial: Partial<ChatSession>): ChatSession {
  return {
    id: "session-1",
    title: "Network 分析",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    ...partial,
  };
}

async function setupNetworkChat(): Promise<void> {
  await saveModelProvider(createProvider());
  await saveProviderModel(createModel());
  await useAppStore.getState().loadChannelConfig();
  await useAppStore.getState().loadChatData();
  useAppStore.getState().setStreamMode(false);
  useAppStore.getState().setNetworkContextEnabled(true);
}

describe("appStore Network 分组筛选", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("默认每 50 个请求为一组并发筛选并合并各组结果", async () => {
    const requests = Array.from({ length: 200 }, (_, index) => createRequest(index + 1));
    const details = requests.map(createDetail);
    const pendingRelevanceCallbacks: Array<{
      content: string;
      callback: (response: unknown) => void;
    }> = [];
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({
          ok: true,
          details: details.filter((detail) => message.requestIds?.includes(detail.id)),
        });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        if (content.includes("Network context:")) {
          callback({ ok: true, content: "AI 分组接口分析" });
          return undefined;
        }

        pendingRelevanceCallbacks.push({ content, callback });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await setupNetworkChat();

    const sendPromise = useAppStore.getState().sendChatMessage("分析所有接口");
    await vi.waitFor(() => {
      expect(pendingRelevanceCallbacks).toHaveLength(4);
    });

    expect(pendingRelevanceCallbacks[0].content).toContain("id=req-1");
    expect(pendingRelevanceCallbacks[0].content).toContain("id=req-50");
    expect(pendingRelevanceCallbacks[0].content).not.toContain("id=req-51");
    expect(pendingRelevanceCallbacks[1].content).toContain("id=req-51");
    expect(pendingRelevanceCallbacks[1].content).toContain("id=req-100");
    expect(pendingRelevanceCallbacks[1].content).not.toContain("id=req-101");
    expect(pendingRelevanceCallbacks[2].content).toContain("id=req-101");
    expect(pendingRelevanceCallbacks[2].content).toContain("id=req-150");
    expect(pendingRelevanceCallbacks[3].content).toContain("id=req-151");
    expect(pendingRelevanceCallbacks[3].content).toContain("id=req-200");

    pendingRelevanceCallbacks[0].callback({ ok: true, content: '{"requestIds":["req-1"]}' });
    pendingRelevanceCallbacks[1].callback({ ok: true, content: '{"requestIds":["req-51"]}' });
    pendingRelevanceCallbacks[2].callback({ ok: true, content: '{"requestIds":["req-101"]}' });
    pendingRelevanceCallbacks[3].callback({ ok: true, content: '{"requestIds":["req-151"]}' });
    await sendPromise;

    const detailRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; requestIds?: string[]; tabId?: number })
      .find((message) => message.type === "networkContext.getDetails");
    expect(detailRequest).toMatchObject({
      tabId: 7,
      requestIds: ["req-1", "req-51", "req-101", "req-151"],
    });
    expect(useAppStore.getState().failure).toBeUndefined();
    expect(useAppStore.getState().chatSessions[0].messages[1].content).toBe("AI 分组接口分析");
  });

  it("聊天偏好会归一化 Network 默认采集类型", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRequestTypeFilters: ["fetch_xhr", "invalid", "img", "fetch_xhr"],
      },
      updatedAt: 2,
    });

    await setupNetworkChat();

    expect(useAppStore.getState().chatPreferences.networkRequestTypeFilters).toEqual(["fetch_xhr", "img"]);
  });

  it("旧聊天偏好缺少 Network 默认采集类型时保持采集全部", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRelevanceBatchSize: 40,
      },
      updatedAt: 2,
    });

    await setupNetworkChat();

    expect(useAppStore.getState().chatPreferences.networkRequestTypeFilters).toEqual(["all"]);
  });

  it("使用聊天偏好中的 Network 筛选分组大小", async () => {
    const requests = Array.from({ length: 120 }, (_, index) => createRequest(index + 1));
    const details = requests.map(createDetail);
    const pendingRelevanceCallbacks: Array<{
      content: string;
      callback: (response: unknown) => void;
    }> = [];
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({
          ok: true,
          details: details.filter((detail) => message.requestIds?.includes(detail.id)),
        });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        if (content.includes("Network context:")) {
          callback({ ok: true, content: "AI 自定义分组接口分析" });
          return undefined;
        }

        pendingRelevanceCallbacks.push({ content, callback });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRelevanceBatchSize: 40,
      },
      updatedAt: 2,
    });
    await setupNetworkChat();

    const sendPromise = useAppStore.getState().sendChatMessage("分析所有接口");
    await vi.waitFor(() => {
      expect(pendingRelevanceCallbacks).toHaveLength(3);
    });

    expect(pendingRelevanceCallbacks[0].content).toContain("id=req-1");
    expect(pendingRelevanceCallbacks[0].content).toContain("id=req-40");
    expect(pendingRelevanceCallbacks[0].content).not.toContain("id=req-41");
    expect(pendingRelevanceCallbacks[1].content).toContain("id=req-41");
    expect(pendingRelevanceCallbacks[1].content).toContain("id=req-80");
    expect(pendingRelevanceCallbacks[1].content).not.toContain("id=req-81");
    expect(pendingRelevanceCallbacks[2].content).toContain("id=req-81");
    expect(pendingRelevanceCallbacks[2].content).toContain("id=req-120");

    pendingRelevanceCallbacks[0].callback({ ok: true, content: '{"requestIds":["req-1"]}' });
    pendingRelevanceCallbacks[1].callback({ ok: true, content: '{"requestIds":["req-41"]}' });
    pendingRelevanceCallbacks[2].callback({ ok: true, content: '{"requestIds":["req-81"]}' });
    await sendPromise;

    const detailRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; requestIds?: string[]; tabId?: number })
      .find((message) => message.type === "networkContext.getDetails");
    expect(detailRequest).toMatchObject({
      tabId: 7,
      requestIds: ["req-1", "req-41", "req-81"],
    });
    expect(useAppStore.getState().chatSessions[0].messages[1].content).toBe("AI 自定义分组接口分析");
  });

  it("发送 Network 上下文前只筛选聊天偏好选中的请求类型", async () => {
    const requests: NetworkRequestMeta[] = [
      { id: "req-fetch", url: "https://api.example.com/data", method: "GET", status: 200, resourceType: "fetch" },
      { id: "req-xhr", url: "https://api.example.com/login", method: "POST", status: 500, resourceType: "xhr" },
      { id: "req-doc", url: "https://example.com", method: "GET", status: 200, resourceType: "document" },
      { id: "req-img", url: "https://example.com/logo.png", method: "GET", status: 200, resourceType: "image" },
    ];
    const details = requests.map(createDetail);
    const relevancePrompts: string[] = [];
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({
          ok: true,
          details: details.filter((detail) => message.requestIds?.includes(detail.id)),
        });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        if (content.includes("Network context:")) {
          callback({ ok: true, content: "AI 类型过滤接口分析" });
          return undefined;
        }

        relevancePrompts.push(content);
        callback({ ok: true, content: '{"requestIds":["req-fetch","req-xhr"]}' });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRequestTypeFilters: ["fetch_xhr"],
      },
      updatedAt: 2,
    });
    await setupNetworkChat();

    await useAppStore.getState().sendChatMessage("分析接口");

    expect(relevancePrompts).toHaveLength(1);
    expect(relevancePrompts[0]).toContain("id=req-fetch");
    expect(relevancePrompts[0]).toContain("id=req-xhr");
    expect(relevancePrompts[0]).not.toContain("id=req-doc");
    expect(relevancePrompts[0]).not.toContain("id=req-img");
    const detailRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; requestIds?: string[] })
      .find((message) => message.type === "networkContext.getDetails");
    expect(detailRequest?.requestIds).toEqual(["req-fetch", "req-xhr"]);
  });

  it("Network 请求类型过滤后为空时返回中文提示且不发起 AI 筛选", async () => {
    const requests: NetworkRequestMeta[] = [
      { id: "req-doc", url: "https://example.com", method: "GET", status: 200, resourceType: "document" },
    ];
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRequestTypeFilters: ["fetch_xhr"],
      },
      updatedAt: 2,
    });
    await setupNetworkChat();

    await useAppStore.getState().sendChatMessage("分析接口");

    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send")).toBe(false);
    expect(useAppStore.getState().failure?.message).toBe("未采集到符合当前类型过滤条件的 Network 请求，请在聊天偏好中调整默认采集类型");
  });

  it("某一组筛选失败时最多重试 3 次并将整体视为失败", async () => {
    const requests = Array.from({ length: 31 }, (_, index) => createRequest(index + 1));
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        if (content.includes("id=req-31")) {
          callback({ ok: false, message: "Network 请求相关性筛选失败" });
          return undefined;
        }

        callback({ ok: true, content: '{"requestIds":["req-1"]}' });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await setupNetworkChat();

    await useAppStore.getState().sendChatMessage("分析所有接口");

    const failedGroupRequests = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send" && (message.messages?.at(-1)?.content ?? "").includes("id=req-31"));
    expect(failedGroupRequests).toHaveLength(3);
    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "networkContext.getDetails")).toBe(false);
    expect(useAppStore.getState().failure?.message).toBe("Network 请求相关性筛选失败");
  });
  it("Network 筛选没有返回响应时使用中文失败提示", async () => {
    const requests = Array.from({ length: 1 }, (_, index) => createRequest(index + 1));
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "chat.send") {
        callback(undefined);
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await setupNetworkChat();

    await useAppStore.getState().sendChatMessage("分析所有接口");

    expect(useAppStore.getState().failure?.message).toBe("Network 请求相关性筛选失败");
  });

  it("开启 Network 上下文后重新生成 AI 消息会重新执行自动化 Network 分析", async () => {
    const requests = [createRequest(1)];
    const details = requests.map(createDetail);
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({ ok: true, details });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        callback(content.includes("Network context:") ? { ok: true, content: "重新分析 Network" } : { ok: true, content: '{"requestIds":["req-1"]}' });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await saveChatSession(
      createChatSession({
        messages: [
          createChatMessage({ id: "message-user-1", role: "user", content: "分析接口", createdAt: 1 }),
          createChatMessage({ id: "message-ai-1", role: "assistant", content: "旧分析", createdAt: 2 }),
        ],
      }),
    );
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.getState().setNetworkContextEnabled(true);

    await useAppStore.getState().regenerateMessage("message-ai-1");

    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "networkContext.getSnapshot")).toBe(true);
    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "networkContext.getDetails")).toBe(true);
    const finalChatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);
    expect(finalChatRequest?.messages?.at(-1)?.content).toContain("Network context:");
    expect(useAppStore.getState().chatSessions[0].messages.map((message) => message.content)).toEqual(["分析接口", "重新分析 Network"]);
  });

  it("Network 首次异常后重新生成用户消息会重新执行自动化 Network 分析", async () => {
    const requests = [createRequest(1)];
    const details = requests.map(createDetail);
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({ ok: true, details });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        callback(content.includes("Network context:") ? { ok: true, content: "异常后重新分析" } : { ok: true, content: '{"requestIds":["req-1"]}' });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await saveChatSession(
      createChatSession({
        messages: [createChatMessage({ id: "message-user-1", role: "user", content: "分析接口", createdAt: 1 })],
      }),
    );
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.getState().setNetworkContextEnabled(true);

    await useAppStore.getState().regenerateMessage("message-user-1");

    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "networkContext.getSnapshot")).toBe(true);
    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "networkContext.getDetails")).toBe(true);
    expect(useAppStore.getState().chatSessions[0].messages.map((message) => message.content)).toEqual(["分析接口", "异常后重新分析"]);
  });

  it("当前会话 Network 覆盖优先于全局聊天偏好", async () => {
    const requests = Array.from({ length: 60 }, (_, index) => ({
      ...createRequest(index + 1),
      resourceType: index === 0 ? "image" : "fetch",
    }));
    const details = requests.map(createDetail);
    const relevancePrompts: string[] = [];
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[]; requestIds?: string[]; tabId?: number }, callback: (response: unknown) => void) => {
      if (message.type === "networkContext.getSnapshot") {
        callback({ ok: true, tabId: 7, requests });
        return undefined;
      }

      if (message.type === "networkContext.getDetails") {
        callback({ ok: true, details: details.filter((detail) => message.requestIds?.includes(detail.id)) });
        return undefined;
      }

      if (message.type === "chat.send") {
        const content = message.messages?.at(-1)?.content ?? "";
        if (content.includes("Network context:")) {
          callback({ ok: true, content: "使用当前聊天 Network 设置" });
          return undefined;
        }

        relevancePrompts.push(content);
        callback({ ok: true, content: '{"requestIds":["req-1"]}' });
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        networkRelevanceBatchSize: 50,
        networkRequestTypeFilters: ["fetch_xhr"],
      },
      updatedAt: 2,
    });
    await saveModelProvider(createProvider());
    await saveProviderModel(createModel());
    await saveChatSession(
      createChatSession({
        chatPreferenceOverrides: {
          networkRelevanceBatchSize: 10,
          networkRequestTypeFilters: ["img"],
        },
      }),
    );
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.getState().setNetworkContextEnabled(true);

    await useAppStore.getState().sendChatMessage("分析图片请求");

    expect(relevancePrompts).toHaveLength(1);
    expect(relevancePrompts[0]).toContain("id=req-1");
    expect(relevancePrompts[0]).not.toContain("id=req-2");
    expect(useAppStore.getState().chatSessions[0].messages[1].content).toBe("使用当前聊天 Network 设置");
  });
});
