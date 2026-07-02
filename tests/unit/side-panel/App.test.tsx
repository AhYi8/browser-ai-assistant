import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import autoprefixer from "autoprefixer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { App } from "../../../src/side-panel/App";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { MCP_SETTINGS_KEY } from "../../../src/shared/mcp/settings";
import type { ModelToolRegistryEntry } from "../../../src/shared/models/types";
import {
  clearDatabase,
  getAppSetting,
  getProviderModels,
  saveAppSetting,
  saveChatFolder,
  saveChatSession,
  saveExtractionRule,
  saveModelProvider,
  savePromptTemplate,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ChatFolder, ChatMessage, ChatSession, ExtractionRule, ModelProvider, PromptTemplate, ProviderModel, SendShortcut } from "../../../src/shared/types";

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

function createChatMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "消息内容",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: true,
    systemPrompt: "你是网页助手",
    contextPrompt: "页面内容",
    contextMode: "text",
    ...partial,
  };
}

function createExtractionRule(partial: Partial<ExtractionRule>): ExtractionRule {
  return {
    id: "rule-1",
    alias: "正文区域",
    urlPattern: "https://example.com/.*",
    selectorsText: "main",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createPromptTemplate(partial: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "prompt-1",
    title: "风险审查",
    content: "从安全、隐私和可维护性三个角度审查。",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createChatFolder(partial: Partial<ChatFolder>): ChatFolder {
  return {
    id: "folder-1",
    name: "项目资料",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createChatSession(partial: Partial<ChatSession>): ChatSession {
  return {
    id: "session-1",
    title: "资料会话",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    ...partial,
  };
}

function getSessionListNewChatButton(): HTMLElement {
  return within(screen.getByLabelText("历史会话")).getByRole("button", { name: "新对话" });
}

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
  };
}

function formatBackupTestTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString("zh-CN");
}

function createShortcutRuntimeMock(options: { screenshotResponse?: unknown } = {}) {
  const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
    if (message.type === "pageContext.extract") {
      callback({
        ok: true,
        text: "页面内容",
        truncated: false,
        usedFallback: true,
      });
      return undefined;
    }

    if (message.type === "tab.captureVisible") {
      callback(
        options.screenshotResponse ?? {
          ok: true,
          attachment: {
            id: "screenshot-1",
            name: "当前标签页截图.png",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,QUJD",
          },
        },
      );
      return undefined;
    }

    callback({
      ok: true,
      content: "快捷键回复",
    });
    return undefined;
  });

  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
    },
  });

  return sendMessage;
}

function hasChatSendCall(sendMessage: ReturnType<typeof createShortcutRuntimeMock>): boolean {
  return sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send");
}

function getLastChatRequest(sendMessage: ReturnType<typeof createShortcutRuntimeMock>): { type: string; messages?: ChatMessage[] } | undefined {
  return sendMessage.mock.calls
    .map(([message]) => message as { type: string; messages?: ChatMessage[] })
    .find((message) => message.type === "chat.send");
}

function createDownloadMock() {
  const appendChild = vi.spyOn(document.body, "appendChild");
  const removeChild = vi.spyOn(document.body, "removeChild");
  const click = vi.fn();
  const anchor = document.createElement("a");
  const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() === "a") {
      Object.defineProperty(anchor, "click", { configurable: true, value: click });
      return anchor;
    }

    return Document.prototype.createElement.call(document, tagName, options);
  });
  const createObjectURL = vi.fn((blob: Blob) => {
    void blob;
    return "blob:chat-export";
  });
  const revokeObjectURL = vi.fn();

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });

  return {
    anchor,
    appendChild,
    click,
    createElement,
    createObjectURL,
    removeChild,
    revokeObjectURL,
  };
}

function createSequentialDownloadMock(urls: string[]) {
  const click = vi.fn();
  const anchor = document.createElement("a");
  Object.defineProperty(anchor, "click", { configurable: true, value: click });
  vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() === "a") {
      return anchor;
    }

    return Document.prototype.createElement.call(document, tagName, options);
  });
  const createObjectURL = vi.fn((blob: Blob) => {
    void blob;
    return urls[createObjectURL.mock.calls.length - 1] ?? "blob:chat-export";
  });
  const revokeObjectURL = vi.fn();

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });

  return {
    anchor,
    click,
    createObjectURL,
    revokeObjectURL,
  };
}

function createPrintWindowMock() {
  const printWindow = {
    document: {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    },
    focus: vi.fn(),
    print: vi.fn(),
  };
  const open = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);

  return {
    open,
    ...printWindow,
  };
}

function createImageFile(name = "截图.png", size = 8): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function stubFileReaderAsDataUrl(dataUrl = "data:image/png;base64,QUJD") {
  class MockFileReader extends EventTarget {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL() {
      this.result = dataUrl;
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("FileReader", MockFileReader);
}

function stubFileReaderError() {
  class MockFileReader extends EventTarget {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = new DOMException("读取失败");
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL() {
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("FileReader", MockFileReader);
}

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    registeredModelToolsMock.tools = [];
    useAppStore.getState().reset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearDatabase();
  });

  it("渲染侧边栏应用标题", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Browser AI Assistant" })).toBeInTheDocument();
  });

  it("顶部操作区提供新建对话入口并复用会话创建行为", async () => {
    const user = userEvent.setup();
    render(<App />);
    act(() => {
      useAppStore.setState({ composerHasDraft: true });
    });

    const header = screen.getByRole("heading", { name: "Browser AI Assistant" }).closest(".app-header");
    const headerActions = header?.querySelector(".app-header-actions");
    const newChatButton = within(headerActions as HTMLElement).getByRole("button", { name: "新建对话" });
    await user.click(newChatButton);

    await waitFor(() => expect(useAppStore.getState().chatSessions[0]?.title).toBe("新对话"));
    expect(useAppStore.getState().activeSessionId).toBe(useAppStore.getState().chatSessions[0]?.id);
  });

  it("会话任务状态通过边框类名展示且不渲染可见文案", async () => {
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    await saveChatSession(createChatSession({ id: "session-running", title: "后台生成" }));
    await saveChatSession(createChatSession({ id: "session-completed", title: "已经完成", sortOrder: 2 }));
    useAppStore.setState({
      chatTasksBySessionId: {
        "session-running": {
          id: "task-running",
          sessionId: "session-running",
          status: "running",
          startedAt: 1,
        },
        "session-completed": {
          id: "task-completed",
          sessionId: "session-completed",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
        },
      },
    });

    render(<App />);

    const runningItem = (await screen.findByRole("button", { name: "后台生成" })).closest(".session-item");
    const completedItem = (await screen.findByRole("button", { name: "已经完成" })).closest(".session-item");
    expect(runningItem).toHaveClass("session-item-running");
    expect(completedItem).toHaveClass("session-item-completed");
    expect(runningItem).toHaveAttribute("aria-label", "后台生成，正在生成");
    expect(completedItem).toHaveAttribute("aria-label", "已经完成，生成完成");
    expect(runningItem?.querySelector(".session-task-indicator")).not.toBeInTheDocument();
    expect(completedItem?.querySelector(".session-task-indicator")).not.toBeInTheDocument();
    expect(screen.queryByText("正在生成")).not.toBeInTheDocument();
    expect(screen.queryByText("生成完成")).not.toBeInTheDocument();
    expect(styles).not.toContain(".session-item-running::before");
    expect(styles).not.toContain(".session-item-completed::before");
    expect(styles).not.toContain(".session-item-failed::before");
    expect(styles).not.toContain(".session-item-canceled::before");
    expect(styles).not.toContain(".session-task-indicator");
    expect(styles).not.toMatch(/\.session-item-(?:running|completed|failed|canceled)[^{]*{[^}]*box-shadow/);
    expect(styles).toContain("border: 2px solid var(--color-hairline-soft)");
    expect(styles).toContain("rgba(204, 120, 92, 1)");
    expect(styles).toContain("rgba(204, 120, 92, 0)");
    expect(styles).toContain("@keyframes session-running-border-pulse");
    expect(styles).toContain(".composer-abort-button");
    expect(styles).toContain("background: var(--color-error)");
  });

  it("会话任务状态样式经过 Tailwind 构建后仍保留", async () => {
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const result = await postcss([tailwindcss(resolve(process.cwd(), "tailwind.config.ts")), autoprefixer]).process(styles, {
      from: resolve(process.cwd(), "src/side-panel/styles.css"),
    });

    expect(result.css).not.toContain(".session-item-running:before");
    expect(result.css).not.toContain(".session-item-completed:before");
    expect(result.css).not.toContain(".session-item-failed:before");
    expect(result.css).not.toContain(".session-item-canceled:before");
    expect(result.css).not.toContain(".session-task-indicator");
    expect(result.css).not.toMatch(/\.session-item-(?:running|completed|failed|canceled)[^{]*{[^}]*box-shadow/);
    expect(result.css).toContain(".session-item-running");
    expect(result.css).toContain(".session-item-completed");
    expect(result.css).toContain(".session-item-failed");
    expect(result.css).toContain(".session-item-canceled");
    expect(result.css).toContain("@keyframes session-running-border-pulse");
    expect(result.css).toMatch(/50%\s*{\s*border-color:\s*(?:rgba\(204,\s*120,\s*92,\s*0\)|#cc785c00);?\s*}/);
    expect(result.css).toContain(".composer-abort-button");
  });

  it("边界确认弹窗使用实体背景并在选择选项后允许提交", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ ok: true, attached: true, message: "已提交边界确认。" });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const dialogStyle = styles.match(/\.boundary-choice-dialog\s*{[^}]+}/)?.[0] ?? "";
    const activeChoiceStyle = styles.match(/\.boundary-choice-item-active\s*{[^}]+}/)?.[0] ?? "";
    useAppStore.setState({
      browserControlEnabled: true,
      browserAutomationMode: "controlled_enhanced",
      pendingBoundaryChoice: {
        type: "browserControl.boundaryChoiceRequest",
        requestId: "boundary-1",
        question: "是否允许本轮发送一个无凭据请求？",
        reason: "需要验证脱敏重放草案的响应结构。",
        choices: [
          {
            id: "send_once",
            title: "发送一次无凭据重放",
            description: "只允许发送当前草案一次。",
            risk: "medium",
            grants: ["send_single_confirmed_replay_request_without_credentials"],
          },
          {
            id: "summary_only",
            title: "只保留脱敏草案",
            description: "不发送网络请求，只继续分析草案。",
            risk: "low",
            grants: [],
          },
        ],
        allowMultiple: false,
        expiresAt: Date.now() + 60_000,
      },
    });

    render(<App />);

    const submitButton = screen.getByRole("button", { name: "提交选择" });
    expect(dialogStyle).toContain("background: color-mix");
    expect(dialogStyle).not.toContain("var(--color-surface)");
    expect(activeChoiceStyle).not.toContain("var(--color-surface)");
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /发送一次无凭据重放/ }));

    expect(screen.getAllByText("授权：1 项").length).toBeGreaterThan(0);
    expect(screen.queryByText("send_single_confirmed_replay_request_without_credentials")).not.toBeInTheDocument();
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    await waitFor(() => expect(useAppStore.getState().pendingBoundaryChoice).toBeUndefined());
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "browserControl.boundaryChoiceRespond",
        requestId: "boundary-1",
        selectedChoiceIds: ["send_once"],
      }),
      expect.any(Function),
    );
  });

  it("边界确认提交后会立即禁用按钮避免重复提交", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn((_message: unknown, _callback?: (response: unknown) => void) => undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
    useAppStore.setState({
      browserControlEnabled: true,
      browserAutomationMode: "controlled_enhanced",
      pendingBoundaryChoice: {
        type: "browserControl.boundaryChoiceRequest",
        requestId: "boundary-slow",
        question: "是否允许本轮发送一个无凭据请求？",
        reason: "需要验证草案响应结构。",
        choices: [
          {
            id: "send_once",
            title: "发送一次",
            description: "只允许发送当前草案一次。",
            risk: "medium",
            grants: ["send_single_confirmed_replay_request_without_credentials"],
          },
          {
            id: "summary_only",
            title: "只看草案",
            description: "不发送网络请求。",
            risk: "low",
            grants: [],
          },
        ],
        allowMultiple: false,
        expiresAt: Date.now() + 60_000,
      },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: /发送一次/ }));
    const submitButton = screen.getByRole("button", { name: "提交选择" });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
    const boundaryRespondCalls = sendMessage.mock.calls.filter(([message]) =>
      (message as { type?: string }).type === "browserControl.boundaryChoiceRespond");
    expect(boundaryRespondCalls).toHaveLength(1);
  });

  it("发送后切换到新会话时原会话会显示运行中并在完成后显示完成态", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-session-task",
      name: "任务渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-task",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-session-task",
      providerId: "provider-session-task",
      displayName: "任务模型",
      modelId: "gpt-task",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
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

    render(<App />);

    await user.type(await screen.findByLabelText("对话输入"), "第一问");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    const firstSessionButton = await screen.findByRole("button", { name: "第一问" });
    await user.click(getSessionListNewChatButton());

    expect(firstSessionButton.closest(".session-item")).toHaveClass("session-item-running");

    await act(async () => {
      portMessageListener?.({ type: "complete", content: "第一答" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firstSessionButton.closest(".session-item")).toHaveClass("session-item-completed");
    });
  });

  it("用户切回原会话后会取消该会话的任务边框状态展示", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-session-task-dismiss",
      name: "任务渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-task",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-session-task-dismiss",
      providerId: "provider-session-task-dismiss",
      displayName: "任务模型",
      modelId: "gpt-task",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
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

    render(<App />);

    await user.type(await screen.findByLabelText("对话输入"), "第一问");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    const firstSessionButton = await screen.findByRole("button", { name: "第一问" });
    await user.click(getSessionListNewChatButton());
    expect(firstSessionButton.closest(".session-item")).toHaveClass("session-item-running");

    await user.click(firstSessionButton);

    expect(firstSessionButton.closest(".session-item")).not.toHaveClass("session-item-running");
    expect(screen.getByRole("button", { name: "终止" })).toBeInTheDocument();

    await act(async () => {
      portMessageListener?.({ type: "complete", content: "第一答" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firstSessionButton.closest(".session-item")).not.toHaveClass("session-item-completed");
    });
  });

  it("用户切回运行中会话再离开时会恢复该会话的运行中边框状态展示", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-session-task-redismiss",
      name: "任务渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-task",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-session-task-redismiss",
      providerId: "provider-session-task-redismiss",
      displayName: "任务模型",
      modelId: "gpt-task",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
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

    render(<App />);

    await user.type(await screen.findByLabelText("对话输入"), "第一问");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(portMessageListener).toBeTypeOf("function");
    });
    const firstSessionButton = await screen.findByRole("button", { name: "第一问" });
    await user.click(getSessionListNewChatButton());
    expect(firstSessionButton.closest(".session-item")).toHaveClass("session-item-running");

    await user.click(firstSessionButton);
    expect(firstSessionButton.closest(".session-item")).not.toHaveClass("session-item-running");

    const secondSessionButton = within(screen.getByLabelText("历史会话"))
      .getAllByRole("button", { name: "新对话" })
      .find((button) => button.closest(".session-item"));
    expect(secondSessionButton).toBeDefined();
    await user.click(secondSessionButton!);

    expect(firstSessionButton.closest(".session-item")).toHaveClass("session-item-running");
  });

  it("发送中即使当前模型不可发送也允许点击终止", async () => {
    const abortActiveChatTask = vi.fn();
    useAppStore.setState({
      providers: [],
      models: [],
      sending: true,
      abortActiveChatTask,
    });

    render(<App />);

    const abortButton = await screen.findByRole("button", { name: "终止" });
    expect(abortButton).toBeEnabled();
    await userEvent.click(abortButton);
    expect(abortActiveChatTask).toHaveBeenCalledTimes(1);
  });

  it("聊天 Markdown 代码块显示类型和快捷操作栏", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-markdown-code-block",
        title: "代码块会话",
        messages: [
          createChatMessage({
            id: "message-markdown-code-block",
            role: "assistant",
            content: "```json\n{\"name\":\"demo\"}\n```",
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByLabelText("代码类型 json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换为换行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开代码块" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制源码" })).toBeInTheDocument();
  });

  it("设置中提供全局聊天偏好入口", async () => {
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));

    expect(screen.getByRole("region", { name: "聊天偏好" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "聊天偏好" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "全局系统提示词" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Network 请求相关性筛选 Prompt" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "全局 temperature" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "发送快捷键" })).toHaveDisplayValue("Enter");
    expect(screen.getByRole("checkbox", { name: "默认展开左侧历史面板" })).toBeInTheDocument();
    expect(styles).toContain(".chat-preference-switch-input");
    expect(styles).toContain(".chat-preference-switch-control");
    expect(styles).toContain(".chat-preference-switch-input:checked + .chat-preference-switch-control");
    expect(styles).toContain("border-radius: 9999px;");
    expect(styles).toContain("transform: translateX(18px);");
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));");
    expect(styles).toContain(".chat-preference-field");
    expect(styles).toContain(".chat-preference-number-input");
    expect(styles).toContain("width: 100%;");
    expect(styles).toContain("min-width: 0;");
    expect(styles).toContain("align-content: start;");
    expect(styles).toContain("align-items: start;");
  });

  it("全局系统提示词使用中文输入法组合输入时只保存最终文本", async () => {
    const updateChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState({ updateChatPreferences });

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));

    const systemPromptInput = screen.getByRole("textbox", { name: "全局系统提示词" });
    fireEvent.compositionStart(systemPromptInput);
    fireEvent.change(systemPromptInput, { target: { value: "你是网页助手，shizhong" } });

    expect(systemPromptInput).toHaveDisplayValue("你是网页助手，shizhong");
    expect(updateChatPreferences).not.toHaveBeenCalled();

    fireEvent.compositionEnd(systemPromptInput, { target: { value: "你是网页助手，始终" } });

    expect(systemPromptInput).toHaveDisplayValue("你是网页助手，始终");
    expect(updateChatPreferences).toHaveBeenCalledTimes(1);
    expect(updateChatPreferences).toHaveBeenCalledWith({ systemPrompt: "你是网页助手，始终" });
  });

  it("全局系统提示词支持清空并跟随外部偏好同步", async () => {
    const updateChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState({ updateChatPreferences });

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("tab", { name: "聊天偏好" }));

    const systemPromptInput = screen.getByRole("textbox", { name: "全局系统提示词" });
    fireEvent.change(systemPromptInput, { target: { value: "" } });

    expect(systemPromptInput).toHaveDisplayValue("");
    expect(updateChatPreferences).toHaveBeenCalledWith({ systemPrompt: "" });

    act(() => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          systemPrompt: "外部同步提示词",
        },
      }));
    });

    expect(systemPromptInput).toHaveDisplayValue("外部同步提示词");
  });

  it("聊天区提供历史抽屉和当前聊天设置抽屉入口", async () => {
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "历史" }));

    expect(screen.getByRole("dialog", { name: "历史记录" })).toHaveClass("history-drawer");
    expect(styles).toMatch(/\.drawer-panel\s*\{[^}]*right-0/s);
    expect(styles).toMatch(/\.history-drawer\s*\{[^}]*left:\s*0;/s);
    expect(styles).toMatch(/\.history-drawer\s*\{[^}]*right:\s*auto;/s);
    expect(styles).toMatch(/\.history-drawer\s*\{[^}]*border-right:\s*1px solid var\(--color-hairline\);/s);
    expect(styles).toMatch(/\.history-drawer\[data-state="open"\]\s*\{[^}]*animation:\s*history-drawer-fade-in/s);
    expect(styles).toMatch(/\.history-drawer\[data-state="closed"\]\s*\{[^}]*animation:\s*history-drawer-fade-out/s);
    expect(styles).toContain("@keyframes dialog-overlay-fade-in");
    expect(styles).toContain("@keyframes dialog-overlay-fade-out");
    expect(styles).toContain("@keyframes history-drawer-fade-in");
    expect(styles).toContain("@keyframes history-drawer-fade-out");
    expect(styles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.history-drawer\[data-state\][\s\S]*animation:\s*none;/s);

    await userEvent.click(screen.getByRole("button", { name: "关闭历史记录" }));
    await userEvent.click(screen.getByRole("button", { name: "打开当前聊天设置" }));

    expect(screen.getByRole("dialog", { name: "当前聊天设置" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "当前聊天设置" })).not.toHaveClass("history-drawer");
    expect(screen.getByRole("textbox", { name: "当前聊天系统提示词" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "当前聊天 temperature" })).toHaveClass("chat-preference-number-input");
    expect(screen.getByRole("spinbutton", { name: "当前聊天 top_k" }).closest("label")).toHaveClass("chat-preference-field");
  });

  it("导出按钮位于当前聊天设置右侧并提供 Markdown、Word、PDF 格式", async () => {
    const user = userEvent.setup();
    const downloadMock = createDownloadMock();
    await saveChatSession(
      createChatSession({
        id: "session-export",
        title: "导出会话",
        createdAt: 1700000000000,
        updatedAt: 1700000100000,
        messages: [
          createChatMessage({
            id: "message-export-user",
            role: "user",
            content: "请总结页面",
            createdAt: 1700000000000,
          }),
          createChatMessage({
            id: "message-export-assistant",
            role: "assistant",
            content: "页面重点如下。",
            createdAt: 1700000100000,
          }),
        ],
      }),
    );

    render(<App />);

    const settingsButton = screen.getByRole("button", { name: "打开当前聊天设置" });
    const exportButton = await screen.findByRole("button", { name: "导出当前聊天" });
    expect(settingsButton.nextElementSibling).toContainElement(exportButton);

    await user.click(exportButton);
    expect(screen.getByRole("menuitem", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Word" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "PDF" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("消息列表"));
    expect(screen.queryByRole("menuitem", { name: "Markdown" })).not.toBeInTheDocument();

    await user.click(exportButton);
    await user.click(screen.getByRole("menuitem", { name: "Markdown" }));

    expect(downloadMock.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadMock.anchor.download).toMatch(/^导出会话-\d{4}-\d{2}-\d{2}\.md$/);
    expect(downloadMock.anchor.href).toBe("blob:chat-export");
    expect(downloadMock.click).toHaveBeenCalledTimes(1);
    expect(downloadMock.revokeObjectURL).toHaveBeenCalledWith("blob:chat-export");
    const blob = downloadMock.createObjectURL.mock.calls[0][0] as Blob;
    const markdown = await blob.text();
    expect(markdown).toContain("# 导出会话\n\n- 导出时间：");
    expect(markdown).toContain("## 用户 · 2023-11-14T22:13:20.000Z\n\n```\n请总结页面\n```");
  });

  it("隐私按钮位于导出按钮右侧，激活后切换为保存按钮", async () => {
    const user = userEvent.setup();
    render(<App />);

    const exportButton = await screen.findByRole("button", { name: "导出当前聊天" });
    const privateButton = screen.getByRole("button", { name: "进入隐私模式" });
    expect(exportButton.parentElement?.nextElementSibling).toBe(privateButton);

    await user.click(privateButton);

    const saveButton = screen.getByRole("button", { name: "保存隐私对话" });
    expect(saveButton).toHaveTextContent("保存");
    expect(saveButton).toHaveClass("chat-private-trigger-active");
  });

  it("已存在且包含消息的历史会话不显示隐私按钮", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-existing",
        title: "已有会话",
        messages: [
          createChatMessage({
            id: "message-existing",
            role: "user",
            content: "已有消息",
          }),
        ],
      }),
    );

    render(<App />);

    await screen.findByRole("button", { name: "导出当前聊天" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "进入隐私模式" })).not.toBeInTheDocument();
    });
  });

  it("隐私模式有消息时切换历史会话需要确认，取消后保留隐私对话", async () => {
    const user = userEvent.setup();
    const sendMessage = createShortcutRuntimeMock();
    const nativeConfirm = vi.spyOn(window, "confirm");
    await saveModelProvider({
      id: "provider-1",
      name: "默认渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-test",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await saveProviderModel({
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
    });
    await saveChatSession(
      createChatSession({
        id: "session-existing",
        title: "已有会话",
        messages: [
          createChatMessage({
            id: "message-existing",
            role: "user",
            content: "已有消息",
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(getSessionListNewChatButton());
    await user.click(screen.getByRole("button", { name: "进入隐私模式" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "隐私问题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));

    await user.click(screen.getByRole("button", { name: "已有会话" }));

    const dialog = screen.getByRole("dialog", { name: "丢弃隐私对话？" });
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("当前隐私对话尚未保存，切换历史会话会丢弃这些内容。");
    await user.click(screen.getByRole("button", { name: "继续保留" }));

    expect(screen.getByRole("button", { name: "保存隐私对话" })).toBeInTheDocument();
    expect(screen.getByText("隐私问题")).toBeInTheDocument();
  });

  it("隐私模式有消息时确认切换历史会话会丢弃隐私对话", async () => {
    const user = userEvent.setup();
    const sendMessage = createShortcutRuntimeMock();
    await saveModelProvider({
      id: "provider-1",
      name: "默认渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-test",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await saveProviderModel({
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
    });
    await saveChatSession(
      createChatSession({
        id: "session-existing",
        title: "已有会话",
        messages: [
          createChatMessage({
            id: "message-existing",
            role: "user",
            content: "已有消息",
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(getSessionListNewChatButton());
    await user.click(screen.getByRole("button", { name: "进入隐私模式" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "隐私问题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));

    await user.click(screen.getByRole("button", { name: "已有会话" }));
    await user.click(screen.getByRole("button", { name: "丢弃并切换" }));

    expect(screen.queryByRole("button", { name: "保存隐私对话" })).not.toBeInTheDocument();
    expect(screen.getByText("已有消息")).toBeInTheDocument();
  });

  it("可以导出当前会话为 Word 和 PDF", async () => {
    const user = userEvent.setup();
    const downloadMock = createSequentialDownloadMock(["blob:word-export"]);
    const printMock = createPrintWindowMock();
    await saveChatSession(
      createChatSession({
        id: "session-export-doc",
        title: "导出文档",
        createdAt: 1700000000000,
        updatedAt: 1700000100000,
        messages: [
          createChatMessage({
            id: "message-export-doc",
            role: "assistant",
            content: "导出内容",
            createdAt: 1700000000000,
          }),
        ],
      }),
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导出当前聊天" }));
    await user.click(screen.getByRole("menuitem", { name: "Word" }));
    await waitFor(() => {
      expect(downloadMock.anchor.download).toMatch(/^导出文档-\d{4}-\d{2}-\d{2}\.docx$/);
    });

    await user.click(await screen.findByRole("button", { name: "导出当前聊天" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF" }));
    await waitFor(() => {
      expect(printMock.print).toHaveBeenCalledTimes(1);
    });

    expect(downloadMock.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadMock.revokeObjectURL).toHaveBeenCalledWith("blob:word-export");
    expect(printMock.document.write).toHaveBeenCalledWith(expect.stringContaining("<pre><code>导出内容</code></pre>"));
  });

  it("导出失败时显示右上角通知且可手动渐出关闭", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "open").mockReturnValue(null);
    await saveChatSession(
      createChatSession({
        id: "session-export-failed",
        title: "导出失败会话",
        messages: [
          createChatMessage({
            id: "message-export-failed",
            role: "assistant",
            content: "导出内容",
            createdAt: 1700000000000,
          }),
        ],
      }),
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导出当前聊天" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法打开打印窗口，请允许弹窗后重试");
    expect(document.querySelector(".chat-failure")).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "关闭通知：导出失败" }));

    expect(screen.getByText("无法打开打印窗口，请允许弹窗后重试").closest(".notification")).toHaveClass("notification-closing");
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(screen.queryByText("无法打开打印窗口，请允许弹窗后重试")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Word 导出失败时通过统一通知显示具体错误提示", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("Word 文件生成失败");
    });
    await saveChatSession(
      createChatSession({
        id: "session-export-word-failed",
        title: "Word 失败会话",
        messages: [
          createChatMessage({
            id: "message-export-word-failed",
            role: "assistant",
            content: "导出内容",
            createdAt: 1700000000000,
          }),
        ],
      }),
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导出当前聊天" }));
    await user.click(screen.getByRole("menuitem", { name: "Word" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Word 文件生成失败");
  });

  it("当前聊天系统提示词使用中文输入法组合输入时只保存最终文本", async () => {
    const updateActiveSessionChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({ updateActiveSessionChatPreferences });

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "打开当前聊天设置" }));

    const systemPromptInput = screen.getByRole("textbox", { name: "当前聊天系统提示词" });
    fireEvent.compositionStart(systemPromptInput);
    fireEvent.change(systemPromptInput, { target: { value: "shizhong" } });

    expect(systemPromptInput).toHaveDisplayValue("shizhong");
    expect(updateActiveSessionChatPreferences).not.toHaveBeenCalled();

    fireEvent.compositionEnd(systemPromptInput, { target: { value: "始终" } });

    expect(systemPromptInput).toHaveDisplayValue("始终");
    expect(updateActiveSessionChatPreferences).toHaveBeenCalledTimes(1);
    expect(updateActiveSessionChatPreferences).toHaveBeenCalledWith({ systemPrompt: "始终" });
  });

  it("聊天偏好可以控制宽面板左侧历史区域默认折叠并手动展开", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "你是网页助手",
        temperature: 0.7,
        maxTokens: 1024,
        historyDrawerDefaultOpen: false,
      },
      updatedAt: 1,
    });

    render(<App />);

    await screen.findByRole("button", { name: "展开历史对话" });
    expect(screen.queryByLabelText("历史会话")).not.toBeInTheDocument();
    expect(screen.queryByText("默认文件夹")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开历史对话" }));

    expect(screen.getByLabelText("历史会话")).toBeInTheDocument();
    expect(screen.getByText("默认文件夹")).toBeInTheDocument();
  });

  it("聊天偏好可以保存发送按钮快捷键", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "发送快捷键" }), "ctrl_enter");

    expect(updateChatPreferences).toHaveBeenCalledWith({ sendShortcut: "ctrl_enter" });
  });

  it("聊天偏好可以保存浏览器自动化默认模式", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        defaultBrowserAutomationMode: "normal_restricted",
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "浏览器自动化默认模式" }), "controlled_enhanced");

    expect(updateChatPreferences).toHaveBeenCalledWith({ defaultBrowserAutomationMode: "controlled_enhanced" });
  });

  it("聊天偏好可以保存工具调用总开关并显示空工具列表", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    expect(screen.getByText("暂无可用工具")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "启用工具调用" }));

    expect(updateChatPreferences).toHaveBeenCalledWith({ toolCallingEnabled: false });
  });

  it("聊天偏好工具列表支持按分类筛选并批量启用运行态未满足的默认工具", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    registeredModelToolsMock.tools = [
      {
        id: "web_search.tavily",
        name: "tavily_search",
        description: "搜索公开网页",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "external_web", capabilities: ["search_public_web"], risk: "low" },
      },
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
      },
      {
        id: "browser.click",
        name: "click",
        description: "点击页面上的目标元素",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
      },
    ];
    useAppStore.setState({
      browserControlEnabled: false,
      chatPreferences: {
        ...useAppStore.getState().chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: [],
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    act(() => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          toolCallingEnabled: true,
          enabledToolIds: [],
        },
      }));
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "工具能力筛选" }), "observe_page");
    await user.selectOptions(screen.getByRole("combobox", { name: "工具运行要求筛选" }), "browser_control");
    await user.selectOptions(screen.getByRole("combobox", { name: "工具风险筛选" }), "low");

    expect(screen.getByRole("checkbox", { name: "启用工具 take_snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用工具 take_snapshot" })).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "启用工具 click" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "启用筛选结果" }));

    expect(updateChatPreferences).toHaveBeenCalledWith({ enabledToolIds: ["browser.take_snapshot"] });
  });
  it("MCP 设置页可以新增 Server 并通过工具列表按钮展开已发现工具", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    registeredModelToolsMock.tools = [
      {
        id: "mcp.mysql.query",
        name: "mcp_mysql_query",
        displayName: "MySQL.query",
        description: "执行 SQL 查询",
        groupId: "mcp_remote",
        parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
        toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
      },
    ];
    await saveAppSetting({
      key: MCP_SETTINGS_KEY,
      value: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "http://127.0.0.1:3000/mcp",
            enabled: true,
            tools: [
              {
                name: "query",
                description: "执行 SQL 查询",
                inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      updatedAt: 1,
    });
    await useAppStore.getState().loadChannelConfig();
    useAppStore.setState({
      updateChatPreferences,
      chatPreferences: {
        ...useAppStore.getState().chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: [],
      },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "MCP 工具" }));
    expect(screen.getByRole("heading", { name: "MCP 工具" })).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.queryByText("query")).not.toBeInTheDocument();

    const toggleButton = screen.getByRole("button", { name: "工具列表" });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    await user.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "MySQL 工具列表" })).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByText("执行 SQL 查询")).toBeInTheDocument();
    expect(screen.getByTitle("query · 执行 SQL 查询")).toBeInTheDocument();

    await user.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "MySQL 工具列表" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "工具运行要求筛选" }), "mcp_remote");
    expect(screen.getByRole("checkbox", { name: "启用工具 MySQL.query" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "启用工具 mcp_mysql_query" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "启用筛选结果" }));

    expect(updateChatPreferences).toHaveBeenCalledWith({ enabledToolIds: ["mcp.mysql.query"] });
  });

  it("MCP 设置页可以在 Server 列表中禁用远程工具注册", async () => {
    const user = userEvent.setup();
    registeredModelToolsMock.tools = [
      {
        id: "mcp.mysql.query",
        name: "mcp_mysql_query",
        displayName: "MySQL.query",
        description: "执行 SQL 查询",
        groupId: "mcp_remote",
        parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
        toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
      },
    ];
    await saveAppSetting({
      key: MCP_SETTINGS_KEY,
      value: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "http://127.0.0.1:3000/mcp",
            enabled: true,
            tools: [
              {
                name: "query",
                description: "执行 SQL 查询",
                inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      updatedAt: 1,
    });
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallingEnabled: true,
        enabledToolIds: ["mcp.mysql.query"],
      },
      updatedAt: 1,
    });
    await useAppStore.getState().loadChannelConfig();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "MCP 工具" }));

    expect(screen.getByRole("checkbox", { name: "禁用 MCP Server MySQL" })).toBeChecked();
    expect(screen.getByRole("button", { name: "刷新工具" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "禁用 MCP Server MySQL" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "启用 MCP Server MySQL" })).not.toBeChecked());
    expect(screen.getByText("状态：已禁用 · 已发现工具：1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新工具" })).toBeDisabled();
    await expect(getAppSetting("chatPreferences")).resolves.toMatchObject({ enabledToolIds: [] });

    registeredModelToolsMock.tools = [];
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "工具运行要求筛选" }), "mcp_remote");

    expect(screen.queryByRole("checkbox", { name: "启用工具 MySQL.query" })).not.toBeInTheDocument();
  });

  it("MCP 设置页删除 Server 需要二次确认", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await saveAppSetting({
      key: MCP_SETTINGS_KEY,
      value: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "http://127.0.0.1:3000/mcp",
            enabled: true,
            tools: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      updatedAt: 1,
    });
    await useAppStore.getState().loadChannelConfig();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "MCP 工具" }));

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("MySQL")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("MySQL")).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it("聊天偏好可以保存工具调用展示方式", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "工具调用展示方式" }), "compact");

    expect(updateChatPreferences).toHaveBeenCalledWith({ toolCallDisplayMode: "compact" });
  });

  it("聊天偏好可以保存非紧凑模式下是否显示工具调用过程", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.click(screen.getByRole("checkbox", { name: "非紧凑模式显示工具调用过程" }));

    expect(updateChatPreferences).toHaveBeenCalledWith({ showToolCallProcessInAssistantMode: true });
  });

  it("聊天偏好可以保存浏览器自动化最大工具轮次", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    const input = screen.getByRole("spinbutton", { name: "全局 浏览器自动化最大工具轮次" });
    expect(input).not.toHaveAttribute("min");
    expect(input).not.toHaveAttribute("max");

    fireEvent.change(input, { target: { value: "48" } });

    expect(updateChatPreferences).toHaveBeenLastCalledWith({ browserAutomationMaxToolIterations: 48 });
  });

  it("聊天偏好可以保存新对话默认注入页面上下文", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    await user.click(screen.getByRole("checkbox", { name: "新对话默认注入当前页面上下文" }));

    expect(updateChatPreferences).toHaveBeenCalledWith({ injectPageContextByDefault: false });
  });

  it("聊天偏好可以保存新对话默认提取 HTML 源码", async () => {
    const user = userEvent.setup();
    const updateChatPreferences = vi.fn(async () => undefined);
    useAppStore.setState({
      chatPreferences: {
        systemPrompt: "你是网页助手",
        aiRequestRetryCount: 5,
        browserAutomationMaxToolIterations: 32,
        toolCallingEnabled: false,
        enabledToolIds: [],
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: "enter",
        historyDrawerDefaultOpen: true,
        injectPageContextByDefault: true,
        extractHtmlByDefault: false,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: false,
      },
      updateChatPreferences,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    const extractHtmlSwitch = screen.getByRole("checkbox", { name: "新对话默认提取 HTML 源码" });
    expect(extractHtmlSwitch).not.toBeChecked();

    await user.click(extractHtmlSwitch);

    expect(updateChatPreferences).toHaveBeenCalledWith({ extractHtmlByDefault: true });
  });

  it("历史展开按钮位于模型选择器左侧，折叠时左侧面板不占宽", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "你是网页助手",
        temperature: 0.7,
        maxTokens: 1024,
        historyDrawerDefaultOpen: true,
      },
      updatedAt: 1,
    });
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    render(<App />);

    const modelSelector = document.querySelector(".model-selector");
    const toggleButton = screen.getByRole("button", { name: "折叠历史对话" });

    expect(modelSelector?.previousElementSibling).toBe(toggleButton);
    await userEvent.click(toggleButton);
    expect(screen.queryByLabelText("历史会话")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开历史对话" })).toHaveAttribute("aria-expanded", "false");
    expect(styles).toContain("grid-template-columns: 0 minmax(0, 1fr);");
    expect(styles).toContain("transition:");
    expect(styles).toContain("transform:");
    expect(styles).toContain("opacity:");
    expect(styles).toContain(".chat-model-row {");
    expect(styles).toContain("position: relative;");
    expect(styles).toContain(".chat-history-panel-toggle");
    expect(styles).toMatch(/\.chat-history-panel-toggle\s*\{[^}]*display:\s*none;/s);
    expect(styles).toMatch(/@media \(min-width:\s*720px\)\s*\{[^}]*\.chat-history-panel-toggle\s*\{[^}]*display:\s*grid;/s);
    expect(styles).toContain("left: 0;");
    expect(styles).toContain("top: 50%;");
    expect(styles).toContain("transform: translate(-50%, -50%);");
    expect(styles).toContain("border-radius: 9999px;");
    expect(styles).toMatch(/\.chat-panel\s*\{[^}]*overflow:\s*visible;/s);
    expect(styles).toContain(".chat-history-panel-toggle::before");
    expect(styles).toContain("box-shadow:");
    expect(styles).toContain("0 -4px 0 currentColor");
    expect(styles).toContain("0 4px 0 currentColor");
    expect(styles).toContain("left: 50%;");
    expect(styles).toContain("top: 50%;");
  });

  it("聊天主区域固定在面板内并只让消息列表内部滚动", async () => {
    render(<App />);

    const mainLayout = document.querySelector(".chat-main-layout");
    const chatPanel = document.querySelector(".chat-panel");
    const messageList = await screen.findByLabelText("消息列表");
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    expect(mainLayout).toBeInTheDocument();
    expect(chatPanel).toBeInTheDocument();
    expect(messageList).toHaveClass("message-list");
    expect(chatPanel).toContainElement(messageList);
    expect(styles).toContain("height: 100%;");
    expect(styles).toContain("height: 100vh;");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).toContain("overflow-auto");
    expect(styles).not.toContain("min-h-[calc(100vh-96px)]");
    expect(styles).not.toContain("min-h-48");
  });

  it("聊天消息中的长代码不会撑出消息容器", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-long-code",
        title: "长代码",
        messages: [
          createChatMessage({
            id: "message-long-code",
            content: "```python\nbox_annotator = sv.BoxAnnotator()\nannotated_frame = box_annotator.annotate(scene=image, detections=detections)\n```",
          }),
        ],
      }),
    );

    render(<App />);

    const messageList = await screen.findByLabelText("消息列表");
    const codeText = await screen.findByText((content) => content.includes("box_annotator"));
    const codeBlock = codeText.closest(".markdown-code-block");
    const bubbleWrap = codeText.closest(".message-bubble-wrap");
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    expect(messageList).toContainElement(bubbleWrap as HTMLElement | null);
    expect(codeBlock).toHaveClass("markdown-code-block-nowrap");
    expect(codeBlock).toHaveClass("markdown-code-block-collapsed");
    expect(styles).toContain(".message-bubble-wrap");
    expect(styles).toContain("min-width: 0;");
    expect(styles).toContain(".markdown-code-block-body");
    expect(styles).toContain("@apply min-w-0 max-w-full overflow-auto;");

    await user.click(screen.getByRole("button", { name: "展开代码块" }));
    expect(codeBlock).toHaveClass("markdown-code-block-expanded");
  });

  it("助手消息旁展示可展开的 Network 请求详情附件", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-network-attachment",
        title: "Network 分析",
        messages: [
          createChatMessage({
            id: "message-network-attachment",
            role: "assistant",
            content: "登录接口返回 500。",
            networkContextAttachment: {
              id: "network-1",
              title: "Network 请求详情 token=secret-token",
              summary: "已注入 1 个 Network 请求：POST 500 https://api.example.com/login",
              createdAt: 2,
              redacted: true,
              truncated: false,
              requests: [
                {
                  id: "req-1",
                  url: "https://api.example.com/login",
                  method: "POST",
                  status: 500,
                  requestHeaders: [{ name: "Authorization", value: "[已脱敏]" }],
                  responseHeaders: [{ name: "Content-Type", value: "application/json" }],
                  responseBody: '{"error":"failed"}',
                  redacted: true,
                  truncated: false,
                },
                {
                  id: "req-2",
                  url: "https://api.example.com/profile",
                  method: "GET",
                  status: 200,
                  responseBody: '{"name":"zhangsan"}',
                  redacted: false,
                  truncated: false,
                },
              ],
            },
          }),
        ],
      }),
    );

    render(<App />);

    const attachment = await screen.findByText("Network 请求详情");
    expect(attachment.closest(".message-network-attachment")).toBeInTheDocument();
    await user.click(attachment);
    expect(screen.getByText("已注入 2 个 Network 请求：POST 500 https://api.example.com/login")).toBeInTheDocument();
    expect(screen.getByText(/Authorization/)).not.toBeVisible();
    expect(screen.getByText(/zhangsan/)).not.toBeVisible();
    await user.click(screen.getByText("POST 500 https://api.example.com/login"));
    expect(screen.getByText(/Authorization/)).toBeInTheDocument();
    expect(screen.getByText(/Authorization/)).toBeVisible();
    expect(screen.getByText(/zhangsan/)).not.toBeVisible();
    await user.click(screen.getByText("GET 200 https://api.example.com/profile"));
    expect(screen.getByText(/zhangsan/)).toBeVisible();
    expect(readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8")).toContain(".message-network-attachment");
    expect(readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8")).toContain(".message-network-request-item summary");
    expect(readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8")).toContain("overflow-wrap: anywhere;");
  });

  it("助手消息旁展示网络搜索附件时使用独立样式类名", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-web-search-attachment",
        title: "网络搜索",
        messages: [
          createChatMessage({
            id: "message-web-search-attachment",
            role: "assistant",
            content: "已参考 Tavily 搜索结果。",
            toolAttachments: [
              {
                id: "tool-attachment-search",
                kind: "web-search",
                title: "网络搜索结果",
                summary: "搜索问题：Tavily 搜索 API",
                provider: "tavily",
                query: "Tavily 搜索 API",
                answer: "Tavily 提供网络搜索 API。",
                results: [
                  {
                    title: "Tavily Search",
                    url: "https://docs.tavily.com/documentation/api-reference/endpoint/search",
                    content: "Search endpoint documentation.",
                  },
                ],
                createdAt: 2,
                redacted: false,
                truncated: false,
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const attachment = await screen.findByText("网络搜索结果");
    expect(attachment.closest(".message-web-search-attachment")).toBeInTheDocument();
    expect(attachment.closest(".message-network-attachment")).not.toBeInTheDocument();

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(styles).toContain(".message-web-search-attachment");
    expect(styles).toContain(".message-web-search-result-item summary");
  });

  it("助手消息旁 Network 历史脏附件展示前会重新脱敏", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-network-unsafe-attachment",
        title: "Network 脏附件",
        messages: [
          createChatMessage({
            id: "message-network-unsafe",
            role: "assistant",
            content: "旧版本保存的 Network 附件。",
            networkContextAttachment: {
              id: "network-unsafe",
              title: "Network 请求详情 token=secret-token",
              summary: "旧版本保存的 Network 请求：POST 500 https://api.example.com/login?token=secret-token&safe=1",
              createdAt: 2,
              redacted: false,
              truncated: false,
              requests: [
                {
                  id: "req-unsafe",
                  url: "https://api.example.com/login?token=secret-token&safe=1",
                  method: "POST",
                  status: 500,
                  requestHeaders: [
                    { name: "Authorization", value: "Bearer secret-token" },
                    { name: "Cookie", value: "sid=secret-cookie" },
                  ],
                  requestBody: '{"password":"123456","name":"zhangsan"}',
                  responseBody: '{"access_token":"secret-token"}',
                  redacted: false,
                  truncated: false,
                },
              ],
            },
          }),
        ],
      }),
    );

    render(<App />);

    await user.click(await screen.findByText("Network 请求详情"));
    await user.click(screen.getByText("POST 500 https://api.example.com/login?token=[已脱敏]&safe=1"));

    expect(screen.getAllByText(/\[已脱敏\]/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-cookie/)).not.toBeInTheDocument();
    expect(screen.queryByText(/123456/)).not.toBeInTheDocument();
  });

  it("用户和 AI 消息下方提供重新生成按钮，并在确认后重新请求", async () => {
    const user = userEvent.setup();
    const regenerateMessage = vi.fn(async () => undefined);
    await saveChatSession(
      createChatSession({
        id: "session-regenerate-ui",
        title: "重新生成",
        messages: [
          createChatMessage({
            id: "message-regenerate-user",
            role: "user",
            content: "请总结页面",
            createdAt: 1,
          }),
          createChatMessage({
            id: "message-regenerate-ai",
            role: "assistant",
            content: "页面总结",
            createdAt: 2,
          }),
        ],
      }),
    );
    useAppStore.setState({ regenerateMessage });

    render(<App />);

    await screen.findByText("请总结页面");
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".message-regenerate-button"));
    expect(buttons).toHaveLength(2);
    expect(buttons[0].closest(".message-regenerate-action")).toHaveClass("message-regenerate-action-user");
    expect(buttons[1].closest(".message-regenerate-action")).toHaveClass("message-regenerate-action-assistant");

    await user.click(buttons[1]);
    expect(screen.getByRole("dialog", { name: "确认重新生成" })).toBeInTheDocument();
    expect(screen.getByText("重新生成会丢弃这条消息后面的聊天记录。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认重新生成" }));

    expect(regenerateMessage).toHaveBeenCalledWith("message-regenerate-ai");
  });

  it("用户和 AI 消息下方提供复制按钮，AI 消息额外提供导出图片按钮", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_value: string) => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText,
      },
    });
    await saveChatSession(
      createChatSession({
        id: "session-message-copy-ui",
        title: "消息复制",
        messages: [
          createChatMessage({
            id: "message-copy-user",
            role: "user",
            content: "用户输入正文",
            createdAt: 1,
            promptInvocations: [
              {
                promptId: "prompt-1",
                title: "提示词",
                contentSnapshot: "不应复制的 Prompt 快照",
              },
            ],
          }),
          createChatMessage({
            id: "message-copy-ai",
            role: "assistant",
            content: "AI 正文",
            thinking: "AI 思考",
            createdAt: 2,
            networkContextAttachment: {
              id: "network-1",
              title: "Network 请求详情",
              summary: "旧摘要",
              createdAt: 2,
              redacted: true,
              truncated: false,
              requests: [
                {
                  id: "req-1",
                  url: "https://api.example.com/login",
                  method: "POST",
                  status: 500,
                  requestHeaders: [{ name: "Authorization", value: "[已脱敏]" }],
                  redacted: true,
                  truncated: false,
                },
              ],
            },
            toolAttachments: [
              {
                id: "tool-attachment-search",
                kind: "web-search",
                title: "网络搜索结果",
                summary: "搜索问题：Tavily API",
                provider: "tavily",
                query: "Tavily API",
                answer: "Tavily 搜索结果",
                results: [
                  {
                    title: "Tavily Docs",
                    url: "https://docs.tavily.com/search",
                    content: "官方文档内容",
                  },
                ],
                createdAt: 2,
                redacted: false,
                truncated: false,
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    await screen.findByText("用户输入正文");
    expect(screen.getByRole("button", { name: "复制用户消息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制 AI 消息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 AI 消息图片" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制用户消息" }));
    expect(writeText).toHaveBeenLastCalledWith("用户输入正文");

    await user.click(screen.getByRole("button", { name: "复制 AI 消息" }));
    const assistantMarkdown = writeText.mock.calls.at(-1)?.[0] as string;
    expect(assistantMarkdown).toContain("> 思考过程：AI 思考");
    expect(assistantMarkdown).toContain("AI 正文");
    expect(assistantMarkdown).toContain("# Network 请求详情附件");
    expect(assistantMarkdown).toContain("# 网络搜索结果附件");
  });

  it("AI 消息导出图片在剪贴板图片写入失败时下载 PNG 并释放 Blob URL", async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => {
      throw new Error("剪贴板不可用");
    });
    vi.stubGlobal("ClipboardItem", class ClipboardItemMock {
      constructor(readonly items: Record<string, Blob>) {}
    });
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        write,
        writeText: vi.fn(async () => undefined),
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      font: "",
      textBaseline: "",
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(callback: BlobCallback) {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const click = vi.fn();
    const anchor = document.createElement("a");
    Object.defineProperty(anchor, "click", { configurable: true, value: click });
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === "a") {
        return anchor;
      }

      return Document.prototype.createElement.call(document, tagName, options);
    });
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:message-image";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    await saveChatSession(
      createChatSession({
        id: "session-message-image-export",
        title: "消息图片",
        messages: [
          createChatMessage({
            id: "message-image-ai",
            role: "assistant",
            content: "# AI 正文\n\n- 要点一",
            thinking: "AI 思考",
            createdAt: 2,
          }),
        ],
      }),
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导出 AI 消息图片" }));

    expect(write).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toMatch(/^AI消息-\d{4}-\d{2}-\d{2}\.png$/);
    expect(anchor.href).toBe("blob:message-image");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:message-image");
  });

  it("重新生成确认浮层可以取消或点击外部关闭", async () => {
    const user = userEvent.setup();
    const regenerateMessage = vi.fn(async () => undefined);
    await saveChatSession(
      createChatSession({
        id: "session-regenerate-dismiss",
        title: "重新生成取消",
        messages: [
          createChatMessage({
            id: "message-regenerate-dismiss-user",
            role: "user",
            content: "需要重新生成的问题",
            createdAt: 1,
          }),
          createChatMessage({
            id: "message-regenerate-dismiss-ai",
            role: "assistant",
            content: "旧回复",
            createdAt: 2,
          }),
        ],
      }),
    );
    useAppStore.setState({ regenerateMessage });

    render(<App />);

    await screen.findByText("需要重新生成的问题");
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".message-regenerate-button"));
    await user.click(buttons[1]);
    await user.click(within(screen.getByRole("dialog", { name: "确认重新生成" })).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "确认重新生成" })).not.toBeInTheDocument();
    expect(regenerateMessage).not.toHaveBeenCalled();

    await user.click(buttons[1]);
    expect(screen.getByRole("dialog", { name: "确认重新生成" })).toBeInTheDocument();
    await user.click(screen.getByRole("heading", { name: "Browser AI Assistant" }));

    expect(screen.queryByRole("dialog", { name: "确认重新生成" })).not.toBeInTheDocument();
    expect(regenerateMessage).not.toHaveBeenCalled();
  });

  it("用户消息可以直接编辑并用纸飞机按钮重新发送", async () => {
    const user = userEvent.setup();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const editAndRegenerateUserMessage = vi.fn(async () => undefined);
    await saveChatSession(
      createChatSession({
        id: "session-edit-user-message",
        title: "编辑用户消息",
        messages: [
          createChatMessage({
            id: "message-edit-user",
            role: "user",
            content: "原始问题",
            createdAt: 1,
          }),
          createChatMessage({
            id: "message-edit-ai",
            role: "assistant",
            content: "旧回复",
            createdAt: 2,
          }),
        ],
      }),
    );
    useAppStore.setState({ editAndRegenerateUserMessage });

    render(<App />);

    await screen.findByText("原始问题");
    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    const editor = screen.getByRole("textbox", { name: "编辑用户消息" });
    await user.clear(editor);
    await user.type(editor, "改写后的问题");
    await user.click(screen.getByRole("button", { name: "发送编辑后的消息" }));

    expect(editAndRegenerateUserMessage).toHaveBeenCalledWith("message-edit-user", "改写后的问题");
    expect(screen.queryByRole("dialog", { name: "确认重新生成" })).not.toBeInTheDocument();
    expect(styles).toContain(".message-bubble-wrap:has(.message-edit-panel)");
    expect(styles).toContain("width: 80%;");
  });

  it("用户消息编辑态可以用叉号按钮取消且不重发", async () => {
    const user = userEvent.setup();
    const editAndRegenerateUserMessage = vi.fn(async () => undefined);
    await saveChatSession(
      createChatSession({
        id: "session-cancel-edit-user-message",
        title: "取消编辑用户消息",
        messages: [
          createChatMessage({
            id: "message-cancel-edit-user",
            role: "user",
            content: "原始问题",
            createdAt: 1,
          }),
          createChatMessage({
            id: "message-cancel-edit-ai",
            role: "assistant",
            content: "旧回复",
            createdAt: 2,
          }),
        ],
      }),
    );
    useAppStore.setState({ editAndRegenerateUserMessage });

    render(<App />);

    await screen.findByText("原始问题");
    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    const editor = screen.getByRole("textbox", { name: "编辑用户消息" });
    await user.clear(editor);
    await user.type(editor, "不应该发送的内容");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));

    expect(screen.queryByRole("textbox", { name: "编辑用户消息" })).not.toBeInTheDocument();
    expect(screen.getByText("原始问题")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "确认重新生成" })).not.toBeInTheDocument();
    expect(editAndRegenerateUserMessage).not.toHaveBeenCalled();
  });

  it("请求失败时不再展示失败重试占位入口，并改用统一通知", async () => {
    act(() => {
      useAppStore.setState({ failure: { message: "请求失败，请重试" } });
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败，请重试");
    expect(document.querySelector(".chat-failure")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("统一通知固定在右上角并在五秒后自动关闭", async () => {
    vi.useFakeTimers();
    useAppStore.getState().addNotification({ type: "warning", title: "测试通知", message: "五秒后关闭" });
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("五秒后关闭");
    expect(styles).toContain(".notification-host");
    expect(styles).toContain("right-4");
    expect(styles).toContain("top-4");
    expect(styles).toContain("@keyframes notification-slide-in");
    expect(styles).toContain("@keyframes notification-slide-out");
    expect(styles).toContain(".notification-closing");
    expect(styles).toContain("transform: translateX(28px);");
    expect(styles).not.toContain(".chat-failure");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText("五秒后关闭").closest(".notification")).toHaveClass("notification-closing");
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(screen.queryByText("五秒后关闭")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("相同失败消息连续出现时仍会重复弹出通知", async () => {
    const user = userEvent.setup();
    act(() => {
      useAppStore.setState({ failure: { message: "请求失败，请重试" } });
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败，请重试");
    await user.click(screen.getByRole("button", { name: "关闭通知：操作失败" }));

    act(() => {
      useAppStore.setState({ failure: { message: "请求失败，请重试" } });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败，请重试");
  });

  it("多条通知并发时已有通知的自动关闭计时不会被新通知重置", async () => {
    vi.useFakeTimers();
    useAppStore.getState().addNotification({ type: "info", title: "第一条", message: "第一条消息" });

    render(<App />);

    expect(screen.getByText("第一条消息")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      useAppStore.getState().addNotification({ type: "success", title: "第二条", message: "第二条消息" });
    });

    expect(screen.getByText("第一条消息")).toBeInTheDocument();
    expect(screen.getByText("第二条消息")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("第一条消息").closest(".notification")).toHaveClass("notification-closing");
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(screen.queryByText("第一条消息")).not.toBeInTheDocument();
    expect(screen.getByText("第二条消息")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("聊天消息中的有序列表和无序列表展示可见序号标记", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-list-markers",
        title: "列表渲染",
        messages: [
          createChatMessage({
            id: "message-list-markers",
            content: "- 无序第一项\n- 无序第二项\n\n1. 有序第一项\n2. 有序第二项",
          }),
        ],
      }),
    );

    render(<App />);

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    await screen.findByText("无序第一项");
    const lists = screen.getAllByRole("list");
    const unorderedList = lists.find((list) => list.tagName.toLowerCase() === "ul");
    const orderedList = lists.find((list) => list.tagName.toLowerCase() === "ol");

    expect(unorderedList).toBeInTheDocument();
    expect(unorderedList?.tagName.toLowerCase()).toBe("ul");
    expect(orderedList).toBeInTheDocument();
    expect(screen.getByText("无序第一项")).toBeInTheDocument();
    expect(screen.getByText("有序第一项")).toBeInTheDocument();
    const unorderedMarkerRule = styles.match(/\.message-bubble ul > li::before \{[\s\S]*?\}/)?.[0] ?? "";
    expect(unorderedMarkerRule).toContain('content: "";');
    expect(unorderedMarkerRule).toContain("top: 0.7em;");
    expect(unorderedMarkerRule).toContain("transform: translateY(-50%);");
    expect(unorderedMarkerRule).toContain("width: 0.275rem;");
    expect(unorderedMarkerRule).toContain("height: 0.275rem;");
    expect(unorderedMarkerRule).toContain("border-radius: 9999px;");
    expect(styles).toContain("counter(message-list-item)");
    expect(styles).toContain(".message-bubble li");
    expect(styles).toContain(".message-bubble ol > li");
    expect(styles).toContain(".message-bubble ol > li::before");
    expect(styles).toContain("font-size: 0.875rem;");
    expect(styles).toContain(".message-bubble li > ol");
    expect(styles).toContain("margin-top: 0.25rem;");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("max-width: 100%;");
  });

  it("聊天正文段落和列表正文使用两端对齐但代码保持左对齐", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-justify",
        title: "两端对齐",
        messages: [
          createChatMessage({
            id: "message-justify",
            content: "这是一段需要两端对齐的聊天正文，用来验证普通段落排版。\n\n- 第一条列表内容也需要两端对齐\n\n```ts\nconst value = 1;\n```",
          }),
        ],
      }),
    );

    render(<App />);

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(await screen.findByText(/需要两端对齐的聊天正文/)).toBeInTheDocument();
    expect(styles).toContain("text-align: justify;");
    expect(styles).toContain("text-align-last: left;");
    expect(styles).toContain(".markdown-code-block-body pre");
    expect(styles).toContain("text-align: left;");
  });

  it("历史会话长标题不撑出横向滚动，归档会话同样截断", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-long-title", title: "分析一下。 sdfsadfsadfsadfsdfsdfsdfsdfsdfsdf" }));
    await saveChatSession(createChatSession({ id: "session-archived-long-title", title: "看看这个仓库是做什么的 sdfsadfsadfsadfsdfsdf", archived: true }));

    render(<App />);

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const activeTitle = await screen.findByText(/sdfsadfsadfsadfsdfsdfs/);
    await user.click(screen.getByRole("button", { name: /已归档/ }));
    const archivedTitle = await screen.findByText(/看看这个仓库是做什么的/);
    const activeTitleButton = activeTitle.closest("button");

    expect(activeTitle).toHaveClass("session-item-title");
    expect(archivedTitle).toHaveClass("session-item-title");
    expect(activeTitleButton).toHaveAttribute("title", "分析一下。 sdfsadfsadfsadfsdfsdfsdfsdfsdfsdf");
    expect(styles).toContain(".session-folder-stack-scroll");
    expect(styles).toContain("overflow-x: hidden;");
    expect(styles).toContain(".session-item");
    expect(styles).toContain("overflow: visible;");
    expect(styles).toContain(".session-item-menu-wrap");
    expect(styles).toContain(".session-title-button");
    expect(styles).toContain(".session-item-title");
    expect(styles).toContain("text-overflow: ellipsis;");
  });

  it("点击历史会话整行空白区域可以切换会话且菜单不会误触发切换", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-first",
        title: "第一条历史",
        updatedAt: 2,
        messages: [createChatMessage({ id: "message-first", role: "user", content: "第一条内容", createdAt: 2 })],
      }),
    );
    await saveChatSession(
      createChatSession({
        id: "session-second",
        title: "第二条历史",
        updatedAt: 1,
        messages: [createChatMessage({ id: "message-second", role: "user", content: "第二条内容", createdAt: 1 })],
      }),
    );

    render(<App />);

    expect(await screen.findByText("第一条内容")).toBeInTheDocument();
    const secondRow = screen.getByText("第二条历史").closest(".session-item-row");
    expect(secondRow).not.toBeNull();
    await user.click(secondRow as HTMLElement);
    expect(await screen.findByText("第二条内容")).toBeInTheDocument();

    const firstMenuButton = screen.getByRole("button", { name: "会话操作 第一条历史" });
    await user.click(firstMenuButton);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByText("第二条内容")).toBeInTheDocument();
  });

  it("标题生成等待中时历史会话标题处展示等待态", async () => {
    await saveChatSession(createChatSession({ id: "session-title-generating", title: "第一问", titleGenerating: true } as Partial<ChatSession>));

    render(<App />);

    const title = await screen.findByText("生成标题中...");
    expect(title).toHaveClass("session-item-title");
    expect(title.closest("button")).toHaveAttribute("title", "第一问");
    expect(screen.queryByText("会话：第一问")).not.toBeInTheDocument();
  });

  it("未配置模型时在输入框区域提示用户配置 API Key 并禁用发送", () => {
    render(<App />);

    expect(screen.getByText("请先配置 API Key 后再开始对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("配置渠道模型后可以按渠道和模型选择并切换流式模式", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-1",
      name: "默认渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-example",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-1",
      providerId: "provider-1",
      displayName: "默认 OpenAI",
      modelId: "gpt-test",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    expect(await screen.findByDisplayValue("默认渠道 / 默认 OpenAI")).toBeInTheDocument();
    expect(screen.getByLabelText("当前模型")).toHaveClass("model-select-input");
    expect(screen.getByText("当前模型").closest("label")).toHaveClass("model-select-label-inline");
    const streamSwitch = screen.getByRole("switch", { name: "流式响应" });
    expect(streamSwitch).toHaveAttribute("aria-checked", "true");
    const appendContextSwitch = screen.getByRole("switch", { name: "拼接上下文" });
    expect(appendContextSwitch).toHaveAttribute("aria-checked", "true");
    expect(appendContextSwitch.closest(".context-strip")).toBeNull();
    expect(appendContextSwitch.closest(".composer-switches")).not.toBeNull();
    await user.click(appendContextSwitch);
    expect(screen.getByRole("switch", { name: "拼接上下文" })).toHaveAttribute("aria-checked", "false");
    await user.click(streamSwitch);
    await user.type(screen.getByLabelText("对话输入"), "你好");

    expect(screen.getByRole("switch", { name: "流式响应" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  it("默认按 Enter 触发发送，Shift+Enter 保留换行", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-shortcut",
      name: "快捷键渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-shortcut",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-shortcut",
      providerId: "provider-shortcut",
      displayName: "快捷键模型",
      modelId: "gpt-shortcut",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("快捷键渠道 / 快捷键模型");
    const input = screen.getByLabelText("对话输入");
    await user.type(input, "保留换行{Shift>}{Enter}{/Shift}继续输入");
    expect(hasChatSendCall(sendMessage)).toBe(false);
    expect(input.textContent).toBe("保留换行\n继续输入");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));
    const chatRequest = getLastChatRequest(sendMessage);
    expect(chatRequest?.messages?.at(-1)?.content).toBe("保留换行\n继续输入");
    expect(input.textContent).toBe("");
  });

  it.each([
    { shortcut: "shift_enter", eventInit: { key: "Enter", shiftKey: true } },
    { shortcut: "ctrl_enter", eventInit: { key: "Enter", ctrlKey: true } },
    { shortcut: "ctrl_shift_enter", eventInit: { key: "Enter", ctrlKey: true, shiftKey: true } },
    { shortcut: "alt_enter", eventInit: { key: "Enter", altKey: true } },
  ] satisfies Array<{ shortcut: SendShortcut; eventInit: Parameters<typeof fireEvent.keyDown>[1] }>)("按聊天偏好的 $shortcut 触发发送", async ({ shortcut, eventInit }) => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-shortcut-custom",
      name: "快捷键渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-shortcut",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-shortcut-custom",
      providerId: "provider-shortcut-custom",
      displayName: "快捷键模型",
      modelId: "gpt-shortcut",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "你是网页助手",
        temperature: 0.7,
        maxTokens: 1024,
        sendShortcut: shortcut,
        historyDrawerDefaultOpen: true,
      },
      updatedAt: 1,
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("快捷键渠道 / 快捷键模型");
    const input = screen.getByLabelText("对话输入");
    await user.type(input, "快捷发送");

    fireEvent.keyDown(input, eventInit);

    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));
    const chatRequest = getLastChatRequest(sendMessage);
    expect(chatRequest?.messages?.at(-1)?.content).toBe("快捷发送");
    expect(input.textContent).toBe("");
  });

  it("输入斜杠可以搜索并调用 Prompt，气泡只显示标题链接", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-prompt",
      name: "Prompt 渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-test",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-prompt",
      providerId: "provider-prompt",
      displayName: "Prompt 模型",
      modelId: "gpt-prompt",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "模型系统提示词",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({ ok: true, text: "页面内容", truncated: false, usedFallback: true });
        return undefined;
      }

      callback({ ok: true, content: "AI 回复" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await saveModelProvider(provider);
    await saveProviderModel(model);
    await savePromptTemplate(createPromptTemplate());

    render(<App />);

    await screen.findByDisplayValue("Prompt 渠道 / Prompt 模型");
    await user.click(screen.getByRole("switch", { name: "流式响应" }));
    const input = screen.getByLabelText("对话输入");
    await user.type(input, "/风险{Enter}");
    const composerPromptToken = screen.getByRole("button", { name: "已调用提示词：风险审查" });
    expect(composerPromptToken).toHaveClass("prompt-token-link");
    expect(composerPromptToken).not.toHaveTextContent("用");
    expect(input.closest(".prompt-inline-editor")).not.toBeNull();
    expect(composerPromptToken.closest(".prompt-inline-editor")).toBe(input.closest(".prompt-inline-editor"));
    expect(input.textContent).toBe("");

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: "已调用提示词：风险审查" })).not.toBeInTheDocument();

    await user.type(input, "/风险");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("button", { name: "已调用提示词：风险审查" })).not.toBeInTheDocument();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "已调用提示词：风险审查" }).closest(".prompt-inline-editor")).toBe(input.closest(".prompt-inline-editor"));

    await user.type(input, "请结合页面输出建议");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send")).toBe(true));
    const chatRequest = sendMessage.mock.calls
      .map(([message]) => message as { type: string; messages?: ChatMessage[] })
      .find((message) => message.type === "chat.send");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("已调用提示词：");
    expect(chatRequest?.messages?.at(-1)?.content).toContain("从安全、隐私和可维护性三个角度审查。");
    const messagePromptToken = await screen.findByLabelText("用户消息提示词：风险审查");
    expect(messagePromptToken).toHaveClass("prompt-token-link");
    expect(messagePromptToken).not.toHaveTextContent("用");
    expect(messagePromptToken.closest(".message-prompt-token-strip")?.tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: "用户消息提示词：风险审查" })).not.toBeInTheDocument();
    expect(screen.queryByText("从安全、隐私和可维护性三个角度审查。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    const editInput = screen.getByRole("textbox", { name: "编辑用户消息" });
    const editPromptToken = screen.getByRole("button", { name: "编辑消息提示词：风险审查" });
    expect(editPromptToken.closest(".prompt-inline-editor")).toBe(editInput.closest(".prompt-inline-editor"));
  });

  it("斜杠 Prompt 菜单支持上下键切换并用 Enter 或 Tab 选择", async () => {
    const user = userEvent.setup();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    await savePromptTemplate(createPromptTemplate({ id: "prompt-first", title: "第一条", content: "第一条内容", sortOrder: 10 }));
    await savePromptTemplate(createPromptTemplate({ id: "prompt-second", title: "第二条", content: "第二条内容", sortOrder: 20 }));

    render(<App />);

    const input = screen.getByLabelText("对话输入");
    await user.type(input, "/");
    const firstOption = screen.getByRole("option", { name: /第一条/ });
    const secondOption = screen.getByRole("option", { name: /第二条/ });
    expect(firstOption).toHaveAttribute("aria-selected", "true");
    expect(secondOption).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(firstOption).toHaveAttribute("aria-selected", "false");
    expect(secondOption).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "已调用提示词：第二条" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Backspace" });
    await user.type(input, "/");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("button", { name: "已调用提示词：第一条" })).toBeInTheDocument();
    expect(styles).toContain(".slash-command-option-active");
    expect(styles).toContain("box-shadow: inset 3px 0 0 var(--color-primary);");
  });

  it("输入法组合输入期间不会用 Enter 快捷键触发发送", async () => {
    const provider: ModelProvider = {
      id: "provider-shortcut-composition",
      name: "快捷键渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-shortcut",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-shortcut-composition",
      providerId: "provider-shortcut-composition",
      displayName: "快捷键模型",
      modelId: "gpt-shortcut",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("快捷键渠道 / 快捷键模型");
    const input = screen.getByLabelText("对话输入");
    input.textContent = "shuru";
    fireEvent.input(input);
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(hasChatSendCall(sendMessage)).toBe(false);

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));
  });

  it("请求失败时展示统一通知且不保存失败消息", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-failure",
      name: "失败渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-failure",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-failure",
      providerId: "provider-failure",
      displayName: "失败模型",
      modelId: "gpt-failure",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
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
        ok: false,
        message: "请求失败，请重试",
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

    render(<App />);

    await screen.findByDisplayValue("失败渠道 / 失败模型");
    await user.click(screen.getByRole("switch", { name: "流式响应" }));
    await user.type(screen.getByLabelText("对话输入"), "失败消息");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send")).toBe(true));

    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败，请重试");
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI 失败消息")).not.toBeInTheDocument();
  });

  it("设置界面使用设置级 Tab 导航并以窄面板卡片管理渠道模型", async () => {
    const user = userEvent.setup();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    const settingsLayout = screen.getByRole("heading", { name: "设置" }).closest(".settings-main-layout");
    expect(settingsLayout).toBeInTheDocument();
    expect(styles).toContain(".settings-main-layout");
    expect(styles).toContain("overflow-auto");
    expect(screen.getByRole("tab", { name: "渠道管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "提取规则" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "同步设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "任务策略" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "提示词" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "界面偏好" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" }).closest("section")?.className).not.toContain("lg:grid-cols");
    expect(screen.getByRole("heading", { name: "设置" }).parentElement?.parentElement).toHaveClass("w-[80%]");
    expect(screen.getByRole("tablist", { name: "设置分类" })).toHaveClass("settings-tabs-scroll", "overflow-x-auto");
    expect(screen.getByRole("tablist", { name: "设置分类" }).className).not.toContain("lg:flex-col");
    expect(screen.queryByLabelText("历史会话")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型渠道" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI 标题生成模型")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新增渠道" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "添加模型" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "提取规则" }));

    expect(screen.getByRole("button", { name: "新增规则" })).toBeInTheDocument();
    expect(screen.queryByLabelText("CSS/XPath 列表")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "提示词" }));
    expect(screen.getByRole("heading", { name: "提示词" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增提示词" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "任务策略" }));
    expect(screen.getByRole("heading", { name: "任务策略" })).toBeInTheDocument();
    expect(screen.getByText("Network/API 分析")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "同步设置" }));

    expect(screen.getByRole("checkbox", { name: "开启同步" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "开启自动同步" })).not.toBeChecked();
    expect(screen.getByText("备份当前插件域本地存储的全部内容，密钥和远程凭据除外")).toBeInTheDocument();
    expect(screen.getByText("加密关闭时，API Key、聊天记录和配置会以明文进入远程备份")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动恢复" })).toBeInTheDocument();
  });

  it("同步设置提供三种备份目标、独立自动同步和加密风险提示", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "同步设置" }));

    expect(screen.getByRole("checkbox", { name: "开启同步" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "开启自动同步" })).not.toBeChecked();
    expect(screen.getByText("备份当前插件域本地存储的全部内容，密钥和远程凭据除外")).toBeInTheDocument();
    expect(screen.getByText("加密关闭时，API Key、聊天记录和配置会以明文进入远程备份")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "开启同步" }));
    expect(screen.getByRole("combobox", { name: "备份目标" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "备份前缀" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "最大备份数量" })).toHaveDisplayValue("3");

    await user.selectOptions(screen.getByRole("combobox", { name: "备份目标" }), "webdav");
    expect(screen.getByRole("textbox", { name: "WebDAV 地址" })).toBeInTheDocument();
    expect(screen.getByLabelText("WebDAV 密码")).toHaveAttribute("type", "password");

    await user.selectOptions(screen.getByRole("combobox", { name: "备份目标" }), "s3");
    expect(screen.getByRole("textbox", { name: "S3 Endpoint" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "S3 Region" })).toHaveDisplayValue("auto");
    expect(screen.getByLabelText("S3 Secret Key")).toHaveAttribute("type", "password");
  });

  it("同步操作结果通过统一通知展示而不是设置页内联文本", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "sync.configureAlarm") {
        callback({ ok: true });
        return undefined;
      }

      callback({ ok: true, message: "备份完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "同步设置" }));
    await user.click(screen.getByRole("checkbox", { name: "开启同步" }));
    await user.click(screen.getByRole("button", { name: "手动备份" }));

    expect(await screen.findByRole("status")).toHaveTextContent("备份完成");
    expect(screen.getByRole("status").closest(".notification")).toBeInTheDocument();
    expect(document.querySelector(".settings-main-layout")?.textContent).not.toContain("备份完成");
  });

  it("相同同步结果连续出现时仍会重复弹出通知", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "sync.configureAlarm") {
        callback({ ok: true });
        return undefined;
      }

      callback({ ok: true, message: "备份完成" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "同步设置" }));
    await user.click(screen.getByRole("checkbox", { name: "开启同步" }));
    await user.click(screen.getByRole("button", { name: "手动备份" }));
    expect(await screen.findByRole("status")).toHaveTextContent("备份完成");
    await user.click(screen.getByRole("button", { name: "关闭通知：同步完成" }));

    await user.click(screen.getByRole("button", { name: "手动备份" }));

    expect(await screen.findByRole("status")).toHaveTextContent("备份完成");
  });

  it("提示词管理支持新增编辑删除和拖拽排序", async () => {
    const user = userEvent.setup();
    const longPromptPreview = "第一条内容第一行，用来验证列表预览。\n第二行内容继续展示。\n第三行内容需要被隐藏。";
    await savePromptTemplate(createPromptTemplate({ id: "prompt-first", title: "第一条", content: longPromptPreview, sortOrder: 10 }));
    await savePromptTemplate(createPromptTemplate({ id: "prompt-second", title: "第二条", content: "第二条内容", sortOrder: 20 }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "提示词" }));
    expect(screen.getByText((_, element) => element?.textContent === longPromptPreview)).toHaveClass("prompt-template-preview");
    await user.click(screen.getByRole("button", { name: "新增提示词" }));
    await user.type(screen.getByRole("textbox", { name: "提示词标题" }), "第三条");
    await user.type(screen.getByRole("textbox", { name: "Prompt 内容" }), "第三条内容");
    await user.click(screen.getByRole("button", { name: "保存提示词" }));

    expect(await screen.findByRole("button", { name: /第三条/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /第三条/ }));
    await user.clear(screen.getByRole("textbox", { name: "提示词标题" }));
    await user.type(screen.getByRole("textbox", { name: "提示词标题" }), "第三条已编辑");
    await user.click(screen.getByRole("button", { name: "保存提示词" }));

    expect(await screen.findByRole("button", { name: /第三条已编辑/ })).toBeInTheDocument();

    const draggedPrompt = screen.getByRole("button", { name: /第二条/ }).closest("article");
    const targetPrompt = screen.getByRole("button", { name: /第一条/ }).closest("article");
    expect(draggedPrompt).not.toBeNull();
    expect(targetPrompt).not.toBeNull();
    fireEvent.dragStart(draggedPrompt as Element, { dataTransfer: createDataTransfer() });
    fireEvent.dragOver(targetPrompt as Element);
    fireEvent.drop(targetPrompt as Element, { dataTransfer: createDataTransfer() });

    await waitFor(() => {
      expect(useAppStore.getState().promptTemplates.map((prompt) => prompt.title).slice(0, 2)).toEqual(["第二条", "第一条"]);
    });

    await user.click(screen.getByRole("button", { name: /第三条已编辑/ }));
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "删除提示词" }));

    expect(screen.queryByRole("button", { name: /第三条已编辑/ })).not.toBeInTheDocument();
  });

  it("同步设置输入框使用中文输入法组合输入时只保存最终文本", async () => {
    const user = userEvent.setup();
    const updateSyncSettings = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        syncSettings: {
          ...state.syncSettings,
          ...updates,
        },
      }));
    });
    useAppStore.setState({
      syncSettings: {
        ...useAppStore.getState().syncSettings,
        syncEnabled: true,
      },
      updateSyncSettings,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "同步设置" }));

    const backupPrefixInput = screen.getByRole("textbox", { name: "备份前缀" });
    fireEvent.compositionStart(backupPrefixInput);
    fireEvent.change(backupPrefixInput, { target: { value: "beifen" } });

    expect(backupPrefixInput).toHaveDisplayValue("beifen");
    expect(updateSyncSettings).not.toHaveBeenCalled();

    fireEvent.compositionEnd(backupPrefixInput, { target: { value: "备份" } });

    expect(backupPrefixInput).toHaveDisplayValue("备份");
    expect(updateSyncSettings).toHaveBeenCalledTimes(1);
    expect(updateSyncSettings).toHaveBeenCalledWith({ backupPrefix: "备份" });
  });

  it("恢复同步备份可以在弹窗中选择指定远程备份并二次确认", async () => {
    const user = userEvent.setup();
    const loadRemoteBackups = vi.fn(async () => undefined);
    const restoreNow = vi.fn(async () => undefined);
    await saveAppSetting({
      key: "syncSettings",
      value: { syncEnabled: true },
      updatedAt: 1,
    });
    useAppStore.setState({
      remoteBackups: [
        {
          id: "browserAiAssistantBackup:work:1",
          prefix: "work",
          createdAt: 1,
          provider: "chrome_sync",
          encrypted: false,
        },
        {
          id: "browserAiAssistantBackup:home:2",
          prefix: "home",
          createdAt: 2,
          provider: "chrome_sync",
          encrypted: true,
        },
      ],
      loadRemoteBackups,
      restoreNow,
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "同步设置" }));
    await user.click(screen.getByRole("button", { name: "手动恢复" }));

    expect(loadRemoteBackups).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "选择远程备份恢复" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /home/ })).toBeInTheDocument();
    const homeBackupRow = screen.getByText("home").closest(".sync-restore-backup-row");
    expect(homeBackupRow).toBeInTheDocument();
    expect(homeBackupRow).toHaveTextContent("home");
    expect(homeBackupRow).toHaveTextContent(formatBackupTestTime(2));
    expect(homeBackupRow).toHaveTextContent("已加密");
    await user.click(screen.getByRole("radio", { name: /home/ }));
    expect(restoreNow).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认覆盖本地数据并恢复" }));
    expect(restoreNow).toHaveBeenCalledWith("browserAiAssistantBackup:home:2");
  });

  it("可以在渠道管理中选择和取消 AI 标题生成模型", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-title",
      name: "标题渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-title",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const chatModel: ProviderModel = {
      id: "model-chat",
      providerId: "provider-title",
      displayName: "聊天模型",
      modelId: "gpt-chat",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const titleModel: ProviderModel = {
      ...chatModel,
      id: "model-title",
      displayName: "标题模型",
      modelId: "gpt-title",
    };
    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(titleModel);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const titleModelSelect = await screen.findByLabelText("AI 标题生成模型");

    await user.selectOptions(titleModelSelect, "model-title");

    await waitFor(() => {
      expect(useAppStore.getState().models.find((model) => model.id === "model-title")?.isTitleModel).toBe(true);
      expect(useAppStore.getState().models.find((model) => model.id === "model-chat")?.isTitleModel).toBe(false);
    });

    await user.selectOptions(titleModelSelect, "");

    await waitFor(() => {
      expect(useAppStore.getState().models.every((model) => !model.isTitleModel)).toBe(true);
    });
  });

  it("可以在渠道管理中选择默认对话模型且位置在 AI 标题生成模型上方", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-default",
      name: "默认渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-default",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const chatModel: ProviderModel = {
      id: "model-chat",
      providerId: "provider-default",
      displayName: "聊天模型",
      modelId: "gpt-chat",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const defaultModel: ProviderModel = {
      ...chatModel,
      id: "model-default",
      displayName: "默认对话模型",
      modelId: "gpt-default",
    };
    await saveModelProvider(provider);
    await saveProviderModel(chatModel);
    await saveProviderModel(defaultModel);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    const defaultModelSelect = await screen.findByLabelText("默认对话模型");
    const titleModelSelect = screen.getByLabelText("AI 标题生成模型");

    expect(defaultModelSelect.compareDocumentPosition(titleModelSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.selectOptions(defaultModelSelect, "model-default");

    await waitFor(() => {
      expect(useAppStore.getState().defaultChatModelId).toBe("model-default");
    });

    await user.selectOptions(defaultModelSelect, "");

    await waitFor(() => {
      expect(useAppStore.getState().defaultChatModelId).toBe("");
    });
  });

  it("可以在渠道管理中新增多个渠道并为当前渠道添加模型", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));

    expect(screen.getByRole("button", { name: /新渠道 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新渠道 2/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue("新渠道 2")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("渠道名称"));
    await user.type(screen.getByLabelText("渠道名称"), "OpenRouter");
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));

    expect(screen.getByRole("button", { name: /OpenRouter/ })).toBeInTheDocument();
    expect(screen.getAllByText("gpt-4.1-mini").length).toBeGreaterThanOrEqual(2);
  });

  it("可以用英文逗号批量手动添加模型", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.type(screen.getByRole("textbox", { name: "批量添加模型" }), "qwen-plus, deepseek-chat, qwen-plus{enter}");

    expect(screen.getByText("qwen-plus")).toBeInTheDocument();
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.getAllByText("qwen-plus")).toHaveLength(1);
    expect(useAppStore.getState().models.map((model) => model.modelId)).toEqual(["qwen-plus", "deepseek-chat"]);
  });

  it("可以在渠道模型中立即清空当前渠道所有模型", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.type(screen.getByRole("textbox", { name: "批量添加模型" }), "qwen-plus,deepseek-chat{enter}");

    expect(useAppStore.getState().models.map((model) => model.modelId)).toEqual(["gpt-4.1-mini", "qwen-plus", "deepseek-chat"]);
    await user.click(screen.getByRole("button", { name: "清空所有" }));

    expect(useAppStore.getState().models).toEqual([]);
    expect(screen.queryByText("gpt-4.1-mini")).not.toBeInTheDocument();
    expect(screen.queryByText("qwen-plus")).not.toBeInTheDocument();
    expect(screen.queryByText("deepseek-chat")).not.toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("模型设置弹窗可以修改模型 ID", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByRole("button", { name: "设置 gpt-4.1-mini" }));
    const modelIdInput = screen.getByRole("textbox", { name: "模型 ID" });
    await user.clear(modelIdInput);
    await user.type(modelIdInput, "qwen-plus");

    expect(screen.getByRole("button", { name: "测试模型连通性 qwen-plus" })).toBeInTheDocument();
    expect(useAppStore.getState().models[0].modelId).toBe("qwen-plus");
  });

  it("模型 ID 使用中文输入法组合输入时只保存最终文本", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByRole("button", { name: "设置 gpt-4.1-mini" }));

    const modelIdInput = screen.getByRole("textbox", { name: "模型 ID" });
    fireEvent.compositionStart(modelIdInput);
    fireEvent.change(modelIdInput, { target: { value: "shizhong" } });

    expect(modelIdInput).toHaveDisplayValue("shizhong");
    expect(useAppStore.getState().models[0].modelId).toBe("gpt-4.1-mini");

    fireEvent.compositionEnd(modelIdInput, { target: { value: "始终" } });

    expect(modelIdInput).toHaveDisplayValue("始终");
    expect(useAppStore.getState().models[0].modelId).toBe("始终");
  });

  it("可以拉取模型列表、添加远端模型并直接在已添加模型行测试模型连通性", async () => {
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: "",
        truncated: false,
        usedFallback: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        models: [
          { id: "gpt-4.1", displayName: "GPT-4.1" },
          { id: "gpt-4.1-mini", displayName: "GPT-4.1 mini" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "模型测试通过",
      });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "获取模型列表" }));
    expect(await screen.findByRole("status")).toHaveTextContent("模型列表已更新");
    expect(screen.getByRole("region", { name: "当前渠道详情" }).textContent).not.toContain("模型列表已更新");
    await user.type(await screen.findByRole("combobox", { name: "搜索模型" }), "mini");

    expect(screen.queryByRole("option", { name: /GPT-4.1 gpt-4.1$/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /GPT-4.1 mini/ }));

    expect(screen.getAllByText("gpt-4.1-mini").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /已添加/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("region", { name: "连通性校验" })).not.toBeInTheDocument();

    vi.useFakeTimers();
    const testButton = screen.getByRole("button", { name: "测试模型连通性 gpt-4.1-mini" });
    act(() => {
      fireEvent.click(testButton);
    });

    const testedModelRow = testButton.closest("article");
    expect(testedModelRow).toHaveClass("model-connectivity-card");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testedModelRow).toHaveClass("border-[var(--color-success)]");
    expect(screen.queryByText("连通性正常")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(testedModelRow).not.toHaveClass("border-[var(--color-success)]");
  });

  it("已添加模型列表只展示 model_id 和删除测试操作", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));

    expect(screen.getByText("gpt-4.1-mini")).toBeInTheDocument();
    expect(screen.queryByText("新模型 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1-mini" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 gpt-4.1-mini" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "连通性校验" })).not.toBeInTheDocument();
  });

  it("视觉模型可以选择图片、粘贴图片、预览放大并随消息发送图片", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-chat",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-chat",
      providerId: "provider-vision-chat",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    stubFileReaderAsDataUrl();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    const imageInput = screen.getByLabelText("上传图片");
    const textInput = screen.getByLabelText("对话输入");
    await user.upload(imageInput, createImageFile("选择.png"));
    fireEvent.paste(textInput, {
      clipboardData: {
        files: [createImageFile("粘贴.png")],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => createImageFile("粘贴.png"),
          },
        ],
      },
    });

    expect(await screen.findByRole("button", { name: "查看图片 选择.png" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "查看图片 粘贴.png" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看图片 选择.png" }));
    expect(screen.getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭图片预览" }));

    await user.type(textInput, "请描述图片");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));
    const chatRequest = getLastChatRequest(sendMessage);
    const userMessage = chatRequest?.messages?.find((message) => message.role === "user");
    expect(userMessage?.attachments).toHaveLength(2);
    expect(screen.getByRole("button", { name: "查看已发送图片 选择.png" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看已发送图片 选择.png" }));
    expect(screen.getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
    expect(screen.queryByRole("button", { name: "查看图片 选择.png" })).not.toBeInTheDocument();
  });

  it("可以从编辑区删除已添加的图片且发送时不包含该图片", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-remove-image",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-remove-image",
      providerId: "provider-vision-remove-image",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    stubFileReaderAsDataUrl();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    await user.upload(screen.getByLabelText("上传图片"), [createImageFile("保留.png"), createImageFile("删除.png")]);
    expect(await screen.findByRole("button", { name: "查看图片 保留.png" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "查看图片 删除.png" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除图片 删除.png" }));

    expect(screen.queryByRole("button", { name: "查看图片 删除.png" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("对话输入"), "描述剩余图片");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(hasChatSendCall(sendMessage)).toBe(true));
    const chatRequest = getLastChatRequest(sendMessage);
    const userMessage = chatRequest?.messages?.find((message) => message.role === "user");
    expect(userMessage?.attachments).toHaveLength(1);
    expect(userMessage?.attachments?.[0]?.name).toBe("保留.png");
  });

  it("视觉模型可以截取当前标签页可见区域并作为图片加入编辑区", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-screenshot",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-screenshot",
      providerId: "provider-vision-screenshot",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = createShortcutRuntimeMock();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    const screenshotButton = screen.getByRole("button", { name: "截图当前标签页" });
    expect(screenshotButton).toHaveClass("ui-button-secondary");
    expect(screenshotButton).not.toHaveClass("composer-switch");
    await user.click(screenshotButton);

    expect(await screen.findByRole("button", { name: "查看图片 当前标签页截图.png" })).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({ type: "tab.captureVisible" }, expect.any(Function));
  });

  it("当前模型不支持视觉理解时不显示截图按钮", async () => {
    const provider: ModelProvider = {
      id: "provider-text-screenshot",
      name: "文本渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-text",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-text-screenshot",
      providerId: "provider-text-screenshot",
      displayName: "文本模型",
      modelId: "gpt-text",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    createShortcutRuntimeMock();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("文本渠道 / 文本模型");
    expect(screen.queryByRole("button", { name: "截图当前标签页" })).not.toBeInTheDocument();
  });

  it("当前标签页截图失败时在编辑区显示错误", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-screenshot-error",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-screenshot-error",
      providerId: "provider-vision-screenshot-error",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    createShortcutRuntimeMock({
      screenshotResponse: {
        ok: false,
        message: "当前页面无法截图，请切换到普通网页后重试",
      },
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    await user.click(screen.getByRole("button", { name: "截图当前标签页" }));

    expect(await screen.findByText("当前页面无法截图，请切换到普通网页后重试")).toBeInTheDocument();
  });

  it("当前标签页截图超过单张大小限制时不加入编辑区", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-screenshot-large",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-screenshot-large",
      providerId: "provider-vision-screenshot-large",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    createShortcutRuntimeMock({
      screenshotResponse: {
        ok: true,
        attachment: {
          id: "screenshot-large",
          name: "当前标签页截图.png",
          mediaType: "image/png",
          dataUrl: `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}`,
        },
      },
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    await user.click(screen.getByRole("button", { name: "截图当前标签页" }));

    expect(await screen.findByText("单张图片不能超过 5MB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看图片 当前标签页截图.png" })).not.toBeInTheDocument();
  });

  it("图片读取失败时显示错误且不产生未捕获异常", async () => {
    const provider: ModelProvider = {
      id: "provider-vision-read-error",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-read-error",
      providerId: "provider-vision-read-error",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    stubFileReaderError();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    await userEvent.upload(screen.getByLabelText("上传图片"), createImageFile("失败.png"));

    expect(await screen.findByText("图片读取失败，请重新选择图片")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看图片 失败.png" })).not.toBeInTheDocument();
  });

  it("历史用户消息中的图片在重新加载后仍显示并可放大预览", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-image-history",
        title: "图片会话",
        messages: [
          createChatMessage({
            id: "message-image-history",
            role: "user",
            content: "这张图是什么",
            attachments: [
              {
                id: "image-history-1",
                name: "恢复.png",
                mediaType: "image/png",
                dataUrl: "data:image/png;base64,QUJD",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("这张图是什么")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看已发送图片 恢复.png" }));
    expect(screen.getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();
  });

  it("非视觉模型禁用图片输入并拒绝粘贴图片", async () => {
    const provider: ModelProvider = {
      id: "provider-text-chat",
      name: "文本渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-text",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-text-chat",
      providerId: "provider-text-chat",
      displayName: "文本模型",
      modelId: "gpt-text",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("文本渠道 / 文本模型");
    const imageInput = screen.getByLabelText("上传图片");
    const textInput = screen.getByLabelText("对话输入");
    expect(imageInput).toBeDisabled();

    fireEvent.paste(textInput, {
      clipboardData: {
        files: [createImageFile("拒绝.png")],
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => createImageFile("拒绝.png"),
          },
        ],
      },
    });

    expect(await screen.findByText("当前模型不支持视觉理解，无法添加图片")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看图片 拒绝.png" })).not.toBeInTheDocument();
  });

  it("可以在已添加模型设置弹窗中切换视觉理解能力并持久化", async () => {
    const provider: ModelProvider = {
      id: "provider-vision",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision",
      providerId: "provider-vision",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      supportsVision: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const user = userEvent.setup();

    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("button", { name: "设置 gpt-vision" }));

    expect(screen.getByRole("dialog", { name: "模型设置" })).toBeInTheDocument();
    const visionSwitch = screen.getByRole("checkbox", { name: "支持视觉理解" });
    expect(visionSwitch).not.toBeChecked();
    expect(screen.getByText("当前不支持视觉理解")).toBeInTheDocument();

    await user.click(visionSwitch);

    expect(screen.getByText("当前支持视觉理解")).toBeInTheDocument();
    await waitFor(async () => {
      const [savedModel] = await getProviderModels("provider-vision");
      expect(savedModel.supportsVision).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "关闭模型设置" }));

    expect(screen.queryByRole("dialog", { name: "模型设置" })).not.toBeInTheDocument();
  });

  it("支持视觉理解的模型在所有模型列表名称后显示眼睛状标识", async () => {
    const provider: ModelProvider = {
      id: "provider-vision-list",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision-list",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const visionModel: ProviderModel = {
      id: "model-vision-list",
      providerId: "provider-vision-list",
      displayName: "视觉模型",
      modelId: "gpt-vision-list",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      supportsVision: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const textModel: ProviderModel = {
      ...visionModel,
      id: "model-text-list",
      displayName: "文本模型",
      modelId: "gpt-text-list",
      supportsVision: false,
      updatedAt: 2,
    };
    const user = userEvent.setup();

    await saveModelProvider(provider);
    await saveProviderModel(visionModel);
    await saveProviderModel(textModel);

    render(<App />);

    expect(await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "当前模型" })).toHaveTextContent("视觉渠道 / 视觉模型 · 视觉");
    expect(screen.getByRole("combobox", { name: "当前模型" })).toHaveTextContent("视觉渠道 / 文本模型");

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByLabelText("gpt-vision-list 支持视觉理解")).toHaveClass("model-vision-icon");
    expect(screen.queryByLabelText("gpt-text-list 支持视觉理解")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "默认对话模型" })).toHaveTextContent("视觉渠道 / 视觉模型 · 视觉");
    expect(screen.getByRole("combobox", { name: "AI 标题生成模型" })).toHaveTextContent("视觉渠道 / 视觉模型 · 视觉");
  });

  it("模型连通性测试只让当前模型进入等待态，其他模型仍可测试", async () => {
    let resolveFirstTest: (value: { ok: boolean; message: string }) => void = () => undefined;
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: "",
        truncated: false,
        usedFallback: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        models: [
          { id: "gpt-4.1", displayName: "GPT-4.1" },
          { id: "gpt-4.1-mini", displayName: "GPT-4.1 mini" },
        ],
      })
      .mockReturnValueOnce(new Promise<{ ok: boolean; message: string }>((resolve) => {
        resolveFirstTest = resolve;
      }))
      .mockResolvedValueOnce({
        ok: true,
        message: "模型测试通过",
      });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "获取模型列表" }));
    await user.click(await screen.findByRole("option", { name: /GPT-4.1.*gpt-4.1$/ }));
    await user.click(screen.getByRole("option", { name: /GPT-4.1 mini/ }));

    await user.click(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1" }));

    expect(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1" })).toHaveTextContent("测试中");
    expect(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1-mini" })).toHaveTextContent("测试");
    expect(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1-mini" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "测试模型连通性 gpt-4.1-mini" }));

    expect(sendMessage).toHaveBeenCalledTimes(4);
    resolveFirstTest({ ok: true, message: "模型测试通过" });
  });

  it("可以删除当前渠道并清理渠道下模型", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "新增渠道" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.click(screen.getByRole("button", { name: "删除渠道" }));

    expect(screen.queryByRole("button", { name: /新渠道 1/ })).not.toBeInTheDocument();
    expect(screen.queryByText("新模型 1")).not.toBeInTheDocument();
  });

  it("启动时从本地存储读取渠道和模型", async () => {
    const provider: ModelProvider = {
      id: "provider-local",
      name: "本地渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-local",
      providerId: "provider-local",
      displayName: "本地模型",
      modelId: "gpt-local",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const user = userEvent.setup();

    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByRole("button", { name: /本地渠道/ })).toBeInTheDocument();
    expect(screen.getAllByText("gpt-local").length).toBeGreaterThan(0);
  });

  it("提取规则列表紧凑展示，命中当前页的规则顶置高亮并点击后展开编辑", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/article",
      text: "正文内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-match",
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveExtractionRule(createExtractionRule({ id: "rule-other", alias: "其他站点", urlPattern: "https://other.example.com/.*", sortOrder: 1 }));
    await saveExtractionRule(createExtractionRule({ id: "rule-match", alias: "当前正文", selectorsText: "article\nmain", sortOrder: 2 }));

    render(<App />);
    await screen.findByText("已匹配规则：当前正文");
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "提取规则" }));

    const ruleButtons = screen.getAllByRole("button", { name: /https:\/\// });
    expect(ruleButtons[0]).toHaveTextContent("当前正文");
    expect(ruleButtons[0].closest("article")).toHaveClass("border-[var(--color-primary)]");
    expect(screen.queryByLabelText("CSS/XPath 列表")).not.toBeInTheDocument();

    await user.click(ruleButtons[0]);

    expect(screen.getByLabelText("规则别名")).toHaveDisplayValue("当前正文");
    expect(screen.getByLabelText("URL 正则")).toHaveDisplayValue("https://example.com/.*");
    expect(screen.getByLabelText("CSS/XPath 列表")).toHaveDisplayValue("article\nmain");
  });

  it("新增提取规则必须显式保存且校验失败不落库", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "提取规则" }));
    await user.click(screen.getByRole("button", { name: "新增规则" }));

    await user.clear(screen.getByLabelText("URL 正则"));
    fireEvent.change(screen.getByLabelText("URL 正则"), { target: { value: "[" } });
    await user.clear(screen.getByLabelText("CSS/XPath 列表"));
    await user.type(screen.getByLabelText("CSS/XPath 列表"), "main");
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    expect(screen.getByText("URL 正则格式不正确")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("URL 正则"));
    fireEvent.change(screen.getByLabelText("URL 正则"), { target: { value: "https://example\\.com/.*" } });
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    expect(await screen.findByRole("button", { name: /https:\/\/example\\\.com\/\.\*/ })).toBeInTheDocument();
  });

  it("点击 AI 生成后先选择模型，再展示 URL 正则候选并可填充输入框", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-ai",
      name: "AI 渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-ai",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-ai",
      providerId: "provider-ai",
      displayName: "AI 模型",
      modelId: "gpt-test",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        url: "https://example.com/news/123?from=home",
        text: "",
        truncated: false,
        usedFallback: true,
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

    render(<App />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("tab", { name: "提取规则" }));
    await user.click(screen.getByRole("button", { name: "新增规则" }));
    await user.type(screen.getByLabelText("CSS/XPath 列表"), "main");
    await user.click(screen.getByRole("button", { name: "AI 生成" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("选择用于生成的模型")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "AI 渠道 / AI 模型" }));

    expect(await screen.findByRole("button", { name: "https://example\\.com/news/\\d+" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );

    await user.click(screen.getByRole("button", { name: "https://example\\.com/news/\\d+" }));

    expect(screen.getByLabelText("URL 正则")).toHaveDisplayValue("https://example\\.com/news/\\d+");
  });

  it("点击选择标签页打开上下文弹窗并可切换注入标签页", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn((message: { type: string; tabId?: number }, callback: (response: unknown) => void) => {
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

          if (message.type === "pageContext.extract") {
            callback({
              ok: true,
              url: message.tabId === 9 ? "https://docs.example.com/guide" : "https://example.com/article",
              title: message.tabId === 9 ? "资料页" : "文章页",
              text: message.tabId === 9 ? "资料正文" : "这是一段提取后的页面正文",
              truncated: true,
              usedFallback: false,
              matchedRuleId: "rule-1",
            });
            return undefined;
          }

          callback({ ok: true, content: "AI 回复" });
          return undefined;
        }),
      },
    });
    await saveExtractionRule(createExtractionRule({ id: "rule-1", alias: "正文规则" }));

    render(<App />);

    expect(await screen.findByText("已匹配规则：正文规则")).toBeInTheDocument();
    expect(screen.getByText("内容已截断，请细化 CSS/XPath")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "选择注入标签页" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择标签页" }));

    const dialog = screen.getByRole("dialog", { name: "选择注入标签页" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("这是一段提取后的页面正文");
    expect(screen.getByRole("button", { name: /注入 文章页/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /注入 资料页/ })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: /注入 资料页/ }));
    expect(screen.getByRole("button", { name: /注入 资料页/ })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText((content) => content.includes("资料正文"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /注入 资料页/ }));
    expect(screen.getByRole("button", { name: /注入 资料页/ })).toHaveAttribute("aria-pressed", "false");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "选择注入标签页" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择标签页" }));
    expect(screen.getByRole("dialog", { name: "选择注入标签页" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭标签页选择" }));

    expect(screen.queryByRole("dialog", { name: "选择注入标签页" })).not.toBeInTheDocument();
  });

  it("聊天输入区的上下文、流式响应和提取模式使用紧凑图标 switch 控件切换", async () => {
    const user = userEvent.setup();
    render(<App />);

    const appendContextSwitch = screen.getByRole("switch", { name: "拼接上下文" });
    const streamSwitch = screen.getByRole("switch", { name: "流式响应" });
    const toolCallingButton = screen.getByRole("button", { name: "工具调用：已启用" });
    const contextSwitch = screen.getByRole("switch", { name: "提取模式" });
    const contextStrip = document.querySelector(".context-strip");

    expect(appendContextSwitch).toHaveAttribute("aria-checked", "true");
    expect(appendContextSwitch.closest(".composer-switches")).not.toBeNull();
    expect(contextStrip?.contains(appendContextSwitch)).toBe(false);
    expect(appendContextSwitch.nextElementSibling).toBe(contextSwitch);
    expect(streamSwitch).toHaveAttribute("aria-checked", "true");
    expect(toolCallingButton).toHaveAttribute("aria-pressed", "true");
    expect(toolCallingButton).not.toBeDisabled();
    expect(contextSwitch).toHaveAttribute("aria-checked", "false");
    expect(contextSwitch).toHaveAttribute("title", "提取文本");
    expect(streamSwitch).toHaveClass("composer-switch");
    expect(screen.queryByRole("checkbox", { name: "流式响应" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "提取文本" })).not.toBeInTheDocument();

    await user.click(appendContextSwitch);
    await user.click(streamSwitch);
    await user.click(contextSwitch);

    expect(screen.getByRole("switch", { name: "拼接上下文" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "流式响应" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "工具调用：已启用" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("title", "提取所有");
  });

  it("全局浏览器控制按钮位于设置按钮左侧并更新运行态", async () => {
    const user = userEvent.setup();
    const setBrowserControlEnabled = vi.fn(async (enabled: boolean) => {
      useAppStore.setState({ browserControlEnabled: enabled });
    });
    useAppStore.setState({
      browserControlEnabled: false,
      browserAutomationMode: "normal_restricted",
      setBrowserControlEnabled,
    });

    render(<App />);

    const browserControlButton = screen.getByRole("button", { name: "浏览器控制" });
    const settingsButton = screen.getByRole("button", { name: "设置" });
    expect(browserControlButton.nextElementSibling).toBe(settingsButton);
    expect(browserControlButton).toHaveClass("ui-button-secondary", "app-header-icon-button");
    expect(settingsButton).toHaveClass("ui-button-secondary", "app-header-icon-button");
    expect(browserControlButton).toHaveTextContent("");
    expect(settingsButton).toHaveTextContent("");
    expect(browserControlButton).not.toHaveClass("browser-control-global-button-active");
    expect(browserControlButton).toHaveAttribute("aria-pressed", "false");
    expect(browserControlButton).toHaveAttribute("title", expect.stringContaining("Chrome 调试协议"));
    expect(settingsButton).toHaveAttribute("title", "设置");
    expect(browserControlButton.querySelector(".app-header-icon")).not.toBeNull();
    expect([...browserControlButton.querySelectorAll(".app-header-icon path")].map((path) => path.getAttribute("d")).join(" ")).not.toContain("l-2 3");
    expect(settingsButton.querySelector(".app-header-icon")).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: "启用浏览器自动化控制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行时只读分析" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toBeDisabled();

    await user.click(browserControlButton);

    expect(setBrowserControlEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器控制" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "浏览器控制" })).toHaveClass("browser-control-global-button-active");
    expect(screen.getByRole("button", { name: "浏览器自动化模式" })).not.toBeDisabled();

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(styles).toContain(".app-header-icon-button");
    expect(styles.indexOf(".ui-button-secondary.browser-control-global-button-active")).toBeGreaterThan(styles.indexOf(".ui-button-secondary"));
    expect(styles).toContain(".composer-mode-trigger");
    expect(styles).toContain(".composer-mode-menu-header");
  });

  it("用户点击 Chrome 调试提示栏取消后回滚全局浏览器控制按钮状态", async () => {
    let runtimeListener: ((message: unknown) => void) | undefined;
    const addListener = vi.fn((listener: (message: unknown) => void) => {
      runtimeListener = listener;
    });
    const removeListener = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener,
          removeListener,
        },
      },
    });
    useAppStore.setState({ browserControlEnabled: true, runtimeReadonlyEnabled: true });

    const { unmount } = render(<App />);

    const browserControlButton = screen.getByRole("button", { name: "浏览器控制" });
    expect(browserControlButton).toHaveAttribute("aria-pressed", "true");
    expect(browserControlButton).toHaveClass("browser-control-global-button-active");

    act(() => {
      runtimeListener?.({ type: "browserControl.detached", tabId: 9, reason: "canceled_by_user" });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器控制" })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByRole("button", { name: "浏览器控制" })).not.toHaveClass("browser-control-global-button-active");
    expect(useAppStore.getState().browserControlEnabled).toBe(false);
    expect(useAppStore.getState().runtimeReadonlyEnabled).toBe(false);

    unmount();

    expect(removeListener).toHaveBeenCalledWith(runtimeListener);
  });

  it("自动化模式只跟随用户或 background 明确模式事件切换", async () => {
    let runtimeListener: ((message: unknown) => void) | undefined;
    const addListener = vi.fn((listener: (message: unknown) => void) => {
      runtimeListener = listener;
    });
    const removeListener = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener,
          removeListener,
        },
      },
    });
    useAppStore.setState({ browserControlEnabled: true, browserAutomationMode: "normal_restricted" });

    const { unmount } = render(<App />);

    act(() => {
      runtimeListener?.({
        type: "browserControl.automationModeChanged",
        mode: "controlled_enhanced",
        tabId: 9,
        expiresAt: Date.now() + 60_000,
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveTextContent("受控增强"));
    expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveClass("composer-mode-trigger-controlled_enhanced");

    act(() => {
      runtimeListener?.({
        type: "browserControl.automationModeChanged",
        mode: "controlled_enhanced",
        tabId: 9,
        expiresAt: Date.now(),
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveTextContent("受控增强"));

    act(() => {
      runtimeListener?.({
        type: "browserControl.automationModeChanged",
        mode: "normal_restricted",
        tabId: 9,
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveTextContent("普通模式"));
    expect(useAppStore.getState().browserAutomationMode).toBe("normal_restricted");

    unmount();

    expect(removeListener).toHaveBeenCalledWith(runtimeListener);
  });

  it("浏览器自动化模式菜单使用说明型弹窗并按风险着色", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    const setBrowserAutomationMode = vi.fn(async (mode) => {
      useAppStore.setState({ browserAutomationMode: mode });
    });
    useAppStore.setState({
      browserControlEnabled: true,
      browserAutomationMode: "normal_restricted",
      setBrowserAutomationMode,
    });

    render(<App />);

    const modeButton = screen.getByRole("button", { name: "浏览器自动化模式" });
    await user.click(modeButton);

    expect(screen.getByRole("listbox", { name: "浏览器自动化模式" })).toBeInTheDocument();
    expect(screen.getByText("选择浏览器自动化模式")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /受控增强/ })).toHaveTextContent("允许 AI 请求一次性边界授权");
    expect(screen.getByRole("option", { name: /完全访问/ })).toHaveTextContent("最高风险");

    await user.click(screen.getByRole("option", { name: /完全访问/ }));

    expect(setBrowserAutomationMode).toHaveBeenCalledWith("full_access");
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveTextContent("完全访问"));
    expect(screen.getByRole("button", { name: "浏览器自动化模式" })).toHaveClass("composer-mode-trigger-full_access");

    confirmSpy.mockRestore();
  });

  it("聊天输入区的工具调用图标按钮打开菜单并控制当前会话工具设置", async () => {
    const user = userEvent.setup();
    const updateActiveSessionChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => {
        const session = state.chatSessions.find((item) => item.id === state.activeSessionId);
        if (!session) {
          return {};
        }

        return {
          chatSessions: state.chatSessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  chatPreferenceOverrides: {
                    ...item.chatPreferenceOverrides,
                    ...updates,
                  },
                }
              : item,
          ),
        };
      });
    });
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
      },
      {
        id: "browser.click",
        name: "click",
        description: "点击页面上的目标元素",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "browser_control", capabilities: ["operate_page"], risk: "medium" },
      },
    ];

    const session = createChatSession({
      id: "session-tool-calling-composer",
      title: "工具调用会话",
      chatPreferenceOverrides: { toolCallingEnabled: false, enabledToolIds: ["browser.take_snapshot"] },
    });
    await saveChatSession(session);
    useAppStore.setState({
      activeSessionId: "session-tool-calling-composer",
      chatSessions: [session],
      chatPreferences: {
        ...useAppStore.getState().chatPreferences,
        toolCallingEnabled: true,
      },
      browserControlEnabled: true,
      updateActiveSessionChatPreferences,
    });

    render(<App />);

    const toolCallingButton = screen.getByRole("button", { name: "工具调用：已关闭" });
    expect(toolCallingButton.closest(".composer-switches")).not.toBeNull();
    expect(toolCallingButton).not.toBeDisabled();
    expect(toolCallingButton).toHaveAttribute("aria-pressed", "false");

    await user.click(toolCallingButton);

    const menu = screen.getByRole("dialog", { name: "工具调用设置" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用全部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /take_snapshot/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /click/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /take_snapshot/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /click/ })).not.toBeDisabled();
    expect(screen.getByText("读取当前页面结构快照")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "启用全部" }));

    expect(updateActiveSessionChatPreferences).toHaveBeenCalledWith({
      toolCallingEnabled: true,
      enabledToolIds: ["browser.take_snapshot", "browser.click"],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "工具调用：已启用" })).toHaveAttribute("aria-pressed", "true"));

    await user.click(screen.getByRole("button", { name: /click/ }));

    expect(updateActiveSessionChatPreferences).toHaveBeenLastCalledWith({ enabledToolIds: ["browser.take_snapshot"] });

    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "工具调用设置" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "打开当前聊天设置" }));

    expect(screen.queryByRole("combobox", { name: "当前聊天工具调用" })).not.toBeInTheDocument();
    expect(screen.queryByText("当前聊天启用工具")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前聊天工具调用请通过输入区工具图标菜单/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复当前聊天工具设置为全局默认" })).not.toBeInTheDocument();

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(styles).toMatch(/\.composer-tool-menu\s*\{[^}]*@apply\s+fixed/s);
  });

  it("浏览器自动化工具样式只跟随浏览器控制运行态激活", async () => {
    const user = userEvent.setup();
    registeredModelToolsMock.tools = [
      {
        id: "browser.take_snapshot",
        name: "take_snapshot",
        description: "读取当前页面结构快照",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        toolClassification: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
      },
    ];

    const session = createChatSession({
      id: "session-browser-tool-style",
      title: "浏览器工具样式",
      chatPreferenceOverrides: { toolCallingEnabled: true, enabledToolIds: ["browser.take_snapshot"] },
    });
    await saveChatSession(session);
    useAppStore.setState({
      activeSessionId: session.id,
      chatSessions: [session],
      browserControlEnabled: false,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "工具调用：已启用" }));

    const snapshotButton = screen.getByRole("button", { name: /take_snapshot/ });
    expect(snapshotButton).toHaveAttribute("aria-pressed", "false");
    expect(snapshotButton).toBeDisabled();
  });

  it("聊天输入区的工具调用菜单支持空会话、启用关闭和键盘关闭", async () => {
    const user = userEvent.setup();
    const updateActiveSessionChatPreferences = vi.fn(async (updates) => {
      useAppStore.setState((state) => ({
        chatPreferences: {
          ...state.chatPreferences,
          ...updates,
        },
      }));
    });
    useAppStore.setState({
      activeSessionId: undefined,
      chatSessions: [],
      updateActiveSessionChatPreferences,
    });

    render(<App />);

    const toolCallingButton = screen.getByRole("button", { name: "工具调用：已启用" });
    expect(toolCallingButton).not.toBeDisabled();

    await user.click(toolCallingButton);

    expect(screen.getByRole("dialog", { name: "工具调用设置" })).toBeInTheDocument();
    expect(screen.getByText("暂无可用工具")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "启用" }));
    expect(updateActiveSessionChatPreferences).toHaveBeenCalledWith({ toolCallingEnabled: true });

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(updateActiveSessionChatPreferences).toHaveBeenLastCalledWith({ toolCallingEnabled: false });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "工具调用设置" })).not.toBeInTheDocument());
  });

  it("聊天输入区的工具调用菜单默认和工具按钮中心线对齐", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    render(<App />);

    const toolCallingButton = screen.getByRole("button", { name: "工具调用：已启用" });
    vi.spyOn(toolCallingButton, "getBoundingClientRect").mockReturnValue({
      x: 260,
      y: 400,
      left: 260,
      right: 296,
      top: 400,
      bottom: 436,
      width: 36,
      height: 36,
      toJSON: () => ({}),
    });

    await user.click(toolCallingButton);

    const menu = screen.getByRole("dialog", { name: "工具调用设置" });
    await waitFor(() => expect(menu).toHaveStyle({ left: "118px" }));
  });

  it("聊天页展示气泡消息、思考过程和提取模式开关", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-chat",
      name: "聊天渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-chat",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-chat",
      providerId: "provider-chat",
      displayName: "聊天模型",
      modelId: "gpt-chat",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
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
        content: "AI 总结",
        thinking: "先阅读页面",
      });
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveExtractionRule(createExtractionRule({ id: "rule-1", alias: "正文规则" }));
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    expect(await screen.findByText("已匹配规则：正文规则")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("title", "提取文本");
    await user.click(screen.getByRole("switch", { name: "提取模式" }));
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("title", "提取所有");

    await user.click(screen.getByRole("switch", { name: "流式响应" }));
    await user.type(screen.getByLabelText("对话输入"), "总结页面");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send")).toBe(true));

    expect((await screen.findAllByText("总结页面")).length).toBeGreaterThan(0);
    expect(await screen.findByText("AI 总结")).toBeInTheDocument();
    const thinkingDetails = screen.getByText("思考过程").closest("details");
    expect(thinkingDetails).toBeInTheDocument();
    expect(thinkingDetails).not.toHaveAttribute("open");
    expect(screen.queryByText("AI 思考过程")).not.toBeInTheDocument();
  });

  it("流式生成中的思考状态显示思考中并默认展开", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-streaming-thinking",
        title: "流式思考",
        messages: [
          createChatMessage({
            id: "message-streaming-thinking",
            thinking: "正在分析页面",
            content: "",
            streaming: true,
          }),
        ],
      }),
    );

    render(<App />);

    const thinkingDetails = await screen.findByText("思考中");
    expect(thinkingDetails.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("正在分析页面")).toBeInTheDocument();
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
  });

  it("AI 请求重试进度在消息气泡上方显示并随状态清除", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-retry-progress",
        title: "重试进度",
        messages: [
          createChatMessage({
            id: "message-retry-progress",
            content: "",
            streaming: true,
          }),
        ],
      }),
    );

    render(<App />);

    await screen.findByText("重试进度");
    act(() => {
      useAppStore.setState({
        chatRetryProgressByMessageId: {
          "message-retry-progress": {
            currentRetry: 1,
            maxRetries: 5,
          },
        },
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent("正在重试 1/5");

    act(() => {
      useAppStore.setState({ chatRetryProgressByMessageId: {} });
    });

    await waitFor(() => {
      expect(screen.queryByText("正在重试 1/5")).not.toBeInTheDocument();
    });
  });

  it("流式思考过程超过五行时自动折叠", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-long-thinking",
        title: "长思考",
        messages: [
          createChatMessage({
            id: "message-long-thinking",
            thinking: ["第一行", "第二行", "第三行", "第四行", "第五行", "第六行"].join("\n"),
            content: "",
            streaming: true,
          }),
        ],
      }),
    );

    render(<App />);

    const thinkingDetails = await screen.findByText("思考中");
    expect(thinkingDetails.closest("details")).not.toHaveAttribute("open");
  });

  it("Markdown 表格渲染为真实 table 元素", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-table",
        title: "表格渲染",
        messages: [
          createChatMessage({
            id: "message-table",
            content: "| 阶段 | 触发动作 |\n|---|---|\n| dev | 合并到 main |\n| beta | 正式发布 |",
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制表格 Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制表格图片" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "阶段" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "合并到 main" })).toBeInTheDocument();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const tableBlockRule = styles.match(/\.markdown-table-block \{[\s\S]*?\}/)?.[0] ?? "";
    const tableActionsRule = styles.match(/\.markdown-table-block-actions \{[\s\S]*?\}/)?.[0] ?? "";
    const tableScrollerRule = styles.match(/\.markdown-table-block-scroller \{[\s\S]*?\}/)?.[0] ?? "";
    const tableRule = styles.match(/\.markdown-table-block table \{[\s\S]*?\}/)?.[0] ?? "";
    const tableHeaderRule = styles.match(/\.markdown-table-block th \{[\s\S]*?\}/)?.[0] ?? "";
    const tableHeaderContentRule = styles.match(/\.markdown-table-block-header-content \{[\s\S]*?\}/)?.[0] ?? "";
    expect(tableBlockRule).toContain("width: fit-content;");
    expect(tableBlockRule).toContain("position: relative;");
    expect(styles).not.toContain(".markdown-table-block-toolbar");
    expect(tableActionsRule).toContain("ml-auto");
    expect(tableActionsRule).toContain("justify-end");
    expect(tableActionsRule).not.toContain("position: absolute;");
    expect(tableHeaderContentRule).toContain("flex");
    expect(tableHeaderRule).toContain("vertical-align: middle;");
    expect(tableHeaderContentRule).toContain("min-h-7");
    expect(tableHeaderContentRule).toContain("width: 100%;");
    expect(tableScrollerRule).toContain("max-w-full");
    expect(tableRule).toContain("width: fit-content;");
  });

  it("发送中继续输入不会被响应完成清空", async () => {
    const user = userEvent.setup();
    let completeChatResponse: (response: unknown) => void = () => undefined;
    const provider: ModelProvider = {
      id: "provider-draft",
      name: "草稿渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-draft",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-draft",
      providerId: "provider-draft",
      displayName: "草稿模型",
      modelId: "gpt-draft",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "pageContext.extract") {
        callback({
          ok: true,
          text: "页面内容",
          truncated: false,
          usedFallback: true,
        });
        return undefined;
      }

      completeChatResponse = callback;
      return undefined;
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
      },
    });
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    const input = await screen.findByLabelText("对话输入");
    await user.click(screen.getByRole("switch", { name: "流式响应" }));
    await user.type(input, "第一条");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(input.textContent).toBe("");
    await waitFor(() => expect(sendMessage.mock.calls.some(([message]) => (message as { type: string }).type === "chat.send")).toBe(true));

    await user.type(input, "下一条草稿");
    await act(async () => {
      completeChatResponse({
        ok: true,
        content: "第一条回复",
      });
      await Promise.resolve();
    });

    expect(await screen.findByText("第一条回复")).toBeInTheDocument();
    await waitFor(() => expect(input.textContent).toBe("下一条草稿"));
  });

  it("历史会话菜单展示重命名归档删除且删除需要二次确认", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByText(/›|⌄/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /›|⌄/ })).not.toBeInTheDocument();
    const defaultFolderButton = screen.getByRole("button", { name: /默认文件夹/ });
    const archiveFolderButton = screen.getByRole("button", { name: /已归档/ });
    const archiveBottom = archiveFolderButton.closest(".session-archive-bottom");
    expect(defaultFolderButton.closest(".session-folder-stack-scroll")).toBeInTheDocument();
    expect(archiveFolderButton).toHaveAttribute("aria-expanded", "false");
    expect(archiveBottom).toHaveClass("shrink-0");
    expect(archiveBottom?.parentElement).not.toHaveClass("session-list-scroll");

    await user.click(getSessionListNewChatButton());
    expect(await screen.findByText("新对话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删 新对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "会话操作 新对话" }));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeInTheDocument();

    await user.click(screen.getByText("历史对话"));
    expect(screen.queryByRole("menuitem", { name: "归档" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "会话操作 新对话" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("menuitem", { name: "确认删除" })).toBeInTheDocument();
    expect(screen.getByText("新对话")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByText("新对话")).not.toBeInTheDocument());
  });

  it("已归档会话菜单向上展开，避免超出底部可视区域", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-archived-menu", title: "底部归档", archived: true }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: /已归档/ }));
    await user.click(await screen.findByRole("button", { name: "会话操作 底部归档" }));

    expect(screen.getByRole("menu")).toHaveClass("session-menu-up");
  });

  it("历史会话菜单可以原地重命名并保存", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-rename", title: "旧标题" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "会话操作 旧标题" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "新标题{Enter}");

    expect(await screen.findByText("新标题")).toBeInTheDocument();
    expect(screen.queryByText("会话：新标题")).not.toBeInTheDocument();
    expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-rename")?.title).toBe("新标题");
  });

  it("会话按 Enter 保存后再次重命名可以仅靠失焦保存", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-enter-blur", title: "初始标题" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "会话操作 初始标题" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    let input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "首次保存{Enter}");
    expect(await screen.findByText("首次保存")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "会话操作 首次保存" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "失焦保存");
    fireEvent.blur(input);

    expect(await screen.findByText("失焦保存")).toBeInTheDocument();
    expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-enter-blur")?.title).toBe("失焦保存");
  });

  it("会话按 Escape 取消后再次重命名可以仅靠失焦保存", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-escape-blur", title: "保留标题" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "会话操作 保留标题" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    let input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "取消标题{Escape}");
    expect(await screen.findByText("保留标题")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "会话操作 保留标题" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "失焦标题");
    fireEvent.blur(input);

    expect(await screen.findByText("失焦标题")).toBeInTheDocument();
    expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-escape-blur")?.title).toBe("失焦标题");
  });

  it("新建文件夹后进入文件夹名编辑并可保存自定义名称", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "新建文件夹" }));
    const input = await screen.findByLabelText("重命名文件夹");
    expect(input).toHaveDisplayValue("新文件夹");

    await user.clear(input);
    await user.type(input, "资料整理{Enter}");

    expect((await screen.findByText("资料整理")).closest("button")).toBeInTheDocument();
    expect(useAppStore.getState().chatFolders.some((folder) => folder.name === "资料整理")).toBe(true);
  });

  it("已有文件夹可以进入重命名且 Escape 取消保存", async () => {
    const user = userEvent.setup();
    await saveChatFolder(createChatFolder({ id: "folder-rename", name: "旧文件夹" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "文件夹操作 旧文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByLabelText("重命名文件夹");
    await user.clear(input);
    await user.type(input, "不会保存{Escape}");

    expect((await screen.findByText("旧文件夹")).closest("button")).toBeInTheDocument();
    expect(useAppStore.getState().chatFolders.find((folder) => folder.id === "folder-rename")?.name).toBe("旧文件夹");
  });

  it("文件夹按 Enter 保存后再次重命名可以仅靠失焦保存", async () => {
    const user = userEvent.setup();
    await saveChatFolder(createChatFolder({ id: "folder-enter-blur", name: "初始文件夹" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "文件夹操作 初始文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    let input = screen.getByLabelText("重命名文件夹");
    await user.clear(input);
    await user.type(input, "首次文件夹{Enter}");
    expect((await screen.findByText("首次文件夹")).closest("button")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "文件夹操作 首次文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    input = screen.getByLabelText("重命名文件夹");
    await user.clear(input);
    await user.type(input, "失焦文件夹");
    fireEvent.blur(input);

    expect((await screen.findByText("失焦文件夹")).closest("button")).toBeInTheDocument();
    expect(useAppStore.getState().chatFolders.find((folder) => folder.id === "folder-enter-blur")?.name).toBe("失焦文件夹");
  });

  it("文件夹菜单提供重命名删除且点击空白区域自动关闭", async () => {
    const user = userEvent.setup();
    await saveChatFolder(createChatFolder({ id: "folder-menu", name: "菜单文件夹" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "文件夹操作 菜单文件夹" }));

    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();

    await user.click(screen.getByText("历史对话"));

    expect(screen.queryByRole("menuitem", { name: "重命名" })).not.toBeInTheDocument();
  });

  it("空文件夹删除需要二次确认，非空文件夹不能删除", async () => {
    const user = userEvent.setup();
    await saveChatFolder(createChatFolder({ id: "folder-empty-delete", name: "空文件夹" }));
    await saveChatFolder(createChatFolder({ id: "folder-non-empty-delete", name: "非空文件夹" }));
    await saveChatSession(createChatSession({ id: "session-in-folder", title: "文件夹内会话", folderId: "folder-non-empty-delete" }));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "文件夹操作 空文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("menuitem", { name: "确认删除" })).toBeInTheDocument();
    expect(screen.getByText("空文件夹")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByText("空文件夹")).not.toBeInTheDocument());
    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === "folder-empty-delete")).toBe(false);

    await user.click(await screen.findByRole("button", { name: "文件夹操作 非空文件夹" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("menuitem", { name: "确认删除" }));

    expect(await screen.findByText("非空文件夹")).toBeInTheDocument();
    expect(useAppStore.getState().chatFolders.some((folder) => folder.id === "folder-non-empty-delete")).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("只能删除空文件夹");
  });

  it("可以拖拽未归档会话到目标文件夹", async () => {
    await saveChatFolder(createChatFolder({ id: "folder-target", name: "目标文件夹" }));
    await saveChatSession(createChatSession({ id: "session-drag", title: "拖拽会话" }));

    render(<App />);

    const sessionButton = await screen.findByRole("button", { name: "拖拽会话" });
    const folderButton = (await screen.findByText("目标文件夹")).closest("button");
    expect(folderButton).toBeInTheDocument();
    fireEvent.dragStart(sessionButton);
    fireEvent.dragOver(folderButton as Element);
    fireEvent.drop(folderButton as Element);

    await waitFor(() => {
      expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-drag")?.folderId).toBe("folder-target");
    });
  });

  it("可以把文件夹内会话拖回默认文件夹", async () => {
    await saveChatFolder(createChatFolder({ id: "folder-source", name: "来源文件夹" }));
    await saveChatSession(createChatSession({ id: "session-drag-default", folderId: "folder-source", title: "回默认会话" }));

    render(<App />);

    const sourceFolderButton = (await screen.findByText("来源文件夹")).closest("button");
    expect(sourceFolderButton).toBeInTheDocument();
    fireEvent.click(sourceFolderButton as Element);
    const sessionButton = await screen.findByRole("button", { name: "回默认会话" });
    const defaultFolderButton = (await screen.findByText("默认文件夹")).closest("button");
    expect(defaultFolderButton).toBeInTheDocument();
    fireEvent.dragStart(sessionButton);
    fireEvent.dragOver(defaultFolderButton as Element);
    fireEvent.drop(defaultFolderButton as Element);

    await waitFor(() => {
      expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-drag-default")?.folderId).toBeUndefined();
    });
  });

  it("归档会话不可拖拽", async () => {
    const user = userEvent.setup();
    await saveChatSession(createChatSession({ id: "session-archived-drag", title: "归档拖拽", archived: true }));

    render(<App />);

    await user.click(screen.getByRole("button", { name: /已归档/ }));
    const sessionButton = await screen.findByRole("button", { name: "归档拖拽" });

    expect(sessionButton.closest("article")).toHaveAttribute("draggable", "false");
  });

  it("带 dataTransfer 的拖拽在 state 丢失后仍可移动", async () => {
    await saveChatFolder(createChatFolder({ id: "folder-data-transfer", name: "数据文件夹" }));
    await saveChatSession(createChatSession({ id: "session-data-transfer", title: "数据拖拽" }));
    const dataTransfer = createDataTransfer();

    render(<App />);

    const sessionButton = await screen.findByRole("button", { name: "数据拖拽" });
    const folderButton = (await screen.findByText("数据文件夹")).closest("button");
    expect(folderButton).toBeInTheDocument();
    fireEvent.dragStart(sessionButton, { dataTransfer });
    fireEvent.dragEnd(sessionButton);
    fireEvent.dragOver(folderButton as Element);
    fireEvent.drop(folderButton as Element, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "session-data-transfer");
    await waitFor(() => {
      expect(useAppStore.getState().chatSessions.find((item) => item.id === "session-data-transfer")?.folderId).toBe("folder-data-transfer");
    });
  });

  it("窄面板历史按钮可以打开历史弹窗", async () => {
    const user = userEvent.setup();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "历史" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("历史记录")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector(".session-list-compact")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector(".session-list-scroll")).toBeInTheDocument();
    expect(styles).toContain(".history-dialog");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
    expect(styles).toContain("overflow: hidden;");
  });

  it("除默认文件夹外的会话文件夹默认折叠，点击后展开", async () => {
    const user = userEvent.setup();
    await saveChatFolder(createChatFolder({ id: "folder-collapse", name: "项目资料" }));
    await saveChatSession(createChatSession({ id: "session-collapse", folderId: "folder-collapse", title: "资料会话" }));

    render(<App />);

    const folderButton = (await screen.findByText("项目资料")).closest("button");
    expect(folderButton).toBeInTheDocument();
    expect(screen.queryByText("资料会话")).not.toBeInTheDocument();
    expect(folderButton).toHaveAttribute("aria-expanded", "false");

    await user.click(folderButton as Element);
    expect(screen.getByText("资料会话")).toBeInTheDocument();
    expect(screen.queryByText("会话：资料会话")).not.toBeInTheDocument();
    expect(folderButton).toHaveAttribute("aria-expanded", "true");

    await user.click(folderButton as Element);
    expect(screen.queryByText("资料会话")).not.toBeInTheDocument();
  });
  it("图片输入限制最多 5 张且单张不能超过 5MB", async () => {
    const user = userEvent.setup();
    const provider: ModelProvider = {
      id: "provider-vision-limit",
      name: "视觉渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "sk-vision",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const model: ProviderModel = {
      id: "model-vision-limit",
      providerId: "provider-vision-limit",
      displayName: "视觉模型",
      modelId: "gpt-vision",
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: "你是网页助手",
      isTitleModel: false,
      supportsVision: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    stubFileReaderAsDataUrl();
    await saveModelProvider(provider);
    await saveProviderModel(model);

    render(<App />);

    await screen.findByDisplayValue("视觉渠道 / 视觉模型 · 视觉");
    const imageInput = screen.getByLabelText("上传图片");
    await user.upload(imageInput, createImageFile("超大.png", 5 * 1024 * 1024 + 1));

    expect(await screen.findByText("单张图片不能超过 5MB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看图片 超大.png" })).not.toBeInTheDocument();

    await user.upload(imageInput, [
      createImageFile("1.png"),
      createImageFile("2.png"),
      createImageFile("3.png"),
      createImageFile("4.png"),
      createImageFile("5.png"),
      createImageFile("6.png"),
    ]);

    expect(await screen.findByText("最多只能添加 5 张图片")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /查看图片/ })).toHaveLength(5);
  });

  it("助手消息会展示工具调用记录，完成后点击可查看气泡详情", async () => {
    const user = userEvent.setup();
    await saveChatSession(
      createChatSession({
        id: "session-tool-call-records",
        title: "工具调用",
        messages: [
          createChatMessage({
            id: "message-tool-call-records",
            role: "assistant",
            content: "已结合搜索结果回答。",
            toolCallRecords: [
              {
                id: "call-running",
                toolId: "web_search.tavily",
                name: "tavily_search",
                displayName: "Tavily 搜索",
                arguments: { query: "运行中" },
                status: "running",
                startedAt: 1,
              },
              {
                id: "call-done",
                toolId: "web_search.tavily",
                name: "tavily_search",
                displayName: "Tavily 搜索",
                arguments: { query: "Tavily API" },
                status: "success",
                startedAt: 1,
                completedAt: 26,
                resultSummary: "返回 1 条结果",
                attachmentIds: ["tool-attachment-call-done"],
              },
            ],
            toolAttachments: [
              {
                id: "tool-attachment-call-done",
                kind: "web-search",
                title: "网络搜索结果",
                summary: "已搜索：Tavily API，返回 1 条结果",
                sourceToolCallId: "call-done",
                createdAt: 2,
                redacted: false,
                truncated: false,
                provider: "tavily",
                query: "Tavily API",
                results: [{ title: "Tavily Search", url: "https://docs.tavily.com/search", content: "Search endpoint documentation." }],
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const running = await screen.findByRole("button", { name: "正在调用 Tavily 搜索：运行中" });
    expect(running).toBeDisabled();
    const completed = await screen.findByRole("button", { name: "已调用 Tavily 搜索：Tavily API" });
    expect(completed.closest(".message-tool-call-row")).toBeInTheDocument();
    await user.click(completed);

    const dialog = await screen.findByRole("dialog", { name: "Tavily 搜索 调用详情" });
    expect(dialog).toHaveTextContent("返回 1 条结果");
    expect(dialog).toHaveTextContent("25 ms");
    expect(screen.getAllByText("网络搜索结果").some((item) => Boolean(item.closest(".message-web-search-attachment")))).toBe(true);
    expect(readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8")).toContain(".message-tool-call-row");
  });

  it("默认按工具轮助手消息展示 AI 回复正文但隐藏本轮工具调用过程和消息操作按钮", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-tool-turn-message",
        title: "工具轮消息",
        messages: [
          createChatMessage({
            id: "message-tool-turn",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "我先查看当前页面结构。",
            thinking: "需要先读取页面。",
            toolCallRecords: [
              {
                id: "call-page",
                toolId: "page.read_context",
                name: "read_page_context",
                displayName: "读取页面上下文",
                arguments: { mode: "text" },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "读取完成",
              },
            ],
          }),
          createChatMessage({ id: "message-final", role: "assistant", content: "最终回答。" }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("我先查看当前页面结构。")).toBeInTheDocument();
    expect(screen.queryByText("需要先读取页面。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已调用 读取页面上下文" })).not.toBeInTheDocument();
    expect(screen.getByText("最终回答。")).toBeInTheDocument();
    const toolTurnEntry = screen.getByText("我先查看当前页面结构。").closest(".message-entry");
    const finalEntry = screen.getByText("最终回答。").closest(".message-entry");
    expect(toolTurnEntry?.querySelector(".message-regenerate-action")).toBeNull();
    expect(finalEntry?.querySelector(".message-regenerate-action")).not.toBeNull();
  });

  it("默认按工具轮助手消息展示 MCP 回复正文但隐藏工具调用过程", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-mcp-tool-turn-visible",
        title: "MCP 工具过程",
        messages: [
          createChatMessage({
            id: "message-mcp-tool-turn",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "调用成功！继续下一步思考：",
            toolCallRecords: [
              {
                id: "call-mcp-sequential-1",
                toolId: "mcp.mcp-server.sequentialthinking",
                name: "mcp_mcp_server_sequentialthinking",
                displayName: "Sequential Thinking",
                arguments: {
                  thought: "第一步验证通过，MCP 工具确实被成功调用。",
                  nextThoughtNeeded: true,
                  thoughtNumber: 2,
                  totalThoughts: 3,
                },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "返回 thoughtNumber=2",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("调用成功！继续下一步思考：")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已调用 Sequential Thinking" })).not.toBeInTheDocument();
    expect(screen.queryByText("第一步验证通过，MCP 工具确实被成功调用。")).not.toBeInTheDocument();
    expect(screen.queryByText("第 2/3 步")).not.toBeInTheDocument();
    expect(screen.queryByText("需要继续：是")).not.toBeInTheDocument();
    expect(screen.queryByText("参数 thought")).not.toBeInTheDocument();
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(styles).not.toContain(".message-tool-call-row-mcp");
    expect(styles).not.toContain(".message-tool-call-argument-summary");
  });

  it("开启偏好后按内置工具调用过程样式展示 MCP 工具调用行并可查看详情参数", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-mcp-tool-turn-preference-visible",
        title: "MCP 工具过程受偏好控制",
        messages: [
          createChatMessage({
            id: "message-mcp-tool-turn-preference-visible",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "调用成功！继续下一步思考：",
            toolCallRecords: [
              {
                id: "call-mcp-sequential-preference-visible",
                toolId: "mcp.mcp-server.sequentialthinking",
                name: "mcp_mcp_server_sequentialthinking",
                displayName: "Sequential Thinking",
                arguments: {
                  thought: "第一步验证通过，MCP 工具确实被成功调用。",
                  nextThoughtNeeded: true,
                  thoughtNumber: 2,
                  totalThoughts: 3,
                },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "返回 thoughtNumber=2",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("调用成功！继续下一步思考：")).toBeInTheDocument();
    const toolButton = screen.getByRole("button", { name: "已调用 Sequential Thinking" });
    expect(toolButton).toHaveClass("message-tool-call-trigger");
    expect(screen.queryByText("第一步验证通过，MCP 工具确实被成功调用。")).not.toBeInTheDocument();
    await userEvent.click(toolButton);

    const dialog = await screen.findByRole("dialog", { name: "Sequential Thinking 调用详情" });
    expect(dialog).toHaveTextContent("\"thought\": \"第一步验证通过，MCP 工具确实被成功调用。\"");
  });

  it("默认隐藏多轮 MCP 工具调用行并不展开每轮参数", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-mcp-multi-tool-turn-visible",
        title: "多轮 MCP 工具过程",
        messages: [
          createChatMessage({
            id: "message-mcp-tool-turn-1",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "第一轮：",
            toolCallRecords: [
              {
                id: "call-mcp-sequential-1",
                toolId: "mcp.server.sequentialthinking",
                name: "mcp_server_sequentialthinking",
                displayName: "sequentialthinking",
                arguments: {
                  thought: "先确认 MCP 工具是否可以被调用。",
                  nextThoughtNeeded: true,
                  thoughtNumber: 1,
                  totalThoughts: 3,
                },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "第一轮完成",
              },
            ],
          }),
          createChatMessage({
            id: "message-mcp-tool-turn-2",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "第二轮：",
            toolCallRecords: [
              {
                id: "call-mcp-sequential-2",
                toolId: "mcp.server.sequentialthinking",
                name: "mcp_server_sequentialthinking",
                displayName: "sequentialthinking",
                arguments: {
                  thought: "再确认工具返回结果是否进入后续上下文。",
                  nextThoughtNeeded: false,
                  thoughtNumber: 2,
                  totalThoughts: 2,
                },
                status: "success",
                startedAt: 3,
                completedAt: 4,
                resultSummary: "第二轮完成",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("第一轮：")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "已调用 sequentialthinking" })).toHaveLength(0);
    expect(screen.queryByText("先确认 MCP 工具是否可以被调用。")).not.toBeInTheDocument();
    expect(screen.queryByText("再确认工具返回结果是否进入后续上下文。")).not.toBeInTheDocument();
    expect(screen.queryByText("第 1/3 步")).not.toBeInTheDocument();
    expect(screen.queryByText("第 2/2 步")).not.toBeInTheDocument();
    expect(screen.queryByText("需要继续：否")).not.toBeInTheDocument();
  });

  it("开启偏好后非紧凑模式会在工具轮助手消息下方显示工具调用过程", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-tool-turn-process-visible",
        title: "工具过程显示",
        messages: [
          createChatMessage({
            id: "message-tool-turn-process-visible",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "我先读取页面。",
            toolCallRecords: [
              {
                id: "call-page-visible",
                toolId: "page.read_context",
                name: "read_page_context",
                displayName: "读取页面上下文",
                arguments: { mode: "text" },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "读取完成",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    expect(await screen.findByText("我先读取页面。")).toBeInTheDocument();
    const toolButton = screen.getByRole("button", { name: "已调用 读取页面上下文" });
    const entry = toolButton.closest(".message-entry");
    const article = entry?.querySelector("article");

    expect(article).not.toBeNull();
    expect(article!.compareDocumentPosition(toolButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(article!.contains(toolButton)).toBe(false);
  });

  it("开启偏好后工具轮调用过程显示在 assistant 消息下方并相对消息列表居中", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-tool-call-below-message",
        title: "工具过程位置",
        messages: [
          createChatMessage({
            id: "message-tool-call-below",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "我先打开页面。",
            toolCallRecords: [
              {
                id: "call-open-page",
                toolId: "browser.new_page",
                name: "browser_new_page",
                displayName: "浏览器新建页面",
                arguments: {},
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "已打开",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const toolButton = await screen.findByRole("button", { name: "已调用 浏览器新建页面" });
    const entry = toolButton.closest(".message-entry");
    const article = entry?.querySelector("article");

    expect(entry).not.toBeNull();
    expect(article).not.toBeNull();
    expect(article!.compareDocumentPosition(toolButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(article!.contains(toolButton)).toBe(false);
    expect(toolButton.closest(".message-tool-call-list")).toHaveClass("message-tool-call-list-panel-centered");
  });

  it("空正文工具轮只显示居中的工具调用过程，不显示 assistant 气泡和操作按钮", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-empty-tool-turn",
        title: "空工具轮",
        messages: [
          createChatMessage({
            id: "message-empty-tool-turn",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            thinking: "",
            toolCallRecords: [
              {
                id: "call-snapshot-empty",
                toolId: "browser.take_snapshot",
                name: "browser_take_snapshot",
                displayName: "浏览器页面快照",
                arguments: {},
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "已截图",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const toolButton = await screen.findByRole("button", { name: "已调用 浏览器页面快照" });
    const entry = toolButton.closest(".message-entry");

    expect(entry?.querySelector("article")).toBeNull();
    expect(entry?.querySelector(".message-avatar")).toBeNull();
    expect(entry?.querySelector(".message-regenerate-action")).toBeNull();
    expect(toolButton.closest(".message-tool-call-list")).toHaveClass("message-tool-call-list-panel-centered");
  });

  it("空正文工具轮带 Network 附件时只展示附件和工具调用过程，不显示空 assistant 气泡", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-empty-tool-turn-network-attachment",
        title: "空工具轮 Network 附件",
        messages: [
          createChatMessage({
            id: "message-before-empty-tool-turn-network-attachment",
            role: "assistant",
            content: "让我试试不同的分类参数格式：",
          }),
          createChatMessage({
            id: "message-empty-tool-turn-network-attachment",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            toolCallRecords: [
              {
                id: "call-network-details",
                toolId: "network.get_request_details",
                name: "network_get_request_details",
                displayName: "Network 请求详情",
                arguments: { requestIds: ["req-1"] },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "返回 1 个请求详情",
                attachmentIds: ["network-attachment-1"],
              },
            ],
            toolAttachments: [
              {
                id: "network-attachment-1",
                kind: "network",
                title: "Network 请求详情",
                summary: "已注入 1 个 Network 请求：GET 200 https://api.example.com/hot.json",
                sourceToolCallId: "call-network-details",
                createdAt: 2,
                redacted: true,
                truncated: false,
                requests: [
                  {
                    id: "req-1",
                    url: "https://api.example.com/hot.json",
                    method: "GET",
                    status: 200,
                    redacted: true,
                    truncated: false,
                  },
                ],
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const toolButton = await screen.findByRole("button", { name: "已调用 Network 请求详情" });
    const attachment = await screen.findByText("Network 请求详情");
    const previousBubble = (await screen.findByText("让我试试不同的分类参数格式：")).closest(".message-bubble-wrap");
    const entry = toolButton.closest(".message-entry");

    expect(attachment.closest(".message-network-attachment")).toBeInTheDocument();
    expect(previousBubble?.contains(attachment.closest(".message-network-attachment") as HTMLElement)).toBe(true);
    expect(entry?.querySelector("article")).toBeNull();
    expect(entry?.querySelector(".message-bubble")).toBeNull();
    expect(entry?.querySelector(".message-regenerate-action")).toBeNull();
    expect(toolButton.closest(".message-tool-call-list")).toHaveClass("message-tool-call-list-panel-centered");
  });

  it("连续空正文 Network 附件会上移到上一条非空助手气泡并按类型聚合", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    const createNetworkAttachment = (id: string, callId: string, count: number) => ({
      id,
      kind: "network" as const,
      title: "Network 请求详情",
      summary: `已注入 ${count} 个 Network 请求`,
      sourceToolCallId: callId,
      createdAt: 2,
      redacted: true,
      truncated: false,
      requests: Array.from({ length: count }, (_, index) => ({
        id: `${id}-req-${index + 1}`,
        url: `https://api.example.com/categories/${id}/${index + 1}.json`,
        method: "GET",
        status: 200,
        redacted: true,
        truncated: false,
      })),
    });
    await saveChatSession(
      createChatSession({
        id: "session-merged-empty-network-attachments",
        title: "空工具轮 Network 附件聚合",
        messages: [
          createChatMessage({
            id: "message-category-params",
            role: "assistant",
            content: "让我试试不同的分类参数格式：",
          }),
          createChatMessage({
            id: "message-network-five",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            toolCallRecords: [
              {
                id: "call-network-five",
                toolId: "network.get_request_details",
                name: "network_get_request_details",
                displayName: "Network 请求详情",
                arguments: { requestIds: ["req-1"] },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "返回 5 个请求详情",
                attachmentIds: ["network-attachment-five"],
              },
            ],
            toolAttachments: [createNetworkAttachment("network-attachment-five", "call-network-five", 5)],
          }),
          createChatMessage({
            id: "message-network-one",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            toolCallRecords: [
              {
                id: "call-network-one",
                toolId: "network.get_request_details",
                name: "network_get_request_details",
                displayName: "Network 请求详情",
                arguments: { requestIds: ["req-6"] },
                status: "success",
                startedAt: 3,
                completedAt: 4,
                resultSummary: "返回 1 个请求详情",
                attachmentIds: ["network-attachment-one"],
              },
            ],
            toolAttachments: [createNetworkAttachment("network-attachment-one", "call-network-one", 1)],
          }),
        ],
      }),
    );

    render(<App />);

    const bubbleWrap = (await screen.findByText("让我试试不同的分类参数格式：")).closest(".message-bubble-wrap");
    const networkAttachments = document.querySelectorAll(".message-network-attachment");
    expect(networkAttachments).toHaveLength(1);
    expect(bubbleWrap?.contains(networkAttachments[0])).toBe(true);
    expect(within(networkAttachments[0] as HTMLElement).getByText("6")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "已调用 Network 请求详情" })).toHaveLength(2);
    for (const toolButton of screen.getAllByRole("button", { name: "已调用 Network 请求详情" })) {
      const entry = toolButton.closest(".message-entry");
      expect(entry?.querySelector("article") || entry?.querySelector(".message-tool-call-list") || entry?.querySelector(".message-regenerate-action")).toBeTruthy();
    }
  });

  it("未知类型附件上移聚合时不会丢弃后续附件", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-merged-generic-attachments",
        title: "未知附件聚合",
        messages: [
          createChatMessage({
            id: "message-before-generic-attachments",
            role: "assistant",
            content: "我会整理工具附件。",
          }),
          createChatMessage({
            id: "message-generic-attachments",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            toolAttachments: [
              {
                id: "generic-attachment-one",
                kind: "custom-result",
                title: "自定义结果",
                summary: "第一段摘要",
                createdAt: 1,
                redacted: true,
                truncated: false,
                details: "第一段详情",
              },
              {
                id: "generic-attachment-two",
                kind: "custom-result",
                title: "自定义结果",
                summary: "第二段摘要",
                createdAt: 2,
                redacted: true,
                truncated: true,
                details: "第二段详情",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const previousBubble = (await screen.findByText("我会整理工具附件。")).closest(".message-bubble-wrap");
    const attachment = screen.getByText("自定义结果").closest(".message-custom-result-attachment");
    expect(attachment).toBeInTheDocument();
    expect(previousBubble?.contains(attachment as HTMLElement)).toBe(true);
    expect(attachment).toHaveTextContent("第一段摘要");
    expect(attachment).toHaveTextContent("第二段摘要");
    expect(attachment).toHaveTextContent("第一段详情");
    expect(attachment).toHaveTextContent("第二段详情");
  });

  it("空正文但有思考的工具轮也只显示工具调用过程", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-empty-content-thinking-tool-turn",
        title: "空正文有思考工具轮",
        messages: [
          createChatMessage({
            id: "message-empty-content-thinking-tool-turn",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "",
            thinking: "这段工具轮思考不应在聊天面板显示。",
            toolCallRecords: [
              {
                id: "call-snapshot-thinking",
                toolId: "browser.take_snapshot",
                name: "browser_take_snapshot",
                displayName: "浏览器页面快照",
                arguments: {},
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "已截图",
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    const toolButton = await screen.findByRole("button", { name: "已调用 浏览器页面快照" });
    const entry = toolButton.closest(".message-entry");

    expect(screen.queryByText("这段工具轮思考不应在聊天面板显示。")).not.toBeInTheDocument();
    expect(entry?.querySelector("article")).toBeNull();
    expect(entry?.querySelector(".message-avatar")).toBeNull();
  });

  it("紧凑工具过程只隐藏工具轮助手正文和思考，仍展示工具调用并保留最终回答", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "compact",
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-compact-tool-turn",
        title: "紧凑工具过程",
        messages: [
          createChatMessage({
            id: "message-tool-turn-compact",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "这段中间回复在聊天面板隐藏。",
            thinking: "这段思考也隐藏。",
            toolCallRecords: [
              {
                id: "call-page-compact",
                toolId: "page.read_context",
                name: "read_page_context",
                displayName: "读取页面上下文",
                arguments: { mode: "text" },
                status: "success",
                startedAt: 1,
                completedAt: 2,
                resultSummary: "读取完成",
              },
            ],
          }),
          createChatMessage({ id: "message-final-compact", role: "assistant", content: "最终回答仍显示。" }),
        ],
      }),
    );

    render(<App />);

    await screen.findByRole("button", { name: "已调用 读取页面上下文" });
    expect(screen.queryByText("这段中间回复在聊天面板隐藏。")).not.toBeInTheDocument();
    expect(screen.queryByText("这段思考也隐藏。")).not.toBeInTheDocument();
    expect(screen.getByText("最终回答仍显示。")).toBeInTheDocument();
  });

  it("同一工具轮超过 5 次调用时默认折叠并可展开全部", async () => {
    const user = userEvent.setup();
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...useAppStore.getState().chatPreferences,
        toolCallDisplayMode: "assistant_grouped",
        showToolCallProcessInAssistantMode: true,
      },
      updatedAt: 2,
    });
    await saveChatSession(
      createChatSession({
        id: "session-collapsed-tool-calls",
        title: "折叠工具调用",
        messages: [
          createChatMessage({
            id: "message-collapsed-tool-calls",
            role: "assistant",
            assistantMessageKind: "tool_call_turn",
            content: "需要连续操作页面。",
            toolCallRecords: Array.from({ length: 6 }, (_, index) => ({
              id: `call-${index + 1}`,
              toolId: "browser.click",
              name: "browser_click",
              displayName: `浏览器点击元素 ${index + 1}`,
              arguments: {},
              status: "success" as const,
              startedAt: index,
              completedAt: index + 1,
              resultSummary: "完成",
            })),
          }),
        ],
      }),
    );

    render(<App />);

    const expandButton = await screen.findByRole("button", { name: "展开全部工具调用（共 6 次）" });
    expect(screen.queryByRole("button", { name: "已调用 浏览器点击元素 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已调用 浏览器点击元素 6" })).toBeInTheDocument();

    await user.click(expandButton);

    expect(screen.getByRole("button", { name: "收起工具调用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已调用 浏览器点击元素 1" })).toBeInTheDocument();
  });

  it("同一条助手消息里的多次网络搜索工具附件会聚合成一个展示块", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-aggregated-tool-attachments",
        title: "工具附件聚合",
        messages: [
          createChatMessage({
            id: "message-aggregated-tool-attachments",
            role: "assistant",
            content: "已结合多次搜索结果回答。",
            toolCallRecords: [
              {
                id: "call-search-1",
                toolId: "web_search.tavily",
                name: "tavily_search",
                displayName: "Tavily 搜索",
                arguments: { query: "Tavily API" },
                status: "success",
                startedAt: 1,
                completedAt: 2,
              },
              {
                id: "call-search-2",
                toolId: "web_search.tavily",
                name: "tavily_search",
                displayName: "Tavily 搜索",
                arguments: { query: "Chrome 扩展" },
                status: "success",
                startedAt: 2,
                completedAt: 3,
              },
            ],
            toolAttachments: [
              {
                id: "tool-attachment-search-1",
                kind: "web-search",
                title: "网络搜索结果",
                summary: "搜索问题：Tavily API",
                sourceToolCallId: "call-search-1",
                createdAt: 2,
                redacted: false,
                truncated: false,
                provider: "tavily",
                query: "Tavily API",
                answer: "答案 A",
                results: [
                  { title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "Search endpoint documentation." },
                  { title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "重复结果。" },
                ],
              },
              {
                id: "tool-attachment-search-2",
                kind: "web-search",
                title: "网络搜索结果",
                summary: "搜索问题：Chrome 扩展",
                sourceToolCallId: "call-search-2",
                createdAt: 3,
                redacted: false,
                truncated: false,
                provider: "tavily",
                query: "Chrome 扩展",
                answer: "答案 B",
                results: [{ title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "Chrome extension docs." }],
              },
            ],
          }),
        ],
      }),
    );

    render(<App />);

    await waitFor(() => expect(document.querySelectorAll(".message-web-search-attachment")).toHaveLength(1));
    expect(document.querySelectorAll(".message-web-search-result-item")).toHaveLength(2);
  });

});
