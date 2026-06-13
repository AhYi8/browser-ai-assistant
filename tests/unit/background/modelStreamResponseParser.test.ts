import { describe, expect, it, vi } from "vitest";
import { readModelStreamResponse } from "../../../src/background/modelStreamResponseParser";
import type { ModelConfig } from "../../../src/shared/types";

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream({
    pull(controller) {
      const chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
        return;
      }

      controller.close();
    },
  });
}

describe("模型流式响应解析", () => {
  it("OpenAI-compatible SSE 会逐段回调正文并解析 think 块", async () => {
    const onContentChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"content":"<think>先"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"分析</think>答"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"案"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel(),
      { onContentChunk },
    );

    expect(result).toEqual({ ok: true, content: "答案", thinking: "先分析" });
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "<think>先");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "分析</think>答");
    expect(onContentChunk).toHaveBeenNthCalledWith(3, "案");
  });

  it("OpenAI-compatible SSE 会逐段回调 reasoning_content 并按模型决定是否保留协议原文", async () => {
    const onThinkingChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"reasoning_content":"先分析"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel({
        modelId: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        endpointUrl: "https://api.deepseek.com/v1/chat/completions",
      }),
      { onThinkingChunk },
    );

    expect(result).toEqual({
      ok: true,
      content: "回答",
      thinking: "先分析",
      reasoningContent: "先分析",
    });
    expect(onThinkingChunk).toHaveBeenCalledWith("先分析");
  });

  it("Anthropic SSE 只拼接 text_delta 并忽略畸形 JSON 片段", async () => {
    const onContentChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          "data: {bad}\n\n",
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第一段"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第二段"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      ),
      createModel({ endpointType: "anthropic_messages" }),
      { onContentChunk },
    );

    expect(result).toEqual({ ok: true, content: "第一段第二段", thinking: undefined });
    expect(onContentChunk).toHaveBeenNthCalledWith(1, "第一段");
    expect(onContentChunk).toHaveBeenNthCalledWith(2, "第二段");
  });

  it("缺少响应体或没有可用增量时返回中文错误", async () => {
    await expect(readModelStreamResponse(new Response(null), createModel())).resolves.toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });

    await expect(readModelStreamResponse(new Response(createStream(["data: {bad}\n\n"])), createModel())).resolves.toEqual({
      ok: false,
      message: "模型响应中没有可用内容",
    });
  });

  it("OpenAI-compatible SSE 已有正文但未收到完成信号时返回中断错误", async () => {
    await expect(
      readModelStreamResponse(
        new Response(createStream(['data: {"choices":[{"delta":{"content":"半截回答"}}]}\n\n'])),
        createModel(),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "流式响应异常中断，请重新生成后重试",
    });
  });

  it("Anthropic SSE 已有正文但未收到 message_stop 时返回中断错误", async () => {
    await expect(
      readModelStreamResponse(
        new Response(
          createStream(['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"半截回答"}}\n\n']),
        ),
        createModel({ endpointType: "anthropic_messages" }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "流式响应异常中断，请重新生成后重试",
    });
  });
});
