import { DEFAULT_MODEL_REQUEST_RETRY_COUNT, normalizeModelRequestRetryCount } from "../../shared/models/modelRequestRetry";
import { getRegisteredModelTools, isBrowserAutomationToolId, isRuntimeReadonlyToolId, normalizeEnabledToolIds } from "../../shared/models/toolRegistry";
import type {
  ChatPreferenceValues,
  ChatSessionPreferenceOverrides,
  PageContextExtractMode,
  SendShortcut,
} from "../../shared/types";

export const DEFAULT_CHAT_PREFERENCES: ChatPreferenceValues = {
  systemPrompt: "你是网页助手",
  aiRequestRetryCount: DEFAULT_MODEL_REQUEST_RETRY_COUNT,
  browserAutomationMaxToolIterations: 32,
  toolCallingEnabled: false,
  enabledToolIds: [],
  toolCallDisplayMode: "assistant_grouped",
  showToolCallProcessInAssistantMode: false,
  temperature: 0.7,
  maxTokens: 1024,
  topK: undefined,
  sendShortcut: "enter",
  historyDrawerDefaultOpen: true,
  injectPageContextByDefault: true,
  extractHtmlByDefault: false,
};

export type EffectiveChatPreferences = Required<
  Pick<
    ChatSessionPreferenceOverrides,
    | "systemPrompt"
    | "aiRequestRetryCount"
    | "browserAutomationMaxToolIterations"
    | "toolCallingEnabled"
    | "enabledToolIds"
    | "temperature"
    | "maxTokens"
  >
> &
  Pick<ChatSessionPreferenceOverrides, "topK">;

export function normalizeChatPreferences(value?: Partial<ChatPreferenceValues>): ChatPreferenceValues {
  return {
    systemPrompt:
      typeof value?.systemPrompt === "string" && value.systemPrompt.trim()
        ? value.systemPrompt.trim()
        : DEFAULT_CHAT_PREFERENCES.systemPrompt,
    aiRequestRetryCount: normalizeModelRequestRetryCount(value?.aiRequestRetryCount, DEFAULT_CHAT_PREFERENCES.aiRequestRetryCount),
    browserAutomationMaxToolIterations: normalizeIntegerWithoutRange(
      value?.browserAutomationMaxToolIterations,
      DEFAULT_CHAT_PREFERENCES.browserAutomationMaxToolIterations,
    ),
    toolCallingEnabled: normalizeBoolean(value?.toolCallingEnabled, DEFAULT_CHAT_PREFERENCES.toolCallingEnabled),
    enabledToolIds: normalizeUserEditableToolIds(value?.enabledToolIds),
    toolCallDisplayMode: normalizeToolCallDisplayMode(value?.toolCallDisplayMode),
    showToolCallProcessInAssistantMode: normalizeBoolean(
      value?.showToolCallProcessInAssistantMode,
      DEFAULT_CHAT_PREFERENCES.showToolCallProcessInAssistantMode,
    ),
    temperature: normalizeNumber(value?.temperature, DEFAULT_CHAT_PREFERENCES.temperature, 0, 2),
    maxTokens: Math.round(normalizeNumber(value?.maxTokens, DEFAULT_CHAT_PREFERENCES.maxTokens, 1, 200_000)),
    topK: normalizeOptionalInteger(value?.topK, 1, 1_000),
    sendShortcut: normalizeSendShortcut(value?.sendShortcut),
    historyDrawerDefaultOpen: normalizeBoolean(value?.historyDrawerDefaultOpen, DEFAULT_CHAT_PREFERENCES.historyDrawerDefaultOpen),
    injectPageContextByDefault: normalizeBoolean(value?.injectPageContextByDefault, DEFAULT_CHAT_PREFERENCES.injectPageContextByDefault),
    extractHtmlByDefault: normalizeBoolean(value?.extractHtmlByDefault, DEFAULT_CHAT_PREFERENCES.extractHtmlByDefault),
  };
}

export function resolveDefaultContextMode(preferences: ChatPreferenceValues): PageContextExtractMode {
  return preferences.extractHtmlByDefault ? "all" : "text";
}

function normalizeSendShortcut(value: unknown): SendShortcut {
  return isSendShortcutValue(value) ? value : DEFAULT_CHAT_PREFERENCES.sendShortcut;
}

function normalizeToolCallDisplayMode(value: unknown): ChatPreferenceValues["toolCallDisplayMode"] {
  return value === "compact" || value === "assistant_grouped" ? value : DEFAULT_CHAT_PREFERENCES.toolCallDisplayMode;
}

function isSendShortcutValue(value: unknown): value is SendShortcut {
  return typeof value === "string" && ["enter", "shift_enter", "ctrl_enter", "ctrl_shift_enter", "alt_enter"].includes(value);
}

export function normalizeChatPreferenceOverrides(value?: ChatSessionPreferenceOverrides): ChatSessionPreferenceOverrides {
  const overrides: ChatSessionPreferenceOverrides = {};

  if (typeof value?.systemPrompt === "string" && value.systemPrompt.trim()) {
    overrides.systemPrompt = value.systemPrompt.trim();
  }
  if (value?.aiRequestRetryCount !== undefined) {
    overrides.aiRequestRetryCount = normalizeModelRequestRetryCount(value.aiRequestRetryCount, DEFAULT_CHAT_PREFERENCES.aiRequestRetryCount);
  }
  if (value?.browserAutomationMaxToolIterations !== undefined) {
    overrides.browserAutomationMaxToolIterations = normalizeIntegerWithoutRange(
      value.browserAutomationMaxToolIterations,
      DEFAULT_CHAT_PREFERENCES.browserAutomationMaxToolIterations,
    );
  }
  if (value?.toolCallingEnabled !== undefined) {
    overrides.toolCallingEnabled = normalizeBoolean(value.toolCallingEnabled, DEFAULT_CHAT_PREFERENCES.toolCallingEnabled);
  }
  if (value?.enabledToolIds !== undefined) {
    overrides.enabledToolIds = normalizeUserEditableToolIds(value.enabledToolIds);
  }
  if (value?.temperature !== undefined) {
    overrides.temperature = normalizeNumber(value.temperature, DEFAULT_CHAT_PREFERENCES.temperature, 0, 2);
  }
  if (value?.maxTokens !== undefined) {
    overrides.maxTokens = Math.round(normalizeNumber(value.maxTokens, DEFAULT_CHAT_PREFERENCES.maxTokens, 1, 200_000));
  }
  if (value?.topK !== undefined) {
    overrides.topK = normalizeOptionalInteger(value.topK, 1, 1_000);
  }

  return overrides;
}

export function resolveEffectiveChatPreferences(
  preferences: ChatPreferenceValues,
  overrides?: ChatSessionPreferenceOverrides,
): EffectiveChatPreferences {
  const normalizedOverrides = normalizeChatPreferenceOverrides({
    systemPrompt: overrides?.systemPrompt ?? preferences.systemPrompt,
    aiRequestRetryCount: overrides?.aiRequestRetryCount ?? preferences.aiRequestRetryCount,
    browserAutomationMaxToolIterations: overrides?.browserAutomationMaxToolIterations ?? preferences.browserAutomationMaxToolIterations,
    toolCallingEnabled: overrides?.toolCallingEnabled ?? preferences.toolCallingEnabled,
    enabledToolIds: overrides?.enabledToolIds ?? preferences.enabledToolIds,
    temperature: overrides?.temperature ?? preferences.temperature,
    maxTokens: overrides?.maxTokens ?? preferences.maxTokens,
    topK: overrides?.topK ?? preferences.topK,
  });

  return {
    systemPrompt: normalizedOverrides.systemPrompt ?? preferences.systemPrompt,
    aiRequestRetryCount: normalizedOverrides.aiRequestRetryCount ?? preferences.aiRequestRetryCount,
    browserAutomationMaxToolIterations: normalizedOverrides.browserAutomationMaxToolIterations ?? preferences.browserAutomationMaxToolIterations,
    toolCallingEnabled: normalizedOverrides.toolCallingEnabled ?? preferences.toolCallingEnabled,
    enabledToolIds: normalizedOverrides.enabledToolIds ?? preferences.enabledToolIds,
    temperature: normalizedOverrides.temperature ?? preferences.temperature,
    maxTokens: normalizedOverrides.maxTokens ?? preferences.maxTokens,
    topK: normalizedOverrides.topK,
  };
}

function normalizeUserEditableToolIds(value: unknown): string[] {
  return normalizeEnabledToolIds(value).filter((toolId) => !isBrowserAutomationToolId(toolId));
}

export function resolveRuntimeEnabledToolIds(enabledToolIds: string[], browserControlEnabled: boolean, runtimeReadonlyEnabled = false): string[] {
  const registeredTools = getRegisteredModelTools();
  const browserToolIds = registeredTools
    .filter((tool) => isBrowserAutomationToolId(tool.id) && (runtimeReadonlyEnabled || !isRuntimeReadonlyToolId(tool.id)))
    .map((tool) => tool.id);
  const baseIds = enabledToolIds.filter((toolId) =>
    (browserControlEnabled || !isBrowserAutomationToolId(toolId)) &&
    (runtimeReadonlyEnabled || !isRuntimeReadonlyToolId(toolId))
  );

  if (!browserControlEnabled) {
    return baseIds;
  }

  // 浏览器控制是显式调试能力，开启后需要整组自动可用，避免单个工具缺失导致自动化链路中断。
  return Array.from(new Set([...baseIds, ...browserToolIds]));
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function normalizeIntegerWithoutRange(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.round(numberValue);
}

function normalizeOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return Math.round(normalizeNumber(value, min, min, max));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
