import { useEffect, useId, useState } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { isPngDataUrl, isTabCaptureImageAttachment, TAB_CAPTURE_VISIBLE_MESSAGE_TYPE, type TabCaptureVisibleResponse } from "../../shared/tabCapture";
import type { AutomationAction, AutomationFlow, ChatImageAttachment, ChatPromptInvocation, PromptTemplate, SendShortcut } from "../../shared/types";
import { useAppStore } from "../state/appStore";
import { PromptInlineEditor } from "./PromptInlineEditor";

const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface ChatComposerProps {
  canSend: boolean;
  matchedRuleLabel: string;
}

type SlashCommandOption =
  | {
      id: string;
      kind: "automation-start" | "automation-exit";
      title: string;
      description: string;
    }
  | {
      id: string;
      kind: "automation-flow";
      title: string;
      description: string;
      flow: AutomationFlow;
    }
  | {
      id: string;
      kind: "prompt";
      title: string;
      description: string;
      prompt: PromptTemplate;
    };

interface ComposerSwitchProps {
  ariaLabel: string;
  checked: boolean;
  label: string;
  onToggle: () => void;
}

function ComposerSwitch({ ariaLabel, checked, label, onToggle }: ComposerSwitchProps) {
  return (
    <button className="composer-switch" type="button" role="switch" aria-label={ariaLabel} aria-checked={checked} onClick={onToggle}>
      <span className="composer-switch-track" aria-hidden="true">
        <span className="composer-switch-thumb" />
      </span>
      <span aria-hidden={ariaLabel !== label}>{label}</span>
    </button>
  );
}

const AUTOMATION_ACTION_LABELS: Record<AutomationAction["type"], string> = {
  click: "点击",
  input: "输入",
  scroll: "滚动",
  wait: "等待",
  navigate: "跳转",
  extractHtml: "抓取 HTML",
  runSandboxExtraction: "沙盒提取",
  none: "无真实网页动作",
};

function AutomationActionPreview({ action }: { action?: AutomationAction }) {
  if (!action) {
    return <span className="automation-action-empty">动作：未指定</span>;
  }

  const details = buildAutomationActionDetails(action);
  return (
    <div className="automation-action-preview">
      <span>动作：{AUTOMATION_ACTION_LABELS[action.type]}</span>
      {details.map((detail) => (
        <div className="automation-action-detail" key={detail.label}>
          <span>{detail.label}</span>
          {detail.code ? <pre>{detail.value}</pre> : <strong>{detail.value}</strong>}
        </div>
      ))}
    </div>
  );
}

function buildAutomationActionDetails(action: AutomationAction): Array<{ label: string; value: string; code?: boolean }> {
  const details: Array<{ label: string; value: string; code?: boolean }> = [];
  if (action.selector) {
    details.push({ label: "目标选择器", value: action.selector });
  }
  if (action.url) {
    details.push({ label: "目标 URL", value: action.url });
  }
  if (action.value) {
    details.push({ label: "输入内容", value: action.value });
  }
  if (typeof action.scrollY === "number") {
    details.push({ label: "滚动距离", value: `${action.scrollY}px` });
  }
  if (typeof action.timeoutMs === "number") {
    details.push({ label: "等待时间", value: `${action.timeoutMs}ms` });
  }
  if (action.code) {
    details.push({ label: action.type === "runSandboxExtraction" ? "提取脚本" : "脚本", value: action.code, code: true });
  }

  return details;
}

function formatAutomationResult(item: unknown): string {
  if (!item || typeof item !== "object") {
    return stringifyAutomationResult(item);
  }

  const result = item as { type?: unknown; title?: unknown; url?: unknown; htmlLength?: unknown; tabId?: unknown; data?: unknown };
  const parts = [
    typeof result.type === "string" ? result.type : "结果",
    typeof result.title === "string" && result.title ? `标题：${result.title}` : undefined,
    typeof result.url === "string" && result.url ? `URL：${result.url}` : undefined,
    typeof result.htmlLength === "number" ? `HTML：${result.htmlLength} 字符` : undefined,
    typeof result.tabId === "number" ? `标签页：${result.tabId}` : undefined,
    "data" in result ? `数据：${formatAutomationResultData(result.data)}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

function formatAutomationResultData(data: unknown): string {
  if (Array.isArray(data)) {
    const preview = data.slice(0, 3).map((item) => stringifyAutomationResult(item)).join("、");
    return `${data.length} 条${preview ? `（${preview}${data.length > 3 ? "…" : ""}）` : ""}`;
  }

  return stringifyAutomationResult(data);
}

function formatAutomationResultJson(item: unknown): string {
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return stringifyAutomationResult(item);
  }
}

function stringifyAutomationResult(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  if (typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  return "已完成";
}

export function ChatComposer({ canSend, matchedRuleLabel }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [promptInvocations, setPromptInvocations] = useState<ChatPromptInvocation[]>([]);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashStartIndex, setSlashStartIndex] = useState<number | undefined>();
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [automationDialog, setAutomationDialog] = useState<"steps" | "results" | undefined>();
  const [composing, setComposing] = useState(false);
  const imageInputId = useId();
  const currentModelSupportsVision = useAppStore((state) => Boolean(state.models.find((model) => model.id === state.selectedModelId)?.supportsVision));
  const sendShortcut = useAppStore((state) => state.chatPreferences.sendShortcut);
  const promptTemplates = useAppStore((state) => state.promptTemplates);
  const automationFlows = useAppStore((state) => state.automationFlows);
  const automationSession = useAppStore((state) => state.automationSession);
  const streamMode = useAppStore((state) => state.streamMode);
  const contextMode = useAppStore((state) => state.contextMode);
  const appendPageContextToSystemPrompt = useAppStore((state) => state.appendPageContextToSystemPrompt);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const setStreamMode = useAppStore((state) => state.setStreamMode);
  const setContextMode = useAppStore((state) => state.setContextMode);
  const setComposerHasDraft = useAppStore((state) => state.setComposerHasDraft);
  const setAppendPageContextToSystemPrompt = useAppStore((state) => state.setAppendPageContextToSystemPrompt);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);
  const enterAutomationMode = useAppStore((state) => state.enterAutomationMode);
  const exitAutomationMode = useAppStore((state) => state.exitAutomationMode);
  const submitAutomationBattleMessage = useAppStore((state) => state.submitAutomationBattleMessage);
  const confirmAutomationFlow = useAppStore((state) => state.confirmAutomationFlow);

  useEffect(() => {
    setComposerHasDraft(input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0);
  }, [attachments.length, input, promptInvocations.length, setComposerHasDraft]);

  useEffect(() => {
    if (!contextDialogOpen) {
      return undefined;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextDialogOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [contextDialogOpen]);

  useEffect(() => {
    if (automationSession.phase === "confirming" && automationSession.pendingFlow) {
      setAutomationDialog("steps");
      return;
    }

    if ((automationSession.phase === "completed" || automationSession.phase === "error") && automationSession.collectedData.length > 0) {
      setAutomationDialog("results");
      return;
    }

    if (automationSession.mode !== "automation") {
      setAutomationDialog(undefined);
    }
  }, [automationSession.collectedData.length, automationSession.mode, automationSession.pendingFlow, automationSession.phase]);

  const submit = async () => {
    const content = input.trim();
    if (!content && attachments.length === 0 && promptInvocations.length === 0) {
      return;
    }

    setInput("");
    setPromptInvocations([]);
    setSlashMenuOpen(false);
    const sendingAttachments = attachments;
    const sendingPromptInvocations = promptInvocations;
    setAttachments([]);
    setAttachmentError("");
    if (automationSession.mode === "automation") {
      await submitAutomationBattleMessage(content);
      return;
    }

    await sendChatMessage(content, sendingAttachments, sendingPromptInvocations);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const isComposingInput = composing || event.nativeEvent.isComposing;
    if (slashMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if (isComposingInput && event.key === "Enter") {
        event.preventDefault();
        return;
      }
      if (!isComposingInput && event.key === "Enter" && slashCommandOptions[0]) {
        event.preventDefault();
        handleSelectSlashCommand(slashCommandOptions[0]);
        return;
      }
    }

    if (isComposingInput || !isSendShortcut(event, sendShortcut)) {
      return;
    }

    event.preventDefault();
    if (!canSend || sending || (!input.trim() && attachments.length === 0 && promptInvocations.length === 0)) {
      return;
    }

    void submit();
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addImageFiles(Array.from(event.target.files ?? [])).catch(() => {
      setAttachmentError("图片读取失败，请重新选择图片");
    });
    event.target.value = "";
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = getPastedImageFiles(event.clipboardData);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void addImageFiles(files).catch(() => {
      setAttachmentError("图片读取失败，请重新选择图片");
    });
  };

  const handleInputChange = (value: string, options: { forceSlashDetection?: boolean } = {}) => {
    setInput(value);
    if (composing && !options.forceSlashDetection) {
      return;
    }

    const slashInfo = findSlashCommand(value);
    if (!slashInfo) {
      setSlashMenuOpen(false);
      setSlashQuery("");
      setSlashStartIndex(undefined);
      return;
    }

    setSlashMenuOpen(true);
    setSlashQuery(slashInfo.query);
    setSlashStartIndex(slashInfo.startIndex);
  };

  const handleSelectSlashCommand = (option: SlashCommandOption) => {
    if (option.kind === "automation-start") {
      enterAutomationMode();
      removeSlashCommandFromInput();
      return;
    }
    if (option.kind === "automation-exit") {
      exitAutomationMode();
      removeSlashCommandFromInput();
      return;
    }
    if (option.kind === "automation-flow") {
      enterAutomationMode(option.flow.id);
      removeSlashCommandFromInput();
      return;
    }

    if (option.kind === "prompt") {
      handleSelectPrompt(option.prompt);
    }
  };

  const removeSlashCommandFromInput = () => {
    setInput((current) => removeSlashCommandSegment(current, slashStartIndex));
    setSlashMenuOpen(false);
    setSlashQuery("");
    setSlashStartIndex(undefined);
  };

  const handleSelectPrompt = (prompt: PromptTemplate) => {
    setPromptInvocations((current) => [
      ...current,
      {
        promptId: prompt.id,
        title: prompt.title,
        contentSnapshot: prompt.content,
      },
    ]);
    removeSlashCommandFromInput();
  };

  const handleCaptureVisibleTab = async () => {
    if (!currentModelSupportsVision) {
      return;
    }
    if (attachments.length >= MAX_IMAGE_ATTACHMENTS) {
      setAttachmentError("最多只能添加 5 张图片");
      return;
    }

    try {
      const response = await sendRuntimeMessage<TabCaptureVisibleResponse>({ type: TAB_CAPTURE_VISIBLE_MESSAGE_TYPE });
      if (!response?.ok) {
        setAttachmentError(response?.message || "当前页面截图失败，请稍后重试");
        return;
      }
      if (!isTabCaptureImageAttachment(response.attachment)) {
        setAttachmentError("当前页面截图结果无效，请重试");
        return;
      }
      if (estimateDataUrlBytes(response.attachment.dataUrl) > MAX_IMAGE_ATTACHMENT_BYTES) {
        setAttachmentError("单张图片不能超过 5MB");
        return;
      }
      if (!isPngDataUrl(response.attachment.dataUrl)) {
        setAttachmentError("当前页面截图结果无效，请重试");
        return;
      }

      setAttachments((current) => [...current, response.attachment]);
      setAttachmentError("");
    } catch {
      setAttachmentError("当前页面截图失败，请稍后重试");
    }
  };

  const addImageFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    if (!currentModelSupportsVision) {
      setAttachmentError("当前模型不支持视觉理解，无法添加图片");
      return;
    }

    const nextAttachments = [...attachments];
    for (const file of files) {
      if (nextAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
        setAttachmentError("最多只能添加 5 张图片");
        break;
      }
      if (!file.type.startsWith("image/") || !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setAttachmentError("仅支持 PNG、JPEG、WebP 或 GIF 图片");
        continue;
      }
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        setAttachmentError("单张图片不能超过 5MB");
        continue;
      }

      try {
        nextAttachments.push({
          id: `image-${Date.now()}-${nextAttachments.length}`,
          name: file.name || "图片",
          mediaType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        });
      } catch {
        setAttachmentError("图片读取失败，请重新选择图片");
        continue;
      }
      setAttachmentError("");
    }

    setAttachments(nextAttachments);
  };

  const contextModeLabel = contextMode === "all" ? "提取所有" : "提取文本";
  const slashCommandOptions = buildSlashCommandOptions(promptTemplates, automationFlows, slashQuery);
  const automationModeActive = automationSession.mode === "automation";
  const canSubmit = canSend && !sending && (input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0);

  return (
    <section className="chat-composer" aria-label="聊天输入区">
      {attachments.length > 0 ? (
        <div className="image-preview-strip" aria-label="已添加图片">
          {attachments.map((attachment) => (
            <div className="image-preview-thumb-wrap" key={attachment.id}>
              <button className="image-preview-thumb" type="button" aria-label={`查看图片 ${attachment.name}`} onClick={() => setPreviewAttachment(attachment)}>
                <img src={attachment.dataUrl} alt="" />
              </button>
              <button
                className="image-preview-remove"
                type="button"
                aria-label={`删除图片 ${attachment.name}`}
                title="删除图片"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="context-strip">
        <button className="ui-button-secondary context-view-button" type="button" onClick={() => setContextDialogOpen(true)}>
          查看上下文
        </button>
        <span className="context-chip">{matchedRuleLabel}</span>
        <button className="ui-button-secondary" type="button" onClick={() => void refreshPageContext()}>
          刷新
        </button>
        {currentModelSupportsVision ? (
          <button className="ui-button-secondary" type="button" aria-label="截图当前标签页" title="截取当前标签页可见区域" onClick={() => void handleCaptureVisibleTab()}>
            截图
          </button>
        ) : null}
        <ComposerSwitch
          ariaLabel="拼接上下文"
          checked={appendPageContextToSystemPrompt}
          label="拼接上下文"
          onToggle={() => setAppendPageContextToSystemPrompt(!appendPageContextToSystemPrompt)}
        />
      </div>
      {pageContext.truncated ? <p className="text-sm text-[var(--color-warning)]">内容已截断，请细化 CSS/XPath</p> : null}
      {pageContext.error ? <p className="text-sm text-[var(--color-error)]">{pageContext.error}</p> : null}
      {automationModeActive ? (
        <div className="automation-status-strip" role="status">
          <div className="automation-status-content">
            <span>{automationSession.statusMessage ?? "自动化模式已开启"}</span>
          </div>
          {automationSession.phase === "confirming" && automationSession.pendingFlow ? (
            <button className="ui-button-primary" type="button" onClick={() => setAutomationDialog("steps")}>
              查看步骤
            </button>
          ) : null}
          {automationSession.collectedData.length > 0 ? (
            <button className="ui-button-primary" type="button" onClick={() => setAutomationDialog("results")}>
              查看结果
            </button>
          ) : null}
          <button className="ui-button-secondary" type="button" onClick={exitAutomationMode}>
            退出自动化
          </button>
        </div>
      ) : null}
      {attachmentError ? <p className="text-sm text-[var(--color-error)]">{attachmentError}</p> : null}
      <div className="chat-input-shell">
        <input
          id={imageInputId}
          className="sr-only"
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          aria-label="上传图片"
          disabled={!currentModelSupportsVision}
          onChange={handleImageInputChange}
        />
        <label
          className={`image-upload-button${currentModelSupportsVision ? "" : " image-upload-button-disabled"}`}
          htmlFor={imageInputId}
          title={currentModelSupportsVision ? "上传图片" : "当前模型不支持视觉理解"}
        >
          <span aria-hidden="true">▣</span>
        </label>
        <PromptInlineEditor
          className="ui-input chat-input"
          ariaLabel="对话输入"
          value={input}
          promptInvocations={promptInvocations}
          promptAriaLabelPrefix="已调用提示词"
          onChange={handleInputChange}
          onRemovePrompt={(index) => setPromptInvocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          onPaste={handlePaste}
          onKeyDown={handleInputKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(value) => {
            setComposing(false);
            handleInputChange(value, { forceSlashDetection: true });
          }}
        />
        {slashMenuOpen ? (
          <div className="slash-command-menu" role="listbox" aria-label="提示词命令">
            {slashCommandOptions.length > 0 ? (
              slashCommandOptions.map((option) => (
                <button
                  key={option.id}
                  className="slash-command-option"
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectSlashCommand(option)}
                >
                  <span className="slash-command-title">{option.title}</span>
                  <span className="slash-command-content">{option.description}</span>
                </button>
              ))
            ) : (
              <p className="slash-command-empty">未找到匹配提示词</p>
            )}
          </div>
        ) : null}
      </div>
      <div className="composer-actions">
        <div className="composer-switches">
          <ComposerSwitch ariaLabel="流式响应" checked={streamMode} label="流式响应" onToggle={() => setStreamMode(!streamMode)} />
          <ComposerSwitch
            ariaLabel="提取模式"
            checked={contextMode === "all"}
            label={contextModeLabel}
            onToggle={() => setContextMode(contextMode === "all" ? "text" : "all")}
          />
        </div>
        <button className="ui-button-primary" type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {sending ? "发送中" : automationModeActive ? "自动化" : "发送"}
        </button>
      </div>
      {previewAttachment ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" />
          <section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label="图片预览">
            <button className="ui-button-secondary image-preview-close" type="button" aria-label="关闭图片预览" onClick={() => setPreviewAttachment(undefined)}>
              关闭
            </button>
            <img src={previewAttachment.dataUrl} alt={previewAttachment.name} />
          </section>
        </>
      ) : null}
      {contextDialogOpen ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" />
          <section className="context-dialog" role="dialog" aria-modal="true" aria-labelledby="context-dialog-title">
            <div className="context-dialog-header">
              <h2 className="context-dialog-title" id="context-dialog-title">
                当前页上下文
              </h2>
              <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭上下文" onClick={() => setContextDialogOpen(false)}>
                关闭
              </button>
            </div>
            <p className="context-preview">{pageContext.text || "暂无上下文"}</p>
          </section>
        </>
      ) : null}
      {automationDialog === "steps" && automationSession.pendingFlow ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" />
          <section className="automation-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-steps-dialog-title">
            <div className="context-dialog-header">
              <h2 className="context-dialog-title" id="automation-steps-dialog-title">
                自动化步骤确认
              </h2>
              <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭自动化步骤" onClick={() => setAutomationDialog(undefined)}>
                关闭
              </button>
            </div>
            <div className="automation-simulation-panel">
              <p>模拟步骤</p>
              <ol>
                {automationSession.pendingFlow.sopSteps.map((step, index) => (
                  <li key={`${step}-${index}`}>
                    <span>{step}</span>
                    <AutomationActionPreview action={automationSession.pendingFlow?.actions[index]} />
                  </li>
                ))}
              </ol>
            </div>
            <div className="automation-dialog-actions">
              <button className="ui-button-secondary" type="button" onClick={() => setAutomationDialog(undefined)}>
                稍后处理
              </button>
              <button className="ui-button-primary" type="button" onClick={() => void confirmAutomationFlow()}>
                {automationSession.flowId ? "开始执行" : "允许并保存流程"}
              </button>
            </div>
          </section>
        </>
      ) : null}
      {automationDialog === "results" && automationSession.collectedData.length > 0 ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" />
          <section className="automation-dialog automation-result-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-results-dialog-title">
            <div className="context-dialog-header">
              <h2 className="context-dialog-title" id="automation-results-dialog-title">
                自动化执行结果
              </h2>
              <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭自动化结果" onClick={() => setAutomationDialog(undefined)}>
                关闭
              </button>
            </div>
            <div className="automation-result-panel">
              <p>执行结果</p>
              <ul>
                {automationSession.collectedData.map((item, index) => (
                  <li key={`automation-result-${index}`}>
                    <span>{formatAutomationResult(item)}</span>
                    <pre>{formatAutomationResultJson(item)}</pre>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

function getPastedImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const paddingBytes = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - paddingBytes);
}

function findSlashCommand(value: string): { startIndex: number; query: string } | undefined {
  const startIndex = value.lastIndexOf("/");
  if (startIndex < 0) {
    return undefined;
  }

  const query = value.slice(startIndex + 1);
  if (/\s/.test(query)) {
    return undefined;
  }

  return { startIndex, query };
}

export function removeSlashCommandSegment(value: string, fallbackStartIndex?: number): string {
  const slashInfo = findSlashCommand(value);
  const startIndex = slashInfo?.startIndex ?? fallbackStartIndex;
  if (startIndex === undefined || startIndex < 0) {
    return value;
  }

  const afterSlashText = value.slice(startIndex + 1);
  const nextWhitespaceIndex = afterSlashText.search(/\s/);
  const endIndex = nextWhitespaceIndex < 0 ? value.length : startIndex + 1 + nextWhitespaceIndex;
  const before = value.slice(0, startIndex);
  const after = value.slice(endIndex);
  if (!before) {
    return after.replace(/^\s+/, "");
  }
  if (!after) {
    return before.replace(/\s+$/, "");
  }
  if (/\s$/.test(before) && /^\s/.test(after)) {
    return `${before}${after.replace(/^\s+/, "")}`;
  }

  return `${before}${after}`;
}

function buildSlashCommandOptions(promptTemplates: PromptTemplate[], automationFlows: AutomationFlow[], query: string): SlashCommandOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const builtInOptions: SlashCommandOption[] = [
    {
      id: "automation-start",
      kind: "automation-start",
      title: "/自动化",
      description: "进入自动化模式，先 Battle 再执行",
    },
    {
      id: "automation-exit",
      kind: "automation-exit",
      title: "/退出自动化",
      description: "退出当前自动化模式",
    },
    ...automationFlows
      .filter((flow) => flow.enabled)
      .map((flow): SlashCommandOption => ({
        id: `automation-flow-${flow.id}`,
        kind: "automation-flow",
        title: flow.name,
        description: `调用自动化流程：${flow.urlPattern}`,
        flow,
      })),
  ];
  const promptOptions = promptTemplates.map((prompt): SlashCommandOption => ({
    id: `prompt-${prompt.id}`,
    kind: "prompt",
    title: prompt.title,
    description: prompt.content,
    prompt,
  }));
  const options = [...builtInOptions, ...promptOptions];
  if (!normalizedQuery) {
    return options;
  }

  return options.filter((option) => `${option.title}\n${option.description}`.toLowerCase().includes(normalizedQuery));
}

function sendRuntimeMessage<T>(message: { type: string }): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error("Chrome runtime 不可用"));
      return;
    }

    let settled = false;
    const finish = (response: T | undefined) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    try {
      // 真实 Chrome 扩展环境可能走 callback 形态；保留 Promise 兼容是为了适配测试环境和不同浏览器实现。
      const maybePromise = runtime.sendMessage(message, (response: T) => {
        const lastError = runtime.lastError;
        if (lastError) {
          fail(new Error(lastError.message));
          return;
        }

        finish(response);
      }) as Promise<T> | undefined;

      if (maybePromise && typeof maybePromise.then === "function") {
        void maybePromise.then(finish).catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function isSendShortcut(event: ReactKeyboardEvent<HTMLElement>, shortcut: SendShortcut): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) {
    return false;
  }

  const modifiers = {
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  switch (shortcut) {
    case "enter":
      return !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey;
    case "shift_enter":
      return modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey;
    case "ctrl_enter":
      return modifiers.ctrlKey && !modifiers.shiftKey && !modifiers.altKey && !modifiers.metaKey;
    case "ctrl_shift_enter":
      return modifiers.ctrlKey && modifiers.shiftKey && !modifiers.altKey && !modifiers.metaKey;
    case "alt_enter":
      return modifiers.altKey && !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey;
    default:
      return false;
  }
}
