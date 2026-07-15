import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss, { type Root } from "postcss";
import { StrictMode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";
import { MarkdownCodeBlock, MarkdownCodePre, resolveMarkdownCodeLanguage } from "../../../src/side-panel/components/MarkdownCodeBlock";

const copyTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../../src/side-panel/utils/messageClipboard", () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderMarkdown(markdown: string) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCodeBlock, pre: MarkdownCodePre }}>
      {markdown}
    </ReactMarkdown>,
  );
}

function getStyleDeclarations(root: Root, selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) {
      return;
    }
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
  });
  return declarations;
}

describe("MarkdownCodeBlock", () => {
  it("用户消息使用暖色代码表面和显式前景色，且不改变 AI 消息的中性代码表面", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/side-panel/styles.css"), "utf8");
    const root = postcss.parse(styles);
    const userBlock = getStyleDeclarations(root, ".message-row-user .markdown-code-block");
    const userBlockBody = getStyleDeclarations(root, ".message-row-user .markdown-code-block-body");
    const userBlockCode = getStyleDeclarations(root, ".message-row-user .markdown-code-block-code");
    const userBlockButtonFocus = getStyleDeclarations(root, ".message-row-user .markdown-code-block-icon-button:focus-visible");
    const userInlineCode = getStyleDeclarations(root, ".message-row-user .message-bubble :not(pre) > code");
    const assistantBlock = getStyleDeclarations(root, ".markdown-code-block");
    const assistantBlockBody = getStyleDeclarations(root, ".markdown-code-block-body");

    expect(userBlock.background).toContain("var(--color-canvas)");
    expect(userBlock.background).toContain("var(--color-primary)");
    expect(userBlock.color).toBe("var(--color-ink)");
    expect(userBlockBody.background).toContain("var(--color-primary)");
    expect(userBlockCode.color).toBe("var(--color-ink)");
    expect(userBlockButtonFocus["outline-color"]).toBe("var(--color-primary-active)");
    expect(userInlineCode.background).toContain("var(--color-primary)");
    expect(userInlineCode.color).toBe("var(--color-ink)");
    expect(userInlineCode["border-radius"]).toBe("0.25rem");
    expect(assistantBlock.background).toBe("var(--color-canvas)");
    expect(assistantBlockBody.background).toContain("var(--color-surface-soft)");
  });

  it("根据 Markdown 语言类名显示代码类型，无法判断时兜底为 text", () => {
    expect(resolveMarkdownCodeLanguage("language-json")).toBe("json");
    expect(resolveMarkdownCodeLanguage("language-js")).toBe("javascript");
    expect(resolveMarkdownCodeLanguage("language-ts")).toBe("typescript");
    expect(resolveMarkdownCodeLanguage()).toBe("text");
  });

  it("默认不换行且处于折叠高度限制状态", () => {
    render(<MarkdownCodeBlock className="language-json">{"{\"name\":\"demo\"}\n"}</MarkdownCodeBlock>);

    const block = screen.getByLabelText("代码类型 json").closest(".markdown-code-block");
    const body = block?.querySelector(".markdown-code-block-body") as HTMLElement | null;

    expect(block).toHaveClass("markdown-code-block-nowrap");
    expect(block).toHaveClass("markdown-code-block-collapsed");
    expect(body).toHaveStyle({ maxHeight: "320px" });
  });

  it("点击换行按钮可以在换行和不换行之间切换", async () => {
    const user = userEvent.setup();
    render(<MarkdownCodeBlock className="language-text">{"first line\nsecond line"}</MarkdownCodeBlock>);

    const block = screen.getByLabelText("代码类型 text").closest(".markdown-code-block");
    const wrapButton = screen.getByRole("button", { name: "切换为换行" });

    await user.click(wrapButton);
    expect(block).toHaveClass("markdown-code-block-wrap");
    expect(screen.getByRole("button", { name: "切换为不换行" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "切换为不换行" }));
    expect(block).toHaveClass("markdown-code-block-nowrap");
  });

  it("点击展开按钮后取消纵向高度限制，再次点击恢复折叠", async () => {
    const user = userEvent.setup();
    render(<MarkdownCodeBlock className="language-java">{"class Demo {}\n".repeat(80)}</MarkdownCodeBlock>);

    const block = screen.getByLabelText("代码类型 java").closest(".markdown-code-block");
    const body = block?.querySelector(".markdown-code-block-body") as HTMLElement | null;

    await user.click(screen.getByRole("button", { name: "展开代码块" }));
    expect(block).toHaveClass("markdown-code-block-expanded");
    expect(body).not.toHaveStyle({ maxHeight: "320px" });

    await user.click(screen.getByRole("button", { name: "收起代码块" }));
    expect(block).toHaveClass("markdown-code-block-collapsed");
    expect(body).toHaveStyle({ maxHeight: "320px" });
  });

  it("复制按钮成功后只复制源码内容并显示已复制", async () => {
    const user = userEvent.setup();
    copyTextToClipboardMock.mockClear();
    render(<MarkdownCodeBlock className="language-javascript">{"const value = 1;\n"}</MarkdownCodeBlock>);

    await user.click(screen.getByRole("button", { name: "复制源码" }));

    expect(copyTextToClipboardMock).toHaveBeenCalledWith("const value = 1;");
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("StrictMode 重新挂载检查后仍能显示复制反馈", async () => {
    const user = userEvent.setup();
    copyTextToClipboardMock.mockReset();
    copyTextToClipboardMock.mockResolvedValue(undefined);
    render(
      <StrictMode>
        <MarkdownCodeBlock className="language-javascript">{"const value = 1;\n"}</MarkdownCodeBlock>
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "复制源码" }));

    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("复制失败时显示失败反馈且不会保留已复制成功提示", async () => {
    const user = userEvent.setup();
    copyTextToClipboardMock.mockReset();
    copyTextToClipboardMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("copy failed"));
    render(<MarkdownCodeBlock className="language-javascript">{"const value = 1;\n"}</MarkdownCodeBlock>);

    await user.click(screen.getByRole("button", { name: "复制源码" }));
    expect(await screen.findByText("已复制")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制源码" }));
    await waitFor(() => expect(screen.queryByText("已复制")).not.toBeInTheDocument());
    expect(await screen.findByText("复制失败")).toBeInTheDocument();
  });

  it("快速重复复制时只显示最后一次复制结果", async () => {
    const user = userEvent.setup();
    const firstCopy = createDeferred();
    const secondCopy = createDeferred();
    copyTextToClipboardMock.mockReset();
    copyTextToClipboardMock.mockReturnValueOnce(firstCopy.promise).mockReturnValueOnce(secondCopy.promise);
    render(<MarkdownCodeBlock className="language-javascript">{"const value = 1;\n"}</MarkdownCodeBlock>);

    await user.click(screen.getByRole("button", { name: "复制源码" }));
    await user.click(screen.getByRole("button", { name: "复制源码" }));

    secondCopy.reject(new Error("copy failed"));
    expect(await screen.findByText("复制失败")).toBeInTheDocument();

    firstCopy.resolve();
    await waitFor(() => expect(screen.queryByText("已复制")).not.toBeInTheDocument());
    expect(screen.getByText("复制失败")).toBeInTheDocument();
  });

  it("复制源码时忽略非文本 children，避免复制 null 或 false 字面量", async () => {
    const user = userEvent.setup();
    copyTextToClipboardMock.mockReset();
    copyTextToClipboardMock.mockResolvedValue(undefined);
    render(
      <MarkdownCodeBlock className="language-text">
        {"first\n"}
        {null}
        {false}
        {2}
        {"\n"}
      </MarkdownCodeBlock>,
    );

    await user.click(screen.getByRole("button", { name: "复制源码" }));

    expect(copyTextToClipboardMock).toHaveBeenCalledWith("first\n2");
  });

  it("ReactMarkdown 行内代码不渲染操作栏", () => {
    renderMarkdown("正文里的 `inline` 代码。");

    expect(screen.getByText("inline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制源码" })).not.toBeInTheDocument();
  });

  it("ReactMarkdown 无语言 fenced code block 兜底显示 text 类型", async () => {
    renderMarkdown("```\nplain text\n```");

    expect(await screen.findByLabelText("代码类型 text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制源码" })).toBeInTheDocument();
  });
});
