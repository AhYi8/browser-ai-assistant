import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../state/appStore";
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
  const systemPromptInput = useComposedTextInput(overrides.systemPrompt ?? "", (systemPrompt) => {
    void updateActiveSessionChatPreferences({ systemPrompt });
  });
  const contextCompressionPromptInput = useComposedTextInput(overrides.contextCompressionPrompt ?? "", (contextCompressionPrompt) => {
    void updateActiveSessionChatPreferences({ contextCompressionPrompt });
  });

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
            <label className="grid gap-1 text-sm">
              上下文压缩 Prompt
              <textarea
                className="ui-input min-h-28"
                aria-label="当前聊天上下文压缩 Prompt"
                placeholder={chatPreferences.contextCompressionPrompt}
                {...contextCompressionPromptInput}
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
                label="最大聊天上下文（token）"
                value={overrides.maxTokens}
                placeholder={chatPreferences.maxTokens}
                min={1}
                max={1_000_000}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ maxTokens: value })}
              />
              <PreferenceNumberInput
                label="自动压缩阈值（%）"
                value={overrides.contextCompressionThresholdPercent}
                placeholder={chatPreferences.contextCompressionThresholdPercent}
                min={1}
                max={100}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ contextCompressionThresholdPercent: value })}
              />
              <PreferenceNumberInput
                label="Network/JS 详情池保留上限"
                value={overrides.toolDetailPoolKeepLimit}
                placeholder={chatPreferences.toolDetailPoolKeepLimit}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ toolDetailPoolKeepLimit: value })}
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
                label="AI 请求失败重试次数"
                value={overrides.aiRequestRetryCount}
                placeholder={chatPreferences.aiRequestRetryCount}
                min={0}
                max={20}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ aiRequestRetryCount: value })}
              />
              <PreferenceNumberInput
                label="最大工具决策轮次"
                value={overrides.browserAutomationMaxToolIterations}
                placeholder={chatPreferences.browserAutomationMaxToolIterations}
                step={1}
                onChange={(value) => void updateActiveSessionChatPreferences({ browserAutomationMaxToolIterations: value })}
              />
            </div>
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
  min?: number;
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
