import { useMemo, useState } from "react";
import type { ExtractionRule, ModelProvider, ProviderModel } from "../../shared/types";
import { useAppStore } from "../state/appStore";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";

type SettingsTab = "channels" | "rules" | "sync" | "appearance";

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "channels", label: "渠道管理" },
  { id: "rules", label: "提取规则" },
  { id: "sync", label: "同步设置" },
  { id: "appearance", label: "界面偏好" },
];

const draftProvider: ModelProvider = {
  id: "draft-provider",
  name: "默认渠道",
  endpointType: "openai_chat",
  endpointUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const draftModel: ProviderModel = {
  id: "draft-model",
  providerId: draftProvider.id,
  displayName: "默认模型",
  modelId: "gpt-4.1-mini",
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: "你是网页助手",
  isTitleModel: false,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

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
          {activeTab === "sync" ? <SyncSettings /> : null}
          {activeTab === "appearance" ? <AppearanceSettings /> : null}
        </div>
      </div>
    </section>
  );
}

function ChannelManagement() {
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const addProvider = useAppStore((state) => state.addProvider);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const addModel = useAppStore((state) => state.addModel);
  const addRemoteModel = useAppStore((state) => state.addRemoteModel);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const deleteModel = useAppStore((state) => state.deleteModel);
  const fetchRemoteModels = useAppStore((state) => state.fetchRemoteModels);
  const testModel = useAppStore((state) => state.testModel);
  const setTitleModel = useAppStore((state) => state.setTitleModel);
  const defaultChatModelId = useAppStore((state) => state.defaultChatModelId);
  const setDefaultChatModel = useAppStore((state) => state.setDefaultChatModel);
  const remoteModelsByProvider = useAppStore((state) => state.remoteModels);
  const channelOperations = useAppStore((state) => state.channelOperations);
  const modelConnectivity = useAppStore((state) => state.modelConnectivity);
  const visibleProviders = providers.length > 0 ? providers : [draftProvider];
  const [selectedProviderId, setSelectedProviderId] = useState(visibleProviders[0].id);
  const [remoteModelQuery, setRemoteModelQuery] = useState("");
  const realSelectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedProvider = realSelectedProvider ?? providers[0] ?? draftProvider;
  const realProviderModels = useMemo(
    () => models.filter((model) => model.providerId === selectedProvider.id),
    [models, selectedProvider.id],
  );
  const providerModels = useMemo(() => {
    if (realProviderModels.length > 0) {
      return realProviderModels;
    }

    return realSelectedProvider ? [] : [draftModel];
  }, [realProviderModels, realSelectedProvider]);
  const remoteModels = remoteModelsByProvider[selectedProvider.id] ?? [];
  const channelOperation = channelOperations[selectedProvider.id];
  const existingRemoteModelIds = new Set(models.filter((model) => model.providerId === selectedProvider.id).map((model) => model.modelId));
  const selectedTitleModelId = models.find((model) => model.isTitleModel)?.id ?? "";
  const titleModelOptions = useMemo(
    () =>
      models
        .map((model) => {
          const provider = providers.find((item) => item.id === model.providerId);
          return provider
            ? {
                id: model.id,
                label: `${provider.name} / ${model.displayName}`,
              }
            : undefined;
        })
        .filter((item): item is { id: string; label: string } => Boolean(item)),
    [models, providers],
  );
  const normalizedRemoteModelQuery = remoteModelQuery.trim().toLowerCase();
  const filteredRemoteModels = remoteModels.filter((remoteModel) => {
    if (!normalizedRemoteModelQuery) {
      return true;
    }

    return (
      remoteModel.id.toLowerCase().includes(normalizedRemoteModelQuery) ||
      remoteModel.displayName.toLowerCase().includes(normalizedRemoteModelQuery)
    );
  });
  const ensureSelectedProvider = () => {
    if (realSelectedProvider) {
      return realSelectedProvider;
    }

    const provider = addProvider();
    setSelectedProviderId(provider.id);
    return provider;
  };
  const handleAddProvider = () => {
    const provider = addProvider();
    setSelectedProviderId(provider.id);
  };
  const handleAddModel = () => {
    const provider = ensureSelectedProvider();
    addModel(provider.id);
  };
  const handleFetchRemoteModels = () => {
    const provider = ensureSelectedProvider();
    void fetchRemoteModels(provider.id);
  };
  const handleDeleteProvider = () => {
    deleteProvider(selectedProvider.id);
    setSelectedProviderId(providers.find((provider) => provider.id !== selectedProvider.id)?.id ?? draftProvider.id);
  };
  const handleTestModel = (modelId: string) => {
    void testModel(selectedProvider.id, modelId);
  };

  return (
    <section className="grid w-full gap-4" aria-label="渠道管理">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">模型渠道</h3>
        <button className="ui-button-secondary" type="button" onClick={handleAddProvider}>
          新增渠道
        </button>
      </div>

      <div className="grid gap-2">
        {visibleProviders.map((provider) => (
          <button
            key={provider.id}
            className={[
              "rounded-lg border p-3 text-left transition",
              provider.id === selectedProvider.id
                ? "border-[var(--color-primary)] bg-[var(--color-surface-card)]"
                : "border-[var(--color-hairline)] bg-[var(--color-canvas)] hover:bg-[var(--color-surface-soft)]",
            ].join(" ")}
            type="button"
            onClick={() => setSelectedProviderId(provider.id)}
          >
            <span className="block text-sm font-medium">{provider.name}</span>
            <span className="ui-muted mt-1 block truncate text-xs">{provider.endpointUrl}</span>
          </button>
        ))}
      </div>

      <section className="grid gap-3 border-t border-[var(--color-hairline)] pt-4" aria-label="当前渠道详情">
        <div className="flex flex-wrap gap-2">
          <button className="ui-button-secondary" type="button" onClick={handleFetchRemoteModels} disabled={channelOperation?.loading}>
            {channelOperation?.loading ? "处理中" : "获取模型列表"}
          </button>
          {realSelectedProvider ? (
            <button className="ui-button-secondary" type="button" onClick={handleDeleteProvider}>
              删除渠道
            </button>
          ) : null}
        </div>
        {channelOperation?.message ? <p className="text-sm text-[var(--color-muted)]">{channelOperation.message}</p> : null}
        {channelOperation?.error ? <p className="text-sm text-[var(--color-error)]">{channelOperation.error}</p> : null}
        <label className="grid gap-1 text-sm">
          渠道名称
          <input
            className="ui-input"
            aria-label="渠道名称"
            value={selectedProvider.name}
            onChange={(event) => updateProvider(ensureSelectedProvider().id, { name: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          端点类型
          <select
            className="ui-input"
            aria-label="端点类型"
            value={selectedProvider.endpointType}
            onChange={(event) => updateProvider(ensureSelectedProvider().id, { endpointType: event.target.value as ModelProvider["endpointType"] })}
          >
            <option value="openai_chat">OpenAI Chat Completions</option>
            <option value="anthropic_messages">Anthropic Messages</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          端点地址
          <input
            className="ui-input"
            aria-label="端点地址"
            value={selectedProvider.endpointUrl}
            onChange={(event) => updateProvider(ensureSelectedProvider().id, { endpointUrl: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          API Key
          <input
            className="ui-input"
            aria-label="API Key"
            type="password"
            value={selectedProvider.apiKey}
            onChange={(event) => updateProvider(ensureSelectedProvider().id, { apiKey: event.target.value })}
          />
        </label>
      </section>

      <section className="grid gap-3 border-t border-[var(--color-hairline)] pt-4" aria-label="AI 标题生成">
        <label className="grid gap-1 text-sm">
          默认对话模型
          <select
            className="ui-input"
            aria-label="默认对话模型"
            value={defaultChatModelId}
            onChange={(event) => void setDefaultChatModel(event.target.value)}
          >
            <option value="">使用第一个可用模型</option>
            {titleModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          AI 标题生成模型
          <select
            className="ui-input"
            aria-label="AI 标题生成模型"
            value={selectedTitleModelId}
            onChange={(event) => setTitleModel(event.target.value)}
          >
            <option value="">不开启自动标题生成</option>
            {titleModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--color-muted)]">选择后仅在首轮对话完成后额外发起一次非流式标题请求。</p>
      </section>

      <section className="grid gap-3 border-t border-[var(--color-hairline)] pt-4" aria-label="渠道模型">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">模型</h4>
          <button className="ui-button-secondary" type="button" onClick={handleAddModel}>
            添加模型
          </button>
        </div>
        {remoteModels.length > 0 ? (
          <div className="grid gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2">
            <label className="grid gap-1 text-sm">
              搜索模型
              <input
                aria-label="搜索模型"
                aria-controls="remote-model-options"
                aria-expanded="true"
                className="ui-input"
                placeholder="搜索或选择模型"
                role="combobox"
                value={remoteModelQuery}
                onChange={(event) => setRemoteModelQuery(event.target.value)}
              />
            </label>
            <div className="grid max-h-48 gap-1 overflow-y-auto" id="remote-model-options" role="listbox">
              {filteredRemoteModels.length > 0 ? (
                filteredRemoteModels.map((remoteModel) => {
                  const alreadyAdded = existingRemoteModelIds.has(remoteModel.id);

                  return (
                    <button
                      key={remoteModel.id}
                      aria-disabled={alreadyAdded}
                      className={[
                        "rounded-md px-3 py-2 text-left text-sm transition",
                        alreadyAdded
                          ? "cursor-not-allowed bg-[var(--color-primary-disabled)] text-[var(--color-muted)]"
                          : "bg-[var(--color-canvas)] text-[var(--color-ink)] hover:bg-[var(--color-surface-card)]",
                      ].join(" ")}
                      disabled={alreadyAdded}
                      role="option"
                      type="button"
                      onClick={() => addRemoteModel(selectedProvider.id, remoteModel)}
                    >
                      {alreadyAdded ? "已添加 " : ""}
                      {remoteModel.displayName}
                      <span className="ui-muted ml-2 text-xs">{remoteModel.id}</span>
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-sm text-[var(--color-muted)]">未找到匹配模型</p>
              )}
            </div>
          </div>
        ) : null}
        <div className="grid gap-2">
          {providerModels.map((model) => {
            const connectivity = modelConnectivity[model.id];

            return (
              <article
                key={model.id}
                className={[
                  "ui-card",
                  "model-connectivity-card",
                  connectivity?.success ? "border-[var(--color-success)]" : "",
                  connectivity?.error ? "border-[var(--color-error)]" : "",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{model.modelId}</span>
                  {realSelectedProvider && model.id !== draftModel.id ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        aria-label={`测试模型连通性 ${model.modelId}`}
                        className="ui-button-secondary px-2 py-1"
                        type="button"
                        onClick={() => handleTestModel(model.id)}
                        disabled={connectivity?.loading}
                      >
                        {connectivity?.loading ? "测试中" : "测试"}
                      </button>
                      <button
                        aria-label={`删除 ${model.modelId}`}
                        className="ui-button-secondary px-2 py-1"
                        type="button"
                        onClick={() => deleteModel(model.id)}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function ExtractionRules() {
  const rules = useAppStore((state) => state.extractionRules);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const pageContext = useAppStore((state) => state.pageContext);
  const saveRuleDraft = useAppStore((state) => state.saveRuleDraft);
  const deleteRule = useAppStore((state) => state.deleteRule);
  const moveRule = useAppStore((state) => state.moveRule);
  const generateUrlPatterns = useAppStore((state) => state.generateUrlPatterns);
  const [expandedRuleId, setExpandedRuleId] = useState<string>();
  const [draft, setDraft] = useState<Pick<ExtractionRule, "alias" | "urlPattern" | "selectorsText">>({
    alias: "",
    urlPattern: "",
    selectorsText: "",
  });
  const [editingRuleId, setEditingRuleId] = useState<string>();
  const [validationMessage, setValidationMessage] = useState("");
  const [generatedPatterns, setGeneratedPatterns] = useState<string[]>([]);
  const [generationMessage, setGenerationMessage] = useState("");
  const [generatingPatterns, setGeneratingPatterns] = useState(false);
  const [showGenerationModels, setShowGenerationModels] = useState(false);
  const matchedRuleId = pageContext.matchedRuleId;
  const orderedRules = useMemo(() => {
    const matchedRules = rules.filter((rule) => rule.id === matchedRuleId);
    const otherRules = rules.filter((rule) => rule.id !== matchedRuleId);
    return [...matchedRules, ...otherRules];
  }, [matchedRuleId, rules]);
  const generationModels = useMemo(
    () =>
      models
        .map((model) => {
          const provider = providers.find((item) => item.id === model.providerId);
          return provider
            ? {
                id: model.id,
                label: `${provider.name} / ${model.displayName}`,
              }
            : undefined;
        })
        .filter((item): item is { id: string; label: string } => Boolean(item)),
    [models, providers],
  );
  const openRule = (rule: ExtractionRule) => {
    setExpandedRuleId(rule.id);
    setEditingRuleId(rule.id);
    setDraft({
      alias: rule.alias,
      urlPattern: rule.urlPattern,
      selectorsText: rule.selectorsText,
    });
    setValidationMessage("");
    setGeneratedPatterns([]);
    setGenerationMessage("");
    setShowGenerationModels(false);
  };
  const createDraft = () => {
    setExpandedRuleId("draft-rule");
    setEditingRuleId(undefined);
    setDraft({
      alias: "",
      urlPattern: "",
      selectorsText: "",
    });
    setValidationMessage("");
    setGeneratedPatterns([]);
    setGenerationMessage("");
    setShowGenerationModels(false);
  };
  const handleSave = async () => {
    const result = await saveRuleDraft(editingRuleId, draft);
    if (!result.ok) {
      setValidationMessage(result.message);
      return;
    }

    setExpandedRuleId(result.rule.id);
    setEditingRuleId(result.rule.id);
    setDraft({
      alias: result.rule.alias,
      urlPattern: result.rule.urlPattern,
      selectorsText: result.rule.selectorsText,
    });
    setValidationMessage("");
  };
  const handleOpenGenerationModels = () => {
    console.debug(`${DEBUG_PREFIX} 用户点击 AI 生成，准备展示模型选择`, {
      modelCount: generationModels.length,
      models: generationModels,
      pageContextUrl: pageContext.url,
    });
    setGeneratedPatterns([]);
    setGenerationMessage("");
    setShowGenerationModels(true);
  };
  const handleGeneratePatterns = async (modelId: string) => {
    console.debug(`${DEBUG_PREFIX} 用户选择模型开始生成`, {
      modelId,
      pageContextUrl: pageContext.url,
    });
    setGeneratingPatterns(true);
    setGenerationMessage("");
    setGeneratedPatterns([]);

    const result = await generateUrlPatterns(modelId);
    console.debug(`${DEBUG_PREFIX} UI 收到生成结果`, {
      ok: result.ok,
      patternCount: result.ok ? result.patterns.length : 0,
      message: result.ok ? undefined : result.message,
    });
    setGeneratingPatterns(false);

    if (!result.ok) {
      setGenerationMessage(result.message);
      return;
    }

    setGeneratedPatterns(result.patterns);
    setShowGenerationModels(false);
  };
  const handleDelete = async () => {
    if (!editingRuleId) {
      setExpandedRuleId(undefined);
      return;
    }

    if (!window.confirm("确认删除这条提取规则吗？")) {
      return;
    }

    await deleteRule(editingRuleId);
    setExpandedRuleId(undefined);
    setEditingRuleId(undefined);
  };

  return (
    <section className="grid w-full gap-3" aria-label="提取规则">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">提取规则</h3>
        <button className="ui-button-secondary" type="button" onClick={createDraft}>
          新增规则
        </button>
      </div>
      <div className="grid gap-2">
        {orderedRules.map((rule) => {
          const matched = rule.id === matchedRuleId;
          const expanded = rule.id === expandedRuleId;

          return (
            <article
              key={rule.id}
              className={[
                "rounded-lg border bg-[var(--color-canvas)] p-2",
                matched ? "border-[var(--color-primary)]" : "border-[var(--color-hairline)]",
              ].join(" ")}
            >
              <div className="flex gap-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => openRule(rule)}
                >
                  {rule.alias ? <span className="block truncate text-sm font-medium">{rule.alias}</span> : null}
                  <span className="ui-muted block truncate text-xs">{rule.urlPattern}</span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button className="ui-button-secondary px-2 py-1" type="button" onClick={() => void moveRule(rule.id, "up")}>
                    上移
                  </button>
                  <button className="ui-button-secondary px-2 py-1" type="button" onClick={() => void moveRule(rule.id, "down")}>
                    下移
                  </button>
                </div>
              </div>
              {expanded ? (
                <RuleEditor
                  draft={draft}
                  validationMessage={validationMessage}
                  onChange={setDraft}
                  generatedPatterns={generatedPatterns}
                  generationMessage={generationMessage}
                  generatingPatterns={generatingPatterns}
                  showGenerationModels={showGenerationModels}
                  generationModels={generationModels}
                  onOpenGenerationModels={handleOpenGenerationModels}
                  onGeneratePatterns={(modelId) => void handleGeneratePatterns(modelId)}
                  onSave={() => void handleSave()}
                  onDelete={() => void handleDelete()}
                />
              ) : null}
            </article>
          );
        })}
        {expandedRuleId === "draft-rule" ? (
          <article className="rounded-lg border border-[var(--color-primary)] bg-[var(--color-canvas)] p-2">
            <RuleEditor
              draft={draft}
              validationMessage={validationMessage}
              onChange={setDraft}
              generatedPatterns={generatedPatterns}
              generationMessage={generationMessage}
              generatingPatterns={generatingPatterns}
              showGenerationModels={showGenerationModels}
              generationModels={generationModels}
              onOpenGenerationModels={handleOpenGenerationModels}
              onGeneratePatterns={(modelId) => void handleGeneratePatterns(modelId)}
              onSave={() => void handleSave()}
              onDelete={() => void handleDelete()}
            />
          </article>
        ) : null}
      </div>
    </section>
  );
}

interface RuleEditorProps {
  draft: Pick<ExtractionRule, "alias" | "urlPattern" | "selectorsText">;
  validationMessage: string;
  generatedPatterns: string[];
  generationMessage: string;
  generatingPatterns: boolean;
  showGenerationModels: boolean;
  generationModels: Array<{ id: string; label: string }>;
  onChange: (draft: Pick<ExtractionRule, "alias" | "urlPattern" | "selectorsText">) => void;
  onOpenGenerationModels: () => void;
  onGeneratePatterns: (modelId: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

function RuleEditor({
  draft,
  validationMessage,
  generatedPatterns,
  generationMessage,
  generatingPatterns,
  showGenerationModels,
  generationModels,
  onChange,
  onOpenGenerationModels,
  onGeneratePatterns,
  onSave,
  onDelete,
}: RuleEditorProps) {
  return (
    <div className="mt-3 grid gap-3 border-t border-[var(--color-hairline)] pt-3">
      <label className="grid gap-1 text-sm">
        规则别名
        <input
          className="ui-input"
          aria-label="规则别名"
          value={draft.alias}
          onChange={(event) => onChange({ ...draft, alias: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        URL 正则
        <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
            className="ui-input min-w-0"
            aria-label="URL 正则"
            value={draft.urlPattern}
            onChange={(event) => onChange({ ...draft, urlPattern: event.target.value })}
          />
          <button className="ui-button-secondary whitespace-nowrap" type="button" onClick={onOpenGenerationModels} disabled={generatingPatterns}>
            AI 生成
          </button>
        </span>
      </label>
      {generationMessage ? <p className="text-sm text-[var(--color-error)]">{generationMessage}</p> : null}
      {showGenerationModels ? (
        <div className="grid gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2">
          <p className="text-sm font-medium">选择用于生成的模型</p>
          {generationModels.length > 0 ? (
            <div className="grid gap-1">
              {generationModels.map((model) => (
                <button
                  key={model.id}
                  className="rounded-md bg-[var(--color-canvas)] px-3 py-2 text-left text-sm text-[var(--color-ink)]"
                  type="button"
                  onClick={() => onGeneratePatterns(model.id)}
                  disabled={generatingPatterns}
                >
                  {model.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-error)]">请先配置模型后再使用 AI 生成</p>
          )}
        </div>
      ) : null}
      {generatedPatterns.length > 0 ? (
        <div className="grid gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2">
          {generatedPatterns.map((pattern) => (
            <button
              key={pattern}
              className="rounded-md bg-[var(--color-canvas)] px-3 py-2 text-left text-xs text-[var(--color-ink)]"
              type="button"
              onClick={() => onChange({ ...draft, urlPattern: pattern })}
            >
              {pattern}
            </button>
          ))}
        </div>
      ) : null}
      <label className="grid gap-1 text-sm">
        CSS/XPath 列表
        <textarea
          className="ui-input min-h-24"
          aria-label="CSS/XPath 列表"
          value={draft.selectorsText}
          onChange={(event) => onChange({ ...draft, selectorsText: event.target.value })}
        />
      </label>
      {validationMessage ? <p className="text-sm text-[var(--color-error)]">{validationMessage}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className="ui-button-primary" type="button" onClick={onSave}>
          保存规则
        </button>
        <button className="ui-button-secondary" type="button" onClick={onDelete}>
          删除规则
        </button>
      </div>
    </div>
  );
}

function SyncSettings() {
  return (
    <fieldset className="grid w-full gap-3">
      <legend className="font-medium">同步设置</legend>
      <p className="rounded-lg p-2 text-sm" style={{ background: "#fff8e8", border: "1px solid color-mix(in srgb, var(--color-warning) 28%, white)", color: "#8a5f00" }}>
        忘记密钥将无法恢复已加密的同步数据
      </p>
      <label className="grid gap-1 text-sm">
        本地加密密钥
        <input className="ui-input" aria-label="本地加密密钥" type="password" />
      </label>
      <label className="grid gap-1 text-sm">
        备份前缀
        <input className="ui-input" aria-label="备份前缀" />
      </label>
      <div className="flex gap-2">
        <button className="ui-button-secondary" type="button">
          手动备份
        </button>
        <button className="ui-button-secondary" type="button">
          手动恢复
        </button>
      </div>
    </fieldset>
  );
}

function AppearanceSettings() {
  return (
    <fieldset className="grid w-full gap-3">
      <legend className="font-medium">界面偏好</legend>
      <label className="grid gap-1 text-sm">
        面板密度
        <select className="ui-input" aria-label="面板密度" defaultValue="normal">
          <option value="compact">紧凑</option>
          <option value="normal">标准</option>
        </select>
      </label>
    </fieldset>
  );
}
