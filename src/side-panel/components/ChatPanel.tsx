import { useEffect, useRef, useState } from "react";
import { ChatPreferenceDrawer } from "./ChatPreferenceDrawer";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";
import { SessionHistoryDialog } from "./SessionHistoryDialog";
import { useAppStore } from "../state/appStore";
import { downloadChatSessionMarkdown, downloadChatSessionPdf, downloadChatSessionWord } from "../utils/chatMarkdownExport";

interface ChatPanelProps {
  historyPanelOpen: boolean;
  onToggleHistoryPanel: () => void;
}

export function ChatPanel({ historyPanelOpen, onToggleHistoryPanel }: ChatPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatPreferencesOpen, setChatPreferencesOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>();
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const failure = useAppStore((state) => state.failure);
  const regenerateMessage = useAppStore((state) => state.regenerateMessage);
  const editAndRegenerateUserMessage = useAppStore((state) => state.editAndRegenerateUserMessage);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const toolCallDisplayMode = useAppStore((state) => state.chatPreferences.toolCallDisplayMode);
  const showToolCallProcessInAssistantMode = useAppStore((state) => state.chatPreferences.showToolCallProcessInAssistantMode);
  const contextMode = useAppStore((state) => state.contextMode);
  const extractionRules = useAppStore((state) => state.extractionRules);
  const storedActiveSession = useAppStore((state) => state.chatSessions.find((session) => session.id === state.activeSessionId));
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const enterPrivateMode = useAppStore((state) => state.enterPrivateMode);
  const savePrivateChatSession = useAppStore((state) => state.savePrivateChatSession);
  const activeSession = privateModeActive ? privateChatSession : storedActiveSession;
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
  const canExport = Boolean(activeSession && activeSession.messages.length > 0);
  const canShowPrivateButton = privateModeActive || !storedActiveSession || storedActiveSession.messages.length === 0;

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !exportMenuRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [exportMenuOpen]);

  const handleExport = async (format: "markdown" | "word" | "pdf") => {
    if (!activeSession || activeSession.messages.length === 0) {
      return;
    }

    setExportMenuOpen(false);
    setExportError(undefined);
    try {
      if (format === "word") {
        await downloadChatSessionWord(activeSession);
        return;
      }

      if (format === "pdf") {
        await downloadChatSessionPdf(activeSession);
        return;
      }

      downloadChatSessionMarkdown(activeSession);
    } catch (error: unknown) {
      setExportError(error instanceof Error ? error.message : "导出失败，请重试");
    }
  };

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
          <div className="chat-export-menu-wrap" ref={exportMenuRef}>
            <button
              className="ui-button-secondary chat-export-trigger"
              type="button"
              aria-label="导出当前聊天"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              disabled={!canExport}
              onClick={() => setExportMenuOpen((value) => !value)}
            >
              导出
            </button>
            {exportMenuOpen ? (
              <div className="chat-export-menu" role="menu">
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("markdown")}>
                  Markdown
                </button>
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("word")}>
                  Word
                </button>
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("pdf")}>
                  PDF
                </button>
              </div>
            ) : null}
          </div>
          {canShowPrivateButton ? (
            <button
              className={privateModeActive ? "ui-button-secondary chat-private-trigger chat-private-trigger-active" : "ui-button-secondary chat-private-trigger"}
              type="button"
              aria-label={privateModeActive ? "保存隐私对话" : "进入隐私模式"}
              onClick={() => void (privateModeActive ? savePrivateChatSession() : enterPrivateMode())}
            >
              {privateModeActive ? "保存" : "隐私"}
            </button>
          ) : null}
        </div>
      </div>
      <MessageList
        messages={activeSession?.messages ?? []}
        toolCallDisplayMode={toolCallDisplayMode}
        showToolCallProcessInAssistantMode={showToolCallProcessInAssistantMode}
        onRegenerateMessage={(messageId) => void regenerateMessage(messageId)}
        onEditAndRegenerateUserMessage={(messageId, content) => void editAndRegenerateUserMessage(messageId, content)}
        regenerating={sending}
      />
      {providers.length === 0 || models.length === 0 ? <p className="chat-warning">请先配置 API Key 后再开始对话</p> : null}
      {failure ? (
        <div className="chat-failure" role="alert">
          <p>{failure.message}</p>
        </div>
      ) : null}
      {exportError ? (
        <div className="chat-failure" role="status">
          <p>{exportError}</p>
          <button className="ui-button-secondary" type="button" aria-label="关闭导出错误提示" onClick={() => setExportError(undefined)}>
            关闭
          </button>
        </div>
      ) : null}
      <ChatComposer canSend={canSend} matchedRuleLabel={matchedRuleLabel} />
      <SessionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <ChatPreferenceDrawer open={chatPreferencesOpen} onOpenChange={setChatPreferencesOpen} />
    </section>
  );
}
