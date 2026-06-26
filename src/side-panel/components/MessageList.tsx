import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "../../shared/networkContext";
import { formatTavilySearchAttachmentSummary } from "../../shared/webSearch/tavily";
import {
  aggregateToolAttachmentGroupByKind,
  collectMessageToolAttachments,
  collectRawMessageToolAttachments,
  formatAutomationReportTypeLabel,
  isAutomationReportToolAttachment,
  isBrowserScreenshotToolAttachment,
  isJsSourceToolAttachment,
  isNetworkToolAttachment,
  isSourceMapToolAttachment,
  isWebSearchToolAttachment,
} from "../../shared/toolArtifacts";
import { createChatMessageMarkdown } from "../utils/chatMarkdownExport";
import { copyOrDownloadMessageImage, copyTextToClipboard } from "../utils/messageClipboard";
import type { ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatToolAttachment, ChatToolCallRecord, ToolCallDisplayMode } from "../../shared/types";
import { MarkdownCodeBlock, MarkdownCodePre } from "./MarkdownCodeBlock";
import { PromptInlineEditor, PromptTokenContent } from "./PromptInlineEditor";
import type { ChatRetryProgress } from "../state/appStore";

const MESSAGE_LIST_BOTTOM_THRESHOLD = 8;

interface MessageListProps {
  messages: ChatMessage[];
  retryProgressByMessageId: Record<string, ChatRetryProgress>;
  toolCallDisplayMode: ToolCallDisplayMode;
  showToolCallProcessInAssistantMode: boolean;
  onRegenerateMessage: (messageId: string) => void;
  onEditAndRegenerateUserMessage: (messageId: string, content: string, promptInvocations?: ChatPromptInvocation[]) => void;
  regenerating: boolean;
}

export function MessageList({
  messages,
  retryProgressByMessageId,
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
  const messageListRef = useRef<HTMLElement>(null);
  // 初次进入会话时默认贴底；一旦用户主动上滚，滚动事件会把它改为 false，避免后续更新抢回底部。
  const shouldStickToBottomRef = useRef(true);
  const regeneratePopoverRef = useRef<HTMLDivElement>(null);
  const toolCallPopoverRef = useRef<HTMLDivElement>(null);
  const displayAttachmentGroups = useMemo(
    () => createDisplayAttachmentGroups(messages, toolCallDisplayMode),
    [messages, toolCallDisplayMode],
  );

  const handleMessageListScroll = () => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    shouldStickToBottomRef.current = isMessageListAtBottom(messageList);
  };

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !shouldStickToBottomRef.current) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
  }, [displayAttachmentGroups, messages, retryProgressByMessageId, showToolCallProcessInAssistantMode, toolCallDisplayMode]);

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
      <section aria-label="消息列表" className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
        <p className="ui-muted text-sm">暂无消息</p>
      </section>
    );
  }

  return (
    <section aria-label="消息列表" className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
      {messages.map((message) => {
        const isToolCallTurn = message.role === "assistant" && message.assistantMessageKind === "tool_call_turn";
        const shouldShowToolCallTimeline = shouldShowToolCallTimelineForMessage(message, toolCallDisplayMode, showToolCallProcessInAssistantMode);
        const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
        const toolCallRecords = message.toolCallRecords ?? [];
        const hasVisibleThinking = message.role === "assistant" && !isToolCallTurn && Boolean(message.thinking) && !hideToolTurnContent;
        const hasVisibleContent = Boolean(message.content.trim()) && !hideToolTurnContent;
        const hasPromptTokens = message.role === "user" && Boolean(message.promptInvocations?.length);
        const shouldRenderMessageBubble = hasVisibleContent || hasPromptTokens;
        const displayAttachments = displayAttachmentGroups.get(message.id) ?? [];
        const retryProgress = message.role === "assistant" ? retryProgressByMessageId[message.id] : undefined;
        const hasVisibleArticle =
          message.role !== "assistant" ||
          !isToolCallTurn ||
          hasVisibleThinking ||
          hasVisibleContent ||
          Boolean(retryProgress) ||
          Boolean(message.attachments?.length) ||
          Boolean(displayAttachments.length);
        const shouldShowPreArticleToolTimeline =
          message.role === "assistant" && toolCallRecords.length > 0 && message.assistantMessageKind !== "tool_call_turn";

        if (!shouldShowPreArticleToolTimeline && !hasVisibleArticle && !shouldShowToolCallTimeline) {
          return null;
        }

        return (
        <div key={message.id} className="message-entry">
          {shouldShowPreArticleToolTimeline ? (
            <ToolCallTimeline
              records={toolCallRecords}
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
            {retryProgress ? <MessageRetryProgress progress={retryProgress} /> : null}
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
            ) : shouldRenderMessageBubble ? (
              <div className={`message-bubble${message.role === "user" && message.promptInvocations?.length ? " message-bubble-with-prompts" : ""}`}>
                {message.role === "user" && message.promptInvocations?.length ? (
                  <PromptTokenLinks prompts={message.promptInvocations} ariaLabelPrefix="用户消息提示词" />
                ) : null}
                {hasVisibleContent ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCodeBlock, pre: MarkdownCodePre }}>{message.content}</ReactMarkdown> : null}
              </div>
            ) : null}
            {message.role === "assistant" ? <ToolAttachmentList attachments={displayAttachments} onPreviewImage={setPreviewAttachment} /> : null}
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

function isMessageListAtBottom(messageList: HTMLElement): boolean {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <= MESSAGE_LIST_BOTTOM_THRESHOLD;
}

function MessageRetryProgress({ progress }: { progress: ChatRetryProgress }) {
  return (
    <div className="message-retry-progress" role="status" aria-live="polite">
      <span className="message-retry-progress-dot" aria-hidden="true" />
      <span>{`正在重试 ${progress.currentRetry}/${progress.maxRetries}`}</span>
    </div>
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

function ToolAttachmentList({ attachments, onPreviewImage }: { attachments: ChatToolAttachment[]; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      {attachments.map((attachment) => (
        <ToolAttachmentView key={attachment.id} attachment={attachment} onPreviewImage={onPreviewImage} />
      ))}
    </>
  );
}

function createDisplayAttachmentGroups(messages: ChatMessage[], toolCallDisplayMode: ToolCallDisplayMode): Map<string, ChatToolAttachment[]> {
  const groups = new Map<string, ChatToolAttachment[]>();
  let lastAssistantBubbleMessageId: string | undefined;
  for (const message of messages) {
    const isAssistant = message.role === "assistant";
    const isToolCallTurn = isAssistant && message.assistantMessageKind === "tool_call_turn";
    const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
    const hasVisibleAssistantBubble = isAssistant && Boolean(message.content.trim()) && !hideToolTurnContent;
    const attachments = isAssistant ? collectRawMessageToolAttachments(message) : [];
    const targetMessageId = isToolCallTurn && !hasVisibleAssistantBubble && attachments.length > 0 && lastAssistantBubbleMessageId ? lastAssistantBubbleMessageId : message.id;

    if (attachments.length > 0) {
      groups.set(targetMessageId, aggregateDisplayAttachmentsByKind([...(groups.get(targetMessageId) ?? []), ...attachments]));
    }
    if (hasVisibleAssistantBubble) {
      lastAssistantBubbleMessageId = message.id;
    }
  }
  return groups;
}

export function aggregateDisplayAttachmentsByKind(attachments: ChatToolAttachment[]): ChatToolAttachment[] {
  const groups = new Map<string, ChatToolAttachment[]>();
  const order: string[] = [];
  for (const attachment of attachments) {
    if (isBrowserScreenshotToolAttachment(attachment)) {
      const key = `${attachment.kind}:${attachment.id}`;
      groups.set(key, [attachment]);
      order.push(key);
      continue;
    }
    if (!groups.has(attachment.kind)) {
      groups.set(attachment.kind, []);
      order.push(attachment.kind);
    }
    groups.get(attachment.kind)?.push(attachment);
  }

  return order.map((kind) => aggregateDisplayAttachmentKindGroup(kind.split(":")[0] ?? kind, groups.get(kind) ?? [])).filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
}

function aggregateDisplayAttachmentKindGroup(kind: string, attachments: ChatToolAttachment[]): ChatToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }
  if (attachments.length === 1) {
    return attachments[0];
  }

  if (kind === "network") {
    const networkAttachments = attachments.filter(isNetworkToolAttachment);
    const allFullAccessRaw = networkAttachments.every((attachment) => attachment.fullAccess === true && attachment.redacted === false);
    const canShowUnredacted = allFullAccessRaw || (networkAttachments.length === 1 && networkAttachments[0]?.redacted === false);
    const requests = uniqueDisplayItems(
      networkAttachments.flatMap((attachment) => canShowUnredacted
        ? attachment.requests
        : attachment.requests.map(redactNetworkRequestDetail)),
      (request) => request.id.trim() || `${request.method}\u0000${request.url}\u0000${request.status ?? ""}`,
    );
    return {
      id: `message-display-network-${attachments.map((attachment) => attachment.id).join("-")}`,
      kind: "network",
      title: "Network 请求详情",
      summary: formatNetworkAttachmentSummary(requests),
      createdAt: getMaxCreatedAt(networkAttachments),
      redacted: !canShowUnredacted,
      fullAccess: allFullAccessRaw || undefined,
      truncated: networkAttachments.some((attachment) => attachment.truncated || attachment.requests.some((request) => request.truncated)),
      requests,
    };
  }

  if (kind === "web-search") {
    const webSearchAttachments = attachments.filter(isWebSearchToolAttachment);
    const first = webSearchAttachments[0];
    if (!first) {
      return attachments[0];
    }
    const results = uniqueDisplayItems(
      webSearchAttachments.flatMap((attachment) => attachment.results),
      (result) => result.url.trim() || result.title.trim(),
    );
    const aggregated = {
      ...first,
      id: `message-display-web-search-${attachments.map((attachment) => attachment.id).join("-")}`,
      query: [...new Set(webSearchAttachments.map((attachment) => attachment.query).filter(Boolean))].join("；"),
      answer: webSearchAttachments.map((attachment) => attachment.answer).filter(Boolean).join("\n\n") || undefined,
      results,
      createdAt: getMaxCreatedAt(webSearchAttachments),
      truncated: webSearchAttachments.some((attachment) => attachment.truncated),
    };
    return {
      ...aggregated,
      summary: formatTavilySearchAttachmentSummary(aggregated),
    };
  }

  if (kind === "js-source") {
    const aggregated = aggregateToolAttachmentGroupByKind(attachments.filter(isJsSourceToolAttachment));
    if (!aggregated) {
      return attachments[0];
    }
    return {
      ...aggregated,
      id: `message-display-js-source-${attachments.map((attachment) => attachment.id).join("-")}`,
    };
  }

  if (kind === "source-map") {
    const aggregated = aggregateToolAttachmentGroupByKind(attachments.filter(isSourceMapToolAttachment));
    if (!aggregated) {
      return attachments[0];
    }
    return {
      ...aggregated,
      id: `message-display-source-map-${attachments.map((attachment) => attachment.id).join("-")}`,
    };
  }

  return aggregateGenericDisplayAttachments(kind, attachments);
}

function getMaxCreatedAt(attachments: ChatToolAttachment[]): number {
  const values = attachments.map((attachment) => attachment.createdAt).filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

function aggregateGenericDisplayAttachments(kind: string, attachments: ChatToolAttachment[]): ChatToolAttachment {
  const first = attachments[0];
  if (attachments.length === 1) {
    return first;
  }

  const details = uniqueNonEmptyStrings(
    attachments.map((attachment) => ("details" in attachment && typeof attachment.details === "string" ? attachment.details : undefined)),
  ).join("\n\n");

  return {
    id: `message-display-${kind}-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind,
    title: first.title,
    summary: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.summary)).join("\n"),
    createdAt: getMaxCreatedAt(attachments),
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated),
    details: details || undefined,
  };
}

function uniqueDisplayItems<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

function uniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function ToolAttachmentView({ attachment, onPreviewImage }: { attachment: ChatToolAttachment; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (isNetworkToolAttachment(attachment)) {
    return <NetworkToolAttachmentView attachment={attachment} />;
  }

  if (isWebSearchToolAttachment(attachment)) {
    return <WebSearchToolAttachmentView attachment={attachment} />;
  }

  if (isJsSourceToolAttachment(attachment)) {
    return <JsSourceToolAttachmentView attachment={attachment} />;
  }

  if (isSourceMapToolAttachment(attachment)) {
    return <SourceMapToolAttachmentView attachment={attachment} />;
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return <BrowserScreenshotToolAttachmentView attachment={attachment} onPreviewImage={onPreviewImage} />;
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return <AutomationReportToolAttachmentView attachment={attachment} />;
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

function AutomationReportToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isAutomationReportToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-automation-report-attachment">
      <summary>
        <span>自动化任务报告</span>
        <span className="message-network-count">{attachment.steps.length}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      <p className="message-tool-attachment-summary">目标：{attachment.objective}</p>
      <p className="message-tool-attachment-summary">任务类型：{formatAutomationReportTypeLabel(attachment.reportType)}</p>
      <p className="message-tool-attachment-summary">结论：{attachment.conclusion}</p>
      <p className="message-tool-attachment-summary">完全访问原文结果：{attachment.fullAccessIncluded ? "是" : "否"}</p>
      {attachment.timeline.length > 0 ? (
        <>
          <p className="message-tool-attachment-summary">时间线</p>
          <ol className="message-automation-report-timeline-list">
            {attachment.timeline.map((event) => (
              <li key={event.id}>
                <strong>{event.label}</strong> [{event.type}]：{event.detail}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <ol className="message-automation-report-step-list">
        {attachment.steps.map((step) => (
          <li key={step.toolCallId}>
            <strong>{step.displayName}</strong> [{step.status}]：{step.evidence}
          </li>
        ))}
      </ol>
      {attachment.failureSummary ? (
        <p className="message-tool-attachment-summary">
          失败工具：{attachment.failureSummary.failedTools.join("、") || "无"}；可恢复动作：{attachment.failureSummary.recoverableActions.join("；") || "无"}
        </p>
      ) : null}
    </details>
  );
}

function BrowserScreenshotToolAttachmentView({ attachment, onPreviewImage }: { attachment: ChatToolAttachment; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (!isBrowserScreenshotToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-browser-screenshot-attachment">
      <summary>
        <span>{attachment.title || "浏览器截图"}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      <button
        className="message-browser-screenshot-preview"
        type="button"
        aria-label="全屏预览浏览器截图"
        onClick={() => onPreviewImage({
          id: attachment.id,
          name: attachment.title || "浏览器截图",
          mediaType: attachment.mediaType,
          dataUrl: attachment.dataUrl,
        })}
      >
        <img src={attachment.dataUrl} alt="浏览器截图" />
      </button>
    </details>
  );
}

function NetworkToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isNetworkToolAttachment(attachment)) {
    return null;
  }

  const requests = attachment.redacted === false ? attachment.requests : attachment.requests.map(redactNetworkRequestDetail);
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

function JsSourceToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isJsSourceToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-js-source-attachment">
      <summary>
        <span>JS 源码片段</span>
        <span className="message-js-source-count">{getJsSourceAttachmentDisplayCount(attachment)}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.resources.length ? (
        <ul className="message-js-source-resource-list">
          {attachment.resources.map((resource) => (
            <li key={resource.id}>
              {resource.source} | {resource.id} | {resource.url}
            </li>
          ))}
        </ul>
      ) : null}
      {attachment.jsMatches.map((match, index) => (
        <details key={`${match.resourceId}-${match.position}-${index}`}>
          <summary>
            <span>
              {match.resourceId}:{match.line}:{match.column} 命中 {match.term}
            </span>
          </summary>
          <pre>{match.snippet}</pre>
        </details>
      ))}
      {attachment.contexts.map((context, index) => (
        <details key={`${context.resourceId}-${context.position}-${index}`}>
          <summary>
            <span>
              {context.resourceId}:{context.line}:{context.column} 上下文
            </span>
          </summary>
          <pre>{context.snippet}</pre>
        </details>
      ))}
      {attachment.failedFetches.length ? <pre>{attachment.failedFetches.map((failure) => `${failure.url}: ${failure.message}`).join("\n")}</pre> : null}
    </details>
  );
}

function SourceMapToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isSourceMapToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-source-map-attachment">
      <summary>
        <span>Source Map 解析结果</span>
        <span className="message-js-source-count">{getSourceMapAttachmentDisplayCount(attachment)}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.candidates.length ? (
        <ul className="message-js-source-resource-list">
          {attachment.candidates.map((candidate, index) => (
            <li key={`${candidate.resourceId}-${candidate.source}-${candidate.url ?? "inline"}-${index}`}>
              {candidate.resourceId} | {candidate.source} | {candidate.status} | {formatSourceMapCandidateLocation(candidate)}
            </li>
          ))}
        </ul>
      ) : null}
      {attachment.resolvedLocations.map((location, index) => (
        <details key={`${location.resourceId}-${location.generatedLine}-${location.generatedColumn}-${index}`}>
          <summary>
            <span>
              {location.resourceId}:{location.generatedLine}:{location.generatedColumn} -&gt; {location.source ?? "未映射"}:{location.originalLine ?? "-"}:{location.originalColumn ?? "-"}
            </span>
          </summary>
          <pre>{formatSourceMapResolvedLocationForDisplay(location)}</pre>
        </details>
      ))}
      {attachment.originalContexts.map((context, index) => (
        <details key={`${context.resourceId}-${context.generatedLine}-${context.generatedColumn}-${context.source ?? ""}-${index}`}>
          <summary>
            <span>
              {context.source ?? "未映射"}:{context.originalLine ?? "-"}:{context.originalColumn ?? "-"} 原始上下文
            </span>
          </summary>
          <pre>{context.snippet ?? context.message ?? ""}</pre>
        </details>
      ))}
      {attachment.failures.length ? <pre>{attachment.failures.map((failure) => `${failure.resourceId ?? failure.url ?? "unknown"}: ${failure.message}`).join("\n")}</pre> : null}
    </details>
  );
}

function formatSourceMapCandidateLocation(candidate: Extract<ChatToolAttachment, { kind: "source-map" }>["candidates"][number]): string {
  if (candidate.inline) {
    return "inline";
  }
  return candidate.url ? "外部 Source Map" : "无 URL";
}

function formatSourceMapResolvedLocationForDisplay(location: Extract<ChatToolAttachment, { kind: "source-map" }>["resolvedLocations"][number]): string {
  return [
    `resourceId: ${location.resourceId}`,
    `generated: ${location.generatedLine}:${location.generatedColumn}`,
    `source: ${location.source ?? "未映射"}`,
    `original: ${location.originalLine ?? "-"}:${location.originalColumn ?? "-"}`,
    `name: ${location.name ?? "-"}`,
    `ignored: ${location.ignored ? "是" : "否"}`,
    `hasSourceContent: ${location.hasSourceContent ? "是" : "否"}`,
    location.message ? `message: ${location.message}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function getSourceMapAttachmentDisplayCount(attachment: ChatToolAttachment): number {
  if (!isSourceMapToolAttachment(attachment)) {
    return 0;
  }

  const resultCount = attachment.resolvedLocations.length + attachment.originalContexts.length;
  if (resultCount > 0) {
    return resultCount;
  }

  return attachment.candidates.length || attachment.failures.length;
}

export function getJsSourceAttachmentDisplayCount(attachment: ChatToolAttachment): number {
  if (!isJsSourceToolAttachment(attachment)) {
    return 0;
  }

  const snippetCount = attachment.jsMatches.length + attachment.contexts.length;
  if (snippetCount > 0) {
    return snippetCount;
  }

  return attachment.resources.length || attachment.failedFetches.length;
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
