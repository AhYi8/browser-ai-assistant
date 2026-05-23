import type { ChatMessage, ChatSession } from "../../shared/types";

const roleLabels: Record<ChatMessage["role"], string> = {
  system: "系统",
  user: "用户",
  assistant: "助手",
};

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

    lines.push(formatContentCodeBlock(message.content), "");
  }

  return lines.join("\n");
}

export function createChatSessionMarkdownFilename(session: ChatSession, exportedAt: number = Date.now()): string {
  const title = sanitizeFilenamePart(session.title).slice(0, 80) || "聊天记录";
  return `${title}-${formatDate(exportedAt)}.md`;
}

export function downloadChatSessionMarkdown(session: ChatSession): void {
  const markdown = createChatSessionMarkdown(session);
  const filename = createChatSessionMarkdownFilename(session);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
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
