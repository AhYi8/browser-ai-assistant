import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase, getChatSession, saveModelProvider, saveProviderModel } from "../../../src/shared/storage/repositories";
import type { ChatMessage, ModelProvider, ProviderModel } from "../../../src/shared/types";

const repositoryMockState = vi.hoisted(() => ({
  failSaveChatSession: false,
  failSaveChatFolder: false,
  delaySaveChatSession: false,
  delaySaveChatFolder: false,
  releaseSaveChatSession: undefined as (() => void) | undefined,
  releaseSaveChatFolder: undefined as (() => void) | undefined,
}));

vi.mock("../../../src/shared/storage/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared/storage/repositories")>();

  return {
    ...actual,
    saveChatSession: vi.fn((...args: Parameters<typeof actual.saveChatSession>) => {
      if (repositoryMockState.failSaveChatSession) {
        throw new Error("IndexedDB 写入失败");
      }

      if (repositoryMockState.delaySaveChatSession) {
        repositoryMockState.delaySaveChatSession = false;
        return new Promise<void>((resolve, reject) => {
          repositoryMockState.releaseSaveChatSession = () => {
            actual.saveChatSession(...args).then(resolve, reject);
          };
        });
      }

      return actual.saveChatSession(...args);
    }),
    saveChatFolder: vi.fn((...args: Parameters<typeof actual.saveChatFolder>) => {
      if (repositoryMockState.failSaveChatFolder) {
        throw new Error("IndexedDB 写入失败");
      }

      if (repositoryMockState.delaySaveChatFolder) {
        repositoryMockState.delaySaveChatFolder = false;
        return new Promise<void>((resolve, reject) => {
          repositoryMockState.releaseSaveChatFolder = () => {
            actual.saveChatFolder(...args).then(resolve, reject);
          };
        });
      }

      return actual.saveChatFolder(...args);
    }),
  };
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

describe("appStore", () => {
  afterEach(async () => {
    repositoryMockState.failSaveChatSession = false;
    repositoryMockState.failSaveChatFolder = false;
    repositoryMockState.delaySaveChatSession = false;
    repositoryMockState.delaySaveChatFolder = false;
    repositoryMockState.releaseSaveChatSession = undefined;
    repositoryMockState.releaseSaveChatFolder = undefined;
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("当前页上下文消息没有返回值时不会读取 undefined.ok", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    });

    await useAppStore.getState().refreshPageContext();

    expect(useAppStore.getState().pageContext).toMatchObject({
      loading: false,
      error: "提取当前页面失败",
    });
  });

  it("使用用户指定的模型请求 AI 生成 URL 正则候选", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/news/123?from=home",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify([
                "https://example\\.com/news/123",
                "https://example\\.com/news/\\d+",
                "https://example\\.com/news/.*",
                "https://example\\.com/.*",
                "https://.*",
              ]),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    const result = await useAppStore.getState().generateUrlPatterns("model-1");

    expect(result).toEqual({
      ok: true,
      patterns: [
        "https://example\\.com/news/123",
        "https://example\\.com/news/\\d+",
        "https://example\\.com/news/.*",
        "https://example\\.com/.*",
        "https://.*",
      ],
    });
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "extractionRule.getCurrentTabUrl",
        debugRequestId: expect.stringMatching(/^url-pattern-/),
      },
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("兼容 callback 形态的当前标签页 URL 响应", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({
        ok: true,
        url: "https://example.com/article",
      });
      return undefined;
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(["https://example\\.com/.*"]),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    const result = await useAppStore.getState().generateUrlPatterns("model-1");

    expect(result).toEqual({
      ok: true,
      patterns: ["https://example\\.com/.*"],
    });
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "extractionRule.getCurrentTabUrl",
        debugRequestId: expect.stringMatching(/^url-pattern-/),
      },
      expect.any(Function),
    );
  });

  it("发送聊天时保存用户消息和 AI 回复，并提交当前会话全部消息", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
          matchedRuleId: "rule-1",
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "AI 回复",
        thinking: "思考内容",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    await useAppStore.getState().sendChatMessage("第一问");
    await useAppStore.getState().sendChatMessage("第二问");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(state.chatSessions).toHaveLength(1);
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "AI 回复", "第二问", "AI 回复"]);
    expect(activeSession?.messages[1].thinking).toBe("思考内容");
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "chat.send",
        stream: false,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "第一问" }),
          expect.objectContaining({ role: "assistant", content: "AI 回复" }),
          expect.objectContaining({ role: "user", content: "第二问" }),
        ]),
      }),
      expect.any(Function),
    );
  });

  it("提取模式切换后刷新页面上下文时传递 all 模式", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/article",
      text: "<html><body>页面</body></html>",
      truncated: false,
      usedFallback: true,
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    useAppStore.getState().setContextMode("all");
    await useAppStore.getState().refreshPageContext();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pageContext.extract",
        extractMode: "all",
      }),
      expect.any(Function),
    );
  });

  it("历史会话支持新建、重命名、归档和删除确认", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();

    await useAppStore.getState().renameChatSession(session.id, "新标题");
    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.title).toBe("新标题");

    await useAppStore.getState().archiveChatSession(session.id);
    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.archived).toBe(true);

    useAppStore.getState().requestDeleteChatSession(session.id);
    expect(useAppStore.getState().pendingDeleteSessionId).toBe(session.id);
    await useAppStore.getState().confirmDeleteChatSession(session.id);
    expect(useAppStore.getState().chatSessions.some((item) => item.id === session.id)).toBe(false);
  });

  it("可以重命名聊天文件夹", async () => {
    const folder = await useAppStore.getState().createChatFolder("旧文件夹");

    await useAppStore.getState().renameChatFolder(folder.id, " 新文件夹 ");

    expect(useAppStore.getState().chatFolders).toEqual([
      {
        ...folder,
        name: "新文件夹",
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it("文件夹重命名为空时保持原名称", async () => {
    const folder = await useAppStore.getState().createChatFolder("旧文件夹");

    await useAppStore.getState().renameChatFolder(folder.id, "   ");

    expect(useAppStore.getState().chatFolders).toEqual([folder]);
  });

  it("文件夹重命名保存失败时记录失败", async () => {
    const folder = await useAppStore.getState().createChatFolder("旧文件夹");

    repositoryMockState.failSaveChatFolder = true;
    await useAppStore.getState().renameChatFolder(folder.id, "新文件夹");

    expect(useAppStore.getState().chatFolders).toEqual([folder]);
    expect(useAppStore.getState().failure?.message).toBe("文件夹保存失败，请重试");
  });

  it("文件夹重命名保存等待期间不会覆盖同一文件夹其他字段", async () => {
    const folder = await useAppStore.getState().createChatFolder("旧文件夹");

    repositoryMockState.delaySaveChatFolder = true;
    const renamePromise = useAppStore.getState().renameChatFolder(folder.id, "新文件夹");
    await vi.waitFor(() => {
      expect(repositoryMockState.releaseSaveChatFolder).toBeTypeOf("function");
    });
    useAppStore.setState((state) => ({
      chatFolders: state.chatFolders.map((item) => (item.id === folder.id ? { ...item, sortOrder: 999 } : item)),
    }));
    repositoryMockState.releaseSaveChatFolder?.();
    await renamePromise;

    expect(useAppStore.getState().chatFolders).toEqual([
      {
        ...folder,
        name: "新文件夹",
        sortOrder: 999,
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it("可以把会话移动到指定文件夹再移回默认文件夹", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();
    const folder = await useAppStore.getState().createChatFolder("资料夹");

    useAppStore.getState().requestDeleteChatSession(session.id);
    await useAppStore.getState().moveChatSessionToFolder(session.id, folder.id);

    const movedSession = useAppStore.getState().chatSessions.find((item) => item.id === session.id);
    expect(movedSession).toEqual({
      ...session,
      folderId: folder.id,
      updatedAt: expect.any(Number),
    });
    expect(useAppStore.getState().pendingDeleteSessionId).toBeUndefined();

    await useAppStore.getState().moveChatSessionToFolder(session.id, undefined);

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual({
      ...movedSession,
      folderId: undefined,
      updatedAt: expect.any(Number),
    });

    useAppStore.getState().reset();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.folderId).toBeUndefined();
  });

  it("移动会话到不存在文件夹时不改变会话", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();

    await useAppStore.getState().moveChatSessionToFolder(session.id, "folder-missing");

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual(session);
  });

  it("归档会话不被移动", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();
    const folder = await useAppStore.getState().createChatFolder("资料夹");
    await useAppStore.getState().archiveChatSession(session.id);
    const archivedSession = useAppStore.getState().chatSessions.find((item) => item.id === session.id);

    await useAppStore.getState().moveChatSessionToFolder(session.id, folder.id);

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual(archivedSession);
  });

  it("会话移动保存失败时记录失败", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();
    const folder = await useAppStore.getState().createChatFolder("资料夹");

    repositoryMockState.failSaveChatSession = true;
    await useAppStore.getState().moveChatSessionToFolder(session.id, folder.id);

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual(session);
    expect(useAppStore.getState().failure?.message).toBe("会话移动失败，请重试");
  });

  it("会话移动保存等待期间不会覆盖同一会话其他字段", async () => {
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();
    const folder = await useAppStore.getState().createChatFolder("资料夹");
    const message: ChatMessage = {
      id: "message-concurrent",
      role: "user",
      content: "并发消息",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "你是网页助手",
      contextPrompt: "页面内容",
      contextMode: "text",
    };

    repositoryMockState.delaySaveChatSession = true;
    const movePromise = useAppStore.getState().moveChatSessionToFolder(session.id, folder.id);
    await vi.waitFor(() => {
      expect(repositoryMockState.releaseSaveChatSession).toBeTypeOf("function");
    });
    useAppStore.setState((state) => ({
      chatSessions: state.chatSessions.map((item) =>
        item.id === session.id ? { ...item, title: "并发标题", messages: [message] } : item,
      ),
    }));
    repositoryMockState.releaseSaveChatSession?.();
    await movePromise;

    expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual({
      ...session,
      title: "并发标题",
      folderId: folder.id,
      updatedAt: expect.any(Number),
      messages: [message],
    });
  });

  it("聊天发送没有返回响应时恢复发送状态并记录失败", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      callback(undefined);
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    await useAppStore.getState().sendChatMessage("第一问");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(state.sending).toBe(false);
    expect(state.failure?.message).toBe("模型请求失败，请重试");
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问"]);
  });

  it("聊天消息保存失败时恢复发送状态并记录中文失败", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "AI 回复",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    repositoryMockState.failSaveChatSession = true;
    await useAppStore.getState().sendChatMessage("第一问");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(state.sending).toBe(false);
    expect(state.failure?.message).toBe("消息保存失败，请重试");
    expect(activeSession?.messages.some((message) => message.role === "assistant")).not.toBe(true);
  });

  it("快速连续发送时只发起一次模型请求且保留第一条用户消息", async () => {
    const provider = createProvider();
    const model = createModel();
    const resolveChatResponses: Array<(response: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      return new Promise((resolve) => {
        resolveChatResponses.push((response) => {
          callback(response);
          resolve(response);
        });
      });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    const secondSend = useAppStore.getState().sendChatMessage("第二问");
    await vi.waitFor(() => {
      expect(resolveChatResponses.length).toBeGreaterThan(0);
    });
    resolveChatResponses.forEach((resolveChatResponse) => resolveChatResponse({ ok: true, content: "AI 回复" }));
    await Promise.all([firstSend, secondSend]);

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(sendMessage.mock.calls.filter(([message]) => (message as { type: string }).type === "chat.send")).toHaveLength(1);
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "AI 回复"]);
  });

  it("发送聊天时若会话已删除，响应完成后不会复活会话", async () => {
    const provider = createProvider();
    const model = createModel();
    const resolveChatResponses: Array<(response: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      return new Promise((resolve) => {
        resolveChatResponses.push((response) => {
          callback(response);
          resolve(response);
        });
      });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(resolveChatResponses).toHaveLength(1);
    });

    const activeSessionId = useAppStore.getState().activeSessionId;
    await useAppStore.getState().confirmDeleteChatSession(activeSessionId);
    resolveChatResponses[0]({ ok: true, content: "AI 回复" });
    await sendPromise;

    expect(useAppStore.getState().chatSessions.some((session) => session.id === activeSessionId)).toBe(false);
    await expect(getChatSession(activeSessionId)).resolves.toBeUndefined();
  });

  it("发送聊天期间修改会话属性时，AI 回复不会覆盖最新标题和文件夹", async () => {
    const provider = createProvider();
    const model = createModel();
    const resolveChatResponses: Array<(response: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      return new Promise((resolve) => {
        resolveChatResponses.push((response) => {
          callback(response);
          resolve(response);
        });
      });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    const folder = await useAppStore.getState().createChatFolder("资料夹");

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(resolveChatResponses).toHaveLength(1);
    });

    const activeSessionId = useAppStore.getState().activeSessionId;
    await useAppStore.getState().renameChatSession(activeSessionId, "最新标题");
    await useAppStore.getState().moveChatSessionToFolder(activeSessionId, folder.id);
    resolveChatResponses[0]({ ok: true, content: "AI 回复" });
    await sendPromise;

    const session = useAppStore.getState().chatSessions.find((item) => item.id === activeSessionId);
    expect(session).toMatchObject({
      title: "最新标题",
      folderId: folder.id,
      messages: [
        expect.objectContaining({ role: "user", content: "第一问" }),
        expect.objectContaining({ role: "assistant", content: "AI 回复" }),
      ],
    });
    await expect(getChatSession(activeSessionId)).resolves.toMatchObject({
      title: "最新标题",
      folderId: folder.id,
    });
  });

  it("发送聊天期间归档会话时，AI 回复不会取消归档状态", async () => {
    const provider = createProvider();
    const model = createModel();
    const resolveChatResponses: Array<(response: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          text: "页面内容",
          truncated: false,
          usedFallback: false,
        });
        return undefined;
      }

      return new Promise((resolve) => {
        resolveChatResponses.push((response) => {
          callback(response);
          resolve(response);
        });
      });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(resolveChatResponses).toHaveLength(1);
    });

    const activeSessionId = useAppStore.getState().activeSessionId;
    await useAppStore.getState().archiveChatSession(activeSessionId);
    resolveChatResponses[0]({ ok: true, content: "AI 回复" });
    await sendPromise;

    const session = useAppStore.getState().chatSessions.find((item) => item.id === activeSessionId);
    expect(session).toMatchObject({
      archived: true,
      messages: [
        expect.objectContaining({ role: "user", content: "第一问" }),
        expect.objectContaining({ role: "assistant", content: "AI 回复" }),
      ],
    });
    await expect(getChatSession(activeSessionId)).resolves.toMatchObject({
      archived: true,
    });
  });

  it("提取模式切换后内部刷新使用 all 模式并写入页面上下文", async () => {
    const sendMessage = vi.fn((message: { type: string; extractMode?: string }, callback: (response: unknown) => void) => {
      callback({
        ok: true,
        url: "https://example.com/article",
        text: message.extractMode === "all" ? "<html><body>页面</body></html>" : "页面",
        truncated: false,
        usedFallback: message.extractMode === "all",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    useAppStore.getState().setContextMode("all");

    await vi.waitFor(() => {
      expect(useAppStore.getState().pageContext.loading).toBe(false);
      expect(useAppStore.getState().pageContext.extractMode).toBe("all");
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pageContext.extract",
        extractMode: "all",
      }),
      expect.any(Function),
    );
  });

  it("较早的慢速上下文刷新完成后不会覆盖较新的模式结果", async () => {
    let resolveTextResponse: ((response: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; extractMode?: string }, callback: (response: unknown) => void) => {
      if (message.extractMode === "text") {
        return new Promise((resolve) => {
          resolveTextResponse = (response) => {
            callback(response);
            resolve(response);
          };
        });
      }

      callback({
        ok: true,
        url: "https://example.com/article",
        text: "<html><body>新页面</body></html>",
        truncated: false,
        usedFallback: true,
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    const textRefresh = useAppStore.getState().refreshPageContext();
    useAppStore.getState().setContextMode("all");
    await vi.waitFor(() => {
      expect(useAppStore.getState().pageContext.extractMode).toBe("all");
      expect(useAppStore.getState().pageContext.text).toBe("<html><body>新页面</body></html>");
    });

    resolveTextResponse?.({
      ok: true,
      url: "https://example.com/article",
      text: "旧页面",
      truncated: false,
      usedFallback: false,
    });
    await textRefresh;

    expect(useAppStore.getState().pageContext).toMatchObject({
      text: "<html><body>新页面</body></html>",
      extractMode: "all",
      usedFallback: true,
    });
  });
});
