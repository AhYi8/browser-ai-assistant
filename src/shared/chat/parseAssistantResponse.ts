export interface ParsedAssistantResponse {
  content: string;
  thinking?: string;
}

export function parseAssistantResponse(rawContent: string): ParsedAssistantResponse {
  const thinkMatch = rawContent.match(/^\s*<think>([\s\S]*?)<\/think>/i);
  if (!thinkMatch) {
    return {
      content: rawContent.trim(),
      thinking: undefined,
    };
  }

  const content = rawContent.slice(thinkMatch[0].length).trim();

  return {
    content: content || rawContent.trim(),
    thinking: thinkMatch[1].trim() || undefined,
  };
}
