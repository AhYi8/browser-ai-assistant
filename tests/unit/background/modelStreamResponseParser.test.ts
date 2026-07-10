import { describe, expect, it, vi } from "vitest";
import { MODEL_CONTENT_FILTERED_MESSAGE, MODEL_OUTPUT_TRUNCATED_MESSAGE } from "../../../src/background/modelResponseStopReason";
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

  it("OpenAI-compatible SSE 会抽取最终 usage chunk 作为会话 Token 用量", async () => {
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":30}}}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel(),
      {},
      "tool_final",
    );

    expect(result).toEqual({
      ok: true,
      content: "回答",
      thinking: undefined,
      tokenUsageEntries: [
        expect.objectContaining({
          source: "tool_final",
          modelId: "model-1",
          endpointType: "openai_chat",
          inputTokens: 90,
          outputTokens: 20,
          cacheWriteTokens: 0,
          cacheReadTokens: 30,
        }),
      ],
    });
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

  it("OpenAI-compatible SSE 流式增量不会把 DSML 工具块透传到 UI", async () => {
    const onContentChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"content":"分析已经非常清晰了。让我再确认 serializeObject：\\n< | | DSML | | tool_calls>\\n"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"< | | DSML | | invoke name=\\"evaluate_script\\">\\n< | | DSML | | parameter name=\\"function\\" string=\\"true\\">() => {\\n"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"var testForm = $(\\"<form><input name=\\\\\\"user\\\\\\" value=\\\\\\"test\\\\\\"><input type=\\\\\\"password\\\\\\" name=\\\\\\"pass\\\\\\" value=\\\\\\"123456\\\\\\"></form>\\");\\n"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"return JSON.stringify(testForm.serializeObject());\\n}</ | | DSML | | parameter>\\n</ | | DSML | | invoke>\\n</ | | DSML | | tool_calls>\\n后续结论。"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel(),
      { onContentChunk },
    );

    expect(result).toEqual({
      ok: true,
      content: "分析已经非常清晰了。让我再确认 serializeObject：\n后续结论。",
      thinking: undefined,
    });
    expect(onContentChunk.mock.calls.map((call) => call[0]).join("")).toBe("分析已经非常清晰了。让我再确认 serializeObject：\n后续结论。");
    expect(onContentChunk.mock.calls.map((call) => call[0]).join("")).not.toContain("DSML");
    expect(onContentChunk.mock.calls.map((call) => call[0]).join("")).not.toContain("evaluate_script");
  });

  it("OpenAI-compatible SSE 思考增量不会把 DSML 工具块透传到 UI", async () => {
    const onThinkingChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"reasoning_content":"现在我已经有了足够的信息。\\n< | | DSML | | tool_calls>\\n"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"< | | DSML | | invoke name=\\"select_page\\">\\n< | | DSML | | parameter name=\\"index\\" string=\\" false\\">1</ | | DSML | | parameter>\\n"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"</ | | DSML | | invoke>\\n</ | | DSML | | tool_calls>\\n回到登录页给出结论。"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"最终结论。"}}]}\n\n',
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
      content: "最终结论。",
      thinking: "现在我已经有了足够的信息。\n回到登录页给出结论。",
      reasoningContent: "现在我已经有了足够的信息。\n回到登录页给出结论。",
    });
    const visibleThinking = onThinkingChunk.mock.calls.map((call) => call[0]).join("");
    expect(visibleThinking).toBe("现在我已经有了足够的信息。\n回到登录页给出结论。");
    expect(visibleThinking).not.toContain("DSML");
    expect(visibleThinking).not.toContain("select_page");
  });

  it("OpenAI-compatible SSE 思考增量会拦截跨 chunk 的全角 DSML 命名空间工具块", async () => {
    const onThinkingChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"reasoning_content":"前置思考\\n<｜｜"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"DSML｜｜tool_calls>\\n<｜｜DSML｜｜invoke name=\\"select_page\\">1"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"</｜｜DSML｜｜invoke>\\n</｜｜DSML｜｜tool_calls>\\n后续思考"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"最终结论。"}}]}\n\n',
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
      content: "最终结论。",
      thinking: "前置思考\n后续思考",
      reasoningContent: "前置思考\n后续思考",
    });
    const visibleThinking = onThinkingChunk.mock.calls.map((call) => call[0]).join("");
    expect(visibleThinking).toBe("前置思考\n后续思考");
    expect(visibleThinking).not.toContain("DSML");
    expect(visibleThinking).not.toContain("select_page");
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

  it("Anthropic SSE 会合并 message_start 和 message_delta 中的 Token 用量", async () => {
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_creation_input_tokens":4,"cache_read_input_tokens":5}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回答"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      ),
      createModel({ endpointType: "anthropic_messages" }),
    );

    expect(result).toEqual({
      ok: true,
      content: "回答",
      thinking: undefined,
      tokenUsageEntries: [
        expect.objectContaining({
          source: "chat",
          modelId: "model-1",
          endpointType: "anthropic_messages",
          inputTokens: 12,
          outputTokens: 7,
          cacheWriteTokens: 4,
          cacheReadTokens: 5,
        }),
      ],
    });
  });

  it("OpenAI-compatible SSE 收到 length 结束原因时不会把半截回答当作成功", async () => {
    const onContentChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"content":"半截回答"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel(),
      { onContentChunk },
    );

    expect(result).toEqual({ ok: false, message: MODEL_OUTPUT_TRUNCATED_MESSAGE });
    expect(onContentChunk).toHaveBeenCalledWith("半截回答");
  });

  it("OpenAI-compatible SSE 截断失败前会先输出过滤器缓冲的安全尾段", async () => {
    const onContentChunk = vi.fn();
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"content":"partial<"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel(),
      { onContentChunk },
    );

    expect(result).toEqual({ ok: false, message: MODEL_OUTPUT_TRUNCATED_MESSAGE });
    expect(onContentChunk.mock.calls.map((call) => call[0]).join("")).toBe("partial<");
  });

  it("OpenAI-compatible SSE 收到 content_filter 结束原因时返回固定中文提示", async () => {
    await expect(
      readModelStreamResponse(
        new Response(
          createStream([
            'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
        createModel(),
      ),
    ).resolves.toEqual({ ok: false, message: MODEL_CONTENT_FILTERED_MESSAGE });
  });

  it("Anthropic SSE 收到 max_tokens 结束原因时不会把半截回答当作成功", async () => {
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"半截回答"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      ),
      createModel({ endpointType: "anthropic_messages" }),
    );

    expect(result).toEqual({ ok: false, message: MODEL_OUTPUT_TRUNCATED_MESSAGE });
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
