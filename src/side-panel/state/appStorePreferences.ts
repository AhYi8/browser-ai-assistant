import { DEFAULT_MODEL_REQUEST_RETRY_COUNT, normalizeModelRequestRetryCount } from "../../shared/models/modelRequestRetry";
import { getRegisteredModelTools, isToolRuntimeAvailable, normalizeEnabledToolIds } from "../../shared/models/toolRegistry";
import type { BrowserAutomationMode } from "../../shared/toolAuthorization";
import type {
  ChatPreferenceValues,
  ChatSessionPreferenceOverrides,
  FollowUpBehavior,
  PageContextExtractMode,
  SendShortcut,
} from "../../shared/types";

export function createDefaultChatPreferences(): ChatPreferenceValues {
  return {
    systemPrompt: "你是网页助手",
    aiRequestRetryCount: DEFAULT_MODEL_REQUEST_RETRY_COUNT,
    browserAutomationMaxToolIterations: 32,
    defaultBrowserAutomationMode: "normal_restricted",
    toolCallingEnabled: true,
    enabledToolIds: getRegisteredModelTools().map((tool) => tool.id),
    toolCallDisplayMode: "assistant_grouped",
    showToolCallProcessInAssistantMode: false,
    temperature: 0.7,
    maxTokens: 1024,
    topK: undefined,
    sendShortcut: "enter",
    followUpBehavior: "queue",
    historyDrawerDefaultOpen: true,
    injectPageContextByDefault: true,
    extractHtmlByDefault: false,
  };
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferenceValues = createDefaultChatPreferences();

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
  const defaults = createDefaultChatPreferences();
  const hasEnabledToolIds = Array.isArray(value?.enabledToolIds);
  return {
    systemPrompt:
      typeof value?.systemPrompt === "string" && value.systemPrompt.trim()
        ? value.systemPrompt.trim()
        : defaults.systemPrompt,
    aiRequestRetryCount: normalizeModelRequestRetryCount(value?.aiRequestRetryCount, defaults.aiRequestRetryCount),
    browserAutomationMaxToolIterations: normalizeIntegerWithoutRange(
      value?.browserAutomationMaxToolIterations,
      defaults.browserAutomationMaxToolIterations,
    ),
    defaultBrowserAutomationMode: normalizeBrowserAutomationMode(value?.defaultBrowserAutomationMode),
    toolCallingEnabled: normalizeBoolean(value?.toolCallingEnabled, defaults.toolCallingEnabled),
    enabledToolIds: hasEnabledToolIds ? normalizeUserEditableToolIds(value?.enabledToolIds) : defaults.enabledToolIds,
    toolCallDisplayMode: normalizeToolCallDisplayMode(value?.toolCallDisplayMode),
    showToolCallProcessInAssistantMode: normalizeBoolean(
      value?.showToolCallProcessInAssistantMode,
      defaults.showToolCallProcessInAssistantMode,
    ),
    temperature: normalizeNumber(value?.temperature, defaults.temperature, 0, 2),
    maxTokens: Math.round(normalizeNumber(value?.maxTokens, defaults.maxTokens, 1, 200_000)),
    topK: normalizeOptionalInteger(value?.topK, 1, 1_000),
    sendShortcut: normalizeSendShortcut(value?.sendShortcut),
    followUpBehavior: normalizeFollowUpBehavior(value?.followUpBehavior),
    historyDrawerDefaultOpen: normalizeBoolean(value?.historyDrawerDefaultOpen, defaults.historyDrawerDefaultOpen),
    injectPageContextByDefault: normalizeBoolean(value?.injectPageContextByDefault, defaults.injectPageContextByDefault),
    extractHtmlByDefault: normalizeBoolean(value?.extractHtmlByDefault, defaults.extractHtmlByDefault),
  };
}

export function resolveDefaultContextMode(preferences: ChatPreferenceValues): PageContextExtractMode {
  return preferences.extractHtmlByDefault ? "all" : "text";
}

function normalizeSendShortcut(value: unknown): SendShortcut {
  return isSendShortcutValue(value) ? value : "enter";
}

function normalizeFollowUpBehavior(value: unknown): FollowUpBehavior {
  return value === "guide" ? "guide" : "queue";
}

function normalizeToolCallDisplayMode(value: unknown): ChatPreferenceValues["toolCallDisplayMode"] {
  return value === "compact" || value === "assistant_grouped" ? value : "assistant_grouped";
}

export function normalizeBrowserAutomationMode(value: unknown): BrowserAutomationMode {
  return value === "controlled_enhanced" || value === "full_access" ? value : "normal_restricted";
}

function isSendShortcutValue(value: unknown): value is SendShortcut {
  return typeof value === "string" && ["enter", "shift_enter", "ctrl_enter", "alt_enter"].includes(value);
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
  if (Array.isArray(value?.enabledToolIds)) {
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
  return normalizeEnabledToolIds(value);
}

export function resolveRuntimeEnabledToolIds(enabledToolIds: string[], browserControlEnabled: boolean, browserAutomationMode: BrowserAutomationMode = "normal_restricted"): string[] {
  const registeredToolsById = new Map(getRegisteredModelTools().map((tool) => [tool.id, tool]));
  return enabledToolIds.filter((toolId) => {
    const tool = registeredToolsById.get(toolId);
    return !tool || isToolRuntimeAvailable(tool, browserControlEnabled, browserAutomationMode);
  });
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
