import { describe, expect, it } from "vitest";
import {
  extractDsmlToolCallsFromContent,
  extractOpenAIToolCalls,
  parseToolArguments,
} from "../../../src/background/modelResponseToolParser";

describe("模型响应工具调用解析", () => {
  it("解析标准 OpenAI tool_calls 并保留合法参数", () => {
    const result = extractOpenAIToolCalls({
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "take_snapshot",
            arguments: "{}",
          },
        },
        {
          type: "function",
          function: {
            name: "click",
            arguments: '{"uid":"6_99","includeSnapshot":true}',
          },
        },
      ],
    });

    expect(result).toEqual([
      { id: "call-1", name: "take_snapshot", arguments: {} },
      { id: "tool-call-2", name: "click", arguments: { uid: "6_99", includeSnapshot: true } },
    ]);
  });

  it("解析 DSML 工具块并从正文移除协议文本", () => {
    const result = extractDsmlToolCallsFromContent(
      [
        "我先读取页面。",
        "<｜tool_calls｜>",
        "<｜invoke name=\"take_snapshot\"｜>",
        "</｜invoke｜>",
        "<｜invoke name=\"click\"｜>",
        "{\"uid\":\"6_99\"}",
        "</｜invoke｜>",
        "</｜tool_calls｜>",
        "稍后继续。",
      ].join("\n"),
    );

    expect(result.content).toBe("我先读取页面。\n\n稍后继续。");
    expect(result.toolCalls).toEqual([
      { id: "dsml-tool-call-1", name: "take_snapshot", arguments: {} },
      { id: "dsml-tool-call-2", name: "click", arguments: { uid: "6_99" } },
    ]);
  });

  it("DSML 非法 JSON 参数会产生 parseError", () => {
    const result = extractDsmlToolCallsFromContent(
      [
        "<|tool_calls|>",
        "<|invoke name=\"take_snapshot\"|>",
        "不是 JSON",
        "</|invoke|>",
        "</|tool_calls|>",
      ].join("\n"),
    );

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "dsml-tool-call-1",
        name: "take_snapshot",
        arguments: {},
        parseError: "工具参数不是合法 JSON",
      },
    ]);
  });

  it("疑似 DSML 工具调用残片会转成格式错误工具调用并移除协议残片", () => {
    const result = extractDsmlToolCallsFromContent(
      [
        "我需要重新读取页面。",
        "<｜tool_calls｜>",
        "<｜invoke name=\"take_snapshot\"｜>",
      ].join("\n"),
    );

    expect(result.content).toBe("我需要重新读取页面。");
    expect(result.toolCalls).toEqual([
      {
        id: "dsml-tool-call-1",
        name: "take_snapshot",
        arguments: {},
        parseError: "工具调用格式不完整",
      },
    ]);
  });

  it("完整 DSML 块后出现残缺工具调用时会保留完整调用并把残缺调用作为错误回灌", () => {
    const result = extractDsmlToolCallsFromContent(
      [
        "先读取页面。",
        "<｜tool_calls｜>",
        "<｜invoke name=\"take_snapshot\"｜>",
        "</｜invoke｜>",
        "</｜tool_calls｜>",
        "再点击按钮。",
        "<｜tool_calls｜>",
        "<｜invoke name=\"click\"｜>",
      ].join("\n"),
    );

    expect(result.content).toBe("先读取页面。\n\n再点击按钮。");
    expect(result.toolCalls).toEqual([
      { id: "dsml-tool-call-1", name: "take_snapshot", arguments: {} },
      {
        id: "dsml-tool-call-2",
        name: "click",
        arguments: {},
        parseError: "工具调用格式不完整",
      },
    ]);
  });

  it("闭合 DSML 块内的残缺 invoke 会作为错误工具调用回灌", () => {
    const result = extractDsmlToolCallsFromContent(
      [
        "准备操作页面。",
        "<｜tool_calls｜>",
        "<｜invoke name=\"take_snapshot\"｜>",
        "</｜invoke｜>",
        "<｜invoke name=\"click\"｜>",
        "</｜tool_calls｜>",
      ].join("\n"),
    );

    expect(result.content).toBe("准备操作页面。");
    expect(result.toolCalls).toEqual([
      { id: "dsml-tool-call-1", name: "take_snapshot", arguments: {} },
      {
        id: "dsml-tool-call-2",
        name: "click",
        arguments: {},
        parseError: "工具调用格式不完整",
      },
    ]);
  });

  it("普通正文不包含 DSML 工具调用时不误解析", () => {
    const result = extractDsmlToolCallsFromContent("正文中只是提到 invoke name 这样的普通文字。");

    expect(result).toEqual({
      content: "正文中只是提到 invoke name 这样的普通文字。",
      toolCalls: [],
    });
  });

  it("工具参数解析只接受 JSON 对象", () => {
    expect(parseToolArguments("")).toEqual({ arguments: {} });
    expect(parseToolArguments("{\"uid\":\"6_99\"}")).toEqual({ arguments: { uid: "6_99" } });
    expect(parseToolArguments("[1]")).toEqual({ arguments: {}, parseError: "工具参数必须是对象" });
    expect(parseToolArguments("bad")).toEqual({ arguments: {}, parseError: "工具参数不是合法 JSON" });
  });
});
