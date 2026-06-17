import { useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SessionList } from "./components/SessionList";
import { useAppStore } from "./state/appStore";
import {
  BROWSER_CONTROL_DETACHED_MESSAGE_TYPE,
  BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE,
  type BrowserControlRuntimeReadonlyChangedMessage,
  type BrowserControlRuntimeEvent,
} from "../shared/browserControl";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const historyPanelDefaultOpen = useAppStore((state) => state.chatPreferences.historyDrawerDefaultOpen);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(historyPanelDefaultOpen);
  const loadChannelConfig = useAppStore((state) => state.loadChannelConfig);
  const loadExtractionRules = useAppStore((state) => state.loadExtractionRules);
  const loadPromptTemplates = useAppStore((state) => state.loadPromptTemplates);
  const loadChatData = useAppStore((state) => state.loadChatData);
  const loadSyncSettings = useAppStore((state) => state.loadSyncSettings);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const browserControlEnabled = useAppStore((state) => state.browserControlEnabled);
  const runtimeReadonlyEnabled = useAppStore((state) => state.runtimeReadonlyEnabled);
  const setBrowserControlEnabled = useAppStore((state) => state.setBrowserControlEnabled);
  const setRuntimeReadonlyEnabled = useAppStore((state) => state.setRuntimeReadonlyEnabled);
  const markBrowserControlDetached = useAppStore((state) => state.markBrowserControlDetached);
  const markRuntimeReadonlyChanged = useAppStore((state) => state.markRuntimeReadonlyChanged);

  useEffect(() => {
    void Promise.all([loadChannelConfig(), loadExtractionRules(), loadPromptTemplates(), loadChatData(), loadSyncSettings()]).then(() => refreshPageContext());
  }, [loadChannelConfig, loadExtractionRules, loadPromptTemplates, loadChatData, loadSyncSettings, refreshPageContext]);

  useEffect(() => {
    setHistoryPanelOpen(historyPanelDefaultOpen);
  }, [historyPanelDefaultOpen]);

  useEffect(() => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) {
      return;
    }

    let runtimeReadonlyExpiryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearRuntimeReadonlyExpiryTimer = () => {
      if (runtimeReadonlyExpiryTimer) {
        clearTimeout(runtimeReadonlyExpiryTimer);
        runtimeReadonlyExpiryTimer = undefined;
      }
    };

    const handleRuntimeMessage = (message: unknown) => {
      if (isBrowserControlDetachedEvent(message)) {
        clearRuntimeReadonlyExpiryTimer();
        markBrowserControlDetached();
        return;
      }

      if (isRuntimeReadonlyChangedEvent(message)) {
        clearRuntimeReadonlyExpiryTimer();
        markRuntimeReadonlyChanged(message.enabled);
        if (message.enabled && typeof message.expiresAt === "number") {
          runtimeReadonlyExpiryTimer = setTimeout(() => {
            markRuntimeReadonlyChanged(false);
          }, Math.max(0, message.expiresAt - Date.now()));
        }
      }
    };

    runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      clearRuntimeReadonlyExpiryTimer();
      runtime.onMessage.removeListener?.(handleRuntimeMessage);
    };
  }, [markBrowserControlDetached, markRuntimeReadonlyChanged]);

  return (
    <main className="app-shell">
      <section className="app-header">
        <h1 className="app-title">Browser AI Assistant</h1>
        <div className="app-header-actions">
          <button
            className={
              browserControlEnabled
                ? "ui-button-secondary app-header-icon-button browser-control-global-button-active"
                : "ui-button-secondary app-header-icon-button"
            }
            type="button"
            aria-label="浏览器控制"
            aria-pressed={browserControlEnabled}
            title={`${browserControlEnabled ? "浏览器控制已开启" : "浏览器控制已关闭"}。开启后扩展会通过 Chrome 调试协议连接当前普通网页，浏览器会显示正在调试提示；关闭会立即断开调试会话。`}
            onClick={() => void setBrowserControlEnabled(!browserControlEnabled)}
          >
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
              <path d="M3 9h18M12 12v4M10 14h4" />
            </svg>
          </button>
          <button
            className={
              runtimeReadonlyEnabled
                ? "ui-button-secondary app-header-icon-button runtime-readonly-global-button-active"
                : "ui-button-secondary app-header-icon-button"
            }
            type="button"
            aria-label="运行时只读分析"
            aria-pressed={runtimeReadonlyEnabled}
            disabled={!browserControlEnabled}
            title={`${runtimeReadonlyEnabled ? "运行时只读分析已开启" : "运行时只读分析已关闭"}。开启后模型可读取当前页面公开运行时对象摘要；不会开放任意脚本、写入页面或读取 Cookie/Storage。`}
            onClick={() => void setRuntimeReadonlyEnabled(!runtimeReadonlyEnabled)}
          >
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16v12H4Z" />
              <path d="M8 10h4M8 14h8M16 10h.01" />
            </svg>
          </button>
          <button className="ui-button-secondary app-header-icon-button" type="button" aria-label="设置" title="设置" onClick={() => setShowSettings((value) => !value)}>
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
            </svg>
          </button>
        </div>
      </section>
      <section className={showSettings ? "settings-main-layout" : (historyPanelOpen ? "chat-main-layout" : "chat-main-layout chat-main-layout-history-collapsed")}>
        {showSettings ? (
          <SettingsPanel />
        ) : (
          <>
            {historyPanelOpen ? <SessionList /> : <div aria-hidden="true" className="session-list-placeholder" />}
            <ChatPanel historyPanelOpen={historyPanelOpen} onToggleHistoryPanel={() => setHistoryPanelOpen((value) => !value)} />
          </>
        )}
      </section>
    </main>
  );
}

function isBrowserControlDetachedEvent(message: unknown): message is BrowserControlRuntimeEvent {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const event = message as { type?: unknown; tabId?: unknown; reason?: unknown };
  return event.type === BROWSER_CONTROL_DETACHED_MESSAGE_TYPE &&
    (typeof event.tabId === "undefined" || typeof event.tabId === "number") &&
    (
      event.reason === "canceled_by_user" ||
      event.reason === "target_closed" ||
      event.reason === "tab_removed" ||
      event.reason === "disabled_by_user" ||
      event.reason === "unknown"
    );
}

function isRuntimeReadonlyChangedEvent(message: unknown): message is BrowserControlRuntimeReadonlyChangedMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const event = message as { type?: unknown; enabled?: unknown; tabId?: unknown; expiresAt?: unknown };
  return event.type === BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE &&
    typeof event.enabled === "boolean" &&
    (typeof event.tabId === "undefined" || typeof event.tabId === "number") &&
    (typeof event.expiresAt === "undefined" || typeof event.expiresAt === "number");
}
