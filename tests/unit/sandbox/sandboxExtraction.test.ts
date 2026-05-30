import { describe, expect, it } from "vitest";
import { compressHtmlForAutomation, runSandboxExtractionCode } from "../../../src/sandbox/sandboxExtraction";

describe("自动化 Sandbox 提取", () => {
  it("在隔离 DOM 中执行提取代码并返回结构化数据", () => {
    const result = runSandboxExtractionCode({
      html: "<html><body><main><h1>订单</h1><p>金额：100</p></main></body></html>",
      code: `
        const title = document.querySelector("h1")?.textContent;
        const amount = document.querySelector("p")?.textContent;
        return { title, amount };
      `,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        title: "订单",
        amount: "金额：100",
      },
    });
  });

  it("提取代码异常时返回中文错误", () => {
    const result = runSandboxExtractionCode({
      html: "<html><body><main>内容</main></body></html>",
      code: "throw new Error('selector failed')",
    });

    expect(result).toEqual({
      ok: false,
      message: "沙盒提取失败：selector failed",
    });
  });

  it("压缩 HTML 时移除脚本、样式和大体积媒体节点", () => {
    const compressed = compressHtmlForAutomation(`
      <html>
        <head><style>.x{color:red}</style><script>window.secret=1</script></head>
        <body><main class="card" style="color:red"><img src="x.png">正文</main></body>
      </html>
    `);

    expect(compressed).toContain("<main>正文</main>");
    expect(compressed).not.toContain("<script>");
    expect(compressed).not.toContain("<style>");
    expect(compressed).not.toContain("<img");
    expect(compressed).not.toContain("class=");
    expect(compressed).not.toContain("style=");
  });
});
