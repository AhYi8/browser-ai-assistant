export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
export type SendShortcut = "enter" | "shift_enter" | "ctrl_enter" | "ctrl_shift_enter" | "alt_enter";
export type AutomationActionType = "click" | "input" | "scroll" | "wait" | "navigate" | "extractHtml" | "runSandboxExtraction" | "none";
export type AutomationFlowRunStatus = "idle" | "success" | "error";
export type AutomationSessionPhase = "idle" | "battle" | "confirming" | "executing" | "completed" | "error";

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
  temperature: number;
  maxTokens: number;
  topK?: number;
  sendShortcut: SendShortcut;
  historyDrawerDefaultOpen: boolean;
}

export interface ChatSessionPreferenceOverrides {
  systemPrompt?: string;
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

export interface AutomationAction {
  type: AutomationActionType;
  selector?: string;
  value?: string;
  url?: string;
  code?: string;
  timeoutMs?: number;
  scrollY?: number;
}

export interface AutomationFlow {
  id: string;
  name: string;
  description: string;
  urlPattern: string;
  sopSteps: string[];
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: AutomationFlowRunStatus;
}

export interface AutomationBattleMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface AutomationSession {
  mode: "off" | "automation";
  phase: AutomationSessionPhase;
  flowId?: string;
  battleMessages: AutomationBattleMessage[];
  currentStepIndex: number;
  collectedData: unknown[];
  errorCount: number;
  statusMessage?: string;
  pendingFlow?: AutomationFlow;
}

export interface AutomationAgentResponse {
  reply_to_user: string;
  plan_ready: boolean;
  sop: string[];
  action: AutomationAction;
  actions?: AutomationAction[];
  extraction?: {
    need_extract: boolean;
    code: string;
  };
  done?: boolean;
  error_recovery_hint?: string;
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
