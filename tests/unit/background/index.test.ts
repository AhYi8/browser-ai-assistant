import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDatabase, saveAppSetting, saveModelProvider } from "../../../src/shared/storage/repositories";

type Listener<T extends (...args: never[]) => void> = T;

function createPortMock(name: string) {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
    sender: {},
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
      removeListener: vi.fn(),
    },
    emitMessage: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    emitDisconnect: () => disconnectListeners.forEach((listener) => listener()),
  } as unknown as chrome.runtime.Port & {
    emitMessage: (message: unknown) => void;
    emitDisconnect: () => void;
    postMessage: ReturnType<typeof vi.fn>;
  };
}

function createChromeMock() {
  const installedListeners: Array<Listener<() => void>> = [];
  const startupListeners: Array<Listener<() => void>> = [];
  const actionListeners: Array<Listener<(tab: chrome.tabs.Tab) => void>> = [];
  const commandListeners: Array<Listener<(command: string) => void>> = [];
  const contextListeners: Array<Listener<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void>> = [];
  const messageListeners: Array<
    Listener<(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean>
  > = [];
  const connectListeners: Array<Listener<(port: chrome.runtime.Port) => void>> = [];
  const alarmListeners: Array<Listener<(alarm: chrome.alarms.Alarm) => void>> = [];
  const tabUpdatedListeners: Array<Listener<(tabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => void>> = [];
  const tabRemovedListeners: Array<Listener<(tabId: number) => void>> = [];

  return {
    installedListeners,
    startupListeners,
    actionListeners,
    commandListeners,
    contextListeners,
    messageListeners,
    connectListeners,
    alarmListeners,
    tabUpdatedListeners,
    tabRemovedListeners,
    chrome: {
      runtime: {
        lastError: undefined as { message: string } | undefined,
        onInstalled: {
          addListener: vi.fn((listener: Listener<() => void>) => installedListeners.push(listener)),
        },
        onStartup: {
          addListener: vi.fn((listener: Listener<() => void>) => startupListeners.push(listener)),
        },
        onMessage: {
          addListener: vi.fn(
            (
              listener: Listener<
                (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean
              >,
            ) => messageListeners.push(listener),
          ),
        },
        onConnect: {
          addListener: vi.fn((listener: Listener<(port: chrome.runtime.Port) => void>) => connectListeners.push(listener)),
        },
      },
      alarms: {
        create: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue(undefined),
        onAlarm: {
          addListener: vi.fn((listener: Listener<(alarm: chrome.alarms.Alarm) => void>) => alarmListeners.push(listener)),
        },
      },
      storage: {
        sync: {
          QUOTA_BYTES_PER_ITEM: 8192,
          set: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
          getKeys: vi.fn().mockResolvedValue([]),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: {
          addListener: vi.fn((listener: Listener<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void>) =>
            contextListeners.push(listener),
          ),
        },
      },
      sidePanel: {
        open: vi.fn().mockResolvedValue(undefined),
      },
      action: {
        onClicked: {
          addListener: vi.fn((listener: Listener<(tab: chrome.tabs.Tab) => void>) => actionListeners.push(listener)),
        },
      },
      commands: {
        onCommand: {
          addListener: vi.fn((listener: Listener<(command: string) => void>) => commandListeners.push(listener)),
        },
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 7, url: "https://example.com/article" }),
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        onUpdated: {
          addListener: vi.fn((listener: Listener<(tabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => void>) =>
            tabUpdatedListeners.push(listener),
          ),
        },
        onRemoved: {
          addListener: vi.fn((listener: Listener<(tabId: number) => void>) => tabRemovedListeners.push(listener)),
        },
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,QUJD"),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          url: "https://example.com/article",
          text: "正文内容",
          truncated: false,
          usedFallback: false,
          matchedRuleId: "rule-1",
        }),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined),
      },
      debugger: {
        attach: vi.fn((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => callback()),
        detach: vi.fn((_debuggee: chrome.debugger.Debuggee, callback: () => void) => callback()),
        sendCommand: vi.fn((_debuggee: chrome.debugger.Debuggee, _method: string, _params: unknown, callback: (result?: unknown) => void) =>
          callback({}),
        ),
        onDetach: {
          addListener: vi.fn(),
        },
      },
    },
  };
}

describe("background 入口", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await clearDatabase();
  });

  it("安装时创建打开侧边栏的右键菜单", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.installedListeners[0]();

    expect(mock.chrome.contextMenus.create).toHaveBeenCalledWith({
      id: "open-side-panel",
      title: "打开 AI 助手",
      contexts: ["page"],
    });
  });

  it("支持插件图标、快捷键和右键菜单打开侧边栏", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    mock.actionListeners[0]({ id: 3 } as chrome.tabs.Tab);
    await mock.commandListeners[0]("open-side-panel");
    await mock.contextListeners[0]({ menuItemId: "open-side-panel" } as chrome.contextMenus.OnClickData, {
      id: 9,
    } as chrome.tabs.Tab);

    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(1, { tabId: 3 });
    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(2, { tabId: 7 });
    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(3, { tabId: 9 });
  });

  it("注册渠道模型和页面上下文消息处理器", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    expect(mock.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("注册同步备份消息和定时任务处理器", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    expect(mock.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
  });

  it("处理浏览器控制开关消息并连接当前标签页", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");

    const sendResponse = vi.fn();
    const keepChannel = mock.messageListeners[0](
      { type: "browserControl.setEnabled", enabled: true },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7 }));
    });
    expect(mock.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3", expect.any(Function));
  });

  it("处理运行时只读授权消息并返回响应", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");

    const enableResponse = vi.fn();
    mock.messageListeners[0](
      { type: "browserControl.setEnabled", enabled: true },
      { tab: { id: 7 } as chrome.tabs.Tab },
      enableResponse,
    );
    await vi.waitFor(() => {
      expect(enableResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7 }));
    });

    const sendResponse = vi.fn();
    const keepChannel = mock.messageListeners[0](
      { type: "browserControl.setRuntimeReadonly", enabled: true, reason: "测试" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7, message: "运行时只读分析已临时开启。" }));
    });
  });

  it("浏览器启动时根据已保存设置恢复自动同步定时任务", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        autoSyncEnabled: true,
        intervalMinutes: 15,
      },
      updatedAt: 1,
    });
    await import("../../../src/background/index");

    mock.startupListeners[0]();

    await vi.waitFor(() => {
      expect(mock.chrome.alarms.create).toHaveBeenCalledWith("browser-ai-assistant.sync-backup", {
        periodInMinutes: 15,
      });
    });
  });

  it("定时任务触发时无需打开侧边栏即可执行备份", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        autoSyncEnabled: true,
        provider: "chrome_sync",
        backupPrefix: "work",
        intervalMinutes: 15,
      },
      updatedAt: 1,
    });
    await saveModelProvider({
      id: "provider-1",
      name: "渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await import("../../../src/background/index");

    mock.alarmListeners[0]({ name: "browser-ai-assistant.sync-backup" } as chrome.alarms.Alarm);

    await vi.waitFor(() => {
      expect(mock.chrome.storage.sync.set).toHaveBeenCalled();
    });
    const backupItems = mock.chrome.storage.sync.set.mock.calls[0][0] as Record<string, unknown>;
    const backupKey = Object.keys(backupItems)[0];
    expect(backupKey).toMatch(/^browserAiAssistantBackup:work:\d+$/);
    expect(backupItems[backupKey]).toEqual(expect.objectContaining({
      prefix: "work",
      provider: "chrome_sync",
    }));
  });

  it("处理手动备份 runtime 消息", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "sync.backupNow" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: expect.any(Boolean) }));
    });
  });

  it("处理远程备份列表 runtime 消息", async () => {
    const mock = createChromeMock();
    const backup = {
      version: 1,
      createdAt: 1,
      prefix: "work",
      provider: "chrome_sync",
      encrypted: false,
      payload: { ok: true },
    };
    mock.chrome.storage.sync.getKeys.mockResolvedValue(["browserAiAssistantBackup:work:1"]);
    mock.chrome.storage.sync.get.mockResolvedValue({ "browserAiAssistantBackup:work:1": backup });
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: { syncEnabled: true, backupPrefix: "work" },
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "sync.listRemoteBackups" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        backups: [
          {
            id: "browserAiAssistantBackup:work:1",
            prefix: "work",
            createdAt: 1,
            provider: "chrome_sync",
            encrypted: false,
          },
        ],
      });
    });
  });

  it("处理指定远程备份恢复 runtime 消息", async () => {
    const mock = createChromeMock();
    const backup = {
      version: 1,
      createdAt: 1,
      prefix: "home",
      provider: "chrome_sync",
      encrypted: false,
      payload: {
        version: 1,
        modelConfigs: [],
        modelProviders: [],
        providerModels: [],
        extractionRules: [],
        chatSessions: [],
        chatFolders: [],
        appSettings: [],
      },
    };
    mock.chrome.storage.sync.get.mockResolvedValue({ "browserAiAssistantBackup:home:1": backup });
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: { syncEnabled: true, backupPrefix: "work" },
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sync.restoreNow", backupId: "browserAiAssistantBackup:home:1" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, message: "恢复完成" });
    });
    expect(mock.chrome.storage.sync.get).toHaveBeenCalledWith("browserAiAssistantBackup:home:1");
  });

  it("WebDAV 配置备份时不写入 Chrome Sync", async () => {
    const mock = createChromeMock();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("fetch", fetcher);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        provider: "webdav",
        backupPrefix: "work",
        webdav: {
          endpointUrl: "https://dav.example.com",
          username: "me",
          remotePath: "browser-ai",
        },
      },
      updatedAt: 1,
    });
    await saveAppSetting({ key: "syncWebDavPassword", value: "pwd", updatedAt: 1 });
    await saveModelProvider({
      id: "provider-1",
      name: "渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sync.backupNow" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, message: "备份完成" });
    });
    expect(mock.chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/dav\.example\.com\/browser-ai\/work--\d+\.json$/),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("转发当前活动页提取请求到 content script", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
        extractMode: "all",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "pageContext.extract",
      rules: [],
      maxLength: 100,
      extractMode: "all",
    });
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      url: "https://example.com/article",
      text: "正文内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("列出当前窗口可注入的普通网页标签页", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.query.mockResolvedValueOnce([
      { id: 7, title: "文章页", url: "https://example.com/article", active: true },
      { id: 8, title: "设置页", url: "chrome://settings", active: false },
      { id: 9, title: "资料页", url: "https://docs.example.com/guide", active: false },
      { title: "无 ID 页面", url: "https://example.com/no-id", active: false },
    ]);
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "pageContext.listTabs" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        tabs: [
          { tabId: 7, title: "文章页", url: "https://example.com/article", active: true },
          { tabId: 9, title: "资料页", url: "https://docs.example.com/guide", active: false },
        ],
      });
    });
    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
  });

  it("指定 tabId 时转发提取请求到对应标签页", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        tabId: 9,
        rules: [],
        extractMode: "text",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(9, {
        type: "pageContext.extract",
        rules: [],
        maxLength: undefined,
        extractMode: "text",
      });
    });
    expect(mock.chrome.tabs.query).not.toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it("没有活动标签页时返回中文错误", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.query.mockResolvedValueOnce([]);
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      message: "未找到当前活动页面",
    });
  });

  it("截取当前活动标签页可见区域并返回图片附件数据", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3 }]);
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "tab.captureVisible",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        attachment: {
          id: expect.stringMatching(/^screenshot-/),
          name: "当前标签页截图.png",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,QUJD",
        },
      });
    });
    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mock.chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(3, { format: "png" });
  });

  it("当前标签页截图失败时返回明确中文错误", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3 }]);
    mock.chrome.tabs.captureVisibleTab.mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "tab.captureVisible",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "当前页面无法截图，请切换到普通网页后重试",
      });
    });
  });

  it("content script 未连接时自动注入后重试提取当前页", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({
        ok: true,
        url: "https://example.com/article",
        text: "注入后正文",
        truncated: false,
        usedFallback: true,
      });
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        url: "https://example.com/article",
        text: "注入后正文",
        truncated: false,
        usedFallback: true,
      });
    });
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content/index.js"],
    });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("处理 URL 正则 AI 生成请求并返回响应", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(["https://example\\.com/news/123", "https://example\\.com/news/.*"]),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "extractionRule.generateUrlPatterns",
        debugRequestId: "url-pattern-test",
        url: "https://example.com/news/123",
        provider: {
          id: "provider-1",
          name: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        model: {
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
        },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        patterns: ["https://example\\.com/news/123", "https://example\\.com/news/.*"],
      });
    });
  });

  it("快速返回当前活动标签页 URL", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 11, url: "https://example.com/news/123" }]);
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "extractionRule.getCurrentTabUrl",
        debugRequestId: "url-pattern-test",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        url: "https://example.com/news/123",
      });
    });
  });

  it("处理聊天发送请求并返回模型回复", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "模型回复" } }],
        }),
      }),
    );
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: {
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
        },
        messages: [],
        stream: false,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        content: "模型回复",
        thinking: undefined,
      });
    });
  });

  it("流式聊天端口断开时会终止正在进行的模型请求", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetcher);
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
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
        },
        messages: [],
        stream: false,
      },
    });

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalled();
    });
    const requestInit = fetcher.mock.calls[0][1] as RequestInit;
    expect((requestInit.signal as AbortSignal).aborted).toBe(false);
    port.emitDisconnect();

    expect((requestInit.signal as AbortSignal).aborted).toBe(true);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("聊天长连接端口会透传 AI 请求重试进度", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "0" } }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "重试成功" } }],
            }),
            { status: 200 },
          ),
        ),
    );
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
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
        },
        messages: [],
        stream: false,
        retryCount: 5,
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: "retry:progress", currentRetry: 1, maxRetries: 5 });
    });
  });

  it("流式聊天完成事件会透传 Tavily 工具附件", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "webSearchSettings",
      value: {
        provider: "tavily",
        tavily: {
          apiKeysText: "tvly-1",
          apiKeyStrategy: "round_robin",
          includeAnswer: "basic",
          includeRawContent: false,
          maxResults: 5,
        },
        updatedAt: 1,
      },
      updatedAt: 1,
    });
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"最终思考"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"最终"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: "",
                  reasoning_content: "需要调用 Tavily 搜索",
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
        }),
    );
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
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
        },
        messages: [],
        stream: true,
        enabledToolIds: ["web_search.tavily"],
        toolChoice: "auto",
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:start",
          record: expect.objectContaining({
            id: "call-1",
            name: "tavily_search",
            status: "running",
          }),
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:complete",
          record: expect.objectContaining({
            id: "call-1",
            status: "success",
            attachmentIds: ["tool-attachment-call-1"],
          }),
          attachments: [
            expect.objectContaining({
              id: "tool-attachment-call-1",
              kind: "web-search",
              provider: "tavily",
              query: "Tavily API",
            }),
          ],
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith({ type: "assistant:final-start" });
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "complete",
          content: "最终回答",
          toolAttachments: undefined,
        }),
      );
    });
  });

});
