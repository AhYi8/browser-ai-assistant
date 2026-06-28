import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { AUTOMATION_PLAYBOOK_SETTINGS_KEY } from "../../../src/shared/automationPlaybooks";
import {
  clearDatabase,
  getAppSetting,
  getChatSession,
  getPromptTemplates,
  getProviderModels,
  saveAppSetting,
  saveChatFolder,
  saveChatSession,
  saveModelProvider,
  savePromptTemplate,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import {
  SYNC_ENCRYPTION_SECRET_KEY,
  SYNC_S3_SECRET_KEY,
  SYNC_WEBDAV_PASSWORD_KEY,
} from "../../../src/shared/sync/settings";
import type { ChatFolder, ChatMessage, ChatPromptInvocation, ModelProvider, NetworkRequestDetail, PromptTemplate, ProviderModel } from "../../../src/shared/types";

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

describe("appStore 网络搜索", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("Tavily 工具结果会保存到 AI 消息附件并在后续追问注入历史搜索结果", async () => {
    const provider = createProvider();
    const model = createModel();
    let chatSendCount = 0;
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "chat.send") {
        chatSendCount += 1;
        callback(
          chatSendCount === 1
            ? {
                ok: true,
                content: "AI 搜索回复",
                toolAttachments: [
                  {
                    id: "tool-attachment-search",
                    kind: "web-search",
                    title: "网络搜索结果",
                    summary: "搜索问题：Tavily API 是什么",
                    provider: "tavily",
                    query: "Tavily API 是什么",
                    answer: "Tavily 是搜索 API。",
                    results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
                    createdAt: 1,
                    redacted: false,
                    truncated: false,
                  },
                ],
              }
            : { ok: true, content: "后续回复" },
        );
        return undefined;
      }

      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
      },
    }));

    await useAppStore.getState().sendChatMessage("Tavily API 是什么");
    await useAppStore.getState().sendChatMessage("继续");

    const chatRequests = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[]; enabledToolIds?: string[]; toolChoice?: string; tavily?: unknown })
      .filter((message) => message.type === "chat.send");
    expect(chatRequests[0]).toMatchObject({
      enabledToolIds: ["web_search.tavily"],
      toolChoice: "auto",
      tavily: {
        includeAnswer: "basic",
        includeRawContent: false,
        maxResults: 5,
      },
    });
    expect(chatRequests[0].messages?.at(-1)?.content).not.toContain("网络搜索上下文：");
    expect(useAppStore.getState().chatSessions[0].messages[1].toolAttachments).toEqual([
      expect.objectContaining({
        kind: "web-search",
        query: "Tavily API 是什么",
      }),
    ]);
    expect(chatRequests[1].messages?.some((message) => message.content.includes("后续追问需要继续参考以下历史网络搜索结果："))).toBe(true);
    expect(chatRequests[1].messages?.some((message) => message.content.includes("Tavily Docs"))).toBe(true);
  });

  it("任务策略设置会通过 appSettings 加载、归一化并保存", async () => {
    await saveAppSetting({
      key: AUTOMATION_PLAYBOOK_SETTINGS_KEY,
      value: { disabledPlaybookIds: ["page_reading", "missing", "network_api_analysis"] },
      updatedAt: 1,
    });

    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().automationPlaybookSettings).toEqual({
      disabledPlaybookIds: ["page_reading", "network_api_analysis"],
    });

    await useAppStore.getState().updateAutomationPlaybookSettings({
      disabledPlaybookIds: ["source_runtime_analysis"],
    });

    expect(await getAppSetting(AUTOMATION_PLAYBOOK_SETTINGS_KEY)).toEqual({
      disabledPlaybookIds: ["source_runtime_analysis"],
    });
  });

  it("全局 Tavily 参数会随 chat.send 传给 background 工具执行", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: "AI 回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
      },
      webSearchSettings: {
        ...state.webSearchSettings,
        tavily: {
          ...state.webSearchSettings.tavily,
          includeAnswer: "basic",
          includeRawContent: false,
          maxResults: 5,
        },
      },
    }));
    await useAppStore.getState().sendChatMessage("Tavily 参数覆盖");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; tavily?: unknown })
      .find((message) => message.type === "chat.send");
    expect(chatRequest).toMatchObject({
      tavily: {
        includeAnswer: "basic",
        includeRawContent: false,
        maxResults: 5,
      },
    });
  });

  it("聊天请求会携带提取规则供浏览器内容提取工具复用", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: "AI 回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.setState((state) => ({
      extractionRules: [{
        id: "rule-main",
        alias: "正文",
        urlPattern: "https://example\\.com/.*",
        selectorsText: "main\n//*[@id='content']",
        sortOrder: 10,
        createdAt: 1,
        updatedAt: 1,
      }],
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["browser.extract_content"],
      },
      browserControlEnabled: true,
    }));

    await useAppStore.getState().sendChatMessage("提取当前页面正文");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; extractionRules?: unknown; messages?: Array<{ content: string }> })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.extractionRules).toEqual([
      expect.objectContaining({
        id: "rule-main",
        selectorsText: "main\n//*[@id='content']",
      }),
    ]);
    expect(chatRequest?.messages?.some((message) => message.content.includes("rule-main"))).toBe(false);
  });

  it("普通模式默认暴露受限 runtime 工具，受控增强模式额外暴露边界确认和重放沙箱", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: "AI 回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: [
          "web_search.tavily",
          "browser.take_snapshot",
          "browser.click",
          "runtime.inspect_globals",
          "boundary.request_user_choice",
          "replay.prepare_request",
          "full_access.execute_script",
        ],
      },
      browserControlEnabled: false,
      browserAutomationMode: "normal_restricted",
    }));

    await useAppStore.getState().sendChatMessage("未开启浏览器控制");
    useAppStore.setState({ browserControlEnabled: true });
    await useAppStore.getState().sendChatMessage("已开启浏览器控制");
    useAppStore.setState({ browserAutomationMode: "controlled_enhanced" });
    await useAppStore.getState().sendChatMessage("已开启受控增强");
    useAppStore.setState({ browserAutomationMode: "full_access" });
    await useAppStore.getState().sendChatMessage("已开启完全访问");

    const chatRequests = sendMessage.mock.calls
      .map(([message]) => message as { type: string; enabledToolIds?: string[] })
      .filter((message) => message.type === "chat.send");
    expect(chatRequests[0].enabledToolIds).toEqual(["web_search.tavily"]);
    expect(chatRequests[1].enabledToolIds).toEqual([
      "web_search.tavily",
      "browser.take_snapshot",
      "browser.click",
      "runtime.inspect_globals",
    ]);
    expect(chatRequests[2].enabledToolIds).toEqual([
      ...chatRequests[1].enabledToolIds!,
      "boundary.request_user_choice",
      "replay.prepare_request",
    ]);
    expect(chatRequests[3].enabledToolIds).toEqual([
      ...chatRequests[1].enabledToolIds!,
      "full_access.execute_script",
    ]);
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

function createTitleModel(): ProviderModel {
  return {
    ...createModel(),
    id: "model-title",
    displayName: "标题模型",
    modelId: "gpt-title",
    isTitleModel: false,
  };
}

function createPromptTemplate(partial: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "prompt-1",
    title: "风险审查",
    content: "从安全、隐私和可维护性三个角度审查。",
    sortOrder: 10,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createChatMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "消息内容",
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

function createNetworkDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: "req-1",
    url: "https://api.example.com/login?token=secret&safe=1",
    method: "POST",
    status: 500,
    statusText: "Internal Server Error",
    mimeType: "application/json",
    resourceType: "xhr",
    durationMs: 130,
    requestHeaders: [
      { name: "Authorization", value: "Bearer secret" },
      { name: "Content-Type", value: "application/json" },
    ],
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    requestBody: '{"password":"123456","name":"张三"}',
    responseBody: '{"error":"用户名或密码错误","access_token":"secret"}',
    truncated: false,
    redacted: false,
    ...partial,
  };
}

function setStaleContextTabState(): void {
  useAppStore.setState({
    contextTabs: [
      {
        tabId: 7,
        title: "旧标签页",
        url: "https://example.com/old",
        active: true,
        selected: true,
      },
    ],
    contextTabsLoading: true,
    contextTabsError: "旧标签页列表错误",
  });
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
    vi.restoreAllMocks();
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

  it("可以加载、保存、校验和排序 Prompt 模板", async () => {
    await savePromptTemplate(createPromptTemplate({ id: "prompt-existing", title: "已有提示词", sortOrder: 20 }));

    await useAppStore.getState().loadPromptTemplates();

    expect(useAppStore.getState().promptTemplates.map((prompt) => prompt.title)).toEqual(["已有提示词"]);

    const invalidResult = await useAppStore.getState().savePromptTemplateDraft(undefined, {
      title: "  ",
      content: "内容",
    });
    expect(invalidResult).toEqual({ ok: false, message: "提示词标题不能为空" });

    const createdResult = await useAppStore.getState().savePromptTemplateDraft(undefined, {
      title: " 新提示词 ",
      content: " 输出行动清单 ",
    });
    expect(createdResult).toMatchObject({
      ok: true,
      prompt: expect.objectContaining({
        title: "新提示词",
        content: "输出行动清单",
      }),
    });

    await useAppStore.getState().reorderPromptTemplates([createdResult.ok ? createdResult.prompt.id : "", "prompt-existing"]);

    expect(useAppStore.getState().promptTemplates.map((prompt) => prompt.title)).toEqual(["新提示词", "已有提示词"]);
    expect((await getPromptTemplates()).map((prompt) => prompt.title)).toEqual(["新提示词", "已有提示词"]);
  });

  it("可以加载和保存同步设置，开启同步不会自动开启自动同步", async () => {
    await useAppStore.getState().loadSyncSettings();

    expect(useAppStore.getState().syncSettings).toMatchObject({
      syncEnabled: false,
      autoSyncEnabled: false,
      provider: "chrome_sync",
    });

    await useAppStore.getState().updateSyncSettings({ syncEnabled: true });

    expect(useAppStore.getState().syncSettings.syncEnabled).toBe(true);
    expect(useAppStore.getState().syncSettings.autoSyncEnabled).toBe(false);
  });

  it("修改本地加密密钥且同步已开启时不会立即触发备份", async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: true, message: "备份完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await useAppStore.getState().updateSyncSettings({ syncEnabled: true, backupPrefix: "work" });

    await useAppStore.getState().updateSyncSecret("encryptionSecret", "new-secret");

    expect(useAppStore.getState().syncSecrets.encryptionSecret).toBe("new-secret");
    expect(sendMessage).not.toHaveBeenCalledWith({ type: "sync.backupNow" }, expect.any(Function));
  });

  it("手动备份才使用当前本地加密密钥触发同步", async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: true, message: "备份完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await useAppStore.getState().updateSyncSettings({ syncEnabled: true, backupPrefix: "work" });
    await useAppStore.getState().updateSyncSecret("encryptionSecret", "new-secret");
    await useAppStore.getState().backupNow();

    expect(useAppStore.getState().syncSecrets.encryptionSecret).toBe("new-secret");
    expect(sendMessage).toHaveBeenCalledWith({ type: "sync.backupNow" }, expect.any(Function));
    expect(useAppStore.getState().syncOperation).toEqual({ loading: false, message: "备份完成" });
  });

  it("可以加载远程备份列表并按指定备份恢复", async () => {
    const sendMessage = vi.fn((message: { type: string; backupId?: string }, callback: (response: unknown) => void) => {
      if (message.type === "sync.listRemoteBackups") {
        callback({
          ok: true,
          backups: [
            {
              id: "browserAiAssistantBackup:home:1",
              prefix: "home",
              createdAt: 1,
              provider: "chrome_sync",
              encrypted: false,
            },
          ],
        });
        return undefined;
      }

      callback({ ok: true, message: "恢复完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveAppSetting({ key: SYNC_ENCRYPTION_SECRET_KEY, value: "local-secret", updatedAt: 1 });

    await useAppStore.getState().loadRemoteBackups();
    await useAppStore.getState().restoreNow("browserAiAssistantBackup:home:1");

    expect(useAppStore.getState().remoteBackups).toEqual([
      {
        id: "browserAiAssistantBackup:home:1",
        prefix: "home",
        createdAt: 1,
        provider: "chrome_sync",
        encrypted: false,
      },
    ]);
    expect(sendMessage).toHaveBeenCalledWith({ type: "sync.restoreNow", backupId: "browserAiAssistantBackup:home:1" }, expect.any(Function));
    expect(useAppStore.getState().syncSecrets.encryptionSecret).toBe("local-secret");
    expect(useAppStore.getState().syncOperation).toEqual({ loading: false, message: "恢复完成" });
  });

  it("恢复备份后重新加载本地同步密钥和远程凭据", async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: true, message: "恢复完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveAppSetting({ key: SYNC_ENCRYPTION_SECRET_KEY, value: "local-secret", updatedAt: 1 });
    await saveAppSetting({ key: SYNC_WEBDAV_PASSWORD_KEY, value: "webdav-password", updatedAt: 1 });
    await saveAppSetting({ key: SYNC_S3_SECRET_KEY, value: "s3-secret", updatedAt: 1 });

    await useAppStore.getState().restoreNow("browserAiAssistantBackup:work:1");

    expect(useAppStore.getState().syncSecrets).toMatchObject({
      encryptionSecret: "local-secret",
      webDavPassword: "webdav-password",
      s3SecretKey: "s3-secret",
    });
  });

  it("刷新页面上下文时请求完整内容，等待发送前再决定是否裁剪", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/article",
      text: "完整页面内容",
      truncated: false,
      usedFallback: true,
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await useAppStore.getState().refreshPageContext();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pageContext.extract",
        maxLength: undefined,
      }),
      expect.any(Function),
    );
    expect(useAppStore.getState().pageContext.text).toBe("完整页面内容");
    expect(useAppStore.getState().pageContext.truncated).toBe(false);
  });

  it("选择多个标签页后批量提取并按标签页顺序合并页面上下文", async () => {
    const sendMessage = vi.fn((message: { type: string; tabId?: number; extractMode?: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.listTabs") {
        callback({
          ok: true,
          tabs: [
            { tabId: 7, title: "文章页", url: "https://example.com/article", active: true },
            { tabId: 9, title: "资料页", url: "https://docs.example.com/guide", active: false },
          ],
        });
        return undefined;
      }

      if (message.type === "pageContext.extract" && message.tabId === 7) {
        callback({
          ok: true,
          url: "https://example.com/article",
          title: "文章页",
          text: "文章正文",
          truncated: false,
          usedFallback: false,
          matchedRuleId: "rule-1",
        });
        return undefined;
      }

      if (message.type === "pageContext.extract" && message.tabId === 9) {
        callback({
          ok: false,
          message: "当前页面无法注入内容脚本",
        });
        return undefined;
      }

      callback({ ok: false, message: "未知请求" });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await useAppStore.getState().loadContextTabs();
    useAppStore.getState().toggleContextTabSelection(9);
    await useAppStore.getState().refreshPageContext();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pageContext.extract", tabId: 7, extractMode: "text" }),
      expect.any(Function),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pageContext.extract", tabId: 9, extractMode: "text" }),
      expect.any(Function),
    );
    expect(useAppStore.getState().pageContext.text).toBe("Page title: 文章页\n\nCurrent URL: https://example.com/article\n\nPage content:\n文章正文");
    expect(useAppStore.getState().contextTabs.find((tab) => tab.tabId === 9)?.error).toBe("当前页面无法注入内容脚本");
  });

  it("新会话首问注入页面上下文，后续追问不重复注入", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.listTabs") {
        callback({
          ok: true,
          tabs: [{ tabId: 7, title: "文章页", url: "https://example.com/article", active: true }],
        });
        return undefined;
      }

      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          url: "https://example.com/article",
          title: "文章页",
          text: "页面上下文正文",
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
    await useAppStore.getState().loadContextTabs();
    await useAppStore.getState().refreshPageContext();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");
    await useAppStore.getState().sendChatMessage("第二问");

    const chatRequests = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send");
    expect(chatRequests[0]?.messages?.[0]?.content).toContain("页面上下文正文");
    expect(chatRequests[1]?.messages?.[0]?.content).not.toContain("页面上下文正文");
    expect(chatRequests[1]?.messages?.[0]?.contextPrompt).toBe("");
  });

  it("新建会话时清理过期的标签页选择加载和错误状态", async () => {
    setStaleContextTabState();

    await useAppStore.getState().createChatSession();

    expect(useAppStore.getState().contextTabs).toEqual([]);
    expect(useAppStore.getState().contextTabsLoading).toBe(false);
    expect(useAppStore.getState().contextTabsError).toBeUndefined();
  });

  it("进入隐私模式时清理过期的标签页选择加载和错误状态", async () => {
    setStaleContextTabState();

    await useAppStore.getState().enterPrivateMode();

    expect(useAppStore.getState().contextTabs).toEqual([]);
    expect(useAppStore.getState().contextTabsLoading).toBe(false);
    expect(useAppStore.getState().contextTabsError).toBeUndefined();
  });

  it("切换到空会话时清理过期的标签页选择加载和错误状态", async () => {
    const emptySession = await useAppStore.getState().createChatSession();
    const sessionWithMessages = {
      id: "session-with-messages",
      title: "已有会话",
      archived: false,
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 2,
      messages: [createChatMessage({ role: "user", content: "已有消息" })],
    };
    await saveChatSession(sessionWithMessages);
    await useAppStore.getState().loadChatData();
    useAppStore.getState().selectChatSession("session-with-messages");
    setStaleContextTabState();

    useAppStore.getState().selectChatSession(emptySession.id);

    expect(useAppStore.getState().activeSessionId).toBe(emptySession.id);
    expect(useAppStore.getState().contextTabs).toEqual([]);
    expect(useAppStore.getState().contextTabsLoading).toBe(false);
    expect(useAppStore.getState().contextTabsError).toBeUndefined();
  });

  it("删除会话后落到空会话时清理过期的标签页选择加载和错误状态", async () => {
    const emptySession = await useAppStore.getState().createChatSession();
    const sessionWithMessages = {
      id: "session-with-messages",
      title: "已有会话",
      archived: false,
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 2,
      messages: [createChatMessage({ role: "user", content: "已有消息" })],
    };
    await saveChatSession(sessionWithMessages);
    await useAppStore.getState().loadChatData();
    useAppStore.getState().selectChatSession("session-with-messages");
    setStaleContextTabState();

    await useAppStore.getState().confirmDeleteChatSession("session-with-messages");

    expect(useAppStore.getState().activeSessionId).toBe(emptySession.id);
    expect(useAppStore.getState().contextTabs).toEqual([]);
    expect(useAppStore.getState().contextTabsLoading).toBe(false);
    expect(useAppStore.getState().contextTabsError).toBeUndefined();
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

  it("可以设置全局唯一的 AI 标题生成模型", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();

    useAppStore.getState().setTitleModel("model-title");

    expect(useAppStore.getState().models).toEqual([
      expect.objectContaining({ id: "model-1", isTitleModel: false }),
      expect.objectContaining({ id: "model-title", isTitleModel: true }),
    ]);

    useAppStore.getState().setTitleModel("");

    expect(useAppStore.getState().models.every((model) => !model.isTitleModel)).toBe(true);
  });

  it("可以保存模型是否支持视觉理解并在重新加载后保留", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    useAppStore.getState().updateModel("model-1", { supportsVision: true });

    await vi.waitFor(async () => {
      const [savedModel] = await getProviderModels("provider-1");
      expect(savedModel.supportsVision).toBe(true);
    });

    useAppStore.getState().reset();
    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().models.find((item) => item.id === "model-1")?.supportsVision).toBe(true);
  });

  it("可以保存默认对话模型并在新建对话时选中该模型", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(defaultModel);
    await useAppStore.getState().loadChannelConfig();

    await useAppStore.getState().setDefaultChatModel("model-default");
    useAppStore.getState().selectModel("model-1");

    await useAppStore.getState().createChatSession();

    expect(useAppStore.getState().defaultChatModelId).toBe("model-default");
    expect(useAppStore.getState().selectedModelId).toBe("model-default");
  });

  it("有未发送草稿时新建对话保持当前对话模型不变", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(defaultModel);
    await useAppStore.getState().loadChannelConfig();

    await useAppStore.getState().setDefaultChatModel("model-default");
    useAppStore.getState().selectModel("model-1");

    await useAppStore.getState().createChatSession({ preserveSelectedModel: true });

    expect(useAppStore.getState().defaultChatModelId).toBe("model-default");
    expect(useAppStore.getState().selectedModelId).toBe("model-1");
  });

  it("默认对话模型不存在时新建对话回退到第一个可用模型", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    await useAppStore.getState().setDefaultChatModel("missing-model");
    useAppStore.getState().selectModel("");

    await useAppStore.getState().createChatSession();

    expect(useAppStore.getState().selectedModelId).toBe("model-1");
  });

  it("未配置默认对话模型时加载渠道不把第一个模型写成显式默认值", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().defaultChatModelId).toBe("");
    expect(useAppStore.getState().selectedModelId).toBe("model-1");
  });

  it("删除默认对话模型所属渠道时清空默认对话模型配置", async () => {
    const provider = createProvider();
    const fallbackModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(fallbackModel);
    await saveProviderModel(defaultModel);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().setDefaultChatModel("model-default");

    useAppStore.getState().deleteProvider("provider-1");

    expect(useAppStore.getState().defaultChatModelId).toBe("");
    await vi.waitFor(async () => {
      await expect(getAppSetting<string>("defaultChatModelId")).resolves.toBe("");
    });
  });

  it("删除默认对话模型时清空默认对话模型配置", async () => {
    const provider = createProvider();
    const fallbackModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(fallbackModel);
    await saveProviderModel(defaultModel);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().setDefaultChatModel("model-default");

    useAppStore.getState().deleteModel("model-default");

    expect(useAppStore.getState().defaultChatModelId).toBe("");
    await vi.waitFor(async () => {
      await expect(getAppSetting<string>("defaultChatModelId")).resolves.toBe("");
    });
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
    useAppStore.getState().setStreamMode(false);

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

  it("发送含 Prompt 调用的聊天时保存可见文本并提交展开后的 UserPrompt", async () => {
    const provider = createProvider();
    const model = createModel();
    const promptInvocation: ChatPromptInvocation = {
      promptId: "prompt-risk",
      title: "风险审查",
      contentSnapshot: "从安全、隐私和可维护性三个角度审查。",
    };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      callback({
        ok: true,
        content: message.type === "chat.send" ? "AI 回复" : "",
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
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("请结合页面输出建议", [], [promptInvocation]);

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("已调用提示词：");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("风险审查");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("从安全、隐私和可维护性三个角度审查。");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("用户输入：\n请结合页面输出建议");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(activeSession?.messages[0]).toMatchObject({
      role: "user",
      content: "请结合页面输出建议",
      promptInvocations: [promptInvocation],
    });
  });

  it("发送聊天时将图片附件带入请求并写入用户消息历史", async () => {
    const provider = createProvider();
    const model = { ...createModel(), supportsVision: true };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
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
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("看图说明", [
      {
        id: "image-1",
        name: "截图.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,QUJD",
      },
    ]);

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    const sentUserMessage = chatRequest?.messages?.find((message) => message.role === "user");
    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);

    expect(sentUserMessage?.attachments).toEqual([
      {
        id: "image-1",
        name: "截图.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,QUJD",
      },
    ]);
    expect(activeSession?.messages.find((message) => message.role === "user")?.attachments).toEqual([
      {
        id: "image-1",
        name: "截图.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,QUJD",
      },
    ]);
  });

  it("允许发送纯图片消息并写入用户消息历史", async () => {
    const provider = createProvider();
    const model = { ...createModel(), supportsVision: true };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
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
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("", [
      {
        id: "image-only",
        name: "纯图片.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,QUJD",
      },
    ]);

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    const sentUserMessage = chatRequest?.messages?.find((message) => message.role === "user");
    const activeSession = useAppStore.getState().chatSessions.find((session) => session.id === useAppStore.getState().activeSessionId);

    expect(sentUserMessage?.content).toBe("");
    expect(sentUserMessage?.attachments).toHaveLength(1);
    expect(activeSession?.messages.find((message) => message.role === "user")?.attachments).toHaveLength(1);
  });

  it("默认将页面上下文拼接到请求 system prompt，关闭后不拼接", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "页面上下文正文",
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
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");
    let chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.[0].content).toContain("页面上下文正文");

    useAppStore.getState().setAppendPageContextToSystemPrompt(false);
    await useAppStore.getState().sendChatMessage("第二问");
    chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);
    expect(chatRequest?.messages?.[0].content).not.toContain("页面上下文正文");
    expect(chatRequest?.messages?.[0].contextPrompt).toBe("");
  });

  it("发送聊天时使用全局聊天偏好覆盖模型默认参数", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
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
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        topK: 20,
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: false,
      },
      updatedAt: 2,
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; model?: ProviderModel; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.model).toMatchObject({
      systemPrompt: "全局系统提示",
      temperature: 0.4,
      maxTokens: 2048,
      topK: 20,
    });
    expect(chatRequest?.messages?.[0]).toMatchObject({
      role: "system",
      content: "全局系统提示",
      systemPrompt: "全局系统提示",
    });
    expect(chatRequest?.messages?.[0].content).not.toContain("页面上下文正文");
    expect(useAppStore.getState().appendPageContextToSystemPrompt).toBe(false);
  });

  it("未保存新对话页面上下文偏好时默认注入当前页面上下文", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "页面上下文正文",
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
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        historyDrawerDefaultOpen: true,
      },
      updatedAt: 2,
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.[0].content).toContain("页面上下文正文");
    expect(useAppStore.getState().chatPreferences.injectPageContextByDefault).toBe(true);
    expect(useAppStore.getState().appendPageContextToSystemPrompt).toBe(true);
  });

  it("未保存新对话 HTML 提取偏好时默认使用可见文本", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        historyDrawerDefaultOpen: true,
      },
      updatedAt: 2,
    });

    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().chatPreferences.extractHtmlByDefault).toBe(false);
    expect(useAppStore.getState().contextMode).toBe("text");
    expect(useAppStore.getState().pageContext.extractMode).toBe("text");
  });

  it("聊天偏好旧数据中的非布尔值会回退到默认值", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        historyDrawerDefaultOpen: "false",
        injectPageContextByDefault: "false",
        extractHtmlByDefault: "true",
        browserAutomationMaxToolIterations: "很多",
        toolCallDisplayMode: "unknown",
      },
      updatedAt: 2,
    });

    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().chatPreferences.historyDrawerDefaultOpen).toBe(true);
    expect(useAppStore.getState().chatPreferences.injectPageContextByDefault).toBe(true);
    expect(useAppStore.getState().chatPreferences.extractHtmlByDefault).toBe(false);
    expect(useAppStore.getState().chatPreferences.aiRequestRetryCount).toBe(5);
    expect(useAppStore.getState().chatPreferences.browserAutomationMaxToolIterations).toBe(32);
    expect(useAppStore.getState().chatPreferences.toolCallDisplayMode).toBe("assistant_grouped");
    expect(useAppStore.getState().chatPreferences.showToolCallProcessInAssistantMode).toBe(false);
    expect(useAppStore.getState().browserControlEnabled).toBe(false);
    expect(useAppStore.getState().appendPageContextToSystemPrompt).toBe(true);
    expect(useAppStore.getState().contextMode).toBe("text");
  });

  it("工具调用偏好旧数据缺失或脏数据时默认关闭并过滤非法工具 ID", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        toolCallingEnabled: "true",
        enabledToolIds: ["page.read_context", "browser.take_snapshot", "", "../bad", 123],
      },
      updatedAt: 2,
    });

    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().chatPreferences.toolCallingEnabled).toBe(false);
    expect(useAppStore.getState().chatPreferences.enabledToolIds).toEqual(["page.read_context", "browser.take_snapshot"]);
    expect(useAppStore.getState().chatPreferences.showToolCallProcessInAssistantMode).toBe(false);
  });

  it("可以保存全局工具调用总开关和单工具启用列表", async () => {
    await useAppStore.getState().updateChatPreferences({
      toolCallingEnabled: true,
      enabledToolIds: ["page.read_context"],
    });

    expect(useAppStore.getState().chatPreferences.toolCallingEnabled).toBe(true);
    expect(useAppStore.getState().chatPreferences.enabledToolIds).toEqual(["page.read_context"]);
    expect(await getAppSetting("chatPreferences")).toMatchObject({
      toolCallingEnabled: true,
      enabledToolIds: ["page.read_context"],
    });
  });

  it("会话级工具调用覆盖优先保存到当前会话", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().updateActiveSessionChatPreferences({
      toolCallingEnabled: true,
      enabledToolIds: ["page.read_context"],
    });

    const activeSessionId = useAppStore.getState().activeSessionId;
    const session = await getChatSession(activeSessionId);
    expect(session?.chatPreferenceOverrides).toMatchObject({
      toolCallingEnabled: true,
      enabledToolIds: ["page.read_context"],
    });
  });

  it("发送聊天时携带当前有效的浏览器自动化最大工具轮次", async () => {
    const provider = createProvider();
    const model = createModel();
    let postedMessage: unknown;
    let portMessageListener: ((message: unknown) => void) | undefined;
    const port = {
      postMessage: vi.fn((message: unknown) => {
        postedMessage = message;
      }),
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
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().updateChatPreferences({ browserAutomationMaxToolIterations: 64 });
    await useAppStore.getState().updateActiveSessionChatPreferences({ browserAutomationMaxToolIterations: 12, enabledToolIds: ["browser.click"] });
    useAppStore.setState((state) => ({
      browserControlEnabled: true,
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
      },
    }));

    const sendPromise = useAppStore.getState().sendChatMessage("需要浏览器自动化");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    portMessageListener?.({ type: "complete", content: "AI 回复" });
    await sendPromise;

    expect(postedMessage).toMatchObject({
      type: "chat.stream.start",
      payload: expect.objectContaining({
        browserAutomationMaxToolIterations: 12,
        enabledToolIds: expect.arrayContaining(["browser.click"]),
      }),
    });
  });

  it("保存新对话默认提取 HTML 后直接发送首问使用 all 模式", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string; extractMode?: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: message.extractMode === "all" ? "<html><body>页面</body></html>" : "页面",
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
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        historyDrawerDefaultOpen: true,
        extractHtmlByDefault: true,
      },
      updatedAt: 2,
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pageContext.extract", extractMode: "all" }),
      expect.any(Function),
    );
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.at(-1)?.contextMode).toBe("all");
  });

  it("更新新对话页面上下文偏好后直接发送首问不注入页面上下文", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "页面上下文正文",
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
    await useAppStore.getState().updateChatPreferences({ injectPageContextByDefault: false });
    useAppStore.getState().setStreamMode(false);

    expect(useAppStore.getState().appendPageContextToSystemPrompt).toBe(false);

    await useAppStore.getState().sendChatMessage("第一问");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.[0].content).not.toContain("页面上下文正文");
    expect(chatRequest?.messages?.[0].contextPrompt).toBe("");
  });

  it("当前会话聊天偏好优先于全局聊天偏好", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
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
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局系统提示",
        temperature: 0.4,
        maxTokens: 2048,
        topK: 20,
        historyDrawerDefaultOpen: false,
      },
      updatedAt: 2,
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().updateActiveSessionChatPreferences({
      systemPrompt: "当前会话系统提示",
      temperature: 0.2,
      maxTokens: 512,
      topK: 8,
    });
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; model?: ProviderModel; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.model).toMatchObject({
      systemPrompt: "当前会话系统提示",
      temperature: 0.2,
      maxTokens: 512,
      topK: 8,
    });
  });

  it("未配置 AI 标题生成模型时不会额外发送标题请求", async () => {
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
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    expect(sendMessage.mock.calls.filter(([message]) => (message as { type: string }).type === "chat.send")).toHaveLength(1);
    expect(useAppStore.getState().chatSessions[0]?.title).toBe("第一问");
  });

  it("配置 AI 标题生成模型后首轮发送时并行生成标题", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();
    let resolveMainResponse: (() => void) | undefined;
    let resolveTitleResponse: (() => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; model?: ProviderModel; stream?: boolean }, callback: (response: unknown) => void) => {
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

      if (message.model?.id === "model-title") {
        return new Promise((resolve) => {
          resolveTitleResponse = () => {
            const response = {
              ok: true,
              content: "{\"title\":\"页面摘要讨论\"}",
            };
            callback(response);
            resolve(response);
          };
        });
      }

      return new Promise((resolve) => {
        resolveMainResponse = () => {
          const response = {
            ok: true,
            content: "AI 回复",
          };
          callback(response);
          resolve(response);
        };
      });
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().selectModel("model-1");
    useAppStore.getState().setTitleModel("model-title");
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");

    await vi.waitFor(() => {
      const chatRequests = sendMessage.mock.calls
        .map(([message]) => message as { type: string; model?: ProviderModel })
        .filter((message) => message.type === "chat.send");
      expect(chatRequests).toHaveLength(2);
    });

    const chatRequests = sendMessage.mock.calls
      .map(([message]) => message as { type: string; model?: ProviderModel; stream?: boolean; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send");
    const titleRequest = chatRequests.find((message) => message.model?.id === "model-title");
    expect(chatRequests).toHaveLength(2);
    expect(titleRequest).toMatchObject({
      model: expect.objectContaining({ id: "model-title" }),
      stream: false,
    });
    expect(titleRequest?.messages?.[0].content).toContain("{\"title\":\"标题\"}");
    expect(titleRequest?.messages?.[1].content).toContain("网页上下文：页面内容");
    expect(titleRequest?.messages?.[1].content).toContain("用户消息：第一问");
    expect(titleRequest?.messages?.[1].content).not.toContain("AI 回复");
    expect(useAppStore.getState().chatSessions[0]).toMatchObject({
      title: "第一问",
      titleGenerating: true,
    });

    resolveTitleResponse?.();
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]).toMatchObject({
        title: "页面摘要讨论",
        titleGenerating: false,
      });
    });
    resolveMainResponse?.();
    await sendPromise;

    expect(useAppStore.getState().chatSessions[0]?.title).toBe("页面摘要讨论");
  });

  it("关闭拼接上下文后标题生成请求不包含页面上下文", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();
    const sendMessage = vi.fn((message: { type: string; model?: ProviderModel }, callback: (response: unknown) => void) => {
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
        content: message.model?.id === "model-title" ? "{\"title\":\"页面摘要讨论\"}" : "AI 回复",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().selectModel("model-1");
    useAppStore.getState().setTitleModel("model-title");
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);
    useAppStore.getState().setAppendPageContextToSystemPrompt(false);

    await useAppStore.getState().sendChatMessage("第一问");

    const titleRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; model?: ProviderModel; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .find((message) => message.model?.id === "model-title");
    expect(titleRequest?.messages?.[1].content).toContain("网页上下文：无");
    expect(titleRequest?.messages?.[1].content).not.toContain("页面内容");
  });

  it("标题模型返回非 JSON 时保留默认标题并清除等待态", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();
    const sendMessage = vi.fn((message: { type: string; model?: ProviderModel }, callback: (response: unknown) => void) => {
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
        content: message.model?.id === "model-title" ? "页面摘要讨论" : "AI 回复",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().selectModel("model-1");
    useAppStore.getState().setTitleModel("model-title");
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.getState().setStreamMode(false);

    await useAppStore.getState().sendChatMessage("第一问");

    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.titleGenerating).toBe(false);
    });
    const session = useAppStore.getState().chatSessions[0];
    expect(session?.title).toBe("第一问");
    expect(session?.titleGenerating).toBe(false);
    expect(session?.messages.map((message) => message.content)).toEqual(["第一问", "AI 回复"]);
  });

  it("流式主回复进行中标题生成请求仍使用非流式", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();
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
    const sendMessage = vi.fn((message: { type: string; model?: ProviderModel }, callback: (response: unknown) => void) => {
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
        content: "{\"title\":\"流式标题\"}",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().selectModel("model-1");
    useAppStore.getState().setTitleModel("model-title");
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    let titleRequest: { type: string; model?: ProviderModel; stream?: boolean } | undefined;
    await vi.waitFor(() => {
      titleRequest = sendMessage.mock.calls
        .map(([message]) => message as { type: string; model?: ProviderModel; stream?: boolean })
        .find((message) => message.type === "chat.send" && message.model?.id === "model-title");
      expect(titleRequest).toBeDefined();
    });
    expect(titleRequest).toMatchObject({
      stream: false,
    });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.title).toBe("流式标题");
    });

    portMessageListener?.({ type: "complete", content: "AI 回复" });
    await sendPromise;
  });

  it("默认开启流式响应并通过长连接逐段更新 AI 消息", async () => {
    const provider = createProvider();
    const model = createModel();
    const disconnect = vi.fn();
    let portMessageListener: ((message: unknown) => void) | undefined;
    let postedMessage: unknown;
    const port = {
      postMessage: vi.fn((message: unknown) => {
        postedMessage = message;
      }),
      disconnect,
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    expect(useAppStore.getState().streamMode).toBe(true);
    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["第一问", ""]);
    });

    portMessageListener?.({ type: "chunk", content: "AI " });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["第一问", "AI "]);
    });
    portMessageListener?.({ type: "chunk", content: "回复" });
    portMessageListener?.({ type: "complete", content: "AI 回复", thinking: "思考内容" });
    await sendPromise;

    const activeSession = useAppStore.getState().chatSessions[0];
    expect(postedMessage).toMatchObject({
      type: "chat.stream.start",
      payload: expect.objectContaining({
        stream: true,
      }),
    });
    expect(activeSession.messages.map((message) => message.content)).toEqual(["第一问", "AI 回复"]);
    expect(activeSession.messages[1].thinking).toBe("思考内容");
    expect(disconnect).toHaveBeenCalled();
  });

  it("普通对话每次发送都先创建消息占位", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const sendPromise = useAppStore.getState().sendChatMessage("普通问题");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["普通问题", ""]);
    });

    portMessageListener?.({ type: "complete", content: "普通回答" });
    await sendPromise;

    expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["普通问题", "普通回答"]);
  });

  it("收到 AI 请求重试进度后更新当前 AI 占位消息并在完成后清除", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    portMessageListener?.({ type: "retry:progress", currentRetry: 1, maxRetries: 5 });
    await vi.waitFor(() => {
      const assistantMessage = useAppStore.getState().chatSessions[0]?.messages[1];
      expect(assistantMessage?.content).toBe("");
      expect(assistantMessage?.streaming).toBe(true);
      expect(useAppStore.getState().chatRetryProgressByMessageId[assistantMessage?.id ?? ""]).toEqual({
        currentRetry: 1,
        maxRetries: 5,
      });
    });

    const assistantMessageId = useAppStore.getState().chatSessions[0]?.messages[1]?.id ?? "";
    portMessageListener?.({ type: "retry:progress", currentRetry: 2, maxRetries: 5 });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatRetryProgressByMessageId[assistantMessageId]).toEqual({
        currentRetry: 2,
        maxRetries: 5,
      });
    });

    portMessageListener?.({ type: "complete", content: "AI 回复" });
    await sendPromise;

    expect(useAppStore.getState().chatRetryProgressByMessageId[assistantMessageId]).toBeUndefined();
    expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
      content: "AI 回复",
      streaming: false,
    });
  });

  it("AI 请求重试进度会在错误和用户取消后清除", async () => {
    const provider = createProvider();
    const model = createModel();
    let portMessageListener: ((message: unknown) => void) | undefined;
    let portDisconnectListener: (() => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(() => {
        portDisconnectListener?.();
      }),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          portMessageListener = listener;
        }),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => {
          portDisconnectListener = listener;
        }),
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({ ok: true, url: "https://example.com/article", text: "页面内容", truncated: false, usedFallback: false });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const firstSendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => expect(portMessageListener).toBeTypeOf("function"));
    portMessageListener?.({ type: "retry:progress", currentRetry: 5, maxRetries: 5 });
    const firstAssistantMessageId = await vi.waitFor(() => {
      const messageId = useAppStore.getState().chatSessions[0]?.messages[1]?.id;
      expect(messageId).toBeTruthy();
      return messageId ?? "";
    });
    portMessageListener?.({ type: "error", message: "模型请求失败，请稍后重试" });
    await firstSendPromise;

    expect(useAppStore.getState().chatRetryProgressByMessageId[firstAssistantMessageId]).toBeUndefined();

    const secondSendPromise = useAppStore.getState().sendChatMessage("第二问");
    await vi.waitFor(() => {
      const lastMessage = useAppStore.getState().chatSessions[0]?.messages.at(-1);
      expect(lastMessage?.role).toBe("assistant");
      expect(lastMessage?.streaming).toBe(true);
    });
    portMessageListener?.({ type: "retry:progress", currentRetry: 1, maxRetries: 5 });
    const secondAssistantMessageId = useAppStore.getState().chatSessions[0]?.messages.at(-1)?.id ?? "";
    useAppStore.getState().abortActiveChatTask();
    await secondSendPromise;

    expect(useAppStore.getState().chatRetryProgressByMessageId[secondAssistantMessageId]).toBeUndefined();
  });

  it("切换到新会话后旧会话后台继续生成且新会话可以继续发送", async () => {
    const provider = createProvider();
    const model = createModel();
    const listeners: Array<(message: unknown) => void> = [];
    const ports: Array<{ postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const connect = vi.fn(() => {
      const port = {
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: {
          addListener: vi.fn((listener: (message: unknown) => void) => listeners.push(listener)),
        },
        onDisconnect: {
          addListener: vi.fn(),
        },
      };
      ports.push(port);
      return port;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        connect,
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(1);
    });
    const firstSessionId = useAppStore.getState().activeSessionId;
    expect(useAppStore.getState().chatTasksBySessionId[firstSessionId]?.status).toBe("running");

    const secondSession = await useAppStore.getState().createChatSession();
    expect(useAppStore.getState().activeSessionId).toBe(secondSession.id);
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBeUndefined();
    useAppStore.getState().selectChatSession(firstSessionId);
    expect(useAppStore.getState().activeSessionId).toBe(firstSessionId);
    expect(useAppStore.getState().sending).toBe(true);
    expect(useAppStore.getState().chatTasksBySessionId[firstSessionId]?.status).toBe("running");
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBe(useAppStore.getState().chatTasksBySessionId[firstSessionId]?.id);
    useAppStore.getState().selectChatSession(secondSession.id);
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBeUndefined();
    const secondSend = useAppStore.getState().sendChatMessage("第二问");
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(2);
    });

    listeners[0]?.({ type: "complete", content: "第一答" });
    listeners[1]?.({ type: "complete", content: "第二答" });
    await Promise.all([firstSend, secondSend]);

    const state = useAppStore.getState();
    const firstSession = state.chatSessions.find((session) => session.id === firstSessionId);
    const secondStoredSession = state.chatSessions.find((session) => session.id === secondSession.id);
    expect(firstSession?.messages.map((message) => message.content)).toEqual(["第一问", "第一答"]);
    expect(secondStoredSession?.messages.map((message) => message.content)).toEqual(["第二问", "第二答"]);
    expect(state.chatTasksBySessionId[firstSessionId]?.status).toBe("completed");
    expect(state.chatTasksBySessionId[secondSession.id]?.status).toBe("completed");
    expect(ports[0].disconnect).toHaveBeenCalled();
    expect(ports[1].disconnect).toHaveBeenCalled();
  });

  it("后台会话完成后用户切回该会话会清除完成态已读提示", async () => {
    const provider = createProvider();
    const model = createModel();
    const listeners: Array<(message: unknown) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    const connect = vi.fn(() => ({
      postMessage: vi.fn(),
      disconnect: vi.fn(() => {
        const listener = disconnectListeners.shift();
        listener?.();
      }),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => listeners.push(listener)),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
      },
    }));
    vi.stubGlobal("chrome", {
      runtime: {
        connect,
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    const firstSessionId = useAppStore.getState().activeSessionId;
    const secondSession = await useAppStore.getState().createChatSession();

    listeners[0]?.({ type: "complete", content: "第一答" });
    await firstSend;

    expect(useAppStore.getState().activeSessionId).toBe(secondSession.id);
    expect(useAppStore.getState().chatTasksBySessionId[firstSessionId]?.status).toBe("completed");
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBeUndefined();

    useAppStore.getState().selectChatSession(firstSessionId);
    const completedTaskId = useAppStore.getState().chatTasksBySessionId[firstSessionId]?.id;
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBe(completedTaskId);

    useAppStore.getState().selectChatSession(secondSession.id);
    expect(useAppStore.getState().dismissedChatTaskIdsBySessionId[firstSessionId]).toBe(completedTaskId);
  });

  it("终止当前会话任务时只断开当前会话的长连接", async () => {
    const provider = createProvider();
    const model = createModel();
    const listeners: Array<(message: unknown) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    const ports: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    const connect = vi.fn(() => {
      const portIndex = ports.length;
      const port = {
        postMessage: vi.fn(),
        disconnect: vi.fn(() => {
          disconnectListeners[portIndex]?.();
        }),
        onMessage: {
          addListener: vi.fn((listener: (message: unknown) => void) => listeners.push(listener)),
        },
        onDisconnect: {
          addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
        },
      };
      ports.push(port);
      return port;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        connect,
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const firstSend = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    const firstSessionId = useAppStore.getState().activeSessionId;
    const secondSession = await useAppStore.getState().createChatSession();
    const secondSend = useAppStore.getState().sendChatMessage("第二问");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));

    useAppStore.getState().abortActiveChatTask();
    expect(ports[0].disconnect).not.toHaveBeenCalled();
    expect(ports[1].disconnect).toHaveBeenCalled();
    expect(useAppStore.getState().chatTasksBySessionId[secondSession.id]?.status).toBe("canceled");

    listeners[0]?.({ type: "complete", content: "第一答" });
    await firstSend;
    await secondSend;

    expect(useAppStore.getState().chatTasksBySessionId[firstSessionId]?.status).toBe("completed");
  });

  it("启用 Tavily 工具且打开流式偏好时仍通过长连接发送流式请求", async () => {
    const provider = createProvider();
    const model = createModel();
    let portMessageListener: ((message: unknown) => void) | undefined;
    let postedMessage: unknown;
    const port = {
      postMessage: vi.fn((message: unknown) => {
        postedMessage = message;
      }),
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
    const connect = vi.fn(() => port);
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: true });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        connect,
        sendMessage,
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
      },
    }));

    const sendPromise = useAppStore.getState().sendChatMessage("需要搜索");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["需要搜索"]);
    });

    expect(connect).toHaveBeenCalledWith({ name: "chat.stream" });
    expect(postedMessage).toMatchObject({
      type: "chat.stream.start",
      payload: expect.objectContaining({
        stream: true,
        enabledToolIds: ["web_search.tavily"],
      }),
    });

    portMessageListener?.({ type: "chunk", content: "工具调用后的 " });
    portMessageListener?.({
      type: "complete",
      content: "工具调用后的 AI 回复内容",
      reasoningContent: "DeepSeek 工具调用思考原文",
      toolAttachments: [
        {
          id: "tool-attachment-search",
          kind: "web-search",
          title: "网络搜索结果",
          summary: "搜索问题：需要搜索",
          provider: "tavily",
          query: "需要搜索",
          results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
          createdAt: 1,
          redacted: false,
          truncated: false,
        },
      ],
    });
    await sendPromise;

    const activeSession = useAppStore.getState().chatSessions[0];
    expect(activeSession.messages.map((message) => message.content)).toEqual(["需要搜索", "工具调用后的 AI 回复内容"]);
    expect(activeSession.messages[1].streaming).toBe(false);
    expect(activeSession.messages[1].toolAttachments).toEqual([
      expect.objectContaining({
        kind: "web-search",
        query: "需要搜索",
      }),
    ]);
    expect(activeSession.messages[1].reasoningContent).toBe("DeepSeek 工具调用思考原文");
  });

  it("流式端口返回明确错误时保留 background 错误原因", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const sendPromise = useAppStore.getState().sendChatMessage("需要工具调用");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    portMessageListener?.({ type: "error", message: "模型响应中没有可用内容" });
    await sendPromise;

    const activeSession = useAppStore.getState().chatSessions[0];
    expect(useAppStore.getState().failure?.message).toBe("模型响应中没有可用内容");
    expect(activeSession.messages[1]).toMatchObject({
      role: "assistant",
      content: "模型响应中没有可用内容",
      streaming: false,
    });
  });

  it("工具调用流程仅在最终总结请求开始时创建占位消息", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
      },
    }));

    const sendPromise = useAppStore.getState().sendChatMessage("需要搜索");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["需要搜索"]);
    });

    portMessageListener?.({
      type: "assistant:tool-turn",
      message: {
        id: "tool-turn-1",
        role: "assistant",
        assistantMessageKind: "tool_call_turn",
        content: "需要先调用工具",
        createdAt: 1,
        modelId: model.id,
        endpointType: "openai_chat",
        streamMode: false,
        systemPrompt: "你是网页助手",
        contextPrompt: "页面内容",
        contextMode: "text",
      },
    });

    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["需要搜索", "需要先调用工具"]);
    });
    expect(useAppStore.getState().chatSessions[0]?.messages).toHaveLength(2);

    portMessageListener?.({ type: "assistant:final-start" });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["需要搜索", "需要先调用工具", ""]);
    });

    portMessageListener?.({ type: "chunk", content: "最终回答" });
    portMessageListener?.({ type: "complete", content: "最终回答" });
    await sendPromise;

    const messages = useAppStore.getState().chatSessions[0]?.messages ?? [];
    expect(messages.map((message) => message.content)).toEqual(["需要搜索", "需要先调用工具", "最终回答"]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      assistantMessageKind: "tool_call_turn",
      content: "需要先调用工具",
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: "最终回答",
    });
    expect(messages[2]?.assistantMessageKind).toBeUndefined();
  });

  it("后台会话流式失败不会污染当前会话错误提示", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
          callback({ ok: true });
          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const sendPromise = useAppStore.getState().sendChatMessage("后台问题");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    const firstSessionId = useAppStore.getState().activeSessionId;
    const secondSession = await useAppStore.getState().createChatSession();
    expect(useAppStore.getState().activeSessionId).toBe(secondSession.id);

    portMessageListener?.({ type: "error", message: "后台失败" });
    await sendPromise;

    const state = useAppStore.getState();
    expect(state.activeSessionId).toBe(secondSession.id);
    expect(state.chatTasksBySessionId[firstSessionId]?.status).toBe("failed");
    expect(state.failure).toBeUndefined();
  });

  it("流式响应先逐段更新思考过程，再逐段更新正文", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    portMessageListener?.({ type: "thinking", content: "先" });
    portMessageListener?.({ type: "thinking", content: "分析" });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
        content: "",
        thinking: "先分析",
        streaming: true,
      });
    });

    portMessageListener?.({ type: "chunk", content: "正式" });
    portMessageListener?.({ type: "chunk", content: "回答" });
    portMessageListener?.({ type: "complete", content: "正式回答", thinking: "先分析" });
    await sendPromise;

    expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
      content: "正式回答",
      thinking: "先分析",
      streaming: false,
    });
  });

  it("流式片段落库较慢时完成消息不会被旧片段覆盖", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    portMessageListener?.({ type: "chunk", content: "旧" });
    portMessageListener?.({ type: "complete", content: "最终回复", thinking: "最终思考" });
    await sendPromise;

    const activeSessionId = useAppStore.getState().activeSessionId;
    await expect(getChatSession(activeSessionId)).resolves.toMatchObject({
      messages: [
        expect.objectContaining({ role: "user", content: "第一问" }),
        expect.objectContaining({ role: "assistant", content: "最终回复", thinking: "最终思考" }),
      ],
    });
    expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
      content: "最终回复",
      thinking: "最终思考",
    });
  });

  it("流式连接断开且没有收到任何响应时保留失败气泡且不回退非流式请求", async () => {
    const provider = createProvider();
    const model = createModel();
    let disconnectListener: (() => void) | undefined;
    const port = {
      postMessage: vi.fn(() => {
        disconnectListener?.();
      }),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => {
          disconnectListener = listener;
        }),
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
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
    expect(state.failure?.message).toBe("流式响应异常中断，请重新生成后重试");
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "流式响应异常中断，请重新生成后重试"]);
    expect(activeSession?.messages[1].streaming).toBe(false);
  });

  it("工具进度事件后端口断开时会把占位消息收尾为失败状态", async () => {
    const provider = createProvider();
    const model = createModel();
    let portMessageListener: ((message: unknown) => void) | undefined;
    let disconnectListener: (() => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          portMessageListener = listener;
        }),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => {
          disconnectListener = listener;
        }),
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: "https://example.com/article",
              text: "页面内容",
              truncated: false,
              usedFallback: false,
            });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();
    useAppStore.setState((state) => ({
      chatPreferences: {
        ...state.chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
      },
    }));

    const sendPromise = useAppStore.getState().sendChatMessage("需要搜索");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    portMessageListener?.({
      type: "tool:start",
      record: {
        id: "call-1",
        toolId: "web_search.tavily",
        name: "tavily_search",
        displayName: "Tavily 搜索",
        arguments: { query: "需要搜索" },
        status: "running",
        startedAt: 1,
      },
    });
    disconnectListener?.();
    await sendPromise;

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    expect(state.failure?.message).toBe("流式响应异常中断，请重新生成后重试");
    expect(activeSession?.messages[1]).toMatchObject({
      content: "流式响应异常中断，请重新生成后重试",
      streaming: false,
    });
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

  it("只能删除没有未归档会话的聊天文件夹", async () => {
    const emptyFolder: ChatFolder = {
      id: "folder-empty-delete-store",
      name: "空文件夹",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const nonEmptyFolder: ChatFolder = {
      id: "folder-non-empty-delete-store",
      name: "非空文件夹",
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 2,
    };
    await saveChatFolder(emptyFolder);
    await saveChatFolder(nonEmptyFolder);
    await saveChatSession({
      id: "session-in-non-empty-folder",
      title: "文件夹内会话",
      archived: false,
      folderId: nonEmptyFolder.id,
      sortOrder: 3,
      createdAt: 3,
      updatedAt: 3,
      messages: [],
    });
    await useAppStore.getState().loadChatData();

    await expect(useAppStore.getState().deleteEmptyChatFolder(nonEmptyFolder.id)).resolves.toBe(false);

    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === nonEmptyFolder.id)).toBe(true);
    expect(useAppStore.getState().failure?.message).toBe("只能删除空文件夹");

    useAppStore.setState({ failure: { message: "历史错误" } });
    await expect(useAppStore.getState().deleteEmptyChatFolder(emptyFolder.id)).resolves.toBe(true);

    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === emptyFolder.id)).toBe(false);
    expect(useAppStore.getState().failure).toBeUndefined();

    useAppStore.getState().reset();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === emptyFolder.id)).toBe(false);
    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === nonEmptyFolder.id)).toBe(true);
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

  it("重新生成 AI 消息时会丢弃该 AI 及后续消息，并用上方用户消息重新请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "页面上下文",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "重新生成回复",
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
    await useAppStore.getState().refreshPageContext();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 4,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "第一问", createdAt: 1 }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "第一答", createdAt: 2 }),
        createChatMessage({ id: "message-user-2", role: "user", content: "第二问", createdAt: 3 }),
        createChatMessage({ id: "message-ai-2", role: "assistant", content: "第二答", createdAt: 4 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().regenerateMessage("message-ai-1");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);

    expect(chatRequest?.messages?.map((message) => `${message.role}:${message.content}`)).toEqual(["system:你是网页助手", "user:第一问"]);
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "重新生成回复"]);
  });

  it("重新生成用户消息时会丢弃该用户消息后的所有消息，并用该用户消息重新请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "第二问新回复",
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
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 4,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "第一问", createdAt: 1 }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "第一答", createdAt: 2 }),
        createChatMessage({ id: "message-user-2", role: "user", content: "第二问", createdAt: 3 }),
        createChatMessage({ id: "message-ai-2", role: "assistant", content: "第二答", createdAt: 4 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().regenerateMessage("message-user-2");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);

    expect(chatRequest?.messages?.map((message) => `${message.role}:${message.content}`)).toEqual([
      "system:你是网页助手",
      "user:第一问",
      "assistant:第一答",
      "user:第二问",
    ]);
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "第一答", "第二问", "第二问新回复"]);
  });

  it("编辑用户消息后会替换该消息内容并丢弃后续消息重新请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "编辑后回复",
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
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 4,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "第一问", createdAt: 1 }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "第一答", createdAt: 2 }),
        createChatMessage({ id: "message-user-2", role: "user", content: "第二问", createdAt: 3 }),
        createChatMessage({ id: "message-ai-2", role: "assistant", content: "第二答", createdAt: 4 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().editAndRegenerateUserMessage("message-user-2", "第二问改写");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);

    expect(chatRequest?.messages?.map((message) => `${message.role}:${message.content}`)).toEqual([
      "system:你是网页助手",
      "user:第一问",
      "assistant:第一答",
      "user:第二问改写",
    ]);
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "第一答", "第二问改写", "编辑后回复"]);
  });

  it("编辑用户消息时找不到消息会记录失败且不发起请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "不应生成的回复",
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
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "第一问", createdAt: 1 }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "第一答", createdAt: 2 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().editAndRegenerateUserMessage("message-missing", "改写内容");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string })
      .find((message) => message.type === "chat.send");

    expect(state.failure?.message).toBe("未找到可编辑的用户消息");
    expect(chatRequest).toBeUndefined();
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "第一答"]);
  });

  it("编辑用户消息传入空白内容时不改变会话且不发起请求", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "第一问", createdAt: 1 }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "第一答", createdAt: 2 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().editAndRegenerateUserMessage("message-user-1", "   ");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    expect(state.failure).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "第一答"]);
  });

  it("编辑带图片的用户消息时保留附件并随请求发送", async () => {
    const provider = createProvider();
    const model = { ...createModel(), supportsVision: true };
    const attachment = {
      id: "image-edit-1",
      name: "截图.png",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,QUJD",
    };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      callback({
        ok: true,
        content: "看图回复",
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
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "看图", createdAt: 1, attachments: [attachment] }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "旧回复", createdAt: 2 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().editAndRegenerateUserMessage("message-user-1", "看图并总结");

    const activeSession = useAppStore.getState().chatSessions.find((session) => session.id === sessionId);
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .at(-1);
    const sentUserMessage = chatRequest?.messages?.find((message) => message.role === "user");

    expect(sentUserMessage?.content).toBe("看图并总结");
    expect(sentUserMessage?.attachments).toEqual([attachment]);
    expect(activeSession?.messages[0]).toMatchObject({
      content: "看图并总结",
      attachments: [attachment],
    });
  });

  it("编辑带图片的用户消息但模型不支持视觉时记录失败且不发起请求", async () => {
    const provider = createProvider();
    const model = { ...createModel(), supportsVision: false };
    const attachment = {
      id: "image-edit-unsupported",
      name: "截图.png",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,QUJD",
    };
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().createChatSession();
    const sessionId = useAppStore.getState().activeSessionId;
    await saveChatSession({
      id: sessionId,
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        createChatMessage({ id: "message-user-1", role: "user", content: "看图", createdAt: 1, attachments: [attachment] }),
        createChatMessage({ id: "message-ai-1", role: "assistant", content: "旧回复", createdAt: 2 }),
      ],
    });
    await useAppStore.getState().loadChatData();

    await useAppStore.getState().editAndRegenerateUserMessage("message-user-1", "看图并总结");

    const state = useAppStore.getState();
    const activeSession = state.chatSessions.find((session) => session.id === sessionId);
    expect(state.failure?.message).toBe("当前模型不支持视觉理解，无法添加图片");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(activeSession?.messages.map((message) => message.content)).toEqual(["看图", "旧回复"]);
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
    useAppStore.getState().setStreamMode(false);

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
    useAppStore.getState().setStreamMode(false);

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
    useAppStore.getState().setStreamMode(false);

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
    useAppStore.getState().setStreamMode(false);

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
    useAppStore.getState().setStreamMode(false);
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
    useAppStore.getState().setStreamMode(false);

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

  it("切换当前对话模型后会保存到当前会话，切回会话时恢复该模型", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const secondModel: ProviderModel = {
      ...createModel(),
      id: "model-second",
      displayName: "第二个模型",
      modelId: "gpt-second",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(secondModel);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const firstSession = await useAppStore.getState().createChatSession();
    await useAppStore.getState().selectModel("model-second");
    const secondSession = await useAppStore.getState().createChatSession();
    await useAppStore.getState().selectModel("model-1");

    useAppStore.getState().selectChatSession(firstSession.id);

    expect(useAppStore.getState().selectedModelId).toBe("model-second");
    await expect(getChatSession(firstSession.id)).resolves.toMatchObject({ selectedModelId: "model-second" });
    await expect(getChatSession(secondSession.id)).resolves.toMatchObject({ selectedModelId: "model-1" });
  });

  it("流式连接未返回内容就断开时保留 AI 气泡且不回退非流式", async () => {
    const provider = createProvider();
    const model = createModel();
    let portDisconnectListener: (() => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => {
          portDisconnectListener = listener;
        }),
      },
    };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({ ok: true, url: "https://example.com/article", text: "页面内容", truncated: false, usedFallback: false });
      }

      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
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
      expect(portDisconnectListener).toBeTypeOf("function");
      expect(useAppStore.getState().chatSessions[0]?.messages.map((message) => message.content)).toEqual(["第一问", ""]);
    });

    portDisconnectListener?.();
    await sendPromise;

    const chatSendCalls = sendMessage.mock.calls.filter(([message]) => (message as { type: string }).type === "chat.send");
    expect(chatSendCalls).toHaveLength(0);
    expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
      role: "assistant",
      content: "流式响应异常中断，请重新生成后重试",
      streaming: false,
    });
  });

  it("流式返回片段后报错时保留已有内容并停止流式状态", async () => {
    const provider = createProvider();
    const model = createModel();
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
        sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
          if (message.type === "pageContext.extract") {
            callback({ ok: true, url: "https://example.com/article", text: "页面内容", truncated: false, usedFallback: false });
          }

          return undefined;
        }),
      },
    });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    await useAppStore.getState().refreshPageContext();

    const sendPromise = useAppStore.getState().sendChatMessage("第一问");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });

    portMessageListener?.({ type: "chunk", content: "已有内容" });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatSessions[0]?.messages[1].content).toBe("已有内容");
    });
    portMessageListener?.({ type: "error", message: "upstream raw error with sk-secret" });
    await sendPromise;

    expect(useAppStore.getState().failure?.message).toBe("流式响应异常中断，请重新生成后重试");
    expect(useAppStore.getState().failure?.message).not.toContain("sk-secret");
    expect(useAppStore.getState().chatSessions[0]?.messages[1]).toMatchObject({
      content: "已有内容\n\n流式响应异常中断，请重新生成后重试",
      streaming: false,
    });
  });

  it("同一毫秒连续创建会话时也会生成不同会话 ID", async () => {
    const provider = createProvider();
    const model = createModel();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    const firstSession = await useAppStore.getState().createChatSession();
    const secondSession = await useAppStore.getState().createChatSession();

    expect(firstSession.id).not.toBe(secondSession.id);
    expect(firstSession.id).toMatch(/^session-123456-/);
    expect(secondSession.id).toMatch(/^session-123456-/);

    nowSpy.mockRestore();
  });

  it("重新加载聊天数据时优先使用当前会话保存的模型而不是默认对话模型", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(defaultModel);
    await saveAppSetting({ key: "defaultChatModelId", value: "model-default", updatedAt: 1 });
    await saveChatSession({
      id: "session-uses-first-model",
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      selectedModelId: "model-1",
      messages: [],
    });

    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().defaultChatModelId).toBe("model-default");
    expect(useAppStore.getState().activeSessionId).toBe("session-uses-first-model");
    expect(useAppStore.getState().selectedModelId).toBe("model-1");
  });

  it("删除当前会话后会同步到新活跃会话保存的模型", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const secondModel: ProviderModel = {
      ...createModel(),
      id: "model-second",
      displayName: "第二个模型",
      modelId: "gpt-second",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(secondModel);
    await saveChatSession({
      id: "session-first",
      title: "第一个会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: "model-1",
      messages: [],
    });
    await saveChatSession({
      id: "session-second",
      title: "第二个会话",
      archived: false,
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 2,
      selectedModelId: "model-second",
      messages: [],
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().activeSessionId).toBe("session-second");
    expect(useAppStore.getState().selectedModelId).toBe("model-second");

    await useAppStore.getState().confirmDeleteChatSession("session-second");

    expect(useAppStore.getState().activeSessionId).toBe("session-first");
    expect(useAppStore.getState().selectedModelId).toBe("model-1");
  });

  it("旧会话没有保存模型时切换会回退到默认对话模型", async () => {
    const provider = createProvider();
    const firstModel = createModel();
    const defaultModel: ProviderModel = {
      ...createModel(),
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(firstModel);
    await saveProviderModel(defaultModel);
    await saveAppSetting({ key: "defaultChatModelId", value: "model-default", updatedAt: 1 });
    await saveChatSession({
      id: "legacy-session",
      title: "旧会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });

    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().activeSessionId).toBe("legacy-session");
    expect(useAppStore.getState().selectedModelId).toBe("model-default");
  });

  it("选择空模型时会清空当前会话保存的模型", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    const session = await useAppStore.getState().createChatSession();

    await useAppStore.getState().selectModel("");

    expect(useAppStore.getState().selectedModelId).toBe("");
    await expect(getChatSession(session.id)).resolves.toMatchObject({ selectedModelId: "" });
  });

  it("活跃会话正在使用的模型被删除后，会话模型会回退到下一个可用模型", async () => {
    const provider = createProvider();
    const fallbackModel = createModel();
    const activeModel: ProviderModel = {
      ...createModel(),
      id: "model-active",
      displayName: "当前模型",
      modelId: "gpt-active",
      updatedAt: 2,
    };

    await saveModelProvider(provider);
    await saveProviderModel(fallbackModel);
    await saveProviderModel(activeModel);
    await saveChatSession({
      id: "session-active-model",
      title: "使用当前模型的会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: "model-active",
      messages: [],
    });
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();

    expect(useAppStore.getState().selectedModelId).toBe("model-active");

    useAppStore.getState().deleteModel("model-active");

    expect(useAppStore.getState().selectedModelId).toBe("model-1");
    expect(useAppStore.getState().chatSessions.find((session) => session.id === "session-active-model")?.selectedModelId).toBe("model-1");
    await vi.waitFor(async () => {
      await expect(getChatSession("session-active-model")).resolves.toMatchObject({ selectedModelId: "model-1" });
    });
  });

  it("空白占位会话进入隐私模式时删除历史 item", async () => {
    const provider = createProvider();
    const model = createModel();
    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    const placeholder = await useAppStore.getState().createChatSession();
    await expect(getChatSession(placeholder.id)).resolves.toBeDefined();

    await useAppStore.getState().enterPrivateMode();

    const state = useAppStore.getState();
    expect(state.privateModeActive).toBe(true);
    expect(state.privateChatSession).toMatchObject({
      title: "新对话",
      selectedModelId: "model-1",
      messages: [],
    });
    expect(state.chatSessions).toHaveLength(0);
    await expect(getChatSession(placeholder.id)).resolves.toBeUndefined();
  });

  it("隐私模式发送消息不会持久化或新增历史 item", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: message.type === "chat.send" ? "隐私回复" : "" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().enterPrivateMode();

    await useAppStore.getState().sendChatMessage("隐私问题");

    const state = useAppStore.getState();
    expect(state.privateModeActive).toBe(true);
    expect(state.chatSessions).toHaveLength(0);
    expect(state.privateChatSession?.messages.map((message) => message.content)).toEqual(["隐私问题", "隐私回复"]);
    await expect(getChatSession(state.privateChatSession?.id ?? "")).resolves.toBeUndefined();
  });

  it("保存隐私会话后退出隐私模式并成为普通历史会话", async () => {
    const provider = createProvider();
    const model = createModel();
    const sendMessage = vi.fn((_message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: "隐私回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().enterPrivateMode();
    await useAppStore.getState().sendChatMessage("需要保留");
    const privateSessionId = useAppStore.getState().privateChatSession?.id ?? "";
    const savedSessionId = privateSessionId.replace(/^private-session-/, "session-");

    await useAppStore.getState().savePrivateChatSession();

    const state = useAppStore.getState();
    expect(state.privateModeActive).toBe(false);
    expect(state.privateChatSession).toBeUndefined();
    expect(state.activeSessionId).toBe(savedSessionId);
    expect(state.chatSessions).toHaveLength(1);
    expect(state.chatSessions[0].id).toBe(savedSessionId);
    expect(state.chatSessions[0].id).not.toMatch(/^private-session-/);
    expect(state.chatSessions[0].messages.map((message) => message.content)).toEqual(["需要保留", "隐私回复"]);
    await expect(getChatSession(privateSessionId)).resolves.toBeUndefined();
    await expect(getChatSession(savedSessionId)).resolves.toMatchObject({
      id: savedSessionId,
      messages: expect.any(Array),
    });
  });

  it("隐私会话生成中保存会被拒绝并保留隐私模式", async () => {
    const provider = createProvider();
    const model = createModel();
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
    vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port), sendMessage: vi.fn() } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().setStreamMode(true);
    await useAppStore.getState().enterPrivateMode();

    const sendPromise = useAppStore.getState().sendChatMessage("隐私生成中");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().privateChatSession?.messages.map((message) => message.content)).toEqual(["隐私生成中", ""]);
    });

    await useAppStore.getState().savePrivateChatSession();

    expect(useAppStore.getState().privateModeActive).toBe(true);
    expect(useAppStore.getState().privateChatSession?.messages.map((message) => message.content)).toEqual(["隐私生成中", ""]);
    expect(useAppStore.getState().failure?.message).toBe("隐私对话仍在生成中，请先终止或等待完成后再保存。");

    portMessageListener?.({ type: "complete", content: "隐私生成完成" });
    await sendPromise;
  });

  it("隐私模式 AI 请求重试进度只保存在临时状态并在完成后清除", async () => {
    const provider = createProvider();
    const model = createModel();
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
    vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port), sendMessage: vi.fn() } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().setStreamMode(true);
    await useAppStore.getState().enterPrivateMode();

    const sendPromise = useAppStore.getState().sendChatMessage("隐私重试问题");
    await vi.waitFor(() => expect(portMessageListener).toBeTypeOf("function"));

    portMessageListener?.({ type: "retry:progress", currentRetry: 1, maxRetries: 5 });
    const assistantMessageId = await vi.waitFor(() => {
      const assistantMessage = useAppStore.getState().privateChatSession?.messages[1];
      expect(assistantMessage?.content).toBe("");
      expect(assistantMessage).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(assistantMessage, "retryProgress")).toBe(false);
      return assistantMessage?.id ?? "";
    });
    await vi.waitFor(() => {
      expect(useAppStore.getState().chatRetryProgressByMessageId[assistantMessageId]).toEqual({
        currentRetry: 1,
        maxRetries: 5,
      });
    });

    portMessageListener?.({ type: "complete", content: "隐私重试完成" });
    await sendPromise;

    expect(useAppStore.getState().chatRetryProgressByMessageId[assistantMessageId]).toBeUndefined();
    expect(useAppStore.getState().privateChatSession?.messages[1]).toMatchObject({
      content: "隐私重试完成",
      streaming: false,
    });
  });

  it("保存隐私会话后使用完整聊天记录重新生成标题", async () => {
    const provider = createProvider();
    const chatModel = createModel();
    const titleModel = createTitleModel();
    const sendMessage = vi.fn((message: { type: string; model?: ProviderModel; messages?: ChatMessage[] }, callback: (response: unknown) => void) => {
      callback({
        ok: true,
        content: message.model?.id === "model-title" ? "{\"title\":\"完整隐私对话标题\"}" : "隐私回复",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);
    await useAppStore.getState().loadChannelConfig();
    useAppStore.getState().selectModel("model-1");
    useAppStore.getState().setTitleModel("model-title");
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().enterPrivateMode();
    await useAppStore.getState().sendChatMessage("第一轮隐私问题");
    await useAppStore.getState().sendChatMessage("第二轮隐私追问");

    await useAppStore.getState().savePrivateChatSession();

    const titleRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; model?: ProviderModel; messages?: ChatMessage[] })
      .filter((message) => message.type === "chat.send")
      .find((message) => message.model?.id === "model-title");
    expect(titleRequest?.messages?.[1].content).toContain("用户：第一轮隐私问题");
    expect(titleRequest?.messages?.[1].content).toContain("助手：隐私回复");
    expect(titleRequest?.messages?.[1].content).toContain("用户：第二轮隐私追问");
    expect(useAppStore.getState().chatSessions[0]).toMatchObject({
      title: "完整隐私对话标题",
      titleGenerating: false,
    });
    await expect(getChatSession(useAppStore.getState().activeSessionId)).resolves.toMatchObject({
      title: "完整隐私对话标题",
    });
  });

  it("隐私模式流式响应只更新内存会话", async () => {
    const provider = createProvider();
    const model = createModel();
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

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().enterPrivateMode();

    const sendPromise = useAppStore.getState().sendChatMessage("流式隐私问题");
    await vi.waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
      expect(useAppStore.getState().privateChatSession?.messages.map((message) => message.content)).toEqual(["流式隐私问题", ""]);
    });

    portMessageListener?.({ type: "chunk", content: "隐私" });
    portMessageListener?.({ type: "complete", content: "隐私流式回复", thinking: "隐私思考" });
    await sendPromise;

    const state = useAppStore.getState();
    expect(state.chatSessions).toHaveLength(0);
    expect(state.privateChatSession?.messages[1]).toMatchObject({
      content: "隐私流式回复",
      thinking: "隐私思考",
      streaming: false,
    });
    await expect(getChatSession(state.privateChatSession?.id ?? "")).resolves.toBeUndefined();
  });

  it("隐私模式下新建对话会退出隐私模式并创建普通占位会话", async () => {
    const provider = createProvider();
    const model = createModel();
    await saveModelProvider(provider);
    await saveProviderModel(model);
    await useAppStore.getState().loadChannelConfig();

    await useAppStore.getState().enterPrivateMode();
    const session = await useAppStore.getState().createChatSession();

    const state = useAppStore.getState();
    expect(state.privateModeActive).toBe(false);
    expect(state.privateChatSession).toBeUndefined();
    expect(state.chatSessions).toEqual([session]);
    await expect(getChatSession(session.id)).resolves.toBeDefined();
  });

  it("隐私模式有消息时直接切换历史会话不会静默丢弃隐私对话", async () => {
    const provider = createProvider();
    const model = createModel();
    const existingSession = {
      id: "session-existing",
      title: "已有会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedModelId: "model-1",
      messages: [
        createChatMessage({
          id: "message-existing",
          role: "user",
          content: "已有消息",
        }),
      ],
    };
    const sendMessage = vi.fn((_message: { type: string }, callback: (response: unknown) => void) => {
      callback({ ok: true, content: "隐私回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await saveChatSession(existingSession);
    await useAppStore.getState().loadChannelConfig();
    await useAppStore.getState().loadChatData();
    useAppStore.getState().setStreamMode(false);
    await useAppStore.getState().createChatSession();
    await useAppStore.getState().enterPrivateMode();
    await useAppStore.getState().sendChatMessage("隐私问题");

    useAppStore.getState().selectChatSession("session-existing");

    const state = useAppStore.getState();
    expect(state.privateModeActive).toBe(true);
    expect(state.privateChatSession?.messages.map((message) => message.content)).toEqual(["隐私问题", "隐私回复"]);
    expect(state.activeSessionId).toBe("");
  });
});
