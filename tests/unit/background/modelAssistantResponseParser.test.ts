import { describe, expect, it } from "vitest";
import { extractAssistantResponseData } from "../../../src/background/modelAssistantResponseParser";
import type { OpenAIStructuredOutputFormat } from "../../../src/shared/models/types";

describe("模型 assistant 响应抽取", () => {
  it("抽取 OpenAI 文本、reasoning_content 和工具调用", () => {
    const result = extractAssistantResponseData(
      {
        choices: [
          {
            message: {
              content: [
                "我先看页面。",
                "<｜tool_calls｜>",
                "<｜invoke name=\"take_snapshot\"｜>",
                "</｜invoke｜>",
                "</｜tool_calls｜>",
              ].join("\n"),
              reasoning_content: "需要先获得页面结构",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "current_time",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      },
      { collectToolCalls: true },
    );

    expect(result).toEqual({
      content: "我先看页面。",
      reasoningContent: "需要先获得页面结构",
      toolCalls: [
        { id: "call-1", name: "current_time", arguments: {} },
        { id: "dsml-tool-call-1", name: "take_snapshot", arguments: {} },
      ],
    });
  });

  it("结构化输出模式从 OpenAI tool_calls 中抽取第一个 arguments 字符串", () => {
    const structuredOutput: OpenAIStructuredOutputFormat = {
      type: "tool",
      tool: {
        name: "extract",
        parameters: {},
      },
    };

    const result = extractAssistantResponseData(
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "extract",
                    arguments: "{\"answer\":\"ok\"}",
                  },
                },
              ],
            },
          },
        ],
      },
      { structuredOutput, collectToolCalls: false },
    );

    expect(result).toEqual({ content: "{\"answer\":\"ok\"}" });
  });

  it("抽取 OpenAI-compatible 响应中的 Token 用量", () => {
    const result = extractAssistantResponseData({
      choices: [{ message: { content: "回答" } }],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 8,
        prompt_tokens_details: {
          cached_tokens: 10,
        },
      },
    });

    expect(result).toEqual({
      content: "回答",
      tokenUsage: {
        inputTokens: 20,
        outputTokens: 8,
        cacheWriteTokens: 0,
        cacheReadTokens: 10,
      },
    });
  });

  it("抽取 OpenAI-compatible finish_reason 供上层识别截断", () => {
    const result = extractAssistantResponseData({
      choices: [{ finish_reason: "length", message: { content: "半截回答" } }],
    });

    expect(result).toEqual({
      content: "半截回答",
      stopReason: "length",
    });
  });

  it("结构化输出模式兼容空字符串 content 与 tool_calls 同时存在", () => {
    const structuredOutput: OpenAIStructuredOutputFormat = {
      type: "tool",
      tool: {
        name: "extract",
        parameters: {},
      },
    };

    const result = extractAssistantResponseData(
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "extract",
                    arguments: "{\"answer\":\"ok\"}",
                  },
                },
              ],
            },
          },
        ],
      },
      { structuredOutput, collectToolCalls: false },
    );

    expect(result).toEqual({ content: "{\"answer\":\"ok\"}" });
  });

  it("OpenAI 无内容时回退抽取 Anthropic 文本和工具调用", () => {
    const result = extractAssistantResponseData(
      {
        content: [
          { type: "text", text: "需要点击按钮。" },
          { type: "tool_use", id: "tool-1", name: "click", input: { uid: "6_99" } },
        ],
      },
      { collectToolCalls: true },
    );

    expect(result).toEqual({
      content: "需要点击按钮。",
      toolCalls: [{ id: "tool-1", name: "click", arguments: { uid: "6_99" } }],
    });
  });

  it("抽取 Anthropic stop_reason 供上层识别输出上限截断", () => {
    const result = extractAssistantResponseData({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "半截回答" }],
    });

    expect(result).toEqual({
      content: "半截回答",
      stopReason: "max_tokens",
    });
  });

  it("带 choices 的 OpenAI-compatible 空响应不会回退到同对象里的 Anthropic content 字段", () => {
    const result = extractAssistantResponseData(
      {
        choices: [{ message: { content: "" } }],
        content: [{ type: "text", text: "不应被当作 Anthropic 正文" }],
      },
      { collectToolCalls: true },
    );

    expect(result).toEqual({ content: "" });
  });

  it("未知响应结构返回空内容", () => {
    expect(extractAssistantResponseData({ foo: "bar" }, { collectToolCalls: true })).toEqual({ content: "" });
  });
});
