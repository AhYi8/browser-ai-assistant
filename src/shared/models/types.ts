import type { ChatMessage } from "../types";

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
}

export type ModelToolChoice = "auto" | "none" | { type: "tool"; name: string };

export interface ModelToolOptions {
  tools?: ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
}

export interface ModelAssistantToolMessage {
  role: "assistant";
  content: string;
  toolCalls: ModelToolCall[];
}

export interface ModelToolResultMessage extends ModelToolResult {
  role: "tool";
}

export type ModelRequestMessage = ChatMessage | ModelAssistantToolMessage | ModelToolResultMessage;

export type ModelToolExecutor = (call: ModelToolCall, tool: ModelToolRegistryEntry) => Promise<ModelToolResult>;

export interface ModelResponseData {
  content: string;
  thinking?: string;
  toolCalls?: ModelToolCall[];
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
