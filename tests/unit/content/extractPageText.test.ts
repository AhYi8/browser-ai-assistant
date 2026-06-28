import { beforeEach, describe, expect, it } from "vitest";
import { extractPageText } from "../../../src/content/extractPageText";
import type { ExtractionRule } from "../../../src/shared/types";

function setPage(html: string) {
  document.body.innerHTML = html;
}

function createRule(partial: Partial<ExtractionRule>): ExtractionRule {
  return {
    id: "rule-1",
    alias: "",
    urlPattern: "https://example.com/.*",
    selectorsText: "main",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("extractPageText", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head><title>测试</title></head><body></body>";
  });

  it("URL 未匹配规则时回退到 body 下可见文本", () => {
    setPage("<nav>导航</nav><main>正文内容</main>");

    const result = extractPageText({
      url: "https://other.example.com/page",
      rules: [createRule({ urlPattern: "https://example.com/.*", selectorsText: "main" })],
      maxLength: 100,
    });

    expect(result).toEqual({
      text: "导航 正文内容",
      truncated: false,
      usedFallback: true,
      matchedRuleId: undefined,
    });
  });

  it("多条规则同时命中时按 sortOrder 选择第一条", () => {
    setPage("<main>默认正文</main><article>优先正文</article>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [
        createRule({ id: "rule-late", selectorsText: "main", sortOrder: 20 }),
        createRule({ id: "rule-first", selectorsText: "article", sortOrder: 10 }),
      ],
      maxLength: 100,
    });

    expect(result.text).toBe("优先正文");
    expect(result.usedFallback).toBe(false);
    expect(result.matchedRuleId).toBe("rule-first");
  });

  it("CSS 命中时按多行顺序拼接文本", () => {
    setPage("<article>第一段</article><aside>补充信息</aside>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "aside\narticle" })],
      maxLength: 100,
    });

    expect(result.text).toBe("补充信息 第一段");
    expect(result.usedFallback).toBe(false);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("XPath 命中时提取文本", () => {
    setPage("<section id=\"content\">XPath 正文</section>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "//*[@id='content']" })],
      maxLength: 100,
    });

    expect(result.text).toBe("XPath 正文");
    expect(result.usedFallback).toBe(false);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("选择器执行失败或提取为空时回退全局文本", () => {
    setPage("<main>可见正文</main>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "[" })],
      maxLength: 100,
    });

    expect(result.text).toBe("可见正文");
    expect(result.usedFallback).toBe(true);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("只提取可见文本并跳过样式脚本和隐藏节点", () => {
    setPage(`
      <style>.hidden { display: none; }</style>
      <script>window.__noise = "脚本噪声";</script>
      <template>模板噪声</template>
      <noscript>无脚本噪声</noscript>
      <main>
        <h1>可见标题</h1>
        <p>可见正文</p>
        <span hidden>hidden 噪声</span>
        <span style="display: none">display 噪声</span>
        <span style="visibility: hidden">visibility 噪声</span>
        <span aria-hidden="true">aria 噪声</span>
      </main>
    `);

    const result = extractPageText({
      url: "https://other.example.com/page",
      rules: [],
      maxLength: 100,
    });

    expect(result.text).toBe("可见标题 可见正文");
    expect(result.usedFallback).toBe(true);
  });

  it("超长内容从开头截取并标记 truncated", () => {
    setPage("<main>abcdef</main>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "main" })],
      maxLength: 3,
    });

    expect(result).toEqual({
      text: "abc",
      truncated: true,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("提取所有模式超长 HTML 从开头截取并标记 truncated", () => {
    setPage("<main>abcdef</main>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "main" })],
      maxLength: 10,
      extractMode: "all",
    });

    expect(result).toEqual({
      text: "<main>abcd",
      truncated: true,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("提取所有模式命中 CSS 时返回匹配元素 outerHTML", () => {
    setPage('<main class="article"><h1>标题</h1><p style="color:red">正文</p></main><aside>侧栏</aside>');

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "main" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toBe('<main class="article"><h1>标题</h1><p style="color:red">正文</p></main>');
    expect(result.usedFallback).toBe(false);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("禁用回退时选择器未命中不会返回全文 HTML", () => {
    document.documentElement.innerHTML = "<head><title>测试</title></head><body><main>正文</main></body>";

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: ".missing" })],
      extractMode: "all",
      allowFallback: false,
    });

    expect(result.text).toBe("");
    expect(result.usedFallback).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("提取所有模式命中 XPath 时按顺序返回匹配元素 outerHTML", () => {
    setPage("<section><article>第一段</article><article>第二段</article></section>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "//article" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toBe("<article>第一段</article>\n<article>第二段</article>");
    expect(result.usedFallback).toBe(false);
  });

  it("提取所有模式命中 XPath 文本节点时保留原始空白", () => {
    setPage("<p> A   B </p>");

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "//p/text()" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toBe(" A   B ");
    expect(result.usedFallback).toBe(false);
  });

  it("提取所有模式命中纯空白 XPath 文本节点时回退完整 HTML 并保留规则 ID", () => {
    document.documentElement.innerHTML = "<head></head><body><p>   </p><main>正文</main></body>";

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: "//p/text()" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toContain("<body><p>   </p><main>正文</main></body>");
    expect(result.usedFallback).toBe(true);
    expect(result.matchedRuleId).toBe("rule-1");
  });

  it("提取所有模式未命中规则时返回完整 HTML", () => {
    document.documentElement.innerHTML = "<head><title>测试</title></head><body><main>正文</main></body>";

    const result = extractPageText({
      url: "https://other.example.com/page",
      rules: [createRule({ urlPattern: "https://example.com/.*", selectorsText: "main" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toContain("<html>");
    expect(result.text).toContain("<head><title>测试</title></head>");
    expect(result.text).toContain("<body><main>正文</main></body>");
    expect(result.usedFallback).toBe(true);
    expect(result.matchedRuleId).toBeUndefined();
  });

  it("提取所有模式规则命中但内容为空时回退完整 HTML 并保留规则 ID", () => {
    document.documentElement.innerHTML = "<head></head><body><main>正文</main></body>";

    const result = extractPageText({
      url: "https://example.com/article",
      rules: [createRule({ selectorsText: ".missing" })],
      maxLength: 500,
      extractMode: "all",
    });

    expect(result.text).toContain("<body><main>正文</main></body>");
    expect(result.usedFallback).toBe(true);
    expect(result.matchedRuleId).toBe("rule-1");
  });
});
