import { useEffect, useMemo, useState } from "react";
import type { ModelProvider, ProviderModel } from "../../../shared/types";
import { parseTavilyIncludeAnswerInput, parseTavilyIncludeRawContentInput } from "../../../shared/webSearch/settings";
import { useAppStore } from "../../state/appStore";
import { formatModelLabelWithVision, ModelVisionIcon } from "../ModelVisionIndicator";
import { useComposedTextInput } from "../useComposedTextInput";
import { GlobalPreferenceNumberInput } from "./GlobalPreferenceNumberInput";

const draftProvider: ModelProvider = {
  id: "draft-provider",
  name: "默认渠道",
  endpointType: "openai_chat",
  endpointUrl: "https://api.openai.com",
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
  supportsVision: false,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

export function ChannelManagement() {
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
  const updateModel = useAppStore((state) => state.updateModel);
  const setTitleModel = useAppStore((state) => state.setTitleModel);
  const defaultChatModelId = useAppStore((state) => state.defaultChatModelId);
  const setDefaultChatModel = useAppStore((state) => state.setDefaultChatModel);
  const webSearchSettings = useAppStore((state) => state.webSearchSettings);
  const updateWebSearchSettings = useAppStore((state) => state.updateWebSearchSettings);
  const remoteModelsByProvider = useAppStore((state) => state.remoteModels);
  const channelOperations = useAppStore((state) => state.channelOperations);
  const modelConnectivity = useAppStore((state) => state.modelConnectivity);
  const visibleProviders = providers.length > 0 ? providers : [draftProvider];
  const [selectedProviderId, setSelectedProviderId] = useState(visibleProviders[0].id);
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const [remoteModelQuery, setRemoteModelQuery] = useState("");
  const [settingsModelId, setSettingsModelId] = useState<string>();
  const [showTavilyApiKey, setShowTavilyApiKey] = useState(false);
  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(draftProvider.id);
      return;
    }
    if (!providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

  const realSelectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const selectedProvider = realSelectedProvider ?? draftProvider;
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
                label: formatModelLabelWithVision(`${provider.name} / ${model.displayName}`, model.supportsVision),
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
    setExpandedProviderId(provider.id);
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
    const nextProviderId = providers.find((provider) => provider.id !== selectedProvider.id)?.id ?? draftProvider.id;
    setSelectedProviderId(nextProviderId);
    setExpandedProviderId(undefined);
  };
  const handleTestModel = (modelId: string) => {
    void testModel(selectedProvider.id, modelId);
  };
  const settingsModel = settingsModelId ? models.find((model) => model.id === settingsModelId) : undefined;
  const tavilyApiKeyInput = useComposedTextInput(webSearchSettings.tavily.apiKeysText, (apiKeysText) => {
    void updateWebSearchSettings({ tavily: { ...webSearchSettings.tavily, apiKeysText } });
  });

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
              provider.id === selectedProviderId
                ? "border-[var(--color-primary)] bg-[var(--color-surface-card)]"
                : "border-[var(--color-hairline)] bg-[var(--color-canvas)] hover:bg-[var(--color-surface-soft)]",
            ].join(" ")}
            type="button"
            onClick={() => {
              setSelectedProviderId(provider.id);
              setExpandedProviderId((current) => (current === provider.id ? undefined : provider.id));
            }}
          >
            <span className="block text-sm font-medium">{provider.name}</span>
            <span className="ui-muted mt-1 block truncate text-xs">{provider.endpointUrl}</span>
          </button>
        ))}
      </div>

      {expandedProviderId === selectedProvider.id ? (
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
      ) : null}
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
                  <span className="model-list-name">
                    <span className="min-w-0 truncate text-sm font-medium">{model.modelId}</span>
                    {model.supportsVision ? <ModelVisionIcon label={`${model.modelId} 支持视觉理解`} /> : null}
                  </span>
                  {realSelectedProvider && model.id !== draftModel.id ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        aria-label={`设置 ${model.modelId}`}
                        className="ui-button-secondary px-2 py-1"
                        type="button"
                        onClick={() => setSettingsModelId(model.id)}
                      >
                        设置
                      </button>
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

      <section className="grid gap-3 border-t border-[var(--color-hairline)] pt-4" aria-label="Tavily 搜索工具配置">
        <h4 className="text-sm font-semibold">Tavily 搜索工具</h4>
        <label className="grid gap-1 text-sm">
          Tavily API Key
          <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              className="ui-input min-w-0"
              aria-label="Tavily API Key"
              type={showTavilyApiKey ? "text" : "password"}
              {...tavilyApiKeyInput}
            />
            <button
              className="ui-button-secondary px-2"
              type="button"
              aria-label={showTavilyApiKey ? "隐藏 Tavily API Key 明文" : "显示 Tavily API Key 明文"}
              onClick={() => setShowTavilyApiKey((visible) => !visible)}
            >
              <TavilyApiKeyVisibilityIcon visible={showTavilyApiKey} />
            </button>
          </span>
          <span className="ui-muted text-xs">多个 API Key 请使用英文逗号分隔。</span>
        </label>
        <label className="grid gap-1 text-sm">
          Tavily API Key 使用策略
          <select
            className="ui-input"
            aria-label="Tavily API Key 使用策略"
            value={webSearchSettings.tavily.apiKeyStrategy}
            onChange={(event) =>
              void updateWebSearchSettings({
                tavily: {
                  ...webSearchSettings.tavily,
                  apiKeyStrategy: event.target.value === "random" ? "random" : "round_robin",
                },
              })
            }
          >
            <option value="round_robin">轮询</option>
            <option value="random">随机</option>
          </select>
        </label>
        <div className="chat-preference-grid">
          <label className="chat-preference-field">
            综合答案
            <select
              className="ui-input chat-preference-shortcut-select"
              aria-label="Tavily 综合答案"
              value={String(webSearchSettings.tavily.includeAnswer)}
              onChange={(event) =>
                void updateWebSearchSettings({
                  tavily: {
                    ...webSearchSettings.tavily,
                    includeAnswer: parseTavilyIncludeAnswerInput(event.target.value),
                  },
                })
              }
            >
              <option value="basic">基础答案</option>
              <option value="advanced">深入答案</option>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </label>
          <label className="chat-preference-field">
            原始内容
            <select
              className="ui-input chat-preference-shortcut-select"
              aria-label="Tavily 原始内容"
              value={String(webSearchSettings.tavily.includeRawContent)}
              onChange={(event) =>
                void updateWebSearchSettings({
                  tavily: {
                    ...webSearchSettings.tavily,
                    includeRawContent: parseTavilyIncludeRawContentInput(event.target.value),
                  },
                })
              }
            >
              <option value="false">关闭</option>
              <option value="true">开启</option>
              <option value="markdown">Markdown</option>
              <option value="text">纯文本</option>
            </select>
          </label>
          <GlobalPreferenceNumberInput
            label="Tavily 最大结果数"
            value={webSearchSettings.tavily.maxResults}
            min={1}
            max={20}
            step={1}
            onChange={(value) =>
              value === undefined
                ? undefined
                : void updateWebSearchSettings({
                    tavily: {
                      ...webSearchSettings.tavily,
                      maxResults: value,
                    },
                  })
            }
          />
        </div>
      </section>
      {settingsModel ? (
        <ModelSettingsDialog
          model={settingsModel}
          onClose={() => setSettingsModelId(undefined)}
          onChangeSupportsVision={(supportsVision) => updateModel(settingsModel.id, { supportsVision })}
        />
      ) : null}
    </section>
  );
}

interface ModelSettingsDialogProps {
  model: ProviderModel;
  onClose: () => void;
  onChangeSupportsVision: (supportsVision: boolean) => void;
}

function ModelSettingsDialog({ model, onClose, onChangeSupportsVision }: ModelSettingsDialogProps) {
  const supportsVision = Boolean(model.supportsVision);

  return (
    <>
      <div className="dialog-overlay" aria-hidden="true" onClick={onClose} />
      <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-label="模型设置">
        <div className="context-dialog-header">
          <div className="min-w-0">
            <h4 className="context-dialog-title">模型设置</h4>
            <p className="ui-muted mt-1 truncate text-xs">{model.modelId}</p>
          </div>
          <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭模型设置" onClick={onClose}>
            关闭
          </button>
        </div>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={supportsVision}
            onChange={(event) => onChangeSupportsVision(event.target.checked)}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">支持视觉理解</span>
        </label>
        <p className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2 text-sm text-[var(--color-body)]">
          {supportsVision ? "当前支持视觉理解" : "当前不支持视觉理解"}
        </p>
      </section>
    </>
  );
}

function TavilyApiKeyVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <span
      className={visible ? "tavily-api-key-visibility-icon tavily-api-key-visibility-icon-open" : "tavily-api-key-visibility-icon tavily-api-key-visibility-icon-closed"}
      aria-hidden="true"
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M2.75 12s3.25-5.5 9.25-5.5 9.25 5.5 9.25 5.5-3.25 5.5-9.25 5.5S2.75 12 2.75 12Z" />
        {visible ? <circle cx="12" cy="12" r="2.75" /> : null}
        {visible ? null : <path d="M4.5 4.5 19.5 19.5" />}
      </svg>
    </span>
  );
}
