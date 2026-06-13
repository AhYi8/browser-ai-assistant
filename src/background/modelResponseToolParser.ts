import type { ModelToolCall } from "../shared/models/types";

export function extractOpenAIToolCalls(message: object): ModelToolCall[] {
  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls
    .map((toolCall, index) => {
      if (!toolCall || typeof toolCall !== "object" || !("function" in toolCall)) {
        return undefined;
      }

      const toolFunction = toolCall.function;
      if (!toolFunction || typeof toolFunction !== "object" || !("name" in toolFunction) || typeof toolFunction.name !== "string") {
        return undefined;
      }

      const parsedArguments = parseToolArguments(
        "arguments" in toolFunction && typeof toolFunction.arguments === "string" ? toolFunction.arguments : "{}",
      );
      return {
        id: "id" in toolCall && typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : `tool-call-${index + 1}`,
        name: toolFunction.name,
        arguments: parsedArguments.arguments,
        ...(parsedArguments.parseError ? { parseError: parsedArguments.parseError } : {}),
      };
    })
    .filter((toolCall): toolCall is ModelToolCall => Boolean(toolCall));
}

export function extractDsmlToolCallsFromContent(content: string): { content: string; toolCalls: ModelToolCall[] } {
  const toolCalls: ModelToolCall[] = [];
  let cleanedContent = "";
  let cursor = 0;
  let toolCallIndex = 0;
  const toolCallBlockPattern = /<\s*[|｜]\s*tool_calls\s*[|｜]\s*>([\s\S]*?)<\s*\/\s*[|｜]\s*tool_calls\s*[|｜]\s*>/gi;

  for (const blockMatch of content.matchAll(toolCallBlockPattern)) {
    const fullMatch = blockMatch[0];
    const blockContent = blockMatch[1] ?? "";
    const matchIndex = blockMatch.index ?? 0;
    cleanedContent += content.slice(cursor, matchIndex);
    cursor = matchIndex + fullMatch.length;

    const invokePattern = /<\s*[|｜]\s*invoke\s+name\s*=\s*["']([^"']+)["']\s*[|｜]\s*>([\s\S]*?)<\s*\/\s*[|｜]\s*invoke\s*[|｜]\s*>/gi;
    let cleanedBlockContent = "";
    let blockCursor = 0;
    for (const invokeMatch of blockContent.matchAll(invokePattern)) {
      const name = invokeMatch[1]?.trim();
      if (!name) {
        continue;
      }

      const invokeIndex = invokeMatch.index ?? 0;
      cleanedBlockContent += blockContent.slice(blockCursor, invokeIndex);
      blockCursor = invokeIndex + invokeMatch[0].length;
      toolCallIndex += 1;
      const parsedArguments = parseToolArguments((invokeMatch[2] ?? "").trim());
      toolCalls.push({
        id: `dsml-tool-call-${toolCallIndex}`,
        name,
        arguments: parsedArguments.arguments,
        ...(parsedArguments.parseError ? { parseError: parsedArguments.parseError } : {}),
      });
    }
    cleanedBlockContent += blockContent.slice(blockCursor);
    if (looksLikeDsmlToolCallContent(cleanedBlockContent)) {
      const incompleteToolCall = extractIncompleteDsmlToolCall(cleanedBlockContent, toolCallIndex + 1);
      if (incompleteToolCall) {
        toolCallIndex += 1;
        toolCalls.push(incompleteToolCall);
      }
    }
  }

  cleanedContent += content.slice(cursor);
  if (looksLikeDsmlToolCallContent(cleanedContent)) {
    const incompleteToolCall = extractIncompleteDsmlToolCall(cleanedContent, toolCallIndex + 1);
    if (incompleteToolCall) {
      toolCalls.push(incompleteToolCall);
      return {
        content: removeDsmlToolCallRemainder(cleanedContent).trim(),
        toolCalls,
      };
    }
  }

  return {
    content: toolCalls.length ? cleanedContent.trim() : content,
    toolCalls,
  };
}

export function extractAnthropicToolCalls(content: unknown[]): ModelToolCall[] {
  return content
    .map((item, index) => {
      if (
        !item ||
        typeof item !== "object" ||
        !("type" in item) ||
        item.type !== "tool_use" ||
        !("name" in item) ||
        typeof item.name !== "string"
      ) {
        return undefined;
      }

      const parsedArguments = parseToolArguments("input" in item ? item.input : {});
      return {
        id: "id" in item && typeof item.id === "string" && item.id.trim() ? item.id : `tool-use-${index + 1}`,
        name: item.name,
        arguments: parsedArguments.arguments,
        ...(parsedArguments.parseError ? { parseError: parsedArguments.parseError } : {}),
      };
    })
    .filter((toolCall): toolCall is ModelToolCall => Boolean(toolCall));
}

export function parseToolArguments(value: unknown): { arguments: Record<string, unknown>; parseError?: string } {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = value.trim() ? JSON.parse(value) : {};
    } catch {
      return { arguments: {}, parseError: "工具参数不是合法 JSON" };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { arguments: {}, parseError: "工具参数必须是对象" };
  }

  return { arguments: parsed as Record<string, unknown> };
}

function looksLikeDsmlToolCallContent(content: string): boolean {
  return /<\s*[|｜]\s*tool_calls\s*[|｜]\s*>/i.test(content) || /<\s*[|｜]\s*invoke\s+name\s*=/i.test(content);
}

function extractIncompleteDsmlToolCall(content: string, index = 1): ModelToolCall | undefined {
  const invokeMatch = content.match(/<\s*[|｜]\s*invoke\s+name\s*=\s*["']([^"']+)["']\s*[|｜]\s*>/i);
  const name = invokeMatch?.[1]?.trim();
  if (!name) {
    return undefined;
  }

  return {
    id: `dsml-tool-call-${index}`,
    name,
    arguments: {},
    parseError: "工具调用格式不完整",
  };
}

function removeDsmlToolCallRemainder(content: string): string {
  const markerMatch = content.match(/<\s*[|｜]\s*tool_calls\s*[|｜]\s*>|<\s*[|｜]\s*invoke\s+name\s*=\s*["'][^"']+["']\s*[|｜]\s*>/i);
  if (!markerMatch || markerMatch.index === undefined) {
    return content;
  }

  return content.slice(0, markerMatch.index);
}
