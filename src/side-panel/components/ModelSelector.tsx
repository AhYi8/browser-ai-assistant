import { useAppStore } from "../state/appStore";

export function ModelSelector() {
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const selectModel = useAppStore((state) => state.selectModel);
  const selectableModels = models
    .map((model) => {
      const provider = providers.find((item) => item.id === model.providerId);
      return provider && provider.enabled && model.enabled
        ? {
            id: model.id,
            label: `${provider.name} / ${model.displayName}`,
          }
        : undefined;
    })
    .filter((model): model is { id: string; label: string } => Boolean(model));

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
