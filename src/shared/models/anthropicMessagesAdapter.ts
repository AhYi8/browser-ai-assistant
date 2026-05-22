import type { ChatMessage, ModelConfig } from "../types";
import { createEndpointUrl } from "./modelCatalog";
import type { ModelRequestPayload } from "./types";

export function createAnthropicMessagesPayload(
  model: ModelConfig,
  messages: ChatMessage[],
  stream: boolean,
): ModelRequestPayload {
  const system = messages.find((message) => message.role === "system")?.content || model.systemPrompt;

  const body: Record<string, unknown> = {
    model: model.modelId,
    system,
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
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
    url: createEndpointUrl(model.endpointUrl, "anthropic_messages"),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body,
  };
}
