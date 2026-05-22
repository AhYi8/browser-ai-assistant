import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "../../../src/side-panel/App";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  clearDatabase,
  saveChatFolder,
  saveChatSession,
  saveExtractionRule,
  saveModelProvider,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ChatFolder, ChatSession, ExtractionRule, ModelProvider, ProviderModel } from "../../../src/shared/types";

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

describe("App", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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
    await saveChatSession(
      createChatSession({
        id: "session-long-code",
        title: "长代码",
        messages: [
          {
            id: "message-long-code",
            role: "assistant",
            content: "```python\nbox_annotator = sv.BoxAnnotator()\nannotated_frame = box_annotator.annotate(scene=image, detections=detections)\n```",
            createdAt: 1,
          },
        ],
      }),
    );

    render(<App />);

    const messageList = await screen.findByLabelText("消息列表");
    const bubbleWrap = screen.getByText(/box_annotator/).closest(".message-bubble-wrap");
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");

    expect(messageList).toContainElement(bubbleWrap);
    expect(styles).toContain(".message-bubble-wrap");
    expect(styles).toContain("min-width: 0;");
    expect(styles).toContain(".message-bubble pre");
    expect(styles).toContain("overflow-x: auto;");
  });

  it("聊天消息中的有序列表和无序列表展示可见序号标记", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-list-markers",
        title: "列表渲染",
        messages: [
          {
            id: "message-list-markers",
            role: "assistant",
            content: "- 无序第一项\n- 无序第二项\n\n1. 有序第一项\n2. 有序第二项",
            createdAt: 1,
          },
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
    expect(unorderedList.tagName.toLowerCase()).toBe("ul");
    expect(orderedList).toBeInTheDocument();
    expect(screen.getByText("无序第一项")).toBeInTheDocument();
    expect(screen.getByText("有序第一项")).toBeInTheDocument();
    expect(styles).toContain('content: "·";');
    expect(styles).toContain("font-size: 1.45rem;");
    expect(styles).toContain("counter(message-list-item)");
    expect(styles).toContain(".message-bubble li");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("max-width: 100%;");
  });

  it("聊天正文段落和列表正文使用两端对齐但代码保持左对齐", async () => {
    await saveChatSession(
      createChatSession({
        id: "session-justify",
        title: "两端对齐",
        messages: [
          {
            id: "message-justify",
            role: "assistant",
            content: "这是一段需要两端对齐的聊天正文，用来验证普通段落排版。\n\n- 第一条列表内容也需要两端对齐\n\n```ts\nconst value = 1;\n```",
            createdAt: 1,
          },
        ],
      }),
    );

    render(<App />);

    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    expect(await screen.findByText(/需要两端对齐的聊天正文/)).toBeInTheDocument();
    expect(styles).toContain("text-align: justify;");
    expect(styles).toContain("text-align-last: left;");
    expect(styles).toContain(".message-bubble pre");
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

    expect(activeTitle).toHaveClass("session-item-title");
    expect(archivedTitle).toHaveClass("session-item-title");
    expect(styles).toContain(".session-folder-stack-scroll");
    expect(styles).toContain("overflow-x: hidden;");
    expect(styles).toContain(".session-item");
    expect(styles).toContain("overflow: visible;");
    expect(styles).toContain(".session-item-menu-wrap");
    expect(styles).toContain(".session-title-button");
    expect(styles).toContain(".session-item-title");
    expect(styles).toContain("text-overflow: ellipsis;");
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
    expect(streamSwitch).toHaveAttribute("aria-checked", "false");
    await user.click(streamSwitch);
    await user.type(screen.getByLabelText("对话输入"), "你好");

    expect(screen.getByRole("switch", { name: "流式响应" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  it("请求失败时展示重试入口且不保存失败消息", async () => {
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
    await user.type(screen.getByLabelText("对话输入"), "失败消息");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("请求失败，请重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
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
    expect(screen.getByRole("tab", { name: "界面偏好" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" }).closest("section")?.className).not.toContain("lg:grid-cols");
    expect(screen.getByRole("heading", { name: "设置" }).parentElement?.parentElement).toHaveClass("w-[80%]");
    expect(screen.getByRole("tablist", { name: "设置分类" })).toHaveClass("settings-tabs-scroll", "overflow-x-auto");
    expect(screen.getByRole("tablist", { name: "设置分类" }).className).not.toContain("lg:flex-col");
    expect(screen.queryByLabelText("历史会话")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型渠道" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新增渠道" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "添加模型" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "提取规则" }));

    expect(screen.getByRole("button", { name: "新增规则" })).toBeInTheDocument();
    expect(screen.queryByLabelText("CSS/XPath 列表")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "同步设置" }));

    expect(screen.getByText("忘记密钥将无法恢复已加密的同步数据")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动恢复" })).toBeInTheDocument();
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

  it("点击查看上下文打开弹窗并可关闭", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          url: "https://example.com/article",
          text: "这是一段提取后的页面正文",
          truncated: true,
          usedFallback: false,
          matchedRuleId: "rule-1",
        }),
      },
    });
    await saveExtractionRule(createExtractionRule({ id: "rule-1", alias: "正文规则" }));

    render(<App />);

    expect(await screen.findByText("已匹配规则：正文规则")).toBeInTheDocument();
    expect(screen.getByText("内容已截断，请细化 CSS/XPath")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "当前页上下文" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看上下文" }));

    const dialog = screen.getByRole("dialog", { name: "当前页上下文" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("这是一段提取后的页面正文");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "当前页上下文" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看上下文" }));
    expect(screen.getByRole("dialog", { name: "当前页上下文" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭上下文" }));

    expect(screen.queryByRole("dialog", { name: "当前页上下文" })).not.toBeInTheDocument();
  });

  it("聊天输入区的流式响应和提取模式使用 switch 控件切换", async () => {
    const user = userEvent.setup();
    render(<App />);

    const streamSwitch = screen.getByRole("switch", { name: "流式响应" });
    const contextSwitch = screen.getByRole("switch", { name: "提取模式" });

    expect(streamSwitch).toHaveAttribute("aria-checked", "false");
    expect(contextSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("提取文本")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "流式响应" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "提取文本" })).not.toBeInTheDocument();

    await user.click(streamSwitch);
    await user.click(contextSwitch);

    expect(screen.getByRole("switch", { name: "流式响应" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("提取文本")).not.toBeInTheDocument();
    expect(screen.getByText("提取所有")).toBeInTheDocument();
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
    expect(screen.getByText("提取文本")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "提取模式" }));
    expect(screen.getByRole("switch", { name: "提取模式" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("提取所有")).toBeInTheDocument();

    await user.type(screen.getByLabelText("对话输入"), "总结页面");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("总结页面")).toBeInTheDocument();
    expect(await screen.findByText("AI 总结")).toBeInTheDocument();
    const thinkingDetails = screen.getByText("思考过程").closest("details");
    expect(thinkingDetails).toBeInTheDocument();
    expect(thinkingDetails).not.toHaveAttribute("open");
    expect(screen.queryByText("AI 思考过程")).not.toBeInTheDocument();
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
    await user.type(input, "第一条");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(input).toHaveDisplayValue("");

    await user.type(input, "下一条草稿");
    await act(async () => {
      completeChatResponse({
        ok: true,
        content: "第一条回复",
      });
      await Promise.resolve();
    });

    expect(await screen.findByText("第一条回复")).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveDisplayValue("下一条草稿"));
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

    await user.click(screen.getByRole("button", { name: "新对话" }));
    expect(await screen.findByText("新对话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删 新对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "会话操作 新对话" }));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeInTheDocument();
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

    expect(await screen.findByText("会话：新标题")).toBeInTheDocument();
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
    expect(await screen.findByText("会话：首次保存")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "会话操作 首次保存" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "失焦保存");
    fireEvent.blur(input);

    expect(await screen.findByText("会话：失焦保存")).toBeInTheDocument();
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
    expect(await screen.findByText("会话：保留标题")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "会话操作 保留标题" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    input = screen.getByLabelText("重命名会话");
    await user.clear(input);
    await user.type(input, "失焦标题");
    fireEvent.blur(input);

    expect(await screen.findByText("会话：失焦标题")).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: "重命名文件夹 旧文件夹" }));
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

    await user.click(await screen.findByRole("button", { name: "重命名文件夹 初始文件夹" }));
    let input = screen.getByLabelText("重命名文件夹");
    await user.clear(input);
    await user.type(input, "首次文件夹{Enter}");
    expect((await screen.findByText("首次文件夹")).closest("button")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "重命名文件夹 首次文件夹" }));
    input = screen.getByLabelText("重命名文件夹");
    await user.clear(input);
    await user.type(input, "失焦文件夹");
    fireEvent.blur(input);

    expect((await screen.findByText("失焦文件夹")).closest("button")).toBeInTheDocument();
    expect(useAppStore.getState().chatFolders.find((folder) => folder.id === "folder-enter-blur")?.name).toBe("失焦文件夹");
  });

  it("可以拖拽未归档会话到目标文件夹", async () => {
    await saveChatFolder(createChatFolder({ id: "folder-target", name: "目标文件夹" }));
    await saveChatSession(createChatSession({ id: "session-drag", title: "拖拽会话" }));

    render(<App />);

    const sessionButton = await screen.findByRole("button", { name: "会话：拖拽会话" });
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
    const sessionButton = await screen.findByRole("button", { name: "会话：回默认会话" });
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
    const sessionButton = await screen.findByRole("button", { name: "会话：归档拖拽" });

    expect(sessionButton.closest("article")).toHaveAttribute("draggable", "false");
  });

  it("带 dataTransfer 的拖拽在 state 丢失后仍可移动", async () => {
    await saveChatFolder(createChatFolder({ id: "folder-data-transfer", name: "数据文件夹" }));
    await saveChatSession(createChatSession({ id: "session-data-transfer", title: "数据拖拽" }));
    const dataTransfer = createDataTransfer();

    render(<App />);

    const sessionButton = await screen.findByRole("button", { name: "会话：数据拖拽" });
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
    expect(screen.queryByText("会话：资料会话")).not.toBeInTheDocument();
    expect(folderButton).toHaveAttribute("aria-expanded", "false");

    await user.click(folderButton as Element);
    expect(screen.getByText("会话：资料会话")).toBeInTheDocument();
    expect(folderButton).toHaveAttribute("aria-expanded", "true");

    await user.click(folderButton as Element);
    expect(screen.queryByText("会话：资料会话")).not.toBeInTheDocument();
  });
});
