import type { ChatImageAttachment, ModelConfig } from "../types";
import { createEndpointUrl } from "./modelCatalog";
import type { ModelRequestMessage, ModelRequestPayload, ModelToolCall, ModelToolChoice, ModelToolOptions } from "./types";

type AnthropicMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
    >;

export function createAnthropicMessagesPayload(
  model: ModelConfig,
  messages: ModelRequestMessage[],
  stream: boolean,
  toolOptions: ModelToolOptions = {},
): ModelRequestPayload {
  const system = messages.find((message) => message.role === "system")?.content || model.systemPrompt;

  const body: Record<string, unknown> = {
    model: model.modelId,
    system,
    messages: messages
      .filter((message) => message.role !== "system")
      .map(createAnthropicMessage),
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    stream,
  };

  if (typeof model.topK === "number") {
    body.top_k = model.topK;
  }

  if (toolOptions.tools?.length) {
    body.tools = toolOptions.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      input_schema: tool.parameters,
    }));
    if (toolOptions.toolChoice) {
      body.tool_choice = createAnthropicToolChoice(toolOptions.toolChoice);
    }
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

function createAnthropicMessage(message: ModelRequestMessage): { role: "user" | "assistant"; content: AnthropicMessageContent } {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        },
      ],
    };
  }

  if (message.role === "assistant" && "toolCalls" in message && message.toolCalls.length > 0) {
    const contentBlocks: Exclude<AnthropicMessageContent, string> = [];
    if (message.content.trim()) {
      contentBlocks.push({ type: "text", text: message.content });
    }
    contentBlocks.push(...message.toolCalls.map(createAnthropicToolUseBlock));
    return {
      role: "assistant",
      content: contentBlocks,
    };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: createAnthropicMessageContent(message.content, "attachments" in message ? message.attachments : undefined),
  };
}

function createAnthropicToolUseBlock(toolCall: ModelToolCall): { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } {
  return {
    type: "tool_use",
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.arguments,
  };
}

function createAnthropicToolChoice(toolChoice: ModelToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "none") {
    return { type: toolChoice };
  }

  return {
    type: "tool",
    name: toolChoice.name,
  };
}

function createAnthropicMessageContent(content: string, attachments?: ChatImageAttachment[]): AnthropicMessageContent {
  if (!attachments?.length) {
    return content;
  }

  return [
    { type: "text", text: content },
    ...attachments.map((attachment) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: attachment.mediaType,
        data: extractBase64Data(attachment.dataUrl),
      },
    })),
  ];
}

function extractBase64Data(dataUrl: string): string {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片附件 dataUrl 格式无效");
  }

  const [, data] = match;
  return data;
}
