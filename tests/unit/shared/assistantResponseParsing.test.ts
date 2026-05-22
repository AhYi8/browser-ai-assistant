import { describe, expect, it } from "vitest";
import { parseAssistantResponse } from "../../../src/shared/chat/parseAssistantResponse";

describe("AI 回复解析", () => {
  it("提取 think 标签内容并从最终回答中剥离", () => {
    expect(parseAssistantResponse("<think>先分析页面</think>\n最终回答")).toEqual({
      content: "最终回答",
      thinking: "先分析页面",
    });
  });

  it("支持多行 think 内容", () => {
    expect(parseAssistantResponse("<think>第一步\n第二步</think>\n\n回答正文")).toEqual({
      content: "回答正文",
      thinking: "第一步\n第二步",
    });
  });

  it("没有 think 标签时只返回正文", () => {
    expect(parseAssistantResponse("普通回答")).toEqual({
      content: "普通回答",
      thinking: undefined,
    });
  });

  it("正文中间出现 think 标签时按普通正文保留", () => {
    expect(parseAssistantResponse("这里是 <think>示例</think> 标签说明")).toEqual({
      content: "这里是 <think>示例</think> 标签说明",
      thinking: undefined,
    });
  });

  it("只有 think 标签时使用原始内容兜底，避免保存空回答", () => {
    expect(parseAssistantResponse("<think>只有思考</think>")).toEqual({
      content: "<think>只有思考</think>",
      thinking: "只有思考",
    });
  });

  it("开头有空白再跟 think 标签时仍然解析", () => {
    expect(parseAssistantResponse("\n  <think>先思考</think>\n回答")).toEqual({
      content: "回答",
      thinking: "先思考",
    });
  });
});
