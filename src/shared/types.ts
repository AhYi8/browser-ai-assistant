export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";

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
  systemPrompt: string;
  isTitleModel: boolean;
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
  thinking?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  folderId?: string;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
