export interface PageContextPromptInput {
  title?: string;
  url?: string;
  text: string;
}

export function createPageContextPrompt(pageContext: PageContextPromptInput): string {
  const parts = [
    pageContext.title?.trim() ? `Page title: ${pageContext.title.trim()}` : "",
    pageContext.url?.trim() ? `Current URL: ${pageContext.url.trim()}` : "",
    pageContext.text.trim() ? `Page content:\n${pageContext.text.trim()}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}
