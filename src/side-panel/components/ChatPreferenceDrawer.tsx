import * as Dialog from "@radix-ui/react-dialog";
import { NETWORK_REQUEST_TYPE_FILTER_OPTIONS } from "../../shared/networkContext";
import type { ChatSessionPreferenceOverrides } from "../../shared/types";
import { useAppStore } from "../state/appStore";
import { resolveNetworkTypeFilterSelection } from "../utils/networkTypeFilterSelection";
import { useComposedTextInput } from "./useComposedTextInput";

interface ChatPreferenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChatPreferenceDrawer({ open, onOpenChange }: ChatPreferenceDrawerProps) {
  const chatPreferences = useAppStore((state) => state.chatPreferences);
  const activeSession = useAppStore((state) => state.chatSessions.find((session) => session.id === state.activeSessionId));
  const updateActiveSessionChatPreferences = useAppStore((state) => state.updateActiveSessionChatPreferences);
  const overrides = activeSession?.chatPreferenceOverrides ?? {};
  const currentNetworkTypeFilters = overrides.networkRequestTypeFilters ?? chatPreferences.networkRequestTypeFilters;
  const systemPromptInput = useComposedTextInput(overrides.systemPrompt ?? "", (systemPrompt) => {
    void updateActiveSessionChatPreferences({ systemPrompt });
  });
  const handleNetworkTypeFilterChange = (filter: (typeof NETWORK_REQUEST_TYPE_FILTER_OPTIONS)[number]["value"], checked: boolean) => {
    const nextFilters = resolveNetworkTypeFilterSelection(currentNetworkTypeFilters, filter, checked);
    if (!nextFilters) {
      return;
    }

    void updateActiveSessionChatPreferences({ networkRequestTypeFilters: nextFilters });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="drawer-panel chat-preference-drawer">
          <div className="drawer-header">
            <Dialog.Title className="history-dialog-title">当前聊天设置</Dialog.Title>
            <Dialog.Description className="sr-only">配置当前会话的系统提示词和采样参数</Dialog.Description>
            <Dialog.Close className="ui-button-secondary drawer-icon-button" type="button" aria-label="关闭当前聊天设置">
              ×
            </Dialog.Close>
          </div>
          <div className="drawer-body">
            <label className="grid gap-1 text-sm">
              系统提示词
              <textarea
                className="ui-input min-h-28"
                aria-label="当前聊天系统提示词"
                placeholder={chatPreferences.systemPrompt}
                {...systemPromptInput}
              />
            </label>
            <div className="chat-preference-grid">
              <PreferenceNumberInput
                label="temperature"
                value={overrides.temperature}
                placeholder={chatPreferences.temperature}
                min={0}
                max={2}
                step={0.1}
                onChange={(value) => void updateActiveSessionChatPreferences({ temperature: value })}
              />
              <PreferenceNumberInput
                label="max_token"
                value={overrides.maxTokens}
                placeholder={chatPreferences.maxTokens}
                min={1}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ maxTokens: value })}
              />
              <PreferenceNumberInput
                label="top_k"
                value={overrides.topK}
                placeholder={chatPreferences.topK ?? "不发送"}
                min={1}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ topK: value })}
              />
              <PreferenceNumberInput
                label="Network 筛选每组请求数"
                value={overrides.networkRelevanceBatchSize}
                placeholder={chatPreferences.networkRelevanceBatchSize}
                min={1}
                max={10_000}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ networkRelevanceBatchSize: value })}
              />
            </div>
            <fieldset className="chat-preference-network-types">
              <legend className="text-sm">当前聊天默认采集 Network 请求类型</legend>
              <div className="chat-preference-network-type-list">
                {NETWORK_REQUEST_TYPE_FILTER_OPTIONS.map((option) => (
                  <label key={option.value} className="chat-preference-network-type-chip">
                    <input
                      type="checkbox"
                      aria-label={`当前聊天采集 ${option.label}`}
                      checked={currentNetworkTypeFilters.includes(option.value)}
                      onChange={(event) => handleNetworkTypeFilterChange(option.value, event.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              className="ui-button-secondary"
              type="button"
              onClick={() =>
                void updateActiveSessionChatPreferences({
                  networkRelevanceBatchSize: undefined,
                  networkRequestTypeFilters: undefined,
                })
              }
            >
              恢复当前聊天 Network 设置为全局默认
            </button>
            <p className="ui-muted text-xs">留空时使用全局聊天偏好；当前设置只作用于本次会话。</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PreferenceNumberInputProps {
  label: string;
  value?: number;
  placeholder: string | number;
  min: number;
  max?: number;
  step: number;
  onChange: (value: number | undefined) => void;
}

function PreferenceNumberInput({ label, value, placeholder, min, max, step, onChange }: PreferenceNumberInputProps) {
  return (
    <label className="chat-preference-field">
      {label}
      <input
        className="ui-input chat-preference-number-input"
        aria-label={`当前聊天 ${label}`}
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder={String(placeholder)}
        value={value ?? ""}
        onChange={(event) => {
          const inputValue = event.target.value.trim();
          onChange(inputValue ? Number(inputValue) : undefined);
        }}
      />
    </label>
  );
}
