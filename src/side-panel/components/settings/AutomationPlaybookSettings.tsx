import { useState } from "react";
import {
  getRegisteredAutomationPlaybooks,
} from "../../../shared/automationPlaybooks";
import type { AutomationPlaybookRisk, AutomationPlaybookSource } from "../../../shared/types";
import { useAppStore } from "../../state/appStore";

const sourceLabels: Record<AutomationPlaybookSource, string> = {
  builtin: "内置策略",
  skill: "Skill 策略",
  user: "我的策略",
};

const riskLabels: Record<AutomationPlaybookRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "最高风险",
};

export function AutomationPlaybookSettings() {
  const settings = useAppStore((state) => state.automationPlaybookSettings);
  const updateAutomationPlaybookSettings = useAppStore((state) => state.updateAutomationPlaybookSettings);
  const [expandedPlaybookIds, setExpandedPlaybookIds] = useState<Set<string>>(() => new Set());
  const disabledIds = new Set(settings.disabledPlaybookIds);
  const playbooks = getRegisteredAutomationPlaybooks();

  const handleToggle = (playbookId: string, checked: boolean) => {
    const nextIds = checked
      ? settings.disabledPlaybookIds.filter((id) => id !== playbookId)
      : Array.from(new Set([...settings.disabledPlaybookIds, playbookId]));
    void updateAutomationPlaybookSettings({ disabledPlaybookIds: nextIds });
  };

  const handleToggleDetails = (playbookId: string) => {
    setExpandedPlaybookIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(playbookId)) {
        nextIds.delete(playbookId);
      } else {
        nextIds.add(playbookId);
      }
      return nextIds;
    });
  };

  return (
    <section className="grid w-full gap-3" aria-label="任务策略">
      <h3 className="text-base font-semibold">任务策略</h3>
      <div className="grid gap-2">
        <div className="ui-panel grid gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>内置策略</span>
            <span className="ui-muted text-xs">第一版仅支持启用或禁用</span>
          </div>
          <div className="grid gap-2">
            {playbooks.map((playbook) => {
              const enabled = !disabledIds.has(playbook.id);
              const detailsExpanded = expandedPlaybookIds.has(playbook.id);
              return (
                <article key={playbook.id} className="rounded border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <h4 className="text-sm font-semibold">{playbook.title}</h4>
                      <p className="ui-muted text-xs">{playbook.description}</p>
                    </div>
                    <label className="chat-preference-switch">
                      <input
                        className="chat-preference-switch-input"
                        type="checkbox"
                        aria-label={`启用任务策略 ${playbook.title}`}
                        checked={enabled}
                        onChange={(event) => handleToggle(playbook.id, event.target.checked)}
                      />
                      <span className="chat-preference-switch-control" aria-hidden="true">
                        <span className="chat-preference-switch-thumb" />
                      </span>
                      <span className="chat-preference-switch-label">{enabled ? "已启用" : "已禁用"}</span>
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded border border-slate-200 px-2 py-1">{sourceLabels[playbook.source]}</span>
                    <span className="rounded border border-slate-200 px-2 py-1">{riskLabels[playbook.risk]}</span>
                    {playbook.recommendedCapabilities.map((capability) => (
                      <span key={capability} className="rounded border border-slate-200 px-2 py-1">{capability}</span>
                    ))}
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      aria-expanded={detailsExpanded}
                      aria-label={`${detailsExpanded ? "收起" : "查看"}任务策略 ${playbook.title} 详细信息`}
                      onClick={() => handleToggleDetails(playbook.id)}
                    >
                      {detailsExpanded ? "收起" : "详细"}
                    </button>
                  </div>
                  {detailsExpanded ? (
                    <div
                      className="mt-3 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs"
                      role="region"
                      aria-label={`${playbook.title}详细信息`}
                    >
                      <dl className="grid gap-2">
                        <div className="grid gap-1">
                          <dt className="font-medium">策略 ID</dt>
                          <dd className="ui-muted break-all">{playbook.id}</dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">来源</dt>
                          <dd className="ui-muted">{sourceLabels[playbook.source]}</dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">风险</dt>
                          <dd className="ui-muted">{riskLabels[playbook.risk]}</dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">默认启用</dt>
                          <dd className="ui-muted">{playbook.defaultEnabled ? "是" : "否"}</dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">标签</dt>
                          <dd className="flex flex-wrap gap-1">
                            {playbook.tags.map((tag) => (
                              <span key={tag} className="rounded border border-slate-200 bg-white px-2 py-1">{tag}</span>
                            ))}
                          </dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">推荐能力</dt>
                          <dd className="flex flex-wrap gap-1">
                            {playbook.recommendedCapabilities.map((capability) => (
                              <span key={capability} className="rounded border border-slate-200 bg-white px-2 py-1">{capability}</span>
                            ))}
                          </dd>
                        </div>
                        <div className="grid gap-1">
                          <dt className="font-medium">适用提示</dt>
                          <dd className="flex flex-wrap gap-1">
                            {playbook.selectionHints.map((hint) => (
                              <span key={hint} className="rounded border border-slate-200 bg-white px-2 py-1">{hint}</span>
                            ))}
                          </dd>
                        </div>
                      </dl>
                      <div className="grid gap-1">
                        <h5 className="font-medium">完整策略提示</h5>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                          {playbook.prompt}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
        <div className="ui-panel grid gap-2 p-3">
          <h4 className="text-sm font-semibold">Skill 策略</h4>
          <p className="ui-muted text-xs">暂未接入。未来 Skill Playbook 会使用同一注册表与启用状态合并。</p>
        </div>
        <div className="ui-panel grid gap-2 p-3">
          <h4 className="text-sm font-semibold">我的策略</h4>
          <p className="ui-muted text-xs">暂未开放。第一版不支持编辑、克隆或删除 Playbook。</p>
        </div>
      </div>
    </section>
  );
}
