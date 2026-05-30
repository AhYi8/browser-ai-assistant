import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDatabase, saveAppSetting, saveModelProvider } from "../../../src/shared/storage/repositories";

type Listener<T extends (...args: never[]) => void> = T;

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

  return {
    installedListeners,
    startupListeners,
    actionListeners,
    commandListeners,
    contextListeners,
    messageListeners,
    connectListeners,
    alarmListeners,
    chrome: {
      runtime: {
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
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        update: vi.fn().mockResolvedValue({ id: 7, url: "https://example.com/next" }),
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
    },
  };
}

describe("background 入口", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
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
      expect(mock.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          "browserAiAssistantBackup:work": expect.objectContaining({
            prefix: "work",
            provider: "chrome_sync",
          }),
        }),
      );
    });
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
      "https://dav.example.com/browser-ai/work.json",
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

  it("转发自动化 DOM 动作到当前活动页 content script", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage.mockResolvedValueOnce({
      ok: true,
      html: "<html><body>第二页</body></html>",
      url: "https://example.com/orders",
      title: "订单",
    });
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "automation.executeDomAction",
        action: { type: "click", selector: ".next-page" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        html: "<html><body>第二页</body></html>",
        url: "https://example.com/orders",
        title: "订单",
      });
    });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "automation.executeDomAction",
      action: { type: "click", selector: ".next-page" },
    });
  });

  it("自动化 DOM 动作未连接时注入 content script 后重试", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({
        ok: true,
        html: "<html><body>注入后页面</body></html>",
        url: "https://example.com/orders",
      });
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "automation.executeDomAction",
        action: { type: "extractHtml" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        html: "<html><body>注入后页面</body></html>",
        url: "https://example.com/orders",
      });
    });
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content/index.js"],
    });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("自动化跳转只通过 background 更新当前标签页 URL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "automation.navigateTab",
        url: "https://example.com/next",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, tabId: 7, url: "https://example.com/next" });
    });
    expect(mock.chrome.tabs.update).toHaveBeenCalledWith(7, { url: "https://example.com/next" });
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
});
