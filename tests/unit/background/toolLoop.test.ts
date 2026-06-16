import { describe, expect, it, vi } from "vitest";
import { runModelToolLoop } from "../../../src/background/toolCalling/toolLoop";
import type { ModelRequestMessage, ModelToolExecutor, ModelToolRegistryEntry } from "../../../src/shared/models/types";
import type { ChatToolAttachment, ChatToolCallRecord } from "../../../src/shared/types";

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
  displayName: "读取页面上下文",
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
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答" });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    expect(result).toEqual({ ok: true, content: "最终回答", thinking: undefined });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("工具调用前的 AI 回复会作为独立工具轮消息返回，最终回答不再承载工具记录", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "我需要先读取页面。",
        thinking: "先确认页面内容。",
        toolCalls: [
          { id: "call-1", name: "read_page_context", arguments: { mode: "text" } },
          { id: "call-2", name: "read_page_context", arguments: { mode: "all" } },
        ],
      })
      .mockResolvedValueOnce({ ok: true, content: "最终回答" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `工具结果：${call.id}`,
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "最终回答",
      toolTurnMessages: [
        expect.objectContaining({
          role: "assistant",
          assistantMessageKind: "tool_call_turn",
          content: "我需要先读取页面。",
          thinking: "先确认页面内容。",
          toolCallRecords: [expect.objectContaining({ id: "call-1" }), expect.objectContaining({ id: "call-2" })],
        }),
      ],
    });
    expect(result).not.toHaveProperty("toolCallRecords");
    expect(result).not.toHaveProperty("toolAttachments");
  });

  it("流式回调会先发一次工具轮助手消息，再发本轮工具 start 和 complete", async () => {
    const events: Array<{ type: "tool-turn" | "start" | "complete"; id: string; recordCount?: number }> = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面。",
        toolCalls: [{ id: "call-stream", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "最终回答" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "工具结果",
    }));

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      onToolTurnMessage: (message) => events.push({ type: "tool-turn", id: message.id, recordCount: message.toolCallRecords?.length ?? 0 }),
      onToolCallStart: (record) => events.push({ type: "start", id: record.id }),
      onToolCallComplete: (record) => events.push({ type: "complete", id: record.id }),
    });

    expect(events).toEqual([
      { type: "tool-turn", id: expect.stringContaining("call-stream"), recordCount: 0 },
      { type: "start", id: "call-stream" },
      { type: "complete", id: "call-stream" },
    ]);
  });

  it("工具调用会先发 start 事件，再执行工具并发 complete 事件", async () => {
    const events: Array<{ type: "start" | "complete"; record: ChatToolCallRecord; attachments?: ChatToolAttachment[] }> = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [{ id: "call-1", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "页面标题是示例" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => {
      expect(events).toEqual([
        {
          type: "start",
          record: expect.objectContaining({
            id: "call-1",
            status: "running",
            displayName: "读取页面上下文",
          }),
        },
      ]);
      return {
        toolCallId: call.id,
        name: call.name,
        content: "页面标题：示例",
        toolAttachments: [
          {
            id: "attachment-1",
            kind: "page-context",
            title: "页面上下文",
            summary: "页面标题：示例",
            sourceToolCallId: call.id,
            createdAt: 2,
            redacted: true,
            truncated: false,
            details: "页面标题：示例",
          },
        ],
      };
    });

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      onToolCallStart: (record) => events.push({ type: "start", record }),
      onToolCallComplete: (record, attachments) => events.push({ type: "complete", record, attachments }),
    });

    expect(result).toMatchObject({
      ok: true,
      content: "页面标题是示例",
      toolTurnMessages: [
        expect.objectContaining({
          toolCallRecords: [
            expect.objectContaining({
              id: "call-1",
              status: "success",
              resultSummary: "页面标题：示例",
              attachmentIds: ["attachment-1"],
            }),
          ],
          toolAttachments: [expect.objectContaining({ id: "attachment-1", kind: "page-context" })],
        }),
      ],
    });
    expect(events).toEqual([
      { type: "start", record: expect.objectContaining({ id: "call-1", status: "running" }) },
      {
        type: "complete",
        record: expect.objectContaining({ id: "call-1", status: "success", attachmentIds: ["attachment-1"] }),
        attachments: [expect.objectContaining({ id: "attachment-1" })],
      },
    ]);
    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", toolCalls: expect.any(Array) }),
        expect.objectContaining({ role: "tool", toolCallId: "call-1", content: "页面标题：示例" }),
      ]),
    );
  });

  it("AbortSignal 已中止时不再执行工具调用", async () => {
    const controller = new AbortController();
    controller.abort();
    const requestModel = vi.fn().mockResolvedValue({
      ok: true,
      content: "",
      toolCalls: [{ id: "call-abort", name: tool.name, arguments: { mode: "text" } }],
    });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, message: "已终止本次生成。" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("工具执行器会收到 AbortSignal", async () => {
    const controller = new AbortController();
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-signal", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "最终回答" });
    const executeTool: ModelToolExecutor = vi.fn(async (call, _tool, context) => {
      expect(context?.signal).toBe(controller.signal);
      return {
        toolCallId: call.id,
        name: call.name,
        content: "工具结果",
      };
    });

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      signal: controller.signal,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("存在最终模型请求时会先跑完多轮工具决策再请求最终回复", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-1", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-2", name: tool.name, arguments: { mode: "all" } }] })
      .mockResolvedValueOnce({ ok: true, content: "工具决策完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终流式回答" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `工具结果：${call.id}`,
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      requestFinalModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "最终流式回答",
      toolTurnMessages: [
        expect.objectContaining({ toolCallRecords: [expect.objectContaining({ id: "call-1" })] }),
        expect.objectContaining({ toolCallRecords: [expect.objectContaining({ id: "call-2" })] }),
      ],
    });
    expect(requestModel).toHaveBeenCalledTimes(3);
    expect(requestFinalModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", toolCallId: "call-1", content: "工具结果：call-1" }),
        expect.objectContaining({ role: "tool", toolCallId: "call-2", content: "工具结果：call-2" }),
      ]),
    );
  });

  it("工具未启用时不执行并把错误记录和中文错误回灌给模型", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-1", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "我无法读取页面" });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [],
      requestModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "我无法读取页面",
      toolTurnMessages: [
        expect.objectContaining({
          toolCallRecords: [expect.objectContaining({ id: "call-1", status: "error", errorMessage: "工具 read_page_context 未启用，已拒绝执行。" })],
        }),
      ],
    });
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

  it("工具未注册时不执行并把错误记录和中文错误回灌给模型", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-1", name: "unknown_tool", arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "没有可用工具。" });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "没有可用工具。",
      toolTurnMessages: [
        expect.objectContaining({
          toolCallRecords: [expect.objectContaining({ id: "call-1", status: "error", toolId: "unknown_tool" })],
        }),
      ],
    });
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
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-1", name: tool.name, arguments: {}, parseError: "工具参数必须是对象" }] })
      .mockResolvedValueOnce({ ok: true, content: "参数错误" });
    const executeTool = vi.fn<ModelToolExecutor>();

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "参数错误",
      toolTurnMessages: [
        expect.objectContaining({
          toolCallRecords: [expect.objectContaining({ id: "call-1", status: "error", errorMessage: "工具 read_page_context 参数无效：工具参数必须是对象" })],
        }),
      ],
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("同一轮多个 Tavily 工具附件会保持独立列表并交给通用附件层聚合", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [
          { id: "call-1", name: tool.name, arguments: { mode: "text" } },
          { id: "call-2", name: tool.name, arguments: { mode: "all" } },
        ],
      })
      .mockResolvedValueOnce({ ok: true, content: "已合并搜索结果" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `搜索结果：${call.id}`,
      toolAttachments: [
        {
          id: `attachment-${call.id}`,
          kind: "web-search",
          title: "网络搜索结果",
          summary: `搜索结果：${call.id}`,
          sourceToolCallId: call.id,
          createdAt: call.id === "call-1" ? 1 : 2,
          redacted: false,
          truncated: false,
          provider: "tavily" as const,
          query: call.id,
          results: [{ title: call.id, url: `https://example.com/${call.id}`, content: call.id }],
        },
      ],
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "已合并搜索结果",
      toolTurnMessages: [
        expect.objectContaining({
          toolAttachments: [expect.objectContaining({ id: "attachment-call-1" }), expect.objectContaining({ id: "attachment-call-2" })],
        }),
      ],
    });
  });

  it("超过最大循环次数时返回中文失败", async () => {
    const requestModel = vi.fn().mockResolvedValue({
      ok: true,
      content: "",
      toolCalls: [{ id: "call-1", name: tool.name, arguments: { mode: "text" } }],
    });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面标题：示例",
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      maxIterations: 1,
    });

    expect(result).toEqual({ ok: false, message: "工具调用超过最大轮次，已停止本次请求。" });
  });
});
