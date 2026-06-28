import type { AutomationPlaybookSelection, ChatMessage, ChatToolAttachment, ChatToolCallRecord } from "../../shared/types";
import type { ModelRequestMessage, ModelResponseData, ModelToolCall, ModelToolExecutor, ModelToolRegistryEntry, ModelToolResultMessage } from "../../shared/models/types";
import { isBrowserAutomationToolId } from "../../shared/models/toolRegistry";
import { createAutomationReportToolAttachment } from "../../shared/toolArtifacts";
import { truncateText } from "../../shared/utils/text";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const FINAL_RESPONSE_INSTRUCTION = [
  "工具调用阶段已经结束，当前请求不会再执行任何工具。",
  "请只基于上文用户问题和已经返回的工具结果，直接给出面向用户的最终中文答复。",
  "最终答复必须区分事实证据、模型推断和未验证假设：工具结果可作为事实证据，基于证据的判断要标明为模型推断，未被工具或用户确认的信息要标明为未验证假设。",
  "上一轮工具决策阶段的自然语言正文只作为过程参考，不要把其中的待办话术当作还会继续执行的计划。",
  "不要再声称将继续调用、测试或等待工具；如果信息不足，请明确说明已完成的部分和无法继续验证的原因。",
].join("\n");

export interface RunModelToolLoopInput {
  initialMessages: ModelRequestMessage[];
  tools: ModelToolRegistryEntry[];
  enabledToolIds: string[];
  requestModel: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  requestFinalModel?: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  executeTool: ModelToolExecutor;
  automationPlaybookSelection?: AutomationPlaybookSelection;
  onToolTurnMessage?: (message: ChatMessage) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  maxIterations?: number;
  signal?: AbortSignal;
}

export type ModelToolLoopResponse =
  | ({ ok: true } & ModelResponseData)
  | {
      ok: false;
      message: string;
    };

export async function runModelToolLoop(input: RunModelToolLoopInput): Promise<ModelToolLoopResponse> {
  const maxIterations = Math.max(1, Math.floor(input.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS));
  const enabledToolIds = new Set(input.enabledToolIds);
  let messages = [...input.initialMessages];
  const toolCallRecords: ChatToolCallRecord[] = [];
  const toolAttachments: ChatToolAttachment[] = [];
  const toolTurnMessages: ChatMessage[] = [];
  let lastResponse: ModelToolLoopResponse | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    const response = await input.requestModel(messages);
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    if (!response.ok) {
      return response;
    }

    if (!response.toolCalls?.length) {
      lastResponse = {
        ok: true,
        content: response.content,
        thinking: response.thinking,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
        ...(toolAttachments.length ? { toolAttachments } : {}),
        ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
      };
      break;
    }

    const currentTurnRecords: ChatToolCallRecord[] = [];
    const currentTurnAttachments: ChatToolAttachment[] = [];
    const toolTurnMessageId = createToolTurnMessageId(response.toolCalls[0]?.id);
    input.onToolTurnMessage?.(
      createToolTurnMessage({
        id: toolTurnMessageId,
        initialMessages: input.initialMessages,
        response,
        toolCallRecords: [],
        toolAttachments: [],
      }),
    );
    const executeCurrentTool = (toolCall: ModelToolCall) =>
      executeAllowedTool(toolCall, input.tools, enabledToolIds, input.executeTool, {
        signal: input.signal,
        onStart: (record) => {
          toolCallRecords.push(record);
          currentTurnRecords.push(record);
          input.onToolCallStart?.(record);
        },
        onComplete: (record, attachments) => {
          const existingIndex = toolCallRecords.findIndex((item) => item.id === record.id);
          if (existingIndex >= 0) {
            toolCallRecords[existingIndex] = record;
          } else {
            toolCallRecords.push(record);
          }
          const currentTurnExistingIndex = currentTurnRecords.findIndex((item) => item.id === record.id);
          if (currentTurnExistingIndex >= 0) {
            currentTurnRecords[currentTurnExistingIndex] = record;
          } else {
            currentTurnRecords.push(record);
          }
          appendUniqueToolAttachments(toolAttachments, attachments);
          appendUniqueToolAttachments(currentTurnAttachments, attachments);
          input.onToolCallComplete?.(record, attachments);
        },
      });
    const hasBrowserAutomationToolCall = response.toolCalls.some((toolCall) => {
      const tool = input.tools.find((entry) => entry.name === toolCall.name || entry.id === toolCall.name);
      return tool ? isBrowserAutomationToolId(tool.id) : false;
    });
    const toolResultMessages: ModelToolResultMessage[] = [];
    if (hasBrowserAutomationToolCall) {
      // 浏览器自动化工具共享 tab、Network 缓存和一次性授权状态；串行执行避免同轮多个工具并发覆盖 grant。
      for (const toolCall of response.toolCalls) {
        toolResultMessages.push(await executeCurrentTool(toolCall));
      }
    } else {
      toolResultMessages.push(...await Promise.all(response.toolCalls.map(executeCurrentTool)));
    }
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    for (const toolResultMessage of toolResultMessages) {
      appendUniqueToolAttachments(toolAttachments, toolResultMessage.toolAttachments ?? []);
      appendUniqueToolAttachments(currentTurnAttachments, toolResultMessage.toolAttachments ?? []);
    }
    if (hasBrowserAutomationToolCall) {
      const report = createAutomationReportToolAttachment({
        objective: getAutomationObjective(input.initialMessages),
        conclusion: summarizeAutomationConclusion(currentTurnRecords),
        records: currentTurnRecords,
        attachments: currentTurnAttachments,
        playbook: input.automationPlaybookSelection,
      });
      if (report) {
        appendUniqueToolAttachments(toolAttachments, [report]);
        appendUniqueToolAttachments(currentTurnAttachments, [report]);
      }
    }
    const toolTurnMessage = createToolTurnMessage({
      id: toolTurnMessageId,
      initialMessages: input.initialMessages,
      response,
      toolCallRecords: currentTurnRecords,
      toolAttachments: currentTurnAttachments,
    });
    toolTurnMessages.push(toolTurnMessage);

    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      },
      ...toolResultMessages,
    ];
  }

  if (input.requestFinalModel && lastResponse?.ok) {
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    const finalResponse = await input.requestFinalModel(createFinalRequestMessages(messages));
    if (input.signal?.aborted) {
      return createAbortResponse();
    }
    if (!finalResponse.ok) {
      return finalResponse;
    }

    return {
      ok: true,
      content: finalResponse.content,
      thinking: finalResponse.thinking,
      ...(finalResponse.reasoningContent ? { reasoningContent: finalResponse.reasoningContent } : {}),
      ...(toolAttachments.length ? { toolAttachments } : {}),
      ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
    };
  }

  return lastResponse ?? { ok: false, message: "工具调用超过最大轮次，已停止本次请求。" };
}

function createFinalRequestMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content: FINAL_RESPONSE_INSTRUCTION,
    },
  ];
}

function createAbortResponse(): ModelToolLoopResponse {
  return { ok: false, message: "已终止本次生成。" };
}

function createToolTurnMessage(input: {
  id: string;
  initialMessages: ModelRequestMessage[];
  response: Extract<ModelToolLoopResponse, { ok: true }>;
  toolCallRecords: ChatToolCallRecord[];
  toolAttachments: ChatToolAttachment[];
}): ChatMessage {
  const createdAt = Date.now();
  const baseMessage = input.initialMessages.find((message): message is ChatMessage => "id" in message && "modelId" in message);
  return {
    id: input.id,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: input.response.content,
    thinking: input.response.thinking,
    reasoningContent: input.response.reasoningContent,
    createdAt,
    modelId: baseMessage?.modelId ?? "",
    endpointType: baseMessage?.endpointType ?? "openai_chat",
    streamMode: baseMessage?.streamMode ?? false,
    systemPrompt: baseMessage?.systemPrompt ?? "",
    contextPrompt: baseMessage?.contextPrompt ?? "",
    contextMode: baseMessage?.contextMode ?? "text",
    matchedRuleId: baseMessage?.matchedRuleId,
    toolCallRecords: input.toolCallRecords,
    toolAttachments: input.toolAttachments.length ? input.toolAttachments : undefined,
  };
}

function createToolTurnMessageId(firstToolCallId: string | undefined): string {
  return `message-${Date.now()}-tool-turn-${firstToolCallId ?? "unknown"}`;
}

function getAutomationObjective(messages: ModelRequestMessage[]): string {
  const userMessage = messages.find((message): message is Extract<ModelRequestMessage, { role: "user"; content: string }> =>
    message.role === "user" && typeof message.content === "string" && Boolean(message.content.trim()),
  );
  return truncateText(userMessage?.content.trim() || "未记录任务目标", 500).text;
}

function summarizeAutomationConclusion(records: ChatToolCallRecord[]): string {
  const successCount = records.filter((record) => record.status === "success").length;
  const errorRecords = records.filter((record) => record.status === "error");
  if (errorRecords.length > 0) {
    const failedTools = Array.from(new Set(errorRecords.map((record) => record.displayName || record.name))).join("、");
    return `已执行 ${records.length} 个自动化步骤，其中 ${successCount} 个成功、${errorRecords.length} 个失败；失败工具：${failedTools}。`;
  }
  return `已执行 ${records.length} 个自动化步骤，全部成功完成。`;
}

async function executeAllowedTool(
  toolCall: ModelToolCall,
  tools: ModelToolRegistryEntry[],
  enabledToolIds: Set<string>,
  executeTool: ModelToolExecutor,
  callbacks: {
    signal?: AbortSignal;
    onStart: (record: ChatToolCallRecord) => void;
    onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  },
): Promise<ModelToolResultMessage> {
  const tool = tools.find((candidate) => candidate.name === toolCall.name);
  const runningRecord: ChatToolCallRecord = {
    id: toolCall.id,
    toolId: tool?.id ?? toolCall.name,
    name: toolCall.name,
    displayName: tool?.displayName ?? toolCall.name,
    arguments: sanitizeToolArguments(toolCall.arguments),
    status: "running",
    startedAt: Date.now(),
  };
  callbacks.onStart(runningRecord);

  if (!tool) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未注册，已拒绝执行。`, callbacks);
  }

  if (!enabledToolIds.has(tool.id)) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未启用，已拒绝执行。`, callbacks);
  }

  if (toolCall.parseError) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 参数无效：${toolCall.parseError}`, callbacks);
  }

  try {
    if (callbacks.signal?.aborted) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const result = await executeTool(toolCall, tool, { signal: callbacks.signal });
    if (callbacks.signal?.aborted) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const resultMessage: ModelToolResultMessage = {
      role: "tool",
      toolCallId: result.toolCallId,
      name: result.name,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
      ...(result.toolAttachments?.length ? { toolAttachments: result.toolAttachments } : {}),
    };
    callbacks.onComplete(createCompletedToolRecord(runningRecord, resultMessage), result.toolAttachments ?? []);
    return resultMessage;
  } catch {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 执行失败，请稍后重试。`, callbacks);
  }
}

function completeToolError(
  runningRecord: ChatToolCallRecord,
  toolCall: ModelToolCall,
  content: string,
  callbacks: { onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void },
): ModelToolResultMessage {
  const result = createToolErrorResult(toolCall, content);
  callbacks.onComplete(createCompletedToolRecord(runningRecord, result), []);
  return result;
}

function createToolErrorResult(toolCall: ModelToolCall, content: string): ModelToolResultMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function createCompletedToolRecord(record: ChatToolCallRecord, result: ModelToolResultMessage): ChatToolCallRecord {
  const attachmentIds = result.toolAttachments?.map((attachment) => attachment.id).filter(Boolean) ?? [];
  return {
    ...record,
    status: result.isError ? "error" : "success",
    completedAt: Date.now(),
    resultSummary: truncateText(result.content.trim(), 280).text,
    ...(result.isError ? { errorMessage: result.content } : {}),
    ...(attachmentIds.length ? { attachmentIds } : {}),
  };
}

function appendUniqueToolAttachments(target: ChatToolAttachment[], attachments: ChatToolAttachment[]): void {
  for (const attachment of attachments) {
    if (!target.some((item) => item.id === attachment.id)) {
      target.push(attachment);
    }
  }
}

function sanitizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, truncateText(value, 1000).text];
      }
      if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return [key, value];
      }
      try {
        return [key, JSON.parse(JSON.stringify(value ?? null)) as unknown];
      } catch {
        return [key, "[无法序列化的参数]"];
      }
    }),
  );
}
