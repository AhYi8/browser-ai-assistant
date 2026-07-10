export const MODEL_OUTPUT_TRUNCATED_MESSAGE = "模型输出达到 max_tokens 上限，回答可能不完整。请调大该模型的“模型输出上限 max_tokens”后重新生成。";
export const MODEL_CONTENT_FILTERED_MESSAGE = "模型响应被内容策略截断，请调整问题后重试。";

export function getModelStopReasonFailureMessage(stopReason: string | undefined): string | undefined {
  const normalized = stopReason?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "length" || normalized === "max_tokens") {
    return MODEL_OUTPUT_TRUNCATED_MESSAGE;
  }
  if (normalized === "content_filter") {
    return MODEL_CONTENT_FILTERED_MESSAGE;
  }
  return undefined;
}
