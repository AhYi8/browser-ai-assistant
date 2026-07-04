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

const browserTool: ModelToolRegistryEntry = {
  id: "network.list_requests",
  name: "network_list_requests",
  displayName: "列出 Network 请求",
  description: "列出请求",
  parameters: {
    type: "object",
    properties: {},
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

    const guidanceItems = [{ id: "follow-up-visible", content: "请优先检查登录表单" }];

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

  it("运行中引导会在下一轮模型决策前作为用户补充注入", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面。",
        toolCalls: [{ id: "call-guide", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按引导调整" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const consumeGuidance = vi.fn(() => [
      {
        id: "follow-up-1",
        content: "请优先检查登录表单",
      },
    ]);

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance,
    });

    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("用户在当前任务运行中补充了以下引导：\n请优先检查登录表单"),
        }),
      ]),
    );
    expect(consumeGuidance).toHaveBeenCalled();
  });

  it("运行中引导会携带 Prompt 调用快照注入模型请求", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面。",
        toolCalls: [{ id: "call-guide-prompt", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按 Prompt 引导调整" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [
      {
        id: "follow-up-prompt",
        content: "补充关注异常态",
        promptInvocations: [
          {
            promptId: "prompt-1",
            title: "检查清单",
            contentSnapshot: "先核对按钮状态，再核对错误提示。",
          },
        ],
      },
    ];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
    });

    expect(requestModel).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("已调用提示词：\n1. 检查清单\n先核对按钮状态，再核对错误提示。"),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("用户输入：\n补充关注异常态"),
        }),
      ]),
    );
  });

  it("运行中纯图片引导会携带图片附件注入模型请求", async () => {
    const imageAttachment = {
      id: "image-1",
      name: "截图.png",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,aW1hZ2U=",
    };
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "已查看图片引导" });
    const executeTool = vi.fn<ModelToolExecutor>();
    const guidanceItems = [
      {
        id: "follow-up-image",
        content: "",
        attachments: [imageAttachment],
      },
    ];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
    });

    expect(requestModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("用户补充了图片附件。"),
          attachments: [imageAttachment],
        }),
      ]),
    );
  });

  it("运行中引导被消费时会输出已引导过程提示", async () => {
    const displayedMessages: Array<{ role: string; content: string; assistantMessageKind?: string; toolCallRecords?: Array<{ displayName: string; status: string }> }> = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面。",
        toolCalls: [{ id: "call-guide-visible", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按引导调整" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [{ id: "follow-up-visible", content: "请优先检查登录表单" }];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
      onToolTurnMessage: (message) => displayedMessages.push(message),
    });

    expect(displayedMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        assistantMessageKind: "tool_call_turn",
        content: "",
        toolCallRecords: [
          expect.objectContaining({
            displayName: "已引导对话",
            status: "success",
          }),
        ],
      }),
      expect.objectContaining({
        role: "assistant",
        assistantMessageKind: "tool_call_turn",
        content: "先读取页面。",
      }),
    ]);
  });

  it("同轮存在浏览器自动化工具时串行执行，避免一次性授权并发覆盖", async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "",
        toolCalls: [
          { id: "call-browser-1", name: "network_list_requests", arguments: {} },
          { id: "call-browser-2", name: "network_list_requests", arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ ok: true, content: "完成" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => {
      started.push(call.id);
      if (call.id === "call-browser-1") {
        await Promise.resolve();
        expect(started).toEqual(["call-browser-1"]);
        releaseFirst?.();
        await firstPending;
      }
      return {
        toolCallId: call.id,
        name: call.name,
        content: `结果 ${call.id}`,
      };
    });

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [browserTool],
      enabledToolIds: [browserTool.id],
      requestModel,
      executeTool,
    });

    expect(started).toEqual(["call-browser-1", "call-browser-2"]);
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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("工具循环应返回成功结果");
    }
    expect(result.toolTurnMessages).toHaveLength(2);
    expect(requestModel).toHaveBeenCalledTimes(3);
    expect(requestFinalModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", toolCallId: "call-1", content: "工具结果：call-1" }),
        expect.objectContaining({ role: "tool", toolCallId: "call-2", content: "工具结果：call-2" }),
      ]),
    );
  });

  it("浏览器自动化工具完成后会基于真实工具记录生成自动化报告附件", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先观察页面，再检查 Network。",
        toolCalls: [
          { id: "call-page", name: "network_list_requests", arguments: {} },
          { id: "call-console", name: "network_list_requests", arguments: { status: 500 } },
        ],
      })
      .mockResolvedValueOnce({ ok: true, content: "工具决策完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答：发现一个 500 请求。" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: call.id === "call-page" ? "页面状态：已加载" : "Network 请求失败：500 token=secret",
      isError: call.id === "call-console",
    }));

    const result = await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [browserTool],
      enabledToolIds: [browserTool.id],
      automationPlaybookSelection: {
        playbookId: "site_diagnostics",
        title: "现场诊断",
        source: "builtin",
        confidence: "high",
        reason: "用户要求排查页面错误",
      },
      requestModel,
      requestFinalModel,
      executeTool,
    });

    expect(result).toMatchObject({
      ok: true,
      content: "最终回答：发现一个 500 请求。",
      toolAttachments: [
        expect.objectContaining({
          kind: "automation-report",
          title: "自动化任务报告",
          summary: expect.stringContaining("总步骤=2，成功=1，失败=1"),
          steps: [
            expect.objectContaining({ toolCallId: "call-page", status: "success", evidence: "页面状态：已加载" }),
            expect.objectContaining({ toolCallId: "call-console", status: "error", evidence: "Network 请求失败：500 token=[已脱敏]" }),
          ],
          timeline: [
            expect.objectContaining({ type: "tool_call", toolCallId: "call-page", status: "success", detail: "页面状态：已加载" }),
            expect.objectContaining({ type: "tool_call", toolCallId: "call-console", status: "error", detail: "Network 请求失败：500 token=[已脱敏]" }),
            expect.objectContaining({ type: "failure_recovery", toolCallId: "call-console", status: "error" }),
          ],
          failureSummary: expect.objectContaining({
            failedStepCount: 1,
            failedTools: ["列出 Network 请求"],
            recoverableActions: expect.arrayContaining(["检查失败步骤的参数、页面状态或授权边界后重试。"]),
          }),
          playbook: expect.objectContaining({
            playbookId: "site_diagnostics",
            title: "现场诊断",
            confidence: "high",
            reason: "用户要求排查页面错误",
          }),
          redacted: true,
        }),
      ],
      toolTurnMessages: [
        expect.objectContaining({
          toolAttachments: expect.arrayContaining([
            expect.objectContaining({ kind: "automation-report", summary: expect.stringContaining("总步骤=2") }),
          ]),
        }),
      ],
    });
    expect(result.ok && result.toolAttachments?.[0].summary).not.toContain("secret");
  });

  it("最终模型请求会明确要求停止工具阶段并直接总结", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "", toolCalls: [{ id: "call-1", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "让我也快速测试 network_compare_requests。" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "测试总结：工具链路正常。" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "network_extract_js_candidates 返回 50 个结果",
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
      content: "测试总结：工具链路正常。",
      toolTurnMessages: [
        expect.objectContaining({ toolCallRecords: [expect.objectContaining({ id: "call-1" })] }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("工具循环应返回成功结果");
    }
    expect(result.toolTurnMessages).toHaveLength(1);
    expect(requestFinalModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("工具调用阶段已经结束"),
        }),
      ]),
    );
    const finalMessages = requestFinalModel.mock.calls[0]?.[0] ?? [];
    expect(finalMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("不要再声称将继续调用、测试或等待工具"),
    });
    expect(finalMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("事实证据、模型推断和未验证假设"),
    });
    expect(finalMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("上一轮工具决策阶段的自然语言正文只作为过程参考"),
    });
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
