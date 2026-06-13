import type { ChatMessage, ChatToolAttachment, ChatToolCallRecord } from "../types";

export interface ModelRequestPayload {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ModelToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ModelToolRegistryEntry extends ModelToolDefinition {
  id: string;
  displayName?: string;
  groupId?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  parseError?: string;
}

export interface ModelToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  toolAttachments?: ChatToolAttachment[];
}

export type ModelToolChoice = "auto" | "none" | { type: "tool"; name: string };

export interface ModelToolOptions {
  tools?: ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
}

export interface ModelSystemMessage {
  role: "system";
  content: string;
}

export interface ModelAssistantToolMessage {
  role: "assistant";
  content: string;
  toolCalls: ModelToolCall[];
  reasoningContent?: string;
}

export interface ModelToolResultMessage extends ModelToolResult {
  role: "tool";
}

export type ModelRequestMessage = ChatMessage | ModelSystemMessage | ModelAssistantToolMessage | ModelToolResultMessage;

export type ModelToolExecutor = (call: ModelToolCall, tool: ModelToolRegistryEntry) => Promise<ModelToolResult>;

export interface ModelResponseData {
  content: string;
  thinking?: string;
  reasoningContent?: string;
  toolCalls?: ModelToolCall[];
  toolCallRecords?: ChatToolCallRecord[];
  toolAttachments?: ChatToolAttachment[];
  toolTurnMessages?: ChatMessage[];
}

export interface OpenAIJsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface OpenAIToolChoiceResponseFormat {
  type: "tool";
  tool: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIStructuredOutputFormat = OpenAIJsonSchemaResponseFormat | OpenAIToolChoiceResponseFormat;

export interface ModelValidationResult {
  ok: boolean;
  message: string;
}
