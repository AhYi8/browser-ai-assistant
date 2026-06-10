import { createAnthropicMessagesPayload } from "./anthropicMessagesAdapter";
import { createOpenAIChatPayload } from "./openaiChatAdapter";
import type { ModelRequestMessage, ModelToolOptions, OpenAIStructuredOutputFormat } from "./types";
import type { ModelConfig } from "../types";

export function createModelRequestPayload(
  model: ModelConfig,
  messages: ModelRequestMessage[],
  stream: boolean,
  structuredOutput?: OpenAIStructuredOutputFormat,
  toolOptions: ModelToolOptions = {},
) {
  if (model.endpointType === "anthropic_messages") {
    return createAnthropicMessagesPayload(model, messages, stream, toolOptions);
  }

  return createOpenAIChatPayload(model, messages, stream, structuredOutput, toolOptions);
}
