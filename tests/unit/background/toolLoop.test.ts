import { describe, expect, it, vi } from "vitest";
import { runModelToolLoop } from "../../../src/background/toolCalling/toolLoop";
import type { ModelRequestMessage, ModelToolExecutor, ModelToolRegistryEntry } from "../../../src/shared/models/types";
import type { ChatContextEstimate, ChatToolAttachment, ChatToolCallRecord, ModelConfig } from "../../../src/shared/types";

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

const modelConfig: ModelConfig = {
  id: "model-1",
  providerId: "provider-1",
  name: "模型",
  displayName: "模型",
  channelName: "渠道",
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

  it("工具决策请求会锚定最新用户问题，避免继续旧任务", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "解释空响应原因" });
    const executeTool = vi.fn<ModelToolExecutor>();

    await runModelToolLoop({
      initialMessages: [
        {
          id: "user-old",
          role: "user",
          content: "帮我逆向一下 Gemini 当前激活标签页接口",
          createdAt: 1,
          modelId: "model-1",
          endpointType: "openai_chat",
          streamMode: false,
          systemPrompt: "你是网页助手",
          contextPrompt: "",
          contextMode: "text",
        },
        {
          role: "assistant",
          content: "正在分析 Gemini 接口",
          toolCalls: [{ id: "call-old", name: tool.name, arguments: { mode: "text" } }],
        },
        {
          role: "tool",
          toolCallId: "call-old",
          name: tool.name,
          content: "历史工具结果",
        },
        {
          id: "user-new",
          role: "user",
          content: "为什么会出现模型响应没有可用内容？具体请求详情给我看一下。",
          createdAt: 1,
          modelId: "model-1",
          endpointType: "openai_chat",
          streamMode: false,
          systemPrompt: "你是网页助手",
          contextPrompt: "",
          contextMode: "text",
        },
      ],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
    });

    const requestMessages = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    expect(requestMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("为什么会出现模型响应没有可用内容"),
    });
    expect(requestMessages.at(-1)).toMatchObject({
      content: expect.stringContaining("除非最新请求明确要求继续旧任务"),
    });
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

    const lastRequestMessages = requestModel.mock.calls.at(-1)?.[0] as ModelRequestMessage[];
    expect(lastRequestMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("用户在当前任务运行中补充了以下引导：\n请优先检查登录表单"),
    });
    expect(lastRequestMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("当前必须优先处理的最新用户请求是："),
    });
    expect(consumeGuidance).toHaveBeenCalled();
  });

  it("运行中引导会在多轮工具决策中持续置顶但只消费展示一次", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面",
        toolCalls: [{ id: "call-guide-1", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "继续读取页面",
        toolCalls: [{ id: "call-guide-2", name: "read_page_context", arguments: { mode: "all" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按引导完成" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: `页面内容 ${call.id}`,
    }));
    const guidanceItems = [{ id: "follow-up-persistent", content: "是对话列表接口需要刷新页面才能触发" }];
    const consumeGuidance = vi.fn(() => guidanceItems);
    const displayedMessages: string[] = [];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance,
      onToolTurnMessage: (message) => {
        if (message.toolCallRecords?.some((record) => record.toolId === "chat.follow_up_guidance")) {
          displayedMessages.push(message.id);
        }
      },
    });

    expect(requestModel).toHaveBeenCalledTimes(3);
    for (const call of requestModel.mock.calls) {
      const requestMessages = call[0] as ModelRequestMessage[];
      const systemContent = requestMessages.find((message) => message.role === "system")?.content ?? "";
      expect(systemContent).toEqual(expect.stringContaining("是对话列表接口需要刷新页面才能触发"));
      expect(systemContent).toEqual(expect.stringContaining("不要回复确认、不要复述引导"));
      expect(systemContent.match(/当前任务运行中的持续引导：/g)).toHaveLength(1);
      expect(requestMessages.find((message) => message.role === "system")).toMatchObject({
        content: expect.stringContaining("是对话列表接口需要刷新页面才能触发"),
      });
      expect(requestMessages.find((message) => message.role === "system")).toMatchObject({
        content: expect.stringContaining("不要回复确认、不要复述引导"),
      });
      expect(requestMessages.at(-1)).toMatchObject({
        role: "user",
        content: expect.stringContaining("当前必须优先处理的最新用户请求是："),
      });
      expect(requestMessages.at(-1)?.content).toEqual(expect.stringContaining("引导是最高优先级覆盖约束"));
    }
    expect(displayedMessages).toHaveLength(1);
  });

  it("无新引导时只过滤确认话术，实质工具决策正文仍会展示和回灌", async () => {
    const displayedContents: string[] = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "好的，消息已发送。等待对话回复完成。",
        toolCalls: [{ id: "call-confirmation", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "发现页面已经返回对话内容，需要读取 Network 请求详情。",
        toolCalls: [{ id: "call-substantive", name: "read_page_context", arguments: { mode: "all" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已继续处理" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      onToolTurnMessage: (message) => displayedContents.push(message.content),
    });

    expect(displayedContents[0]).toBe("");
    expect(displayedContents[1]).toBe("发现页面已经返回对话内容，需要读取 Network 请求详情。");
    const secondRequestMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    expect(secondRequestMessages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("好的"),
    }));
    expect(secondRequestMessages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("消息已发送"),
    }));
    const thirdRequestMessages = requestModel.mock.calls[2]?.[0] as ModelRequestMessage[];
    expect(thirdRequestMessages).toContainEqual(expect.objectContaining({
      role: "assistant",
      content: "发现页面已经返回对话内容，需要读取 Network 请求详情。",
    }));
  });

  it("刚消费引导后的第一轮工具决策只展示净化后的实质正文，后续轮次不再展示正文", async () => {
    const displayedContents: string[] = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "好的，聚焦于对话接口。清空 Network 缓存后重新发送消息。",
        toolCalls: [{ id: "call-guided-visible", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        content: "按最新用户消息，两个接口都需要。继续获取列表接口。",
        toolCalls: [{ id: "call-guided-hidden", name: "read_page_context", arguments: { mode: "all" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已完成" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [{ id: "follow-up-dialog-only", content: "不需要对话列表接口了，只逆向对话接口" }];

    await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "逆向对话接口和历史对话列表接口" }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
      onToolTurnMessage: (message) => displayedContents.push(message.content),
    });

    expect(displayedContents).toContain("清空 Network 缓存后重新发送消息。");
    expect(displayedContents.some((content) => content.includes("好的"))).toBe(false);
    expect(displayedContents.some((content) => content.includes("聚焦于"))).toBe(false);
    expect(displayedContents.some((content) => content.includes("两个接口都需要"))).toBe(false);
    const secondRequestMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    expect(secondRequestMessages).toContainEqual(expect.objectContaining({
      role: "assistant",
      content: "清空 Network 缓存后重新发送消息。",
    }));
    const thirdRequestMessages = requestModel.mock.calls[2]?.[0] as ModelRequestMessage[];
    expect(thirdRequestMessages).not.toContainEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("两个接口都需要"),
    }));
  });

  it("聚焦于前缀后没有标点时不会吞掉实质工具决策正文", async () => {
    const displayedContents: string[] = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "聚焦于对话接口并读取页面",
        toolCalls: [{ id: "call-focus-no-punctuation", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已完成" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      onToolTurnMessage: (message) => displayedContents.push(message.content),
    });

    expect(displayedContents[0]).toBe("对话接口并读取页面");
    const secondRequestMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    expect(secondRequestMessages).toContainEqual(expect.objectContaining({
      role: "assistant",
      content: "对话接口并读取页面",
    }));
  });

  it("刚消费引导后的第一轮如果只剩复述引导则不展示也不回灌", async () => {
    const displayedContents: string[] = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "好的，根据最新引导，只逆向对话接口。",
        toolCalls: [{ id: "call-guidance-restatement", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已完成" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [{ id: "follow-up-restatement", content: "不需要对话列表接口了，只逆向对话接口" }];

    await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "逆向对话接口和历史对话列表接口" }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
      onToolTurnMessage: (message) => displayedContents.push(message.content),
    });

    expect(displayedContents.some((content) => content.includes("只逆向对话接口"))).toBe(false);
    const secondRequestMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    expect(secondRequestMessages.some((message) => message.role === "assistant" && typeof message.content === "string" && message.content.includes("只逆向对话接口"))).toBe(false);
  });

  it("运行中引导会持续进入最终回答请求", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面",
        toolCalls: [{ id: "call-guide-final", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "工具阶段完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [{ id: "follow-up-final", content: "最终回答必须说明刷新页面这一点" }];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      requestFinalModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
    });

    const finalMessages = requestFinalModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    expect(finalMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("最终回答必须说明刷新页面这一点"),
    });
    expect(finalMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("工具调用阶段已经结束"),
    });
    expect(finalMessages.at(-1)?.content).not.toEqual(expect.stringContaining("最终回答必须说明刷新页面这一点"));
  });

  it("运行中引导会作为任务提醒中的覆盖约束参与后续决策", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "先读取页面。",
        toolCalls: [{ id: "call-guide-main-task", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按真实任务继续" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [
      {
        id: "follow-up-main-task",
        content: "是对话列表接口需要刷新页面才能触发",
      },
    ];

    await runModelToolLoop({
      initialMessages: [
        {
          ...baseMessages[0],
          content: "帮我逆向一下 Gemini 当前激活标签页接口",
        },
      ],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
    });

    const firstRequestMessages = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    const reminderMessages = firstRequestMessages.filter(
      (message) => message.role === "user" && message.content.startsWith("当前必须优先处理的最新用户请求是："),
    );
    expect(reminderMessages).toHaveLength(1);
    expect(reminderMessages[0]?.content).toContain("帮我逆向一下 Gemini 当前激活标签页接口");
    expect(reminderMessages[0]?.content).toContain("是对话列表接口需要刷新页面才能触发");
    expect(reminderMessages[0]?.content).toContain("引导是最高优先级覆盖约束");
    expect(firstRequestMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("是对话列表接口需要刷新页面才能触发"),
    });
  });

  it("运行中引导可以取消原任务中的子目标并阻止冲突决策正文回灌", async () => {
    const displayedContents: string[] = [];
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: "按最新用户消息，两个接口都需要。先获取列表接口。",
        toolCalls: [{ id: "call-conflict", name: "read_page_context", arguments: { mode: "text" } }],
      })
      .mockResolvedValueOnce({ ok: true, content: "已按对话接口继续" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "页面内容",
    }));
    const guidanceItems = [{ id: "follow-up-cancel-list", content: "不需要对话列表接口了，只逆向对话接口" }];

    await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "帮我逆向对话接口和历史对话列表接口" }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
      onToolTurnMessage: (message) => displayedContents.push(message.content),
    });

    const firstRequestMessages = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    const systemContent = firstRequestMessages.find((message) => message.role === "system")?.content ?? "";
    expect(systemContent).toContain("不需要对话列表接口了，只逆向对话接口");
    expect(firstRequestMessages.at(-1)?.content).toContain("不需要对话列表接口了，只逆向对话接口");
    expect(firstRequestMessages.at(-1)?.content).toContain("被引导取消、缩小或排除的目标不得继续执行");
    expect(displayedContents.some((content) => content.includes("两个接口都需要"))).toBe(false);
    const secondRequestMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    expect(secondRequestMessages.some((message) => message.role === "assistant" && typeof message.content === "string" && message.content.includes("两个接口都需要"))).toBe(false);
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

    const lastRequestMessages = requestModel.mock.calls.at(-1)?.[0] as ModelRequestMessage[];
    expect(lastRequestMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("已调用提示词：\n1. 检查清单\n先核对按钮状态，再核对错误提示。"),
    });
    expect(lastRequestMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("用户输入：\n补充关注异常态"),
    });
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

    const requestMessages = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    expect(requestMessages.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("用户补充了图片附件。"),
    });
    expect(requestMessages).toContainEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("当前任务持续引导包含图片附件"),
      attachments: [imageAttachment],
    }));
    expect(requestMessages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("当前必须优先处理的最新用户请求是："),
    });
    expect(requestMessages.at(-1)?.content).toEqual(expect.stringContaining("读取页面"));
    expect(requestMessages.at(-1)?.content).not.toEqual(expect.stringContaining("当前任务持续引导包含图片附件"));
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

  it("首次工具决策请求前超过阈值会先压缩上下文", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "压缩后回答" });
    const requestCompression = vi.fn().mockResolvedValue({
      ok: true,
      content: "压缩摘要",
      tokenUsageEntries: [{ id: "usage-compression", usageSchemaVersion: 1, source: "context_compression", modelId: "model-1", endpointType: "openai_chat", createdAt: 1, inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }],
    });
    const displayedMessages: string[] = [];
    const contextEstimates: ChatContextEstimate[] = [];
    const guidanceItems = [{ id: "follow-up-compression", content: "压缩后仍然优先检查对话接口" }];

    const result = await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "很长的用户问题".repeat(200) }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      consumeGuidance: vi.fn(() => guidanceItems.splice(0)),
      onToolTurnMessage: (message) => displayedMessages.push(message.assistantMessageKind ?? ""),
      onContextEstimate: (estimate) => contextEstimates.push(estimate),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 400,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(result).toMatchObject({ ok: true, content: "压缩后回答" });
    expect(requestCompression).toHaveBeenCalledTimes(1);
    expect(contextEstimates).toEqual([
      expect.objectContaining({
        scope: "tool_loop",
        phase: "decision",
        maxContextTokens: 400,
        thresholdPercent: 50,
        triggerThresholdTokens: 200,
      }),
      expect.objectContaining({
        scope: "tool_loop",
        phase: "decision",
        maxContextTokens: 400,
        thresholdPercent: 50,
        triggerThresholdTokens: 200,
      }),
    ]);
    expect(contextEstimates[0]?.estimatedContextTokens).toBeGreaterThanOrEqual(200);
    expect(contextEstimates[1]?.estimatedContextTokens).toBeLessThan(contextEstimates[0]?.estimatedContextTokens ?? 0);
    expect(requestCompression.mock.calls[0]?.[0].some((message: ModelRequestMessage) => "content" in message && String(message.content).includes("很长的用户问题"))).toBe(true);
    const compressedDecisionRequest = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    expect(compressedDecisionRequest).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", assistantMessageKind: "context_summary", content: "压缩摘要" }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("很长的用户问题") }),
    ]));
    expect(compressedDecisionRequest).not.toContainEqual(expect.objectContaining({ role: "user", content: "请基于以上压缩上下文继续当前任务。" }));
    expect(compressedDecisionRequest.find((message) => message.role === "system")).toMatchObject({
      content: expect.stringContaining("压缩后仍然优先检查对话接口"),
    });
    expect(compressedDecisionRequest.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("当前必须优先处理的最新用户请求是："),
    });
    expect(compressedDecisionRequest.at(-1)?.content).toContain("引导是最高优先级覆盖约束");
    expect(displayedMessages).toEqual(["tool_call_turn", "tool_call_turn"]);
    expect(result.ok && result.toolTurnMessages?.map((message) => message.assistantMessageKind)).toEqual(["tool_call_turn", "context_summary"]);
  });

  it("首次工具决策压缩后保留最新用户任务，避免被旧历史带偏", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "开始逆向 Gemini 接口" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "旧历史主要是 Clash Verge。" });
    const oldUserMessage = { ...baseMessages[0], id: "user-old", content: "总结 Clash Verge 高级玩法".repeat(20) };
    const currentUserMessage = { ...baseMessages[0], id: "user-current", content: "帮我逆向一下 Gemini 当前激活标签页接口" };

    await runModelToolLoop({
      initialMessages: [oldUserMessage, currentUserMessage],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    const compressedRequest = requestModel.mock.calls[0]?.[0] as ModelRequestMessage[];
    expect(compressedRequest).toContainEqual(expect.objectContaining({ role: "user", content: expect.stringContaining("Gemin") }));
    expect(compressedRequest).not.toContainEqual(expect.objectContaining({ role: "user", content: "总结 Clash Verge 高级玩法" }));
  });

  it("首次工具决策前优先使用侧边栏传入的初始上下文估算，避免本地文本估算虚高误压缩", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "直接决策" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "不应压缩" });

    await runModelToolLoop({
      initialMessages: [
        { role: "assistant", content: "本地估算很长".repeat(100), toolCalls: [] },
        { ...baseMessages[0], content: "继续" },
      ],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 100,
        initialContextTokens: 50,
        thresholdPercent: 90,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(requestCompression).not.toHaveBeenCalled();
    expect(requestModel).toHaveBeenCalledTimes(1);
  });

  it("工具结果追加后超过阈值会在下一轮 AI 请求前压缩", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "先读页面", toolCalls: [{ id: "call-large", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "基于压缩摘要回答" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "工具结果压缩摘要" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "很长的工具结果".repeat(30),
    }));

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool,
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 90,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(requestCompression).toHaveBeenCalledTimes(1);
    expect(requestCompression.mock.calls[0]?.[0].some((message: ModelRequestMessage) => "content" in message && String(message.content).includes("很长的工具结果"))).toBe(true);
    expect(requestModel).toHaveBeenLastCalledWith([
      expect.objectContaining({ role: "assistant", assistantMessageKind: "context_summary", content: "工具结果压缩摘要" }),
      expect.objectContaining({ role: "user", content: "读取页面" }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("当前必须优先处理的最新用户请求") }),
    ]);
  });

  it("最终回答请求前超过阈值会先压缩再请求最终回答", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "先读页面", toolCalls: [{ id: "call-final-compress", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "工具决策完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "最终前摘要" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "工具结果",
    }));

    await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "普通问题".repeat(20) }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      requestFinalModel,
      executeTool,
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 90,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(requestCompression).toHaveBeenCalled();
    expect(requestFinalModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", assistantMessageKind: "context_summary", content: "最终前摘要" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("工具调用阶段已经结束") }),
      ]),
    );
  });

  it("最终回答指令导致真实最终请求超阈值时也会先压缩", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "先读页面", toolCalls: [{ id: "call-final-instruction", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "工具决策完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "最终请求摘要" });
    const executeTool: ModelToolExecutor = vi.fn(async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: "短结果",
    }));

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      requestFinalModel,
      executeTool,
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 120,
        thresholdPercent: 100,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(requestCompression).toHaveBeenCalledTimes(1);
    expect(requestCompression.mock.calls[0]?.[0].some((message: ModelRequestMessage) => "content" in message && String(message.content).includes("工具调用阶段已经结束"))).toBe(true);
    expect(requestFinalModel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", assistantMessageKind: "context_summary", content: "最终请求摘要" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("工具调用阶段已经结束") }),
      ]),
    );
  });

  it("最终回答压缩成功后会再次发送压缩后的运行中上下文估算", async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "先读页面", toolCalls: [{ id: "call-final-estimate", name: tool.name, arguments: { mode: "text" } }] })
      .mockResolvedValueOnce({ ok: true, content: "工具决策完成" });
    const requestFinalModel = vi.fn().mockResolvedValue({ ok: true, content: "最终回答" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "最终回答前摘要" });
    const contextEstimates: ChatContextEstimate[] = [];

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      requestFinalModel,
      executeTool: vi.fn(async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: "短工具结果",
      })),
      onContextEstimate: (estimate) => contextEstimates.push(estimate),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 120,
        thresholdPercent: 100,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    const finalEstimates = contextEstimates.filter((estimate) => estimate.phase === "final");
    expect(finalEstimates).toHaveLength(2);
    expect(finalEstimates[0]?.estimatedContextTokens).toBeGreaterThanOrEqual(120);
    expect(finalEstimates[1]?.estimatedContextTokens).toBeLessThan(finalEstimates[0]?.estimatedContextTokens ?? 0);
  });

  it("压缩请求本身超预算时会先摘要化长工具结果且保留附件索引", async () => {
    const hugeToolContent = `${"Network body ".repeat(6000)}BODYTAIL`;
    const networkAttachment: ChatToolAttachment = {
      id: "tool-attachment-network-1",
      kind: "network",
      title: "Network 请求详情",
      summary: "共 1 条请求",
      sourceToolCallId: "call-large-network",
      createdAt: 1,
      redacted: true,
      truncated: false,
      requests: [
        {
          id: "req-1",
          url: "https://example.com/api/huge",
          method: "POST",
          status: 200,
          responseBody: "完整响应正文",
          truncated: false,
          redacted: true,
        },
      ],
    };
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, content: "读取 Network", toolCalls: [{ id: "call-large-network", name: tool.name, arguments: { mode: "network" } }] })
      .mockResolvedValueOnce({ ok: true, content: "基于摘要继续" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "不应调用 AI 压缩" });

    await runModelToolLoop({
      initialMessages: baseMessages,
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn(async (call) => ({
        toolCallId: call.id,
        name: call.name,
        content: hugeToolContent,
        toolAttachments: [networkAttachment],
      })),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 20000,
        thresholdPercent: 90,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(requestCompression).not.toHaveBeenCalled();
    const secondDecisionMessages = requestModel.mock.calls[1]?.[0] as ModelRequestMessage[];
    const summarizedToolMessage = secondDecisionMessages.find((message) => message.role === "tool");
    expect(summarizedToolMessage).toMatchObject({
      role: "tool",
      toolCallId: "call-large-network",
      name: tool.name,
      toolAttachments: [networkAttachment],
    });
    expect(summarizedToolMessage?.content).toContain("工具结果已因上下文预算被摘要化");
    expect(summarizedToolMessage?.content).toContain("req-1");
    expect(summarizedToolMessage?.content).not.toContain("BODYTAIL");
  });

  it("压缩失败时停止工具循环并返回中文错误", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "不应调用" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: false, message: "聊天上下文压缩失败，请稍后重试" });
    const completedRecords: ChatToolCallRecord[] = [];

    const result = await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "很长的问题".repeat(20) }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      onToolCallComplete: (record) => completedRecords.push(record),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(result).toEqual({ ok: false, message: "聊天上下文压缩失败，请稍后重试" });
    expect(requestModel).not.toHaveBeenCalled();
    expect(completedRecords[0]).toMatchObject({ toolId: "chat.context_compression", status: "error" });
  });

  it("压缩后仍超过阈值时不会继续请求模型", async () => {
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "不应调用" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "压缩摘要" });
    const completedRecords: ChatToolCallRecord[] = [];

    const result = await runModelToolLoop({
      initialMessages: [
        { role: "system", content: "很长的系统提示".repeat(20) },
        { ...baseMessages[0], content: "很长的问题".repeat(20) },
      ],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      onToolCallComplete: (record) => completedRecords.push(record),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 10,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(result).toEqual({ ok: false, message: "聊天上下文压缩后仍超过自动压缩阈值，请调大最大聊天上下文或缩短系统提示、页面上下文后重试" });
    expect(requestModel).not.toHaveBeenCalled();
    expect(completedRecords[0]).toMatchObject({
      toolId: "chat.context_compression",
      status: "error",
      errorMessage: "聊天上下文压缩后仍超过自动压缩阈值，请调大最大聊天上下文或缩短系统提示、页面上下文后重试",
      resultSummary: "压缩摘要",
    });
  });

  it("压缩请求返回后已取消时会收尾压缩工具过程", async () => {
    const controller = new AbortController();
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "不应调用" });
    const requestCompression = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { ok: true, content: "不应使用" };
    });
    const completedRecords: ChatToolCallRecord[] = [];

    const result = await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "很长的问题".repeat(20) }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      signal: controller.signal,
      onToolCallComplete: (record) => completedRecords.push(record),
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(result).toEqual({ ok: false, message: "已终止本次生成。" });
    expect(requestModel).not.toHaveBeenCalled();
    expect(completedRecords[0]).toMatchObject({
      toolId: "chat.context_compression",
      status: "error",
      errorMessage: "已终止本次生成。",
    });
  });

  it("压缩前已取消时不会发起压缩和工具请求", async () => {
    const controller = new AbortController();
    controller.abort();
    const requestModel = vi.fn().mockResolvedValue({ ok: true, content: "不应调用" });
    const requestCompression = vi.fn().mockResolvedValue({ ok: true, content: "不应调用" });

    const result = await runModelToolLoop({
      initialMessages: [{ ...baseMessages[0], content: "很长的问题".repeat(20) }],
      tools: [tool],
      enabledToolIds: [tool.id],
      requestModel,
      executeTool: vi.fn<ModelToolExecutor>(),
      signal: controller.signal,
      contextCompression: {
        model: modelConfig,
        maxContextTokens: 80,
        thresholdPercent: 50,
        compressionPrompt: "请压缩",
        systemPrompt: "你是网页助手",
        contextMode: "text",
        requestCompression,
      },
    });

    expect(result).toEqual({ ok: false, message: "已终止本次生成。" });
    expect(requestCompression).not.toHaveBeenCalled();
    expect(requestModel).not.toHaveBeenCalled();
  });
});
