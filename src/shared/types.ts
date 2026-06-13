export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
export type SendShortcut = "enter" | "shift_enter" | "ctrl_enter" | "ctrl_shift_enter" | "alt_enter";
export type NetworkRequestTypeFilter = "all" | "fetch_xhr" | "doc" | "css" | "js" | "font" | "img" | "media" | "manifest" | "ws" | "wasm" | "other";
export type WebSearchProviderType = "tavily";
export type WebSearchApiKeyStrategy = "round_robin" | "random";
export type TavilyIncludeAnswer = boolean | "basic" | "advanced";
export type TavilyIncludeRawContent = boolean | "markdown" | "text";

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
  networkRelevancePrompt: string;
  networkRelevanceBatchSize: number;
  networkRequestTypeFilters: NetworkRequestTypeFilter[];
  aiRequestRetryCount: number;
  browserAutomationMaxToolIterations: number;
  toolCallingEnabled: boolean;
  enabledToolIds: string[];
  temperature: number;
  maxTokens: number;
  topK?: number;
  sendShortcut: SendShortcut;
  historyDrawerDefaultOpen: boolean;
  injectPageContextByDefault: boolean;
  extractHtmlByDefault: boolean;
}

export interface ChatSessionPreferenceOverrides {
  systemPrompt?: string;
  networkRelevanceBatchSize?: number;
  networkRequestTypeFilters?: NetworkRequestTypeFilter[];
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
  requests: NetworkRequestDetail[];
}

export interface ChatGenericToolAttachment extends ChatToolAttachmentBase {
  kind: string;
  details?: string;
}

export type ChatToolAttachment = ChatWebSearchToolAttachment | ChatNetworkToolAttachment | ChatGenericToolAttachment;

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
