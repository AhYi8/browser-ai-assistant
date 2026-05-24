import { describe, expect, it } from "vitest";
import { createPageContextPrompt } from "../../../src/shared/chat/pageContextPrompt";

describe("页面上下文 prompt 格式化", () => {
  it("标题、URL 和正文都为空时返回空字符串", () => {
    expect(createPageContextPrompt({ title: "  ", url: "", text: " \n\t " })).toBe("");
  });

  it("仅保留存在的页面信息", () => {
    expect(createPageContextPrompt({ title: "资料页", text: "" })).toBe("Page title: 资料页");
    expect(createPageContextPrompt({ url: "https://example.com/article", text: "" })).toBe("Current URL: https://example.com/article");
    expect(createPageContextPrompt({ text: "页面正文" })).toBe("Page content:\n页面正文");
  });

  it("同时存在标题、URL 和正文时按稳定顺序拼接并修剪外层空白", () => {
    expect(
      createPageContextPrompt({
        title: "  资料页标题  ",
        url: "  https://example.com/article?from=tab  ",
        text: "  页面正文内容  ",
      }),
    ).toBe("Page title: 资料页标题\n\nCurrent URL: https://example.com/article?from=tab\n\nPage content:\n页面正文内容");
  });

  it("标题和 URL 中的换行符按原始内容保留", () => {
    expect(
      createPageContextPrompt({
        title: "第一行\n第二行",
        url: "https://example.com/article\n?debug=1",
        text: "正文",
      }),
    ).toContain("Page title: 第一行\n第二行");
  });
});
