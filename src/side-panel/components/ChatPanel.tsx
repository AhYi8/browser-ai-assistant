import { useState } from "react";
import { ChatPreferenceDrawer } from "./ChatPreferenceDrawer";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";
import { SessionHistoryDialog } from "./SessionHistoryDialog";
import { useAppStore } from "../state/appStore";

interface ChatPanelProps {
  historyPanelOpen: boolean;
  onToggleHistoryPanel: () => void;
}

export function ChatPanel({ historyPanelOpen, onToggleHistoryPanel }: ChatPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatPreferencesOpen, setChatPreferencesOpen] = useState(false);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const failure = useAppStore((state) => state.failure);
  const clearFailure = useAppStore((state) => state.clearFailure);
  const pageContext = useAppStore((state) => state.pageContext);
  const contextMode = useAppStore((state) => state.contextMode);
  const extractionRules = useAppStore((state) => state.extractionRules);
  const activeSession = useAppStore((state) => state.chatSessions.find((session) => session.id === state.activeSessionId));
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const selectedProvider = providers.find((provider) => provider.id === selectedModel?.providerId);
  const matchedRule = extractionRules.find((rule) => rule.id === pageContext.matchedRuleId);
  const canSend = Boolean(selectedModel?.enabled && selectedProvider?.enabled);
  const matchedRuleLabel = pageContext.usedFallback && pageContext.matchedRuleId
    ? "规则命中但无内容，已回退"
    : matchedRule
      ? `已匹配规则：${matchedRule.alias || matchedRule.urlPattern}`
      : contextMode === "all"
        ? "全局 HTML"
        : "全局文本";

  return (
    <section className="chat-panel">
      <div className="chat-model-row">
        <button
          className="ui-button-secondary chat-history-panel-toggle"
          type="button"
          aria-label={historyPanelOpen ? "折叠历史对话" : "展开历史对话"}
          aria-expanded={historyPanelOpen}
          data-history-panel-open={historyPanelOpen}
          onClick={onToggleHistoryPanel}
        />
        <ModelSelector />
        <div className="chat-header-actions">
          <button className="ui-button-secondary chat-history-trigger" type="button" onClick={() => setHistoryOpen(true)}>
            历史
          </button>
          <button className="ui-button-secondary chat-drawer-trigger" type="button" aria-label="打开当前聊天设置" onClick={() => setChatPreferencesOpen(true)}>
            ⚙
          </button>
        </div>
      </div>
      <MessageList messages={activeSession?.messages ?? []} />
      {providers.length === 0 || models.length === 0 ? <p className="chat-warning">请先配置 API Key 后再开始对话</p> : null}
      {failure ? (
        <div className="chat-failure">
          <p>{failure.message}</p>
          <button className="ui-button-secondary" type="button" onClick={clearFailure}>
            重试
          </button>
        </div>
      ) : null}
      <ChatComposer canSend={canSend} matchedRuleLabel={matchedRuleLabel} />
      <SessionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <ChatPreferenceDrawer open={chatPreferencesOpen} onOpenChange={setChatPreferencesOpen} />
    </section>
  );
}
