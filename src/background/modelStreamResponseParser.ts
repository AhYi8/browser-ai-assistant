import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createTokenUsageEntry, maxTokenUsage, normalizeModelTokenUsage } from "../shared/chat/tokenUsage";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import type { ChatTokenUsage, ChatTokenUsageSource, ModelConfig } from "../shared/types";
import type { ChatSendResponse } from "./modelRequestHandler";
import { getModelStopReasonFailureMessage } from "./modelResponseStopReason";

const STREAM_INTERRUPTED_MESSAGE = "流式响应异常中断，请重新生成后重试";

export interface ModelStreamCallbacks {
  onContentChunk?: (content: string) => void;
  onThinkingChunk?: (content: string) => void;
}

export async function readModelStreamResponse(
  response: Response,
  model: ModelConfig,
  callbacks: ModelStreamCallbacks = {},
  tokenUsageSource: ChatTokenUsageSource = "chat",
): Promise<ChatSendResponse> {
  if (!response.body) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let visibleContent = "";
  let rawThinking = "";
  let visibleThinking = "";
  let sawDone = false;
  let stopReason: string | undefined;
  let tokenUsage: ChatTokenUsage | undefined;
  const contentChunkFilter = new DsmlStreamChunkFilter();
  const thinkingChunkFilter = new DsmlStreamChunkFilter();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer, model.endpointType);
    buffer = parsed.remaining;
    tokenUsage = maxTokenUsage(tokenUsage, parsed.tokenUsage);
    stopReason = parsed.stopReason ?? stopReason;
    for (const chunk of parsed.contentChunks) {
      rawContent += chunk;
      const visibleChunk = contentChunkFilter.push(chunk);
      if (visibleChunk) {
        visibleContent += visibleChunk;
        callbacks.onContentChunk?.(visibleChunk);
      }
    }
    for (const chunk of parsed.thinkingChunks) {
      rawThinking += chunk;
      const visibleChunk = thinkingChunkFilter.push(chunk);
      if (visibleChunk) {
        visibleThinking += visibleChunk;
        callbacks.onThinkingChunk?.(visibleChunk);
      }
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
  tokenUsage = maxTokenUsage(tokenUsage, tail.tokenUsage);
  stopReason = tail.stopReason ?? stopReason;
  for (const chunk of tail.contentChunks) {
    rawContent += chunk;
    const visibleChunk = contentChunkFilter.push(chunk);
    if (visibleChunk) {
      visibleContent += visibleChunk;
      callbacks.onContentChunk?.(visibleChunk);
    }
  }
  for (const chunk of tail.thinkingChunks) {
    rawThinking += chunk;
    const visibleChunk = thinkingChunkFilter.push(chunk);
    if (visibleChunk) {
      visibleThinking += visibleChunk;
      callbacks.onThinkingChunk?.(visibleChunk);
    }
  }

  const flushVisibleChunks = () => {
    const finalVisibleContentChunk = contentChunkFilter.flush();
    if (finalVisibleContentChunk) {
      visibleContent += finalVisibleContentChunk;
      callbacks.onContentChunk?.(finalVisibleContentChunk);
    }
    const finalVisibleThinkingChunk = thinkingChunkFilter.flush();
    if (finalVisibleThinkingChunk) {
      visibleThinking += finalVisibleThinkingChunk;
      callbacks.onThinkingChunk?.(finalVisibleThinkingChunk);
    }
  };

  const stopReasonFailureMessage = getModelStopReasonFailureMessage(stopReason);
  if (stopReasonFailureMessage) {
    flushVisibleChunks();
    return { ok: false, message: stopReasonFailureMessage };
  }

  if (!rawContent && !rawThinking) {
    return { ok: false, message: "模型响应中没有可用内容" };
  }

  if (!sawDone) {
    return { ok: false, message: STREAM_INTERRUPTED_MESSAGE };
  }

  flushVisibleChunks();

  const parsedContent = parseAssistantResponse(visibleContent || rawContent);
  const parsedThinking = parseAssistantResponse(visibleThinking || rawThinking);
  const tokenUsageEntry = tokenUsage
    ? createTokenUsageEntry({
        usage: tokenUsage,
        source: tokenUsageSource,
        modelId: model.id,
        endpointType: model.endpointType,
      })
    : undefined;
  return {
    ok: true,
    content: parsedContent.content,
    thinking: visibleThinking || parsedThinking.thinking || parsedContent.thinking,
    ...(tokenUsageEntry ? { tokenUsageEntries: [tokenUsageEntry] } : {}),
    ...(shouldPassDeepSeekReasoningContent(model) && (visibleThinking || rawThinking)
      ? { reasoningContent: visibleThinking || rawThinking }
      : {}),
  };
}

class DsmlStreamChunkFilter {
  // 已进入工具块抑制态时保留更长尾部，用来等待可能跨 chunk 到达的结束标记。
  private static readonly markerTailLength = 96;

  private buffer = "";
  private suppressingToolBlock = false;
  private lastOutputEndsWithNewline = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer) {
      if (this.suppressingToolBlock) {
        const endMatch = matchDsmlToolCallEnd(this.buffer);
        if (!endMatch) {
          this.buffer = this.buffer.slice(-DsmlStreamChunkFilter.markerTailLength);
          break;
        }

        this.buffer = this.buffer.slice(endMatch.index + endMatch.text.length);
        if (this.lastOutputEndsWithNewline) {
          this.buffer = this.buffer.replace(/^\r?\n/, "");
        }
        this.suppressingToolBlock = false;
        continue;
      }

      const startMatch = matchDsmlToolCallStart(this.buffer);
      if (!startMatch) {
        const safeLength = getSafeVisibleLengthBeforePotentialDsmlStart(this.buffer);
        if (safeLength === 0) {
          break;
        }
        output += this.takeVisiblePrefix(safeLength);
        continue;
      }

      output += this.takeVisiblePrefix(startMatch.index);
      this.buffer = this.buffer.slice(startMatch.index + startMatch.text.length);
      this.suppressingToolBlock = true;
    }

    return output;
  }

  flush(): string {
    if (this.suppressingToolBlock) {
      this.buffer = "";
      this.suppressingToolBlock = false;
      return "";
    }

    return this.takeVisiblePrefix(this.buffer.length);
  }

  private takeVisiblePrefix(length: number): string {
    const text = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    if (text) {
      this.lastOutputEndsWithNewline = /\r?\n$/.test(text);
    }
    return text;
  }
}

function matchDsmlToolCallStart(content: string): { index: number; text: string } | undefined {
  return findFirstPatternMatch(content, [
    /<\s*[|｜]\s*[|｜]\s*DSML\s*[|｜]\s*[|｜]\s*tool_calls\s*>/i,
    /<\s*[|｜]\s*tool_calls\s*[|｜]\s*>/i,
  ]);
}

function matchDsmlToolCallEnd(content: string): { index: number; text: string } | undefined {
  return findFirstPatternMatch(content, [
    /<\s*\/\s*[|｜]\s*[|｜]\s*DSML\s*[|｜]\s*[|｜]\s*tool_calls\s*>/i,
    /<\s*\/\s*[|｜]\s*tool_calls\s*[|｜]\s*>/i,
  ]);
}

function findFirstPatternMatch(content: string, patterns: RegExp[]): { index: number; text: string } | undefined {
  let firstMatch: { index: number; text: string } | undefined;
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (!match || match.index === undefined) {
      continue;
    }
    if (!firstMatch || match.index < firstMatch.index) {
      firstMatch = { index: match.index, text: match[0] };
    }
  }
  return firstMatch;
}

function getSafeVisibleLengthBeforePotentialDsmlStart(content: string): number {
  const scanStart = Math.max(0, content.length - DsmlStreamChunkFilterMarkerWindow);
  for (let index = content.length - 1; index >= scanStart; index -= 1) {
    if (content[index] !== "<") {
      continue;
    }
    const suffix = content.slice(index);
    if (isPotentialDsmlToolCallStartPrefix(suffix)) {
      return index;
    }
    return content.length;
  }
  return content.length;
}

// 未确认工具块开始前只扫描较短窗口，避免普通长正文因为尾部残留检查产生额外缓冲。
const DsmlStreamChunkFilterMarkerWindow = 64;

function isPotentialDsmlToolCallStartPrefix(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  const candidates = ["<|tool_calls|>", "<｜tool_calls｜>", "<||dsml||tool_calls>", "<｜｜dsml｜｜tool_calls>"];
  return candidates.some((candidate) => candidate.startsWith(compact));
}

function consumeSseBuffer(
  buffer: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; tokenUsage?: ChatTokenUsage; done: boolean; stopReason?: string; remaining: string } {
  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let tokenUsage: ChatTokenUsage | undefined;
  let done = false;
  let stopReason: string | undefined;
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
    tokenUsage = maxTokenUsage(tokenUsage, parsed.tokenUsage);
    done = done || parsed.done;
    stopReason = parsed.stopReason ?? stopReason;
  }

  return { contentChunks, thinkingChunks, tokenUsage, done, stopReason, remaining };
}

function parseSseEventBlock(
  eventBlock: string,
  endpointType: ModelConfig["endpointType"],
): { contentChunks: string[]; thinkingChunks: string[]; tokenUsage?: ChatTokenUsage; done: boolean; stopReason?: string } {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const contentChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let tokenUsage: ChatTokenUsage | undefined;
  let done = false;
  let stopReason: string | undefined;

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
      stopReason = chunk.stopReason ?? extractAnthropicStreamStopReason(data) ?? stopReason;
      tokenUsage = maxTokenUsage(tokenUsage, normalizeModelTokenUsage(data));

      done = done || isAnthropicStreamStop(data);
    } catch {
      // 第三方 SSE 偶发心跳或非 JSON 片段时忽略，避免单个畸形片段中断整次回复。
    }
  }

  return { contentChunks, thinkingChunks, tokenUsage, done, stopReason };
}

function extractOpenAIStreamChunk(data: unknown): { content: string; thinking: string; stopReason?: string } {
  if (!data || typeof data !== "object" || !("choices" in data) || !Array.isArray(data.choices)) {
    return { content: "", thinking: "" };
  }

  const firstChoice = data.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return { content: "", thinking: "" };
  }
  const stopReason = "finish_reason" in firstChoice && typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : undefined;
  if (!("delta" in firstChoice)) {
    return { content: "", thinking: "", ...(stopReason ? { stopReason } : {}) };
  }

  const { delta } = firstChoice;
  if (!delta || typeof delta !== "object") {
    return { content: "", thinking: "", ...(stopReason ? { stopReason } : {}) };
  }

  return {
    content: "content" in delta && typeof delta.content === "string" ? delta.content : "",
    thinking: "reasoning_content" in delta && typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    ...(stopReason ? { stopReason } : {}),
  };
}

function extractAnthropicStreamText(data: unknown): { content: string; thinking: string; stopReason?: string } {
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

function extractAnthropicStreamStopReason(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  if ("delta" in data && data.delta && typeof data.delta === "object" && "stop_reason" in data.delta && typeof data.delta.stop_reason === "string") {
    return data.delta.stop_reason;
  }
  if ("stop_reason" in data && typeof data.stop_reason === "string") {
    return data.stop_reason;
  }
  return undefined;
}
