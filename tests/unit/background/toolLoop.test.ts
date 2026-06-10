import { describe, expect, it, vi } from "vitest";
import { runModelToolLoop } from "../../../src/background/toolCalling/toolLoop";
import type { ModelRequestMessage, ModelToolExecutor, ModelToolRegistryEntry } from "../../../src/shared/models/types";

const baseMessages: ModelRequestMessage[] = [
  {
    id: "user-1",
    role: "user",
    content: "读取页面",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
  },
];

const tool: ModelToolRegistryEntry = {
  id: "page.read_context",
  name: "read_page_context",
  description: "读取当前页面上下文",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string" },
    },
    required: ["mode"],
    additionalProperties: false,
  },
};

describe("通用模型工具循环", () => {
  it("没有工具调用时直接返回最终文本", async () => {
    const requestModel = vi.fn().mockResolvedValue({
      ok: true,
      content: "最终回答",
    });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: ["page.read_context"],
      requestModel,
      executeTool,
    });

    expect(result).toEqual({ ok: true, content: "最终回答", thinking: undefined });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("工具调用后执行已启用工具并回灌结果继续请求", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [{ id: "call-1", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "页面标题是示例",
      });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面标题：示例",
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: ["page.read_context"],
      requestModel,
      executeTool,
    });

    expect(result).toEqual({ ok: true, content: "页面标题是示例", thinking: undefined });
    expect(executeTool).toHaveBeenCalledWith({ id: "call-1", name: "read_page_context", arguments: { mode: "text" } }, tool);
    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", toolCalls: expect.any(Array) }),
        expect.objectContaining({ role: "tool", toolCallId: "call-1", content: "页面标题：示例" }),
      ]),
    );
  });

  it("工具未启用时不执行并把中文错误回灌给模型", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [{ id: "call-1", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "我无法读取页面",
      });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [],
      requestModel,
      executeTool,
    });

    expect(result).toEqual({ ok: true, content: "我无法读取页面", thinking: undefined });
    expect(executeTool).not.toHaveBeenCalled();
    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-1",
          content: "工具 read_page_context 未启用，已拒绝执行。",
          isError: true,
        }),
      ]),
    );
  });

  it("工具未注册时不执行并把中文错误回灌给模型", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [{ id: "call-1", name: "unknown_tool", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "没有可用工具。",
      });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: ["page.read_context"],
      requestModel,
      executeTool,
    });

    expect(result).toEqual({ ok: true, content: "没有可用工具。", thinking: undefined });
    expect(executeTool).not.toHaveBeenCalled();
    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-1",
          content: "工具 unknown_tool 未注册，已拒绝执行。",
          isError: true,
        }),
      ]),
    );
  });

  it("工具参数非法时不执行并回灌错误", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [{ id: "call-1", name: "read_page_context", arguments: [], parseError: "工具参数必须是对象" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "参数错误",
      });
    const executeTool = vi.fn<ModelToolExecutor>();

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: ["page.read_context"],
      requestModel,
      executeTool,
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: "工具 read_page_context 参数无效：工具参数必须是对象",
          isError: true,
        }),
      ]),
    );
  });

  it("超过最大循环次数时返回中文失败", async () => {
    const requestModel = vi.fn().mockResolvedValue({
      ok: true,
      content: "",
      toolCalls: [{ id: "call-1", name: "read_page_context", arguments: { mode: "text" } }],
    });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面标题：示例",
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: ["page.read_context"],
      requestModel,
      executeTool,
      maxIterations: 1,
    });

    expect(result).toEqual({ ok: false, message: "工具调用超过最大轮次，已停止本次请求。" });
  });
});
