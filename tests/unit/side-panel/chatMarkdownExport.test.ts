import {
  createChatMessageMarkdown,
  createChatSessionMarkdown,
  createChatSessionMarkdownFilename,
  createChatSessionPrintHtml,
  downloadChatSessionMarkdown,
  downloadChatSessionPdf,
  downloadChatSessionWord,
} from "../../../src/side-panel/utils/chatMarkdownExport";
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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

  it("导出会保留紧凑模式在聊天面板隐藏的工具轮助手消息", () => {
    const session = createSession({
      title: "工具轮导出",
      messages: [
        createMessage({
          id: "message-tool-turn-export",
          role: "assistant",
          assistantMessageKind: "tool_call_turn",
          content: "工具调用前的 AI 中间回复",
          thinking: "工具调用前的思考",
          createdAt: 1700000000000,
          toolCallRecords: [
            {
              id: "call-export",
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
    });

    const markdown = createChatSessionMarkdown(session, 1700000200000);

    expect(markdown).toContain("工具调用前的 AI 中间回复");
    expect(markdown).toContain("工具调用前的思考");
  });

  it("导出用户消息时把调用的 Prompt 快照拼接到用户输入前", () => {
    const session = createSession({
      title: "Prompt 会话",
      messages: [
        createMessage({
          id: "message-prompt",
          role: "user",
          content: "用户输入的内容",
          promptInvocations: [
            {
              promptId: "prompt-1",
              title: "Prompt1 的标题",
              contentSnapshot: "Prompt1 的内容",
            },
            {
              promptId: "prompt-2",
              title: "Prompt2 的标题",
              contentSnapshot: "Prompt2 的内容",
            },
          ],
          createdAt: 1700000000000,
        }),
      ],
    });

    expect(createChatSessionMarkdown(session, 1700000200000)).toContain(`## 用户 · 2023-11-14T22:13:20.000Z

\`\`\`\`
# 调用的Prompt

## Prompt1 的标题
\`\`\`
Prompt1 的内容
\`\`\`

## Prompt2 的标题
\`\`\`
Prompt2 的内容
\`\`\`

# 用户输入

用户输入的内容
\`\`\`\`
`);
    expect(createChatSessionPrintHtml(session, 1700000200000)).toContain("# 调用的Prompt");
  });

  it("复制用户消息时只返回用户输入正文", () => {
    const message = createMessage({
      id: "message-copy-user",
      role: "user",
      content: "用户真正输入的内容",
      promptInvocations: [
        {
          promptId: "prompt-1",
          title: "不应复制的 Prompt",
          contentSnapshot: "Prompt 快照不属于用户直接输入",
        },
      ],
      attachments: [
        {
          id: "image-1",
          name: "截图.png",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
        },
      ],
    });

    expect(createChatMessageMarkdown(message)).toBe("用户真正输入的内容");
  });

  it("复制助手消息时包含思考过程、正文、Network 附件和网络搜索附件", () => {
    const message = createMessage({
      id: "message-copy-assistant",
      role: "assistant",
      content: "登录接口返回 500，建议检查服务端错误日志。",
      thinking: "先检查请求状态。\n再查看响应体。",
      networkContextAttachment: {
        id: "network-1",
        title: "Network 请求详情",
        summary: "历史摘要不应直接复用",
        createdAt: 1700000100000,
        redacted: true,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: "https://api.example.com/login",
            method: "POST",
            status: 500,
            statusText: "Internal Server Error",
            requestHeaders: [{ name: "Authorization", value: "[已脱敏]" }],
            responseBody: "{\"error\":\"failed\"}",
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
          answer: "Tavily 提供搜索能力。",
          results: [
            {
              title: "Tavily Docs",
              url: "https://docs.tavily.com/search",
              content: "官方文档内容",
            },
          ],
          createdAt: 1700000200000,
          redacted: false,
          truncated: false,
        },
      ],
    });

    const markdown = createChatMessageMarkdown(message);

    expect(markdown).toContain("> 思考过程：先检查请求状态。\n> 再查看响应体。");
    expect(markdown).toContain("登录接口返回 500，建议检查服务端错误日志。");
    expect(markdown).toContain("# Network 请求详情附件");
    expect(markdown).toContain("已注入 1 个 Network 请求：POST 500 https://api.example.com/login");
    expect(markdown).toContain("Authorization: [已脱敏]");
    expect(markdown).toContain("# 网络搜索结果附件");
    expect(markdown).toContain("搜索问题：Tavily API");
    expect(markdown).toContain("Tavily Docs");
  });

  it("复制助手消息前会重新脱敏历史 Network 脏附件", () => {
    const message = createMessage({
      id: "message-copy-unsafe-network",
      role: "assistant",
      content: "旧版本保存的 Network 附件。",
      networkContextAttachment: {
        id: "network-unsafe",
        title: "Network 请求详情 token=secret-token",
        summary: "旧摘要 token=secret-token",
        createdAt: 1700000100000,
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
            requestBody: "{\"password\":\"123456\",\"name\":\"zhangsan\"}",
            responseBody: "{\"access_token\":\"secret-token\"}",
            redacted: false,
            truncated: false,
          },
        ],
      },
    });

    const markdown = createChatMessageMarkdown(message);

    expect(markdown).toContain("token=[已脱敏]");
    expect(markdown).toContain("Authorization: [已脱敏]");
    expect(markdown).toContain("Cookie: [已脱敏]");
    expect(markdown).toContain("\"password\":\"[已脱敏]\"");
    expect(markdown).not.toContain("secret-token");
    expect(markdown).not.toContain("secret-cookie");
    expect(markdown).not.toContain("123456");
  });

  it("导出助手消息时包含 Network 请求详情附件", () => {
    const session = createSession({
      title: "Network 分析",
      messages: [
        createMessage({
          id: "message-assistant-network",
          role: "assistant",
          content: "登录接口返回 500，建议检查服务端错误日志。",
          networkContextAttachment: {
            id: "network-1",
            title: "Network 请求详情",
            summary: "已注入 1 个 Network 请求：POST 500 https://api.example.com/login",
            createdAt: 1700000100000,
            redacted: true,
            truncated: false,
            requests: [
              {
                id: "req-1",
                url: "https://api.example.com/login",
                method: "POST",
                status: 500,
                statusText: "Internal Server Error",
                mimeType: "application/json",
                resourceType: "xhr",
                durationMs: 120,
                requestHeaders: [{ name: "Authorization", value: "[已脱敏]" }],
                responseHeaders: [{ name: "Content-Type", value: "application/json" }],
                requestBody: '{"password":"[已脱敏]"}',
                responseBody: '{"error":"failed"}',
                redacted: true,
                truncated: false,
              },
            ],
          },
          createdAt: 1700000000000,
        }),
      ],
    });

    const markdown = createChatSessionMarkdown(session, 1700000200000);

    expect(markdown).toContain("# Network 请求详情附件");
    expect(markdown).toContain("已注入 1 个 Network 请求：POST 500 https://api.example.com/login");
    expect(markdown).toContain("Authorization: [已脱敏]");
    expect(createChatSessionPrintHtml(session, 1700000200000)).toContain("Network 请求详情附件");
  });

  it("导出历史 Network 脏附件前会重新脱敏", () => {
    const session = createSession({
      title: "Network 脏附件",
      messages: [
        createMessage({
          id: "message-assistant-network-unsafe",
          role: "assistant",
          content: "旧版本保存的 Network 附件。",
          networkContextAttachment: {
            id: "network-unsafe",
            title: "Network 请求详情",
            summary: "旧版本保存的 Network 请求：POST 500 https://api.example.com/login?token=secret-token&safe=1",
            createdAt: 1700000100000,
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
          createdAt: 1700000000000,
        }),
      ],
    });

    const markdown = createChatSessionMarkdown(session, 1700000200000);

    expect(markdown).toContain("token=[已脱敏]");
    expect(markdown).toContain("Authorization: [已脱敏]");
    expect(markdown).toContain("Cookie: [已脱敏]");
    expect(markdown).toContain('"password":"[已脱敏]"');
    expect(markdown).not.toContain("secret-token");
    expect(markdown).not.toContain("secret-cookie");
    expect(markdown).not.toContain("123456");
    expect(createChatSessionPrintHtml(session, 1700000200000)).not.toContain("secret-token");
  });

  it("生成适合下载的 Markdown 文件名", () => {
    const session = createSession({ title: "资料/会话:*?" });

    expect(createChatSessionMarkdownFilename(session, 1700000200000)).toBe("资料_会话___-2023-11-14.md");
  });

  it("下载当前会话 Word 文档", async () => {
    const downloadMock = createDownloadMock("blob:session-word");
    const session = createSession({
      title: "Word 会话",
      messages: [createMessage({ content: "Word 内容", createdAt: 1700000000000 })],
    });

    await downloadChatSessionWord(session, 1700000200000);

    expect(downloadMock.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadMock.anchor.download).toBe("Word 会话-2023-11-14.docx");
    expect(downloadMock.anchor.href).toBe("blob:session-word");
    expect(downloadMock.click).toHaveBeenCalledTimes(1);
    expect(downloadMock.revokeObjectURL).toHaveBeenCalledWith("blob:session-word");
    const blob = downloadMock.createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("Word 文档使用 A4 页面并把消息正文原文放进代码块", async () => {
    const downloadMock = createDownloadMock("blob:session-word");
    const session = createSession({
      title: "Word 格式会话",
      messages: [
        createMessage({
          role: "assistant",
          content: "第一行\n第二行\n\n> 引用第一行\n> 引用第二行\n\n```ts\nconst value = 1;\nconsole.log(value);\n```",
          thinking: "思考第一行\n思考第二行",
          createdAt: 1700000000000,
        }),
      ],
    });

    await downloadChatSessionWord(session, 1700000200000);

    const blob = downloadMock.createObjectURL.mock.calls[0][0] as Blob;
    const documentXml = await getDocxEntryText(blob, "word/document.xml");
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect(documentXml).toContain("<w:br/>");
    expect(documentXml).toContain('<w:left w:val="single" w:color="E8A55A" w:sz="12"/>');
    expect(documentXml).toContain('<w:jc w:val="left"/>');
    expect(documentXml).toContain('<w:shd w:fill="181715"');
    expect(documentXml).toContain('<w:color w:val="FAF9F5"/>');
    expect(documentXml).toContain("&gt; 引用第一行");
    expect(documentXml).toContain("```ts");
  });

  it("生成用于 Word/PDF 的打印 HTML，把消息正文原文放进代码块", () => {
    const session = createSession({
      title: "格式会话",
      messages: [
        createMessage({
          role: "assistant",
          content: "# 标题\n\n> 引用内容\n\n```ts\nconst value = 1;\n```\n\nBob's \"引用\"",
          thinking: "第一步\n第二步",
          createdAt: 1700000000000,
        }),
      ],
    });

    const html = createChatSessionPrintHtml(session, 1700000200000);

    expect(html).toContain("@page { size: A4; margin: 18mm; }");
    expect(html).toContain("<title>格式会话</title>");
    expect(html).toContain("<h1>格式会话</h1>");
    expect(html).toContain("<pre><code># 标题");
    expect(html).toContain("&gt; 引用内容");
    expect(html).toContain("```ts");
    expect(html).toContain('<section class="thinking">');
    expect(html).toContain("text-align: left;");
    expect(html).toContain("思考过程：第一步<br>第二步");
    expect(html).toContain("Bob&#39;s &quot;引用&quot;");
    expect(html).not.toContain(".meta");
    expect(html).not.toContain(".message");
  });

  it("打开打印窗口导出当前会话 PDF", async () => {
    const printMock = createPrintWindowMock();
    const session = createSession({
      title: "PDF 会话",
      messages: [createMessage({ content: "PDF 内容", createdAt: 1700000000000 })],
    });

    await downloadChatSessionPdf(session, 1700000200000);

    expect(printMock.open).toHaveBeenCalledWith("", "_blank");
    expect(printMock.document.open).toHaveBeenCalledTimes(1);
    expect(printMock.document.write).toHaveBeenCalledWith(expect.stringContaining("@page { size: A4; margin: 18mm; }"));
    expect(printMock.document.write).toHaveBeenCalledWith(expect.stringContaining("<pre><code>PDF 内容</code></pre>"));
    expect(printMock.document.close).toHaveBeenCalledTimes(1);
    expect(printMock.focus).toHaveBeenCalledTimes(1);
    expect(printMock.print).toHaveBeenCalledTimes(1);
  });

  it("打印 PDF 失败时抛出明确错误", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const session = createSession({
      title: "PDF 格式会话",
      messages: [
        createMessage({
          role: "assistant",
          content: "> 引用内容\n\n```ts\nconst value = 1;\n```\n\n普通段落",
          thinking: "思考内容",
          createdAt: 1700000000000,
        }),
      ],
    });

    await expect(downloadChatSessionPdf(session, 1700000200000)).rejects.toThrow("无法打开打印窗口，请允许弹窗后重试");
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
  });
});

function createDownloadMock(url: string) {
  const click = vi.fn();
  const anchor = document.createElement("a");
  Object.defineProperty(anchor, "click", { configurable: true, value: click });
  const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() === "a") {
      return anchor;
    }

    return Document.prototype.createElement.call(document, tagName, options);
  });
  const createObjectURL = vi.fn((blob: Blob) => {
    void blob;
    return url;
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
    createElement,
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

describe("网络搜索附件导出", () => {
  it("导出助手消息时包含网络搜索结果附件", () => {
    const session = createSession({
      title: "搜索会话",
      messages: [
        createMessage({
          id: "message-assistant-search",
          role: "assistant",
          content: "Tavily 可以用于网络搜索。",
          toolAttachments: [
            {
              id: "tool-attachment-search",
              kind: "web-search",
              title: "网络搜索结果",
              summary: "搜索问题：Tavily API",
              provider: "tavily",
              query: "Tavily API",
              answer: "Tavily 是搜索 API。",
              results: [
                {
                  title: "Tavily Docs",
                  url: "https://docs.tavily.com/search",
                  content: "官方文档内容",
                  score: 0.9,
                  publishedDate: "2026-01-01",
                },
              ],
              createdAt: 1700000100000,
              redacted: false,
              truncated: false,
            },
          ],
          createdAt: 1700000000000,
        }),
      ],
    });

    const markdown = createChatSessionMarkdown(session, 1700000200000);

    expect(markdown).toContain("# 网络搜索结果附件");
    expect(markdown).toContain("搜索问题：Tavily API");
    expect(markdown).toContain("Tavily Docs");
    expect(markdown).toContain("https://docs.tavily.com/search");
    expect(createChatSessionPrintHtml(session, 1700000200000)).toContain("网络搜索结果附件");
  });
});

async function getDocxEntryText(blob: Blob, entryPath: string): Promise<string> {
  const zipModule = await import("jszip");
  const zip = await zipModule.default.loadAsync(await blob.arrayBuffer());
  const entry = zip.file(entryPath);
  if (!entry) {
    throw new Error(`未找到 DOCX 条目：${entryPath}`);
  }

  return entry.async("text");
}
