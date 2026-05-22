import type { ChatMessage, ModelConfig } from "../types";
import { createEndpointUrl } from "./modelCatalog";
import type { ModelRequestPayload } from "./types";

export function createOpenAIChatPayload(
  model: ModelConfig,
  messages: ChatMessage[],
  stream: boolean,
): ModelRequestPayload {
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    stream,
  };

  if (typeof model.topK === "number") {
    body.top_k = model.topK;
  }

  return {
    url: createEndpointUrl(model.endpointUrl, "openai_chat"),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`,
    },
    body,
  };
}
