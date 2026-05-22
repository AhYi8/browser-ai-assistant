import type { ChatMessage, ModelConfig } from "../types";

const TITLE_MAX_LENGTH = 60;

export interface GenerateSessionTitleInput {
  fallbackTitle: string;
  messages: ChatMessage[];
  titleModel?: ModelConfig;
  requestTitle: (model: ModelConfig, messages: ChatMessage[]) => Promise<string>;
}

export interface CreateTitleGenerationMessagesInput {
  userContent: string;
  pageContext: string;
  assistantContent?: string;
}

export async function generateSessionTitle(input: GenerateSessionTitleInput): Promise<string> {
  if (!input.titleModel) {
    return input.fallbackTitle;
  }

  try {
    const generatedTitle = parseGeneratedTitle(await input.requestTitle(input.titleModel, input.messages));
    return generatedTitle || input.fallbackTitle;
  } catch {
    return input.fallbackTitle;
  }
}

export function createTitleGenerationMessages(input: CreateTitleGenerationMessagesInput): ChatMessage[] {
  const now = Date.now();

  return [
    {
      id: `title-message-${now}-system`,
      role: "system",
      content: [
        "你是对话标题生成器。",
        "请根据用户消息和助手回复生成一个简短、准确、适合作为历史会话列表展示的中文标题。",
        '只返回一个 JSON 对象，格式必须是 {"title":"标题"}。',
        "不要返回 Markdown、代码块、解释、前后缀或任何额外文本。",
        `标题不超过 ${TITLE_MAX_LENGTH} 个字符。`,
      ].join("\n"),
      createdAt: now,
      modelId: "",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
    },
    {
      id: `title-message-${now}-user`,
      role: "user",
      content: [`网页上下文：${input.pageContext || "无"}`, `用户消息：${input.userContent}`, `助手回复：${input.assistantContent ?? ""}`].join("\n\n"),
      createdAt: now,
      modelId: "",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
    },
  ];
}

export function parseGeneratedTitle(rawContent: string): string | undefined {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object" || !("title" in parsed) || typeof parsed.title !== "string") {
      return undefined;
    }

    const title = parsed.title.trim();
    return title ? title.slice(0, TITLE_MAX_LENGTH) : undefined;
  } catch {
    // 标题模型必须严格返回 JSON；解析失败时保留默认标题，避免脏回复污染历史列表。
    return undefined;
  }
}
