import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import type { ChatMessage, ModelConfig } from "../shared/types";

export interface ChatSendMessage {
  type: "chat.send";
  model: ModelConfig;
  messages: ChatMessage[];
  stream: boolean;
}

export type ChatSendResponse =
  | {
      ok: true;
      content: string;
      thinking?: string;
    }
  | {
      ok: false;
      message: string;
    };

type Fetcher = typeof fetch;

export async function handleChatSendMessage(
  message: ChatSendMessage,
  fetcher: Fetcher = fetch,
): Promise<ChatSendResponse> {
  if (message.stream) {
    return { ok: false, message: "当前版本暂不支持真实流式响应，请关闭流式响应后重试" };
  }

  try {
    const payload = createModelRequestPayload(message.model, message.messages, message.stream);
    const response = await fetcher(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `模型请求失败：${response.status} ${response.statusText}`.trim(),
      };
    }

    const data = await response.json();
    const rawContent = extractAssistantContent(data);
    if (!rawContent) {
      return { ok: false, message: "模型响应中没有可用内容" };
    }

    return {
      ok: true,
      ...parseAssistantResponse(rawContent),
    };
  } catch {
    return {
      ok: false,
      message: "模型请求失败，请稍后重试",
    };
  }
}

function extractAssistantContent(data: unknown): string {
  if (isOpenAIResponse(data)) {
    return data.choices[0].message.content;
  }

  if (isAnthropicResponse(data)) {
    return data.content
      .filter((item): item is { type: "text"; text: string } =>
        Boolean(
          item &&
            typeof item === "object" &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string",
        ),
      )
      .map((item) => item.text)
      .join("");
  }

  return "";
}

function isOpenAIResponse(data: unknown): data is { choices: Array<{ message: { content: string } }> } {
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return false;
  }

  const firstChoice = data.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    return false;
  }

  const { message } = firstChoice;
  return Boolean(message && typeof message === "object" && "content" in message && typeof message.content === "string");
}

function isAnthropicResponse(data: unknown): data is { content: unknown[] } {
  return Boolean(data && typeof data === "object" && "content" in data && Array.isArray(data.content));
}
