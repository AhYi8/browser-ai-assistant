import { formatNetworkAttachmentForExport, formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "../../shared/networkContext";
import type { ChatMessage, ChatSession } from "../../shared/types";

const roleLabels: Record<ChatMessage["role"], string> = {
  system: "系统",
  user: "用户",
  assistant: "助手",
};

type ExportBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "thinking"; text: string };

export function createChatSessionMarkdown(session: ChatSession, exportedAt: number = Date.now()): string {
  const lines = [
    `# ${sanitizeMarkdownHeading(session.title)}`,
    "",
    `- 导出时间：${formatDateTime(exportedAt)}`,
    `- 会话创建时间：${formatDateTime(session.createdAt)}`,
    `- 会话更新时间：${formatDateTime(session.updatedAt)}`,
    `- 消息数量：${session.messages.length}`,
    "",
  ];

  for (const message of session.messages) {
    lines.push(`## ${roleLabels[message.role]} · ${formatDateTime(message.createdAt)}`, "");

    if (message.thinking?.trim()) {
      // 思考过程不是正式回复内容，用引用块保留上下文，同时避免干扰正文 Markdown 结构。
      lines.push(`> 思考过程：${message.thinking.trim().replace(/\r?\n/g, "\n> ")}`, "");
    }

    lines.push(formatContentCodeBlock(formatMessageExportContent(message)), "");
  }

  return lines.join("\n");
}

export function createChatSessionMarkdownFilename(session: ChatSession, exportedAt: number = Date.now()): string {
  return createChatSessionExportFilename(session, "md", exportedAt);
}

export function downloadChatSessionMarkdown(session: ChatSession, exportedAt: number = Date.now()): void {
  const markdown = createChatSessionMarkdown(session, exportedAt);
  const filename = createChatSessionExportFilename(session, "md", exportedAt);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, filename);
}

export async function downloadChatSessionWord(session: ChatSession, exportedAt: number = Date.now()): Promise<void> {
  const document = await createWordDocument(session, exportedAt);
  const { Packer } = await import("docx");
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, createChatSessionExportFilename(session, "docx", exportedAt));
}

export async function downloadChatSessionPdf(session: ChatSession, exportedAt: number = Date.now()): Promise<void> {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("无法打开打印窗口，请允许弹窗后重试");
  }

  printWindow.document.open();
  printWindow.document.write(createChatSessionPrintHtml(session, exportedAt));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export function createChatSessionPrintHtml(session: ChatSession, exportedAt: number = Date.now()): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(session.title)}</title>
<style>
${createPrintCss()}
</style>
</head>
<body>
${createPrintBodyHtml(session, exportedAt)}
</body>
</html>`;
}

function createPrintCss(): string {
  return `@page { size: A4; margin: 18mm; }
body { margin: 0; color: #141413; background: #ffffff; font-family: "Microsoft YaHei", "SimSun", "Noto Sans CJK SC", Arial, sans-serif; font-size: 12pt; line-height: 1.65; }
h1 { font-size: 22pt; font-weight: 600; margin: 0 0 14pt; }
h2 { font-size: 15pt; font-weight: 600; margin: 18pt 0 8pt; }
h3 { font-size: 13pt; font-weight: 600; margin: 14pt 0 6pt; }
p { margin: 0 0 8pt; white-space: pre-wrap; }
pre { margin: 0 0 8pt; padding: 8pt; background: #181715; color: #faf9f5; border-radius: 4pt; white-space: pre-wrap; word-break: break-word; font-family: "Microsoft YaHei Mono", Consolas, monospace; font-size: 10pt; line-height: 1.5; }
.thinking { margin: 0 0 8pt; padding: 6pt 10pt; border-left: 3pt solid #e8a55a; background: #faf9f5; color: #6c6a64; text-align: left; white-space: pre-wrap; }`;
}

function createChatSessionExportFilename(session: ChatSession, extension: "md" | "docx" | "pdf", exportedAt: number = Date.now()): string {
  const title = sanitizeFilenamePart(session.title).slice(0, 80) || "聊天记录";
  return `${title}-${formatDate(exportedAt)}.${extension}`;
}

function createPrintBodyHtml(session: ChatSession, exportedAt: number): string {
  return createExportBlocks(session, exportedAt).map(blockToHtml).join("\n");
}

function createExportBlocks(session: ChatSession, exportedAt: number): ExportBlock[] {
  const blocks: ExportBlock[] = [
    { type: "heading", level: 1, text: sanitizeMarkdownHeading(session.title) },
    { type: "paragraph", text: `导出时间：${formatDateTime(exportedAt)}` },
    { type: "paragraph", text: `会话创建时间：${formatDateTime(session.createdAt)}` },
    { type: "paragraph", text: `会话更新时间：${formatDateTime(session.updatedAt)}` },
    { type: "paragraph", text: `消息数量：${session.messages.length}` },
  ];

  for (const message of session.messages) {
    blocks.push({ type: "heading", level: 2, text: `${roleLabels[message.role]} · ${formatDateTime(message.createdAt)}` });
    if (message.thinking?.trim()) {
      blocks.push({ type: "thinking", text: `思考过程：${message.thinking.trim()}` });
    }
    blocks.push({ type: "code", text: formatMessageExportContent(message).trimEnd() });
  }

  return blocks;
}

function formatMessageExportContent(message: ChatMessage): string {
  const promptInvocations = message.role === "user" ? (message.promptInvocations ?? []) : [];
  const contentSections = [message.content];

  if (message.networkContextAttachment) {
    const networkRequests = message.networkContextAttachment.requests.map(redactNetworkRequestDetail);
    contentSections.push(
      [
        "# Network 请求详情附件",
        "",
        formatNetworkAttachmentSummary(networkRequests),
        "",
        formatNetworkAttachmentForExport(networkRequests),
      ].join("\n"),
    );
  }

  if (promptInvocations.length === 0) {
    return contentSections.join("\n\n").trim();
  }

  const promptSections = promptInvocations.map((prompt) => [`## ${prompt.title}`, "```", prompt.contentSnapshot, "```"].join("\n"));

  return ["# 调用的Prompt", "", promptSections.join("\n\n"), "", "# 用户输入", "", ...contentSections].join("\n");
}

function blockToHtml(block: ExportBlock): string {
  if (block.type === "heading") {
    return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
  }

  if (block.type === "thinking") {
    return `<section class="thinking">${escapeHtml(block.text).replace(/\n/g, "<br>")}</section>`;
  }

  if (block.type === "code") {
    return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  }

  return `<p>${escapeHtml(block.text)}</p>`;
}

async function createWordDocument(session: ChatSession, exportedAt: number) {
  const { AlignmentType, BorderStyle, Document, HeadingLevel, Paragraph, ShadingType, TextRun } = await import("docx");
  const createTextRuns = (text: string, options: { italics?: boolean; font?: string; color?: string } = {}) =>
    text.split(/\r?\n/).flatMap((line, index) => [
      ...(index > 0 ? [new TextRun({ break: 1, ...options })] : []),
      new TextRun({ text: line || " ", ...options }),
    ]);
  const paragraphs = createExportBlocks(session, exportedAt).flatMap((block) => {
    if (block.type === "heading") {
      return [
        new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          spacing: { before: block.level === 1 ? 0 : 240, after: 120 },
          children: [new TextRun({ text: block.text, bold: true })],
        }),
      ];
    }

    if (block.type === "thinking") {
      return [
        new Paragraph({
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "E8A55A" } },
          shading: { type: ShadingType.CLEAR, fill: "FAF9F5" },
          spacing: { after: 120 },
          indent: { left: 240 },
          alignment: AlignmentType.LEFT,
          children: createTextRuns(block.text),
        }),
      ];
    }

    if (block.type === "code") {
      return block.text.split(/\r?\n/).map(
        (line) =>
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: "181715" },
            spacing: { after: 0 },
            children: [new TextRun({ text: line || " ", font: "Consolas", color: "FAF9F5" })],
          }),
      );
    }

    return [
      new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.LEFT,
        children: createTextRuns(block.text || " "),
      }),
    ];
  });

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1021, right: 1021, bottom: 1021, left: 1021 },
          },
        },
        children: paragraphs,
      },
    ],
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    // Blob URL 属于页面资源，即使下载触发失败也要释放，避免 Side Panel 长时间打开时累积内存。
    URL.revokeObjectURL(url);
  }
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized.replace(/^\.+/, (dots) => "_".repeat(dots.length));
}

function sanitizeMarkdownHeading(value: string): string {
  const sanitized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/^#+\s*/g, "")
    .trim();

  return sanitized || "未命名聊天";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatContentCodeBlock(content: string): string {
  const normalizedContent = content.trimEnd();
  const fence = createCodeFence(normalizedContent);
  return `${fence}\n${normalizedContent}\n${fence}`;
}

function createCodeFence(content: string): string {
  const longestFenceLength = Array.from(content.matchAll(/`{3,}/g)).reduce((maxLength, match) => Math.max(maxLength, match[0].length), 0);
  // 正文里可能已经包含 Markdown 代码块，外层围栏必须更长，避免导出的聊天记录被提前截断。
  return "`".repeat(Math.max(3, longestFenceLength + 1));
}

function formatDateTime(value: number): string {
  return new Date(value).toISOString();
}

function formatDate(value: number): string {
  return formatDateTime(value).slice(0, 10);
}
