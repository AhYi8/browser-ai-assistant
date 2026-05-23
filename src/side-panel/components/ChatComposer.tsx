import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SendShortcut } from "../../shared/types";
import { useAppStore } from "../state/appStore";

interface ChatComposerProps {
  canSend: boolean;
  matchedRuleLabel: string;
}

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

export function ChatComposer({ canSend, matchedRuleLabel }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const sendShortcut = useAppStore((state) => state.chatPreferences.sendShortcut);
  const streamMode = useAppStore((state) => state.streamMode);
  const contextMode = useAppStore((state) => state.contextMode);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const setStreamMode = useAppStore((state) => state.setStreamMode);
  const setContextMode = useAppStore((state) => state.setContextMode);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);

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

  const submit = async () => {
    const content = input.trim();
    if (!content) {
      return;
    }

    setInput("");
    await sendChatMessage(content);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composing || !isSendShortcut(event, sendShortcut)) {
      return;
    }

    event.preventDefault();
    if (!canSend || sending || !input.trim()) {
      return;
    }

    void submit();
  };

  const contextModeLabel = contextMode === "all" ? "提取所有" : "提取文本";

  return (
    <section className="chat-composer" aria-label="聊天输入区">
      <div className="context-strip">
        <button className="ui-button-secondary context-view-button" type="button" onClick={() => setContextDialogOpen(true)}>
          查看上下文
        </button>
        <span className="context-chip">{matchedRuleLabel}</span>
        <button className="ui-button-secondary" type="button" onClick={() => void refreshPageContext()}>
          刷新
        </button>
      </div>
      {pageContext.truncated ? <p className="text-sm text-[var(--color-warning)]">内容已截断，请细化 CSS/XPath</p> : null}
      {pageContext.error ? <p className="text-sm text-[var(--color-error)]">{pageContext.error}</p> : null}
      <textarea
        className="ui-input chat-input"
        aria-label="对话输入"
        value={input}
        onKeyDown={handleInputKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(event) => setInput(event.target.value)}
      />
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
        <button className="ui-button-primary" type="button" disabled={!canSend || sending || !input.trim()} onClick={() => void submit()}>
          {sending ? "发送中" : "发送"}
        </button>
      </div>
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
    </section>
  );
}

function isSendShortcut(event: ReactKeyboardEvent<HTMLTextAreaElement>, shortcut: SendShortcut): boolean {
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
