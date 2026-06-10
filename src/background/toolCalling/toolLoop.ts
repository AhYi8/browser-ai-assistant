import type { ModelRequestMessage, ModelResponseData, ModelToolCall, ModelToolExecutor, ModelToolRegistryEntry, ModelToolResultMessage } from "../../shared/models/types";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

export interface RunModelToolLoopInput {
  initialMessages: ModelRequestMessage[];
  tools: ModelToolRegistryEntry[];
  enabledToolIds: string[];
  requestModel: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  executeTool: ModelToolExecutor;
  maxIterations?: number;
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

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const response = await input.requestModel(messages);
    if (!response.ok) {
      return response;
    }

    if (!response.toolCalls?.length) {
      return {
        ok: true,
        content: response.content,
        thinking: response.thinking,
      };
    }

    const toolResultMessages = await Promise.all(
      response.toolCalls.map((toolCall) => executeAllowedTool(toolCall, input.tools, enabledToolIds, input.executeTool)),
    );

    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      },
      ...toolResultMessages,
    ];
  }

  return { ok: false, message: "工具调用超过最大轮次，已停止本次请求。" };
}

async function executeAllowedTool(
  toolCall: ModelToolCall,
  tools: ModelToolRegistryEntry[],
  enabledToolIds: Set<string>,
  executeTool: ModelToolExecutor,
): Promise<ModelToolResultMessage> {
  const tool = tools.find((candidate) => candidate.name === toolCall.name);
  if (!tool) {
    return createToolErrorResult(toolCall, `工具 ${toolCall.name} 未注册，已拒绝执行。`);
  }

  if (!enabledToolIds.has(tool.id)) {
    return createToolErrorResult(toolCall, `工具 ${toolCall.name} 未启用，已拒绝执行。`);
  }

  if (toolCall.parseError) {
    return createToolErrorResult(toolCall, `工具 ${toolCall.name} 参数无效：${toolCall.parseError}`);
  }

  try {
    const result = await executeTool(toolCall, tool);
    return {
      role: "tool",
      toolCallId: result.toolCallId,
      name: result.name,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
    };
  } catch {
    return createToolErrorResult(toolCall, `工具 ${toolCall.name} 执行失败，请稍后重试。`);
  }
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
