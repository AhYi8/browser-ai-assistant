export interface ParsedAssistantResponse {
  content: string;
  thinking?: string;
}

export function parseAssistantResponse(rawContent: string): ParsedAssistantResponse {
  const contentWithoutToolMarkup = stripLeakedToolMarkup(rawContent);
  const thinkMatch = contentWithoutToolMarkup.match(/^\s*<think>([\s\S]*?)<\/think>/i);
  if (!thinkMatch) {
    return {
      content: contentWithoutToolMarkup.trim(),
      thinking: undefined,
    };
  }

  const content = contentWithoutToolMarkup.slice(thinkMatch[0].length).trim();

  return {
    content: content || contentWithoutToolMarkup.trim(),
    thinking: thinkMatch[1].trim() || undefined,
  };
}

function stripLeakedToolMarkup(content: string): string {
  const pairedToolMarkupPattern =
    /<\s*\|\s*\|\s*DSML\s*\|\s*\|\s*([a-z_:-]+)\b[^>]*>[\s\S]*?<\/\s*\|\s*\|\s*DSML\s*\|\s*\|\s*\1\s*>/gi;
  let cleanedContent = content;
  let previousContent = "";

  // DSML 片段可能嵌套输出，先逐层剥离成对标签，避免把同一行标签前的可见正文一起删除。
  while (cleanedContent !== previousContent) {
    previousContent = cleanedContent;
    cleanedContent = cleanedContent.replace(pairedToolMarkupPattern, "");
  }

  return cleanedContent
    .split(/\r?\n/)
    .map((line) => line.replace(/<\/?\s*\|\s*\|\s*DSML\s*\|\s*\|[^>]*>.*$/i, ""))
    .join("\n")
    .trim();
}
