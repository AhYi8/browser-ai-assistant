import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { copyTextToClipboard } from "../utils/messageClipboard";

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  "c#": "csharp",
  csharp: "csharp",
  cpp: "cpp",
  css: "css",
  htm: "html",
  html: "html",
  ini: "text",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  json5: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  plaintext: "text",
  plain: "text",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  text: "text",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  txt: "text",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const DEFAULT_MAX_HEIGHT = 320;
const COPY_FEEDBACK_DURATION_MS = 1600;
type CopyFeedback = "success" | "error" | null;

export interface MarkdownCodeBlockProps extends ComponentPropsWithoutRef<"code"> {
  "data-inline"?: boolean | string;
  node?: unknown;
}

// react-markdown 仍会先包一层 pre；这里移除外层 pre，避免旧气泡样式覆盖专用代码块布局。
export function MarkdownCodePre({ children }: ComponentPropsWithoutRef<"pre">) {
  return <>{children}</>;
}

export function resolveMarkdownCodeLanguage(className?: string): string {
  const languageMatch = className?.match(/(?:^|\s)language-([^\s]+)/i);
  const rawLanguage = languageMatch?.[1]?.trim().toLowerCase();
  if (!rawLanguage) {
    return "text";
  }

  return LANGUAGE_ALIAS_MAP[rawLanguage] ?? "text";
}

export function MarkdownCodeBlock({ className, children, node: _node, ...props }: MarkdownCodeBlockProps) {
  const rawText = createMarkdownCodeText(children, { trimTrailingLineBreak: false });
  const isExplicitInline = props["data-inline"] === true || props["data-inline"] === "true";
  const isBlockCode = !isExplicitInline && (hasMarkdownCodeLanguage(className) || rawText.endsWith("\n") || rawText.endsWith("\r"));
  if (!isBlockCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <MarkdownCodeBlockFrame className={className}>
      {children}
    </MarkdownCodeBlockFrame>
  );
}

function MarkdownCodeBlockFrame({ className, children }: Pick<MarkdownCodeBlockProps, "className" | "children">) {
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const copyRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const codeText = useMemo(() => createMarkdownCodeText(children), [children]);
  const language = useMemo(() => resolveMarkdownCodeLanguage(className), [className]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearCopyFeedbackTimer();
    };
  }, []);

  const clearCopyFeedbackTimer = () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  };

  const showCopyFeedback = (feedback: Exclude<CopyFeedback, null>) => {
    setCopyFeedback(feedback);
    clearCopyFeedbackTimer();
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_DURATION_MS);
  };

  const handleCopyCode = async () => {
    const requestId = copyRequestIdRef.current + 1;
    copyRequestIdRef.current = requestId;
    try {
      await copyTextToClipboard(codeText);
      if (!mountedRef.current || requestId !== copyRequestIdRef.current) {
        return;
      }
      showCopyFeedback("success");
    } catch {
      if (!mountedRef.current || requestId !== copyRequestIdRef.current) {
        return;
      }
      showCopyFeedback("error");
    }
  };

  return (
    <div
      className={[
        "markdown-code-block",
        wrap ? "markdown-code-block-wrap" : "markdown-code-block-nowrap",
        expanded ? "markdown-code-block-expanded" : "markdown-code-block-collapsed",
      ].join(" ")}
      data-language={language}
    >
      <div className="markdown-code-block-toolbar">
        <span className="markdown-code-block-language" aria-label={`代码类型 ${language}`}>
          {language}
        </span>
        <div className="markdown-code-block-actions">
          <button
            className="markdown-code-block-icon-button"
            type="button"
            aria-label={wrap ? "切换为不换行" : "切换为换行"}
            title={wrap ? "切换为不换行" : "切换为换行"}
            aria-pressed={wrap}
            onClick={() => setWrap((current) => !current)}
          >
            {wrap ? <NoWrapIcon /> : <WrapIcon />}
          </button>
          <button
            className="markdown-code-block-icon-button"
            type="button"
            aria-label={expanded ? "收起代码块" : "展开代码块"}
            title={expanded ? "收起代码块" : "展开代码块"}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          <span className="markdown-code-block-copy-action">
            <button
              className="markdown-code-block-icon-button"
              type="button"
              aria-label="复制源码"
              title="复制源码"
              onClick={() => void handleCopyCode()}
            >
              <CopyIcon />
            </button>
            {copyFeedback ? (
              <span
                className={[
                  "markdown-code-block-copy-feedback",
                  copyFeedback === "error" ? "markdown-code-block-copy-feedback-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="status"
                aria-live="polite"
              >
                {copyFeedback === "success" ? "已复制" : "复制失败"}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div className="markdown-code-block-body" style={!expanded ? { maxHeight: DEFAULT_MAX_HEIGHT } : undefined}>
        <pre>
          <code className="markdown-code-block-code">{codeText}</code>
        </pre>
      </div>
    </div>
  );
}

function hasMarkdownCodeLanguage(className?: string): boolean {
  return /(?:^|\s)language-[^\s]+/i.test(className ?? "");
}

function createMarkdownCodeText(children: ReactNode, options: { trimTrailingLineBreak?: boolean } = {}): string {
  const childList = Array.isArray(children) ? children : [children];
  const rawText = childList
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (child === null || child === undefined || typeof child === "boolean" || isValidElement(child)) {
        return "";
      }
      return String(child);
    })
    .join("");
  return options.trimTrailingLineBreak === false ? rawText : rawText.replace(/\r?\n$/, "");
}

function WrapIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4 6h12" />
      <path d="M4 10h14a3 3 0 0 1 0 6H9" />
      <path d="M11 13 8 16l3 3" />
      <path d="M4 20h8" />
    </svg>
  );
}

function NoWrapIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4 7h12" />
      <path d="M4 12h13" />
      <path d="M4 17h12" />
      <path d="m17 9 3 3-3 3" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M8 9 12 5l4 4" />
      <path d="M12 5v6" />
      <path d="M16 15 12 19l-4-4" />
      <path d="M12 19v-6" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M8 5 12 9l4-4" />
      <path d="M12 9V3" />
      <path d="M16 19 12 15l-4 4" />
      <path d="M12 15v6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M8 8h10v10H8Z" />
      <path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}
