import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatImageAttachment, ChatMessage } from "../../shared/types";

interface MessageListProps {
  messages: ChatMessage[];
  onRegenerateMessage: (messageId: string) => void;
  onEditAndRegenerateUserMessage: (messageId: string, content: string) => void;
  regenerating: boolean;
}

export function MessageList({ messages, onRegenerateMessage, onEditAndRegenerateUserMessage, regenerating }: MessageListProps) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | undefined>();
  const [editingMessageId, setEditingMessageId] = useState<string | undefined>();
  const [editingContent, setEditingContent] = useState("");
  const regeneratePopoverRef = useRef<HTMLDivElement>(null);

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

  if (messages.length === 0) {
    return (
      <section aria-label="消息列表" className="message-list">
        <p className="ui-muted text-sm">暂无消息</p>
      </section>
    );
  }

  return (
    <section aria-label="消息列表" className="message-list">
      {messages.map((message) => (
        <article key={message.id} className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
          <div className="message-avatar" aria-hidden="true">
            {message.role === "user" ? "我" : "AI"}
          </div>
          <div className="message-bubble-wrap">
            {message.role === "assistant" && message.thinking ? (
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
                <textarea
                  className="ui-input message-edit-input"
                  aria-label="编辑用户消息"
                  value={editingContent}
                  onChange={(event) => setEditingContent(event.target.value)}
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
                    }}
                  >
                    <CancelEditIcon />
                  </button>
                  <button
                    className="message-icon-button message-edit-send-button"
                    type="button"
                    aria-label="发送编辑后的消息"
                    title="发送编辑后的消息"
                    disabled={regenerating || !editingContent.trim()}
                    onClick={() => {
                      const trimmedContent = editingContent.trim();
                      if (!trimmedContent) {
                        return;
                      }

                      setEditingMessageId(undefined);
                      setEditingContent("");
                      onEditAndRegenerateUserMessage(message.id, trimmedContent);
                    }}
                  >
                    <SendEditedMessageIcon />
                  </button>
                </div>
              </div>
            ) : (
              <div className="message-bubble">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )}
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
            </div>
          </div>
        </article>
      ))}
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

function shouldOpenThinking(message: ChatMessage): boolean {
  if (!message.streaming || !message.thinking) {
    return false;
  }

  return message.thinking.split(/\r?\n/).length <= 5;
}
