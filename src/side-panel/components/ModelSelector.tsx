import { useAppStore } from "../state/appStore";
import { formatModelLabelWithVision } from "./ModelVisionIndicator";

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
            label: formatModelLabelWithVision(`${provider.name} / ${model.displayName}`, model.supportsVision),
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
