import { createChatSessionMarkdown, createChatSessionMarkdownFilename, downloadChatSessionMarkdown } from "../../../src/side-panel/utils/chatMarkdownExport";
import type { ChatMessage, ChatSession } from "../../../src/shared/types";

function createMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "消息内容",
    createdAt: 1700000000000,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: true,
    systemPrompt: "你是网页助手",
    contextPrompt: "页面内容",
    contextMode: "text",
    ...partial,
  };
}

function createSession(partial: Partial<ChatSession>): ChatSession {
  return {
    id: "session-1",
    title: "资料/会话:*?",
    archived: false,
    sortOrder: 1,
    createdAt: 1699990000000,
    updatedAt: 1700000000000,
    messages: [],
    ...partial,
  };
}

describe("chatMarkdownExport", () => {
  it("把当前会话消息格式化为 Markdown", () => {
    const session = createSession({
      title: "资料会话",
      messages: [
        createMessage({ id: "message-user", role: "user", content: "请总结页面", createdAt: 1700000000000 }),
        createMessage({
          id: "message-assistant",
          role: "assistant",
          content: "可以。\n\n- 要点一\n- 要点二",
          thinking: "先阅读页面，再归纳重点。",
          createdAt: 1700000100000,
        }),
      ],
    });

    expect(createChatSessionMarkdown(session, 1700000200000)).toBe(`# 资料会话

- 导出时间：2023-11-14T22:16:40.000Z
- 会话创建时间：2023-11-14T19:26:40.000Z
- 会话更新时间：2023-11-14T22:13:20.000Z
- 消息数量：2

## 用户 · 2023-11-14T22:13:20.000Z

\`\`\`
请总结页面
\`\`\`

## 助手 · 2023-11-14T22:15:00.000Z

> 思考过程：先阅读页面，再归纳重点。

\`\`\`
可以。

- 要点一
- 要点二
\`\`\`
`);
  });

  it("正文包含 Markdown 代码块时使用更长围栏避免冲突", () => {
    const session = createSession({
      title: "代码会话",
      messages: [
        createMessage({
          id: "message-code",
          role: "assistant",
          content: "示例：\n```ts\nconst value = 1;\n```",
          createdAt: 1700000000000,
        }),
      ],
    });

    expect(createChatSessionMarkdown(session, 1700000200000)).toContain(`## 助手 · 2023-11-14T22:13:20.000Z

\`\`\`\`
示例：
\`\`\`ts
const value = 1;
\`\`\`
\`\`\`\`
`);
  });

  it("生成适合下载的 Markdown 文件名", () => {
    const session = createSession({ title: "资料/会话:*?" });

    expect(createChatSessionMarkdownFilename(session, 1700000200000)).toBe("资料_会话___-2023-11-14.md");
  });

  it("清理会话标题中的 Markdown 结构字符并为空标题提供回退", () => {
    const session = createSession({
      title: "# 一级标题\n<script>",
      messages: [createMessage({ role: "system", content: "系统消息", createdAt: 1700000000000 })],
    });

    expect(createChatSessionMarkdown(session, 1700000200000)).toContain(`# 一级标题 <script>

- 导出时间：2023-11-14T22:16:40.000Z`);
    expect(createChatSessionMarkdown(createSession({ title: " \n\t " }), 1700000200000)).toContain("# 未命名聊天");
    expect(createChatSessionMarkdown(createSession({ title: "### " }), 1700000200000)).toContain("# 未命名聊天");
  });

  it("保留 system 角色和多行思考过程", () => {
    const session = createSession({
      title: "系统会话",
      messages: [
        createMessage({
          role: "system",
          content: "系统消息",
          thinking: "第一步\n第二步",
          createdAt: 1700000000000,
        }),
      ],
    });

    expect(createChatSessionMarkdown(session, 1700000200000)).toContain(`## 系统 · 2023-11-14T22:13:20.000Z

> 思考过程：第一步
> 第二步

\`\`\`
系统消息
\`\`\`
`);
  });

  it("文件名处理空标题和前导点", () => {
    expect(createChatSessionMarkdownFilename(createSession({ title: "" }), 1700000200000)).toBe("聊天记录-2023-11-14.md");
    expect(createChatSessionMarkdownFilename(createSession({ title: ".env 记录" }), 1700000200000)).toBe("_env 记录-2023-11-14.md");
  });

  it("下载当前会话 Markdown 后释放 Blob URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-14T22:16:40.000Z"));
    const click = vi.fn();
    const anchor = document.createElement("a");
    Object.defineProperty(anchor, "click", { configurable: true, value: click });
    const appendChild = vi.spyOn(document.body, "appendChild");
    const removeChild = vi.spyOn(document.body, "removeChild");
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === "a") {
        return anchor;
      }

      return Document.prototype.createElement.call(document, tagName, options);
    });
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:session-markdown";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const session = createSession({
      title: "下载会话",
      messages: [createMessage({ content: "下载内容", createdAt: 1700000000000 })],
    });

    downloadChatSessionMarkdown(session);

    expect(createElement).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("下载会话-2023-11-14.md");
    expect(anchor.href).toBe("blob:session-markdown");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:session-markdown");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toContain("```\n下载内容\n```");
    vi.useRealTimers();
  });

  it("下载点击失败时仍清理临时链接并释放 Blob URL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-14T22:16:40.000Z"));
    const anchor = document.createElement("a");
    const clickError = new Error("下载失败");
    Object.defineProperty(anchor, "click", {
      configurable: true,
      value: vi.fn(() => {
        throw clickError;
      }),
    });
    const removeChild = vi.spyOn(document.body, "removeChild");
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === "a") {
        return anchor;
      }

      return Document.prototype.createElement.call(document, tagName, options);
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:failed-download"),
      revokeObjectURL,
    });

    const session = createSession({
      title: "失败会话",
      messages: [createMessage({ content: "下载内容", createdAt: 1700000000000 })],
    });

    expect(() => downloadChatSessionMarkdown(session)).toThrow(clickError);
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed-download");
    vi.useRealTimers();
  });
});
