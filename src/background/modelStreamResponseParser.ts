import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import type { ModelConfig } from "../shared/types";
import type { ChatSendResponse } from "./modelRequestHandler";

const STREAM_INTERRUPTED_MESSAGE = "流式响应异常中断，请重新生成后重试";

export interface ModelStreamCallbacks {
  onContentChunk?: (content: string) => void;
  onThinkingChunk?: (content: string) => void;
}

export async function readModelStreamResponse(
  response: Response,
  model: ModelConfig,
  callbacks: ModelStreamCallbacks = {},
): Promise<ChatSendResponse> {
  if (!response.body) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let rawThinking = "";
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer, model.endpointType);
    buffer = parsed.remaining;
    for (const chunk of parsed.contentChunks) {
      rawContent += chunk;
      callbacks.onContentChunk?.(chunk);
    }
    for (const chunk of parsed.thinkingChunks) {
      rawThinking += chunk;
      callbacks.onThinkingChunk?.(chunk);
    }

    if (parsed.done) {
      sawDone = true;
      break;
    }
  }

  buffer += decoder.decode();
  // 流结束时有些兼容渠道不会补最后的空行，这里主动补分隔符以消费尾部未闭合事件。
  const tail = consumeSseBuffer(`${buffer}\n\n`, model.endpointType);
  sawDone = sawDone || tail.done;
  for (const chunk of tail.contentChunks) {
    rawContent += chunk;
    callbacks.onContentChunk?.(chunk);
  }
  for (const chunk of tail.thinkingChunks) {
    rawThinking += chunk;
    callbacks.onThinkingChunk?.(chunk);
  }

  if (!rawContent && !rawThinking) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  if (!sawDone) {
    return { ok: false, message: STREAM_INTERRUPTED_MESSAGE };
  }

  const parsedContent = parseAssistantResponse(rawContent);
  return {
    ok: true,
    content: parsedContent.content,
    thinking: rawThinking || parsedContent.thinking,
    ...(shouldPassDeepSeekReasoningContent(model) && rawThinking ? { reasoningContent: rawThinking } : {}),
  };
}

function consumeSseBuffer(
  buffer: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; done: boolean; remaining: string } {
  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let done = false;
  let remaining = buffer;

  while (true) {
    const separatorIndex = remaining.indexOf("\n\n");
    if (separatorIndex < 0) {
      break;
    }

    const eventBlock = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const parsed = parseSseEventBlock(eventBlock, endpointType);
    contentChunks.push(...parsed.contentChunks);
    thinkingChunks.push(...parsed.thinkingChunks);
    done = done || parsed.done;
  }

  return { contentChunks, thinkingChunks, done, remaining };
}

function parseSseEventBlock(
  eventBlock: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; done: boolean } {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let done = false;

  for (const dataLine of dataLines) {
    if (!dataLine) {
      continue;
    }

    if (dataLine === "[DONE]") {
      done = true;
      continue;
    }

    try {
      const data = JSON.parse(dataLine) as unknown;
      const chunk = endpointType === "anthropic_messages" ? extractAnthropicStreamText(data) : extractOpenAIStreamChunk(data);
      if (chunk.content) {
        contentChunks.push(chunk.content);
      }
      if (chunk.thinking) {
        thinkingChunks.push(chunk.thinking);
      }

      done = done || isAnthropicStreamStop(data);
    } catch {
      // 第三方 SSE 偶发心跳或非 JSON 片段时忽略，避免单个畸形片段中断整次回复。
    }
  }

  return { contentChunks, thinkingChunks, done };
}

function extractOpenAIStreamChunk(data: unknown): { content: string; thinking: string } {
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return { content: "", thinking: "" };
  }

  const firstChoice = data.choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("delta" in firstChoice)) {
    return { content: "", thinking: "" };
  }

  const { delta } = firstChoice;
  if (!delta || typeof delta !== "object") {
    return { content: "", thinking: "" };
  }

  return {
    content: "content" in delta && typeof delta.content === "string" ? delta.content : "",
    thinking: "reasoning_content" in delta && typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
  };
}

function extractAnthropicStreamText(data: unknown): { content: string; thinking: string } {
  if (!data || typeof data !== "object" || !("delta" in data)) {
    return { content: "", thinking: "" };
  }

  const { delta } = data;
  const content = delta &&
    typeof delta === "object" &&
    "type" in delta &&
    delta.type === "text_delta" &&
    "text" in delta &&
    typeof delta.text === "string"
    ? delta.text
    : "";

  return { content, thinking: "" };
}

function isAnthropicStreamStop(data: unknown): boolean {
  return Boolean(data && typeof data === "object" && "type" in data && data.type === "message_stop");
}
