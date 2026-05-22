import { createAnthropicMessagesPayload } from "./anthropicMessagesAdapter";
import { createOpenAIChatPayload } from "./openaiChatAdapter";
import type { ModelValidationResult } from "./types";
import type { ChatMessage, ModelConfig } from "../types";

type Fetcher = typeof fetch;

export async function validateModelConfig(model: ModelConfig, fetcher: Fetcher = fetch): Promise<ModelValidationResult> {
  const validationMessage = createValidationMessage(model);
  const payload =
    model.endpointType === "anthropic_messages"
      ? createAnthropicMessagesPayload(model, [validationMessage], false)
      : createOpenAIChatPayload(model, [validationMessage], false);

  try {
    const response = await fetcher(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `API Key 校验失败：${response.status} ${response.statusText}`,
      };
    }

    return {
      ok: true,
      message: "API Key 校验通过",
    };
  } catch (error) {
    return {
      ok: false,
      message: `API Key 校验失败：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}

function createValidationMessage(model: ModelConfig): ChatMessage {
  return {
    id: "validation-message",
    role: "user",
    content: "请回复 OK",
    createdAt: Date.now(),
    modelId: model.id,
    endpointType: model.endpointType,
    contextMode: "text",
    streamMode: false,
    systemPrompt: model.systemPrompt,
    contextPrompt: "",
  };
}
