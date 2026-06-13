import { useEffect, useRef, useState, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "../../shared/networkContext";
import { formatTavilySearchAttachmentSummary } from "../../shared/webSearch/tavily";
import { collectMessageToolAttachments, collectRawMessageToolAttachments, isNetworkToolAttachment, isWebSearchToolAttachment } from "../../shared/toolArtifacts";
import { createChatMessageMarkdown } from "../utils/chatMarkdownExport";
import { copyOrDownloadMessageImage, copyTextToClipboard } from "../utils/messageClipboard";
import type { ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatToolAttachment, ChatToolCallRecord, ToolCallDisplayMode } from "../../shared/types";
import { PromptInlineEditor, PromptTokenContent } from "./PromptInlineEditor";

interface MessageListProps {
  messages: ChatMessage[];
  toolCallDisplayMode: ToolCallDisplayMode;
  showToolCallProcessInAssistantMode: boolean;
  onRegenerateMessage: (messageId: string) => void;
  onEditAndRegenerateUserMessage: (messageId: string, content: string, promptInvocations?: ChatPromptInvocation[]) => void;
  regenerating: boolean;
}

export function MessageList({
  messages,
  toolCallDisplayMode,
  showToolCallProcessInAssistantMode,
  onRegenerateMessage,
  onEditAndRegenerateUserMessage,
  regenerating,
}: MessageListProps) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | undefined>();
  const [editingMessageId, setEditingMessageId] = useState<string | undefined>();
  const [editingContent, setEditingContent] = useState("");
  const [editingPromptInvocations, setEditingPromptInvocations] = useState<ChatPromptInvocation[]>([]);
  const [messageActionFeedback, setMessageActionFeedback] = useState<{ messageId: string; text: string; tone: "success" | "error" } | undefined>();
  const [activeToolCallId, setActiveToolCallId] = useState<string | undefined>();
  const regeneratePopoverRef = useRef<HTMLDivElement>(null);
  const toolCallPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingRegenerateMessageId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !regeneratePopoverRef.current?.contains(target)) {
        setPendingRegenerateMessageId(undefined);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pendingRegenerateMessageId]);

  useEffect(() => {
    if (!activeToolCallId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !toolCallPopoverRef.current?.contains(target)) {
        setActiveToolCallId(undefined);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveToolCallId(undefined);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeToolCallId]);

  useEffect(() => {
    if (!messageActionFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setMessageActionFeedback(undefined), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [messageActionFeedback]);

  const handleCopyMessage = async (message: ChatMessage) => {
    try {
      await copyTextToClipboard(createChatMessageMarkdown(message));
      setMessageActionFeedback({ messageId: message.id, text: "已复制", tone: "success" });
    } catch (error) {
      setMessageActionFeedback({ messageId: message.id, text: error instanceof Error ? error.message : "复制失败，请重试", tone: "error" });
    }
  };

  const handleExportMessageImage = async (message: ChatMessage) => {
    try {
      const result = await copyOrDownloadMessageImage(createChatMessageMarkdown(message));
      setMessageActionFeedback({ messageId: message.id, text: result === "copied" ? "图片已复制" : "图片已下载", tone: "success" });
    } catch {
      setMessageActionFeedback({ messageId: message.id, text: "导出图片失败，请重试", tone: "error" });
    }
  };

  if (messages.length === 0) {
    return (
      <section aria-label="消息列表" className="message-list">
        <p className="ui-muted text-sm">暂无消息</p>
      </section>
    );
  }

  return (
    <section aria-label="消息列表" className="message-list">
      {messages.map((message) => {
        const isToolCallTurn = message.role === "assistant" && message.assistantMessageKind === "tool_call_turn";
        const shouldShowToolCallTimeline = shouldShowToolCallTimelineForMessage(message, toolCallDisplayMode, showToolCallProcessInAssistantMode);
        const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
        const hasVisibleThinking = message.role === "assistant" && !isToolCallTurn && Boolean(message.thinking) && !hideToolTurnContent;
        const hasVisibleContent = Boolean(message.content.trim()) && !hideToolTurnContent;
        const hasVisibleArticle =
          message.role !== "assistant" ||
          !isToolCallTurn ||
          hasVisibleThinking ||
          hasVisibleContent ||
          Boolean(message.attachments?.length) ||
          Boolean(collectMessageToolAttachments(message).length);

        return (
        <div key={message.id} className="message-entry">
          {message.role === "assistant" && message.toolCallRecords?.length && message.assistantMessageKind !== "tool_call_turn" ? (
            <ToolCallTimeline
              records={message.toolCallRecords}
              attachments={collectRawMessageToolAttachments(message)}
              activeToolCallId={activeToolCallId}
              popoverRef={toolCallPopoverRef}
              panelCentered
              onToggle={(recordId) => setActiveToolCallId((current) => (current === recordId ? undefined : recordId))}
            />
          ) : null}
        {hasVisibleArticle ? (
        <article className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
          <div className="message-avatar" aria-hidden="true">
            {message.role === "user" ? "我" : "AI"}
          </div>
          <div className="message-bubble-wrap">
            {hasVisibleThinking ? (
              <details className="message-thinking" open={shouldOpenThinking(message) || undefined}>
                <summary>{message.streaming ? "思考中" : "思考过程"}</summary>
                <p>{message.thinking}</p>
              </details>
            ) : null}
            {message.attachments?.length ? (
              <div className="message-image-preview-strip" aria-label="已发送图片">
                {message.attachments.map((attachment) => (
                  <button
                    className="image-preview-thumb"
                    type="button"
                    key={attachment.id}
                    aria-label={`查看已发送图片 ${attachment.name}`}
                    onClick={() => setPreviewAttachment(attachment)}
                  >
                    <img src={attachment.dataUrl} alt="" />
                  </button>
                ))}
              </div>
            ) : null}
            {editingMessageId === message.id ? (
              <div className="message-edit-panel">
                <PromptInlineEditor
                  className="ui-input message-edit-input"
                  ariaLabel="编辑用户消息"
                  value={editingContent}
                  promptInvocations={editingPromptInvocations}
                  promptAriaLabelPrefix="编辑消息提示词"
                  onChange={setEditingContent}
                  onRemovePrompt={(index) => setEditingPromptInvocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                />
                <div className="message-edit-actions">
                  <button
                    className="message-icon-button message-edit-cancel-button"
                    type="button"
                    aria-label="取消编辑"
                    title="取消编辑"
                    onClick={() => {
                      setEditingMessageId(undefined);
                      setEditingContent("");
                      setEditingPromptInvocations([]);
                    }}
                  >
                    <CancelEditIcon />
                  </button>
                  <button
                    className="message-icon-button message-edit-send-button"
                    type="button"
                    aria-label="发送编辑后的消息"
                    title="发送编辑后的消息"
                    disabled={regenerating || (!editingContent.trim() && editingPromptInvocations.length === 0)}
                    onClick={() => {
                      const trimmedContent = editingContent.trim();
                      if (!trimmedContent && editingPromptInvocations.length === 0) {
                        return;
                      }

                      setEditingMessageId(undefined);
                      setEditingContent("");
                      const nextPromptInvocations = editingPromptInvocations;
                      setEditingPromptInvocations([]);
                      onEditAndRegenerateUserMessage(message.id, trimmedContent, nextPromptInvocations);
                    }}
                  >
                    <SendEditedMessageIcon />
                  </button>
                </div>
              </div>
            ) : (
              <div className={`message-bubble${message.role === "user" && message.promptInvocations?.length ? " message-bubble-with-prompts" : ""}`}>
                {message.role === "user" && message.promptInvocations?.length ? (
                  <PromptTokenLinks prompts={message.promptInvocations} ariaLabelPrefix="用户消息提示词" />
                ) : null}
                {hasVisibleContent ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : null}
              </div>
            )}
            {message.role === "assistant" ? <ToolAttachmentList message={message} /> : null}
            {!isToolCallTurn ? (
              <div className={`message-regenerate-action message-regenerate-action-${message.role}`}>
              {message.role === "user" ? (
                <button
                  className="message-icon-button message-edit-button"
                  type="button"
                  aria-label="编辑消息"
                  title="编辑消息"
                  disabled={regenerating || message.streaming}
                  onClick={() => {
                    setPendingRegenerateMessageId(undefined);
                    setEditingMessageId(message.id);
                    setEditingContent(message.content);
                    setEditingPromptInvocations(message.promptInvocations ?? []);
                  }}
                >
                  <EditMessageIcon />
                </button>
              ) : null}
              <button
                className="message-icon-button message-regenerate-button"
                type="button"
                aria-label="重新生成"
                title="重新生成"
                disabled={regenerating || message.streaming}
                onClick={() => setPendingRegenerateMessageId(message.id)}
              >
                <RegenerateIcon />
              </button>
              <button
                className="message-icon-button message-copy-button"
                type="button"
                aria-label={message.role === "user" ? "复制用户消息" : "复制 AI 消息"}
                title={message.role === "user" ? "复制用户消息" : "复制 AI 消息"}
                onClick={() => void handleCopyMessage(message)}
              >
                <CopyMessageIcon />
              </button>
              {message.role === "assistant" ? (
                <button
                  className="message-icon-button message-export-image-button"
                  type="button"
                  aria-label="导出 AI 消息图片"
                  title="导出 AI 消息图片"
                  onClick={() => void handleExportMessageImage(message)}
                >
                  <ExportImageIcon />
                </button>
              ) : null}
              {pendingRegenerateMessageId === message.id ? (
                <div className="message-regenerate-popover" role="dialog" aria-label="确认重新生成" ref={regeneratePopoverRef}>
                  <p>重新生成会丢弃这条消息后面的聊天记录。</p>
                  <div className="message-regenerate-popover-actions">
                    <button className="ui-button-secondary message-regenerate-cancel" type="button" onClick={() => setPendingRegenerateMessageId(undefined)}>
                      取消
                    </button>
                    <button
                      className="ui-button-primary message-regenerate-confirm"
                      type="button"
                      onClick={() => {
                        setPendingRegenerateMessageId(undefined);
                        onRegenerateMessage(message.id);
                      }}
                    >
                      确认重新生成
                    </button>
                  </div>
                </div>
              ) : null}
              {messageActionFeedback?.messageId === message.id ? (
                <span className={`message-action-feedback message-action-feedback-${messageActionFeedback.tone}`} role="status">
                  {messageActionFeedback.text}
                </span>
              ) : null}
              </div>
            ) : null}
          </div>
        </article>
        ) : null}
        {shouldShowToolCallTimeline ? (
          <ToolCallTimeline
            records={message.toolCallRecords}
            attachments={collectRawMessageToolAttachments(message)}
            activeToolCallId={activeToolCallId}
            popoverRef={toolCallPopoverRef}
            panelCentered
            onToggle={(recordId) => setActiveToolCallId((current) => (current === recordId ? undefined : recordId))}
          />
        ) : null}
        </div>
      );
      })}
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
    </section>
  );
}

function ToolCallTimeline({
  records,
  attachments,
  activeToolCallId,
  popoverRef,
  panelCentered = false,
  onToggle,
}: {
  records: ChatToolCallRecord[];
  attachments: ChatToolAttachment[];
  activeToolCallId?: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  panelCentered?: boolean;
  onToggle: (recordId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = records.length > 5;
  const visibleRecords = shouldCollapse && !expanded ? records.slice(-1) : records;

  return (
    <div className={panelCentered ? "message-tool-call-list message-tool-call-list-panel-centered" : "message-tool-call-list"} aria-label="工具调用记录">
      {shouldCollapse ? (
        <button className="message-tool-call-collapse-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起工具调用" : `展开全部工具调用（共 ${records.length} 次）`}
        </button>
      ) : null}
      {visibleRecords.map((record) => {
        const completed = record.status !== "running";
        const relatedAttachments = attachments.filter((attachment) => record.attachmentIds?.includes(attachment.id) || attachment.sourceToolCallId === record.id);
        return (
          <div key={record.id} className="message-tool-call-row">
            <button
              className="message-tool-call-trigger"
              type="button"
              disabled={!completed}
              aria-disabled={!completed}
              aria-expanded={activeToolCallId === record.id}
              onClick={() => completed && onToggle(record.id)}
            >
              {formatToolCallLine(record)}
            </button>
            {activeToolCallId === record.id && completed ? (
              <div className="message-tool-call-popover" role="dialog" aria-label={`${record.displayName} 调用详情`} ref={popoverRef}>
                <dl>
                  <div>
                    <dt>工具</dt>
                    <dd>{record.displayName}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{record.status === "success" ? "已完成" : "失败"}</dd>
                  </div>
                  <div>
                    <dt>耗时</dt>
                    <dd>{formatToolDuration(record)}</dd>
                  </div>
                  <div>
                    <dt>参数</dt>
                    <dd>
                      <pre>{JSON.stringify(record.arguments, null, 2)}</pre>
                    </dd>
                  </div>
                  <div>
                    <dt>{record.status === "error" ? "错误" : "结果"}</dt>
                    <dd>{record.errorMessage || record.resultSummary || "工具没有返回可展示摘要"}</dd>
                  </div>
                  {relatedAttachments.length ? (
                    <div>
                      <dt>附件</dt>
                      <dd>{relatedAttachments.map((attachment) => attachment.title).join("、")}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ToolAttachmentList({ message }: { message: ChatMessage }) {
  const attachments = collectMessageToolAttachments(message);
  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      {attachments.map((attachment) => (
        <ToolAttachmentView key={attachment.id} attachment={attachment} />
      ))}
    </>
  );
}

function ToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (isNetworkToolAttachment(attachment)) {
    return <NetworkToolAttachmentView attachment={attachment} />;
  }

  if (isWebSearchToolAttachment(attachment)) {
    return <WebSearchToolAttachmentView attachment={attachment} />;
  }

  return (
    <details className={`message-tool-attachment message-${attachment.kind}-attachment`}>
      <summary>
        <span>{attachment.title}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.details ? <pre>{attachment.details}</pre> : null}
    </details>
  );
}

function NetworkToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isNetworkToolAttachment(attachment)) {
    return null;
  }

  const requests = attachment.requests.map(redactNetworkRequestDetail);
  const summary = formatNetworkAttachmentSummary(requests);

  return (
    <details className="message-tool-attachment message-network-attachment">
      <summary>
        <span>Network 请求详情</span>
        <span className="message-network-count">{requests.length}</span>
      </summary>
      <p className="message-network-summary">{summary}</p>
      <ul className="message-network-request-list">
        {requests.map((request) => (
          <li key={request.id} className="message-network-request-item">
            <details>
              <summary>
                <span className="message-network-request-line">
                  {request.method || "UNKNOWN"} {request.status ?? "unknown"} {request.url}
                </span>
                <span className="message-network-flags">
                  {request.redacted ? "已脱敏" : "原文"}
                  {request.truncated ? " · 已截断" : ""}
                </span>
              </summary>
              <pre>{JSON.stringify(request, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

function WebSearchToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isWebSearchToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-web-search-attachment">
      <summary>
        <span>网络搜索结果</span>
        <span className="message-web-search-count">{attachment.results.length}</span>
      </summary>
      <p className="message-web-search-summary">{formatTavilySearchAttachmentSummary(attachment)}</p>
      <ul className="message-web-search-result-list">
        {attachment.results.map((result, index) => (
          <li key={`${result.url}-${index}`} className="message-web-search-result-item">
            <details>
              <summary>
                <span className="message-web-search-result-line">{result.title || result.url}</span>
                <span className="message-web-search-flags">{attachment.provider}</span>
              </summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

function formatToolCallLine(record: ChatToolCallRecord): string {
  const query = typeof record.arguments.query === "string" && record.arguments.query.trim() ? `：${record.arguments.query.trim()}` : "";
  if (record.status === "running") {
    return `正在调用 ${record.displayName}${query}`;
  }
  if (record.status === "error") {
    return `${record.displayName} 调用失败${query}`;
  }
  return `已调用 ${record.displayName}${query}`;
}

function formatToolDuration(record: ChatToolCallRecord): string {
  if (!record.completedAt) {
    return "进行中";
  }
  return `${Math.max(0, record.completedAt - record.startedAt)} ms`;
}

function PromptTokenLinks({ prompts, ariaLabelPrefix }: { prompts: ChatPromptInvocation[]; ariaLabelPrefix: string }) {
  return (
    <span className="message-prompt-token-strip">
      {prompts.map((prompt, index) => (
        <span key={`${prompt.promptId}-${index}`} className="prompt-token-link" aria-label={`${ariaLabelPrefix}：${prompt.title}`}>
          <PromptTokenContent title={prompt.title} />
        </span>
      ))}
    </span>
  );
}

function RegenerateIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M18.5 9.5A6.2 6.2 0 0 0 7.8 6.2L5.5 8.5" />
      <path d="M5.5 5.5v3h3" />
      <path d="M5.5 14.5a6.2 6.2 0 0 0 10.7 3.3l2.3-2.3" />
      <path d="M18.5 18.5v-3h-3" />
    </svg>
  );
}

function EditMessageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 18.5 6.2 14 15.7 4.5a2.1 2.1 0 0 1 3 3L9.2 17 5 18.5Z" />
      <path d="m14.2 6 3.8 3.8" />
    </svg>
  );
}

function SendEditedMessageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4.5 5.5 19.5 12 4.5 18.5 7.5 12 4.5 5.5Z" />
      <path d="M7.8 12h5.8" />
    </svg>
  );
}

function CancelEditIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M7 7 17 17" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function CopyMessageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M8 8h10v10H8Z" />
      <path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function ExportImageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 5h14v14H5Z" />
      <path d="m8 15 2.8-3 2.2 2.3 1.4-1.5L18 17" />
      <circle cx="9" cy="9.5" r="0.8" />
    </svg>
  );
}

function shouldOpenThinking(message: ChatMessage): boolean {
  if (!message.streaming || !message.thinking) {
    return false;
  }

  return message.thinking.split(/\r?\n/).length <= 5;
}

function shouldHideToolTurnContent(message: ChatMessage, displayMode: ToolCallDisplayMode): boolean {
  return displayMode === "compact" && message.assistantMessageKind === "tool_call_turn";
}

function shouldShowToolCallTimelineForMessage(
  message: ChatMessage,
  displayMode: ToolCallDisplayMode,
  showToolCallProcessInAssistantMode: boolean,
): message is ChatMessage & { toolCallRecords: ChatToolCallRecord[] } {
  if (message.role !== "assistant" || !message.toolCallRecords?.length) {
    return false;
  }

  if (message.assistantMessageKind !== "tool_call_turn") {
    return false;
  }

  return displayMode === "compact" || showToolCallProcessInAssistantMode;
}
