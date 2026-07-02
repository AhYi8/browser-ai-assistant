import type { ChatMessage, ChatToolAttachment, ChatToolCallRecord } from "../types";
import type { ToolRiskCapability } from "../toolAuthorization";

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

export type ModelToolRuntimeRequirement = "local" | "external_web" | "browser_control" | "controlled_enhanced" | "full_access" | "mcp_remote";

export type ModelToolCapability =
  | "observe_page"
  | "operate_page"
  | "analyze_site"
  | "confirm_boundary"
  | "deliver_result"
  | "search_public_web"
  | "system_context"
  | "call_remote_tool";

export type ModelToolRisk = "low" | "medium" | "high" | "critical";

export interface ModelToolClassification {
  runtime: ModelToolRuntimeRequirement;
  capabilities: ModelToolCapability[];
  risk: ModelToolRisk;
}

export interface ModelToolRegistryEntry extends ModelToolDefinition {
  id: string;
  displayName?: string;
  groupId?: string;
  requiredCapabilities?: ToolRiskCapability[];
  toolClassification?: ModelToolClassification;
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

export interface ModelUserMessage {
  role: "user";
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

export type ModelRequestMessage = ChatMessage | ModelSystemMessage | ModelUserMessage | ModelAssistantToolMessage | ModelToolResultMessage;

export interface ModelToolExecutionContext {
  signal?: AbortSignal;
}

export type ModelToolExecutor = (call: ModelToolCall, tool: ModelToolRegistryEntry, context?: ModelToolExecutionContext) => Promise<ModelToolResult>;

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
