import type { BrowserAutomationMode } from "./toolAuthorization";

export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
export type ExtractionSelectorType = "css" | "xpath";
export type SendShortcut = "enter" | "shift_enter" | "ctrl_enter" | "alt_enter";
export type FollowUpBehavior = "queue" | "guide";
export type ToolCallDisplayMode = "assistant_grouped" | "compact";
export type WebSearchProviderType = "tavily";
export type WebSearchApiKeyStrategy = "round_robin" | "random";
export type TavilyIncludeAnswer = boolean | "basic" | "advanced";
export type TavilyIncludeRawContent = boolean | "markdown" | "text";
export type AutomationPlaybookSource = "builtin" | "skill" | "user";
export type AutomationPlaybookRisk = "low" | "medium" | "high" | "critical";
export type AutomationPlaybookConfidence = "low" | "medium" | "high";

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  disabledReason?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  endpointUrl: string;
  enabled: boolean;
  tools: McpDiscoveredTool[];
  lastRefreshError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface McpSettings {
  servers: McpServerConfig[];
}

export type McpServerSecretMap = Record<string, string>;

export interface McpToolRuntimeMetadata {
  serverId: string;
  toolName: string;
}

export interface AutomationPlaybookSelection {
  playbookId: string;
  title: string;
  source: AutomationPlaybookSource;
  confidence: AutomationPlaybookConfidence;
  reason: string;
}

export interface AutomationPlaybookSettings {
  disabledPlaybookIds: string[];
}

export interface ModelProvider {
  id: string;
  name: string;
  endpointType: EndpointType;
  endpointUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderModel {
  id: string;
  providerId: string;
  displayName: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  topK?: number;
  systemPrompt: string;
  isTitleModel: boolean;
  supportsVision?: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig extends ProviderModel {
  name: string;
  channelName: string;
  endpointType: EndpointType;
  endpointUrl: string;
  apiKey: string;
}

export interface ChatPreferenceValues {
  systemPrompt: string;
  contextCompressionPrompt: string;
  contextCompressionThresholdPercent: number;
  aiRequestRetryCount: number;
  browserAutomationMaxToolIterations: number;
  defaultBrowserAutomationMode?: BrowserAutomationMode;
  toolCallingEnabled: boolean;
  enabledToolIds: string[];
  toolCallDisplayMode: ToolCallDisplayMode;
  showToolCallProcessInAssistantMode: boolean;
  temperature: number;
  maxTokens: number;
  topK?: number;
  sendShortcut: SendShortcut;
  followUpBehavior: FollowUpBehavior;
  historyDrawerDefaultOpen: boolean;
  injectPageContextByDefault: boolean;
  extractHtmlByDefault: boolean;
}

export interface ChatSessionPreferenceOverrides {
  systemPrompt?: string;
  contextCompressionPrompt?: string;
  contextCompressionThresholdPercent?: number;
  aiRequestRetryCount?: number;
  browserAutomationMaxToolIterations?: number;
  toolCallingEnabled?: boolean;
  enabledToolIds?: string[];
  temperature?: number;
  maxTokens?: number;
  topK?: number;
}

export interface TavilyWebSearchSettings {
  apiKeysText: string;
  apiKeyStrategy: WebSearchApiKeyStrategy;
  includeAnswer: TavilyIncludeAnswer;
  includeRawContent: TavilyIncludeRawContent;
  maxResults: number;
}

export interface WebSearchSettings {
  provider: WebSearchProviderType;
  tavily: TavilyWebSearchSettings;
  updatedAt: number;
}

export interface ChatImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

export interface NetworkHeader {
  name: string;
  value: string;
}

export interface NetworkRequestMeta {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  resourceType?: string;
  startedAt?: string;
  durationMs?: number;
  requestHeaders?: NetworkHeader[];
  responseHeaders?: NetworkHeader[];
  requestBody?: string;
  failed?: boolean;
  error?: string;
}

export interface NetworkRequestDetail extends NetworkRequestMeta {
  responseBody?: string;
  responseBodyEncoding?: string;
  truncated: boolean;
  redacted: boolean;
}

export interface ChatNetworkContextAttachment {
  id: string;
  title: string;
  summary: string;
  requests: NetworkRequestDetail[];
  createdAt: number;
  redacted: boolean;
  truncated: boolean;
}

export interface ChatWebSearchResult {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score?: number;
  publishedDate?: string;
}

export interface ChatWebSearchPayload {
  provider: WebSearchProviderType;
  query: string;
  answer?: string;
  results: ChatWebSearchResult[];
  createdAt: number;
  truncated: boolean;
}

export type ChatToolCallStatus = "running" | "success" | "error";

export interface ChatToolCallRecord {
  id: string;
  toolId: string;
  name: string;
  displayName: string;
  arguments: Record<string, unknown>;
  status: ChatToolCallStatus;
  startedAt: number;
  completedAt?: number;
  resultSummary?: string;
  errorMessage?: string;
  attachmentIds?: string[];
}

export interface ChatToolAttachmentBase {
  id: string;
  kind: string;
  title: string;
  summary: string;
  sourceToolCallId?: string;
  createdAt: number;
  redacted: boolean;
  truncated: boolean;
}

export interface ChatWebSearchToolAttachment extends ChatToolAttachmentBase {
  kind: "web-search";
  provider: WebSearchProviderType;
  query: string;
  answer?: string;
  results: ChatWebSearchResult[];
}

export interface ChatNetworkToolAttachment extends ChatToolAttachmentBase {
  kind: "network";
  fullAccess?: boolean;
  requests: NetworkRequestDetail[];
}

export type JsSourceResourceSource = "network" | "same-origin-fetch";

export interface JsSourceResource {
  id: string;
  source: JsSourceResourceSource;
  url: string;
  mimeType?: string;
  size: number;
  searchable: boolean;
  fetchedAt?: number;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceMatch {
  resourceId: string;
  source: JsSourceResourceSource;
  url: string;
  term: string;
  position: number;
  line: number;
  column: number;
  snippet: string;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceContext {
  resourceId: string;
  source: JsSourceResourceSource;
  url: string;
  position: number;
  line: number;
  column: number;
  snippet: string;
  redacted: boolean;
  truncated: boolean;
}

export interface JsSourceFetchFailure {
  url: string;
  message: string;
}

export interface ChatJsSourceToolAttachment extends ChatToolAttachmentBase {
  kind: "js-source";
  query?: string[];
  resources: JsSourceResource[];
  jsMatches: JsSourceMatch[];
  contexts: JsSourceContext[];
  failedFetches: JsSourceFetchFailure[];
}

export type SourceMapCandidateSource = "response-header" | "x-source-map-header" | "source-mapping-url" | "inline";
export type SourceMapCandidateStatus = "available" | "fetchable" | "blocked" | "failed";

export interface SourceMapCandidate {
  resourceId: string;
  resourceUrl: string;
  source: SourceMapCandidateSource;
  url?: string;
  inline: boolean;
  status: SourceMapCandidateStatus;
  parsed: boolean;
  message?: string;
}

export interface SourceMapResolvedLocation {
  resourceId: string;
  resourceUrl: string;
  generatedLine: number;
  generatedColumn: number;
  source?: string;
  originalLine?: number;
  originalColumn?: number;
  name?: string;
  ignored: boolean;
  hasSourceContent: boolean;
  message?: string;
}

export interface SourceMapOriginalContext extends SourceMapResolvedLocation {
  snippet?: string;
  redacted: boolean;
  truncated: boolean;
}

export interface ChatSourceMapToolAttachment extends ChatToolAttachmentBase {
  kind: "source-map";
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  originalContexts: SourceMapOriginalContext[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
}

export interface ChatBrowserScreenshotToolAttachment extends ChatToolAttachmentBase {
  kind: "browser-screenshot";
  mediaType: "image/png";
  dataUrl: string;
  target: "viewport" | "element";
  uid?: string;
  byteSize: number;
  clip?: { x: number; y: number; width: number; height: number; scale: number };
}

export interface AutomationReportStep {
  toolCallId: string;
  toolName: string;
  displayName: string;
  status: ChatToolCallStatus;
  startedAt: number;
  completedAt?: number;
  evidence: string;
  attachmentKinds: string[];
}

export type AutomationTimelineEventType = "tool_call" | "page_change" | "wait" | "user_confirmation" | "failure_recovery";

export interface AutomationTimelineEvent {
  id: string;
  type: AutomationTimelineEventType;
  at: number;
  label: string;
  detail: string;
  toolCallId?: string;
  status?: ChatToolCallStatus;
}

export interface AutomationFailureSummary {
  failedStepCount: number;
  failedTools: string[];
  recoverableActions: string[];
}

export type AutomationReportType = "general" | "page_inspection" | "form_diagnosis" | "interface_analysis";

export interface ChatAutomationReportToolAttachment extends ChatToolAttachmentBase {
  kind: "automation-report";
  reportType: AutomationReportType;
  objective: string;
  conclusion: string;
  playbook?: AutomationPlaybookSelection;
  steps: AutomationReportStep[];
  timeline: AutomationTimelineEvent[];
  failureSummary?: AutomationFailureSummary;
  fullAccessIncluded: boolean;
}

export interface ChatGenericToolAttachment extends ChatToolAttachmentBase {
  kind: string;
  details?: string;
}

export type ChatToolAttachment =
  | ChatWebSearchToolAttachment
  | ChatNetworkToolAttachment
  | ChatJsSourceToolAttachment
  | ChatSourceMapToolAttachment
  | ChatBrowserScreenshotToolAttachment
  | ChatAutomationReportToolAttachment
  | ChatGenericToolAttachment;

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatPromptInvocation {
  promptId: string;
  title: string;
  contentSnapshot: string;
}

export type ChatTokenUsageSource = "chat" | "tool_decision" | "tool_final" | "title" | "context_compression";

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface ChatTokenUsageEntry extends ChatTokenUsage {
  id: string;
  usageSchemaVersion: number;
  source: ChatTokenUsageSource;
  modelId: string;
  endpointType: EndpointType;
  createdAt: number;
}

export interface ExtractionRule {
  id: string;
  alias: string;
  urlPattern: string;
  selectorsText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  assistantMessageKind?: "tool_call_turn" | "context_summary";
  content: string;
  createdAt: number;
  modelId: string;
  endpointType: EndpointType;
  streamMode: boolean;
  systemPrompt: string;
  contextPrompt: string;
  contextMode: PageContextExtractMode;
  matchedRuleId?: string;
  attachments?: ChatImageAttachment[];
  networkContextAttachment?: ChatNetworkContextAttachment;
  toolCallRecords?: ChatToolCallRecord[];
  toolAttachments?: ChatToolAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  thinking?: string;
  reasoningContent?: string;
  streaming?: boolean;
  tokenUsageEntryIds?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  titleGenerating?: boolean;
  selectedModelId?: string;
  folderId?: string;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  tokenUsageEntries?: ChatTokenUsageEntry[];
  chatPreferenceOverrides?: ChatSessionPreferenceOverrides;
}

export interface ChatFolder {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}
