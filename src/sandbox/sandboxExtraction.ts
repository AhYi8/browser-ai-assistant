export type SandboxExtractionResult = { ok: true; data: unknown } | { ok: false; message: string };

export interface SandboxExtractionInput {
  html: string;
  code: string;
}

export function runSandboxExtractionCode(input: SandboxExtractionInput): SandboxExtractionResult {
  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(input.html, "text/html");
    const safeCode = input.code.trim();
    if (!safeCode) {
      return { ok: false, message: "沙盒提取代码不能为空" };
    }

    // 仅在扩展 Sandbox 中执行模型生成的提取代码；代码只能访问重建后的 HTML 文档，不能触碰真实网页 DOM。
    const run = new Function("document", "htmlString", safeCode) as (document: Document, htmlString: string) => unknown;
    return { ok: true, data: run(document, input.html) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `沙盒提取失败：${error.message}` : "沙盒提取失败",
    };
  }
}

export function compressHtmlForAutomation(html: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  document.querySelectorAll("script, style, svg, img, picture, video, audio, canvas, iframe").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((element) => {
    element.removeAttribute("class");
    element.removeAttribute("style");
    element.removeAttribute("src");
    element.removeAttribute("srcset");
  });

  return document.documentElement.outerHTML.replace(/\s+/g, " ").trim();
}
