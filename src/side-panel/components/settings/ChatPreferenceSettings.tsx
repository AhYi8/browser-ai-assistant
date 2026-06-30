import { useState } from "react";
import {
  MODEL_TOOL_CAPABILITY_VALUES,
  MODEL_TOOL_RISK_VALUES,
  MODEL_TOOL_RUNTIME_VALUES,
  filterModelToolsByClassification,
  getModelToolGroups,
  getRegisteredModelTools,
} from "../../../shared/models/toolRegistry";
import type { ModelToolCapability, ModelToolRisk, ModelToolRuntimeRequirement } from "../../../shared/models/types";
import type { BrowserAutomationMode } from "../../../shared/toolAuthorization";
import type { ChatPreferenceValues, SendShortcut } from "../../../shared/types";
import { useAppStore } from "../../state/appStore";
import { useComposedTextInput } from "../useComposedTextInput";
import { GlobalPreferenceNumberInput } from "./GlobalPreferenceNumberInput";

const sendShortcutOptions: Array<{ value: SendShortcut; label: string }> = [
  { value: "enter", label: "Enter" },
  { value: "shift_enter", label: "Shift+Enter" },
  { value: "ctrl_enter", label: "Ctrl+Enter" },
  { value: "ctrl_shift_enter", label: "Ctrl+Shift+Enter" },
  { value: "alt_enter", label: "Alt+Enter" },
];

const browserAutomationModeOptions: Array<{ value: BrowserAutomationMode; label: string }> = [
  { value: "normal_restricted", label: "普通模式" },
  { value: "controlled_enhanced", label: "受控增强" },
  { value: "full_access", label: "完全访问" },
];

const toolRuntimeLabels: Record<ModelToolRuntimeRequirement, string> = {
  local: "本地工具",
  external_web: "公开网页搜索",
  browser_control: "浏览器控制",
  controlled_enhanced: "受控增强",
  full_access: "完全访问",
};

const toolCapabilityLabels: Record<ModelToolCapability, string> = {
  observe_page: "观察页面",
  operate_page: "操作页面",
  analyze_site: "分析现场",
  confirm_boundary: "请求确认",
  deliver_result: "交付结果",
  search_public_web: "公开搜索",
  system_context: "系统上下文",
};

const toolRiskLabels: Record<ModelToolRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "最高风险",
};

export function ChatPreferenceSettings() {
  const [runtimeFilter, setRuntimeFilter] = useState<ModelToolRuntimeRequirement | "">("");
  const [capabilityFilter, setCapabilityFilter] = useState<ModelToolCapability | "">("");
  const [riskFilter, setRiskFilter] = useState<ModelToolRisk | "">("");
  const chatPreferences = useAppStore((state) => state.chatPreferences);
  const updateChatPreferences = useAppStore((state) => state.updateChatPreferences);
  const registeredTools = getRegisteredModelTools();
  const filteredTools = filterModelToolsByClassification(registeredTools, {
    ...(runtimeFilter ? { runtime: runtimeFilter } : {}),
    ...(capabilityFilter ? { capability: capabilityFilter } : {}),
    ...(riskFilter ? { risk: riskFilter } : {}),
  });
  const registeredToolGroups = getModelToolGroups(filteredTools);
  const systemPromptInput = useComposedTextInput(chatPreferences.systemPrompt, (systemPrompt) => {
    void updateChatPreferences({ systemPrompt });
  });
  const handleToolToggle = (toolId: string, checked: boolean) => {
    const nextToolIds = checked ? [...chatPreferences.enabledToolIds, toolId] : chatPreferences.enabledToolIds.filter((id) => id !== toolId);
    void updateChatPreferences({ enabledToolIds: Array.from(new Set(nextToolIds)) });
  };
  const filteredToolIds = filteredTools.map((tool) => tool.id);
  const handleEnableFilteredTools = () => {
    void updateChatPreferences({
      enabledToolIds: Array.from(new Set([...chatPreferences.enabledToolIds, ...filteredToolIds])),
    });
  };
  const handleDisableFilteredTools = () => {
    const filteredIds = new Set(filteredTools.map((tool) => tool.id));
    void updateChatPreferences({ enabledToolIds: chatPreferences.enabledToolIds.filter((toolId) => !filteredIds.has(toolId)) });
  };

  return (
    <section className="grid w-full gap-3" aria-label="聊天偏好">
      <h3 className="text-base font-semibold">聊天偏好</h3>
      <label className="grid gap-1 text-sm">
        系统提示词
        <textarea
          className="ui-input min-h-32"
          aria-label="全局系统提示词"
          {...systemPromptInput}
        />
      </label>
      <div className="chat-preference-grid">
        <GlobalPreferenceNumberInput
          label="AI 请求失败重试次数"
          value={chatPreferences.aiRequestRetryCount}
          min={0}
          max={20}
          step={1}
          onChange={(value) => void updateChatPreferences({ aiRequestRetryCount: value })}
        />
        <GlobalPreferenceNumberInput
          label="浏览器自动化最大工具轮次"
          value={chatPreferences.browserAutomationMaxToolIterations}
          step={1}
          onChange={(value) => void updateChatPreferences({ browserAutomationMaxToolIterations: value })}
        />
        <label className="chat-preference-field">
          浏览器自动化默认模式
          <select
            className="ui-input chat-preference-shortcut-select"
            aria-label="浏览器自动化默认模式"
            value={chatPreferences.defaultBrowserAutomationMode ?? "normal_restricted"}
            onChange={(event) => void updateChatPreferences({ defaultBrowserAutomationMode: event.target.value as BrowserAutomationMode })}
          >
            {browserAutomationModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <GlobalPreferenceNumberInput
          label="temperature"
          value={chatPreferences.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => void updateChatPreferences({ temperature: value })}
        />
        <GlobalPreferenceNumberInput
          label="max_token"
          value={chatPreferences.maxTokens}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ maxTokens: value })}
        />
        <GlobalPreferenceNumberInput
          label="top_k"
          value={chatPreferences.topK}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ topK: value })}
        />
      </div>
      <fieldset className="chat-preference-network-types">
        <legend className="text-sm">工具调用</legend>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={chatPreferences.toolCallingEnabled}
            onChange={(event) => void updateChatPreferences({ toolCallingEnabled: event.target.checked })}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">启用工具调用</span>
        </label>
        <p className="ui-muted text-xs">这里设置新对话默认启用的工具；实际发送时仍会根据当前会话选择、浏览器控制状态和自动化模式过滤。</p>
        <div className="chat-preference-tool-filter-grid">
          <label className="chat-preference-field">
            能力
            <select
              className="ui-input chat-preference-shortcut-select"
              aria-label="工具能力筛选"
              value={capabilityFilter}
              onChange={(event) => setCapabilityFilter(event.target.value as ModelToolCapability | "")}
            >
              <option value="">全部能力</option>
              {MODEL_TOOL_CAPABILITY_VALUES.map((capability) => (
                <option key={capability} value={capability}>{toolCapabilityLabels[capability]}</option>
              ))}
            </select>
          </label>
          <label className="chat-preference-field">
            运行要求
            <select
              className="ui-input chat-preference-shortcut-select"
              aria-label="工具运行要求筛选"
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value as ModelToolRuntimeRequirement | "")}
            >
              <option value="">全部运行要求</option>
              {MODEL_TOOL_RUNTIME_VALUES.map((runtime) => (
                <option key={runtime} value={runtime}>{toolRuntimeLabels[runtime]}</option>
              ))}
            </select>
          </label>
          <label className="chat-preference-field">
            风险
            <select
              className="ui-input chat-preference-shortcut-select"
              aria-label="工具风险筛选"
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value as ModelToolRisk | "")}
            >
              <option value="">全部风险</option>
              {MODEL_TOOL_RISK_VALUES.map((risk) => (
                <option key={risk} value={risk}>{toolRiskLabels[risk]}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="chat-preference-tool-bulk-actions">
          <button className="ui-button-secondary" type="button" onClick={handleEnableFilteredTools}>启用筛选结果</button>
          <button className="ui-button-secondary" type="button" onClick={handleDisableFilteredTools}>禁用筛选结果</button>
        </div>
        {registeredTools.length > 0 ? (
          <div className="chat-preference-tool-group-list">
            {registeredToolGroups.map((group) => (
              <div key={group.id} className="chat-preference-tool-group">
                <div className="chat-preference-tool-group-title">{group.label}</div>
                {group.tools.map((tool) => {
                  return (
                    <label key={tool.id} className="chat-preference-network-type-chip">
                      <input
                        type="checkbox"
                        aria-label={`启用工具 ${tool.name}`}
                        checked={chatPreferences.enabledToolIds.includes(tool.id)}
                        onChange={(event) => handleToolToggle(tool.id, event.target.checked)}
                      />
                      <span>{tool.name}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="ui-muted text-xs">暂无可用工具</p>
        )}
      </fieldset>
      <label className="chat-preference-field">
        工具调用展示方式
        <select
          className="ui-input chat-preference-shortcut-select"
          aria-label="工具调用展示方式"
          value={chatPreferences.toolCallDisplayMode}
          onChange={(event) => void updateChatPreferences({ toolCallDisplayMode: event.target.value as ChatPreferenceValues["toolCallDisplayMode"] })}
        >
          <option value="assistant_grouped">AI 回复与工具分组</option>
          <option value="compact">紧凑工具过程</option>
        </select>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.showToolCallProcessInAssistantMode}
          onChange={(event) => void updateChatPreferences({ showToolCallProcessInAssistantMode: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">非紧凑模式显示工具调用过程</span>
      </label>
      <label className="chat-preference-field">
        发送快捷键
        <select
          className="ui-input chat-preference-shortcut-select"
          aria-label="发送快捷键"
          value={chatPreferences.sendShortcut}
          onChange={(event) => void updateChatPreferences({ sendShortcut: event.target.value as SendShortcut })}
        >
          {sendShortcutOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.historyDrawerDefaultOpen}
          onChange={(event) => void updateChatPreferences({ historyDrawerDefaultOpen: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">默认展开左侧历史面板</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.injectPageContextByDefault}
          onChange={(event) => void updateChatPreferences({ injectPageContextByDefault: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">新对话默认注入当前页面上下文</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.extractHtmlByDefault}
          onChange={(event) => void updateChatPreferences({ extractHtmlByDefault: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">新对话默认提取 HTML 源码</span>
      </label>
    </section>
  );
}
