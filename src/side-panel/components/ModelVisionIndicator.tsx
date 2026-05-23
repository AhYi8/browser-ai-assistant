export const MODEL_VISION_TEXT_MARK = "视觉";

interface ModelVisionIconProps {
  label: string;
}

export function formatModelLabelWithVision(label: string, supportsVision?: boolean): string {
  // 原生 option 不能渲染 HTML 图标，只能用短文本保留同等能力标识。
  return supportsVision ? `${label} · ${MODEL_VISION_TEXT_MARK}` : label;
}

export function ModelVisionIcon({ label }: ModelVisionIconProps) {
  return (
    <span className="model-vision-icon" role="img" aria-label={label} title="支持视觉理解">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M2.75 12s3.25-5.5 9.25-5.5 9.25 5.5 9.25 5.5-3.25 5.5-9.25 5.5S2.75 12 2.75 12Z" />
        <circle cx="12" cy="12" r="2.75" />
      </svg>
    </span>
  );
}
