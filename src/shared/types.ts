export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
export type SendShortcut = "enter" | "shift_enter" | "ctrl_enter" | "ctrl_shift_enter" | "alt_enter";
export type NetworkRequestTypeFilter = "all" | "fetch_xhr" | "doc" | "css" | "js" | "font" | "img" | "media" | "manifest" | "ws" | "wasm" | "other";

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
  temperature?: number;
  maxTokens?: number;
  topK?: number;
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
  promptInvocations?: ChatPromptInvocation[];
  thinking?: string;
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
