import { useState } from "react";
import { ChannelManagement } from "./settings/ChannelManagement";
import { ChatPreferenceSettings } from "./settings/ChatPreferenceSettings";
import { ExtractionRules } from "./settings/ExtractionRules";
import { AutomationPlaybookSettings } from "./settings/AutomationPlaybookSettings";
import { PromptTemplateSettings } from "./settings/PromptTemplateSettings";
import { SyncSettings } from "./settings/SyncSettings";

type SettingsTab = "channels" | "rules" | "chat" | "playbooks" | "prompts" | "sync";

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "channels", label: "渠道管理" },
  { id: "rules", label: "提取规则" },
  { id: "chat", label: "聊天偏好" },
  { id: "playbooks", label: "任务策略" },
  { id: "prompts", label: "提示词" },
  { id: "sync", label: "同步设置" },
];

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("channels");

  return (
    <section className="ui-panel shadow-sm">
      <div className="mx-auto grid w-[80%] gap-4">
        <div className="min-w-0 space-y-3">
          <h2 className="text-base font-semibold">设置</h2>
          <div className="settings-tabs-scroll flex gap-2 overflow-x-auto" role="tablist" aria-label="设置分类">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                className={[
                  "shrink-0 rounded px-3 py-2 text-left text-sm transition",
                  activeTab === tab.id
                    ? "text-white"
                    : "ui-button-secondary",
                ].join(" ")}
                style={activeTab === tab.id ? { background: "var(--color-surface-dark)", color: "var(--color-on-dark)" } : undefined}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          {activeTab === "channels" ? <ChannelManagement /> : null}
          {activeTab === "rules" ? <ExtractionRules /> : null}
          {activeTab === "chat" ? <ChatPreferenceSettings /> : null}
          {activeTab === "playbooks" ? <AutomationPlaybookSettings /> : null}
          {activeTab === "prompts" ? <PromptTemplateSettings /> : null}
          {activeTab === "sync" ? <SyncSettings /> : null}
        </div>
      </div>
    </section>
  );
}
