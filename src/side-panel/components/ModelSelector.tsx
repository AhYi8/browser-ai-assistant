import { useMemo } from "react";

import { useAppStore } from "../state/appStore";
import { formatModelLabelWithVision } from "./ModelVisionIndicator";

export function ModelSelector() {
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const selectModel = useAppStore((state) => state.selectModel);
  const selectableModels = useMemo(() => {
    const providerById = new Map(providers.map((provider, index) => [provider.id, { provider, index }]));
    return models
      .flatMap((model, modelIndex) => {
        const providerItem = providerById.get(model.providerId);
        return providerItem?.provider.enabled && model.enabled
          ? {
              id: model.id,
              label: formatModelLabelWithVision(`${providerItem.provider.name} / ${model.displayName}`, model.supportsVision),
              modelIndex,
              providerIndex: providerItem.index,
            }
          : [];
      })
      // 按渠道配置顺序分组，同一渠道内保留模型原有顺序，避免不同渠道模型在下拉框中穿插显示。
      .sort((left, right) => left.providerIndex - right.providerIndex || left.modelIndex - right.modelIndex);
  }, [models, providers]);

  return (
    <div className="model-selector">
      <label className="model-select-label model-select-label-inline">
        <span className="model-select-text">当前模型</span>
        <select
          className="ui-input model-select-input"
          value={selectedModelId}
          onChange={(event) => selectModel(event.target.value)}
        >
          <option value="">未选择模型</option>
          {selectableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
