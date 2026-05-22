import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../../shared/types";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
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
            <div className="message-bubble">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function shouldOpenThinking(message: ChatMessage): boolean {
  if (!message.streaming || !message.thinking) {
    return false;
  }

  return message.thinking.split(/\r?\n/).length <= 5;
}
