import type { ChatImageAttachment, ModelConfig } from "../types";
import { createEndpointUrl } from "./modelCatalog";
import type { ModelRequestMessage, ModelRequestPayload, ModelToolCall, ModelToolChoice, ModelToolOptions, OpenAIStructuredOutputFormat } from "./types";

type OpenAIMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export function createOpenAIChatPayload(
  model: ModelConfig,
  messages: ModelRequestMessage[],
  stream: boolean,
  structuredOutput?: OpenAIStructuredOutputFormat,
  toolOptions: ModelToolOptions = {},
): ModelRequestPayload {
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages: messages.map(createOpenAIMessage),
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    stream,
  };

  if (typeof model.topK === "number") {
    body.top_k = model.topK;
  }

  if (structuredOutput?.type === "json_schema") {
    body.response_format = structuredOutput;
  }

  if (structuredOutput?.type === "tool") {
    body.tools = [
      {
        type: "function",
        function: structuredOutput.tool,
      },
    ];
    body.tool_choice = {
      type: "function",
      function: {
        name: structuredOutput.tool.name,
      },
    };
  }

  if (!structuredOutput && toolOptions.tools?.length) {
    body.tools = toolOptions.tools.map((tool) => ({
      type: "function",
      function: tool,
    }));
    if (toolOptions.toolChoice) {
      body.tool_choice = createOpenAIToolChoice(toolOptions.toolChoice);
    }
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

function createOpenAIMessage(message: ModelRequestMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  const base: Record<string, unknown> = {
    role: message.role,
    content: createOpenAIMessageContent(message.content, "attachments" in message ? message.attachments : undefined),
  };

  if (message.role === "assistant" && "toolCalls" in message && message.toolCalls.length > 0) {
    base.tool_calls = message.toolCalls.map(createOpenAIToolCall);
  }

  return base;
}

function createOpenAIToolCall(toolCall: ModelToolCall): Record<string, unknown> {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function createOpenAIToolChoice(toolChoice: ModelToolChoice): unknown {
  if (toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: toolChoice.name,
    },
  };
}

function createOpenAIMessageContent(content: string, attachments?: ChatImageAttachment[]): OpenAIMessageContent {
  if (!attachments?.length) {
    return content;
  }

  return [
    { type: "text", text: content },
    ...attachments.map((attachment) => ({
      type: "image_url" as const,
      image_url: {
        url: attachment.dataUrl,
      },
    })),
  ];
}
