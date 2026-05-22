import { useEffect, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SessionList } from "./components/SessionList";
import { useAppStore } from "./state/appStore";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const loadChannelConfig = useAppStore((state) => state.loadChannelConfig);
  const loadExtractionRules = useAppStore((state) => state.loadExtractionRules);
  const loadChatData = useAppStore((state) => state.loadChatData);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);

  useEffect(() => {
    void Promise.all([loadChannelConfig(), loadExtractionRules(), loadChatData()]).then(() => refreshPageContext());
  }, [loadChannelConfig, loadExtractionRules, loadChatData, refreshPageContext]);

  return (
    <main className="app-shell">
      <section className="app-header">
        <h1 className="app-title">Browser AI Assistant</h1>
        <button className="ui-button-secondary" type="button" onClick={() => setShowSettings((value) => !value)}>
          设置
        </button>
      </section>
      <section className={showSettings ? "settings-main-layout" : "chat-main-layout"}>
        {showSettings ? (
          <SettingsPanel />
        ) : (
          <>
            <SessionList />
            <ChatPanel />
          </>
        )}
      </section>
    </main>
  );
}
