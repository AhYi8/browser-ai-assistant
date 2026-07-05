import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { estimateChatContextTokens } from "../../shared/chat/contextCompression";
import { createPageContextPrompt } from "../../shared/chat/pageContextPrompt";
import {
  MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID,
  TAVILY_SEARCH_TOOL_ID,
  getModelToolGroups,
  getRegisteredModelTools,
  isDebuggerRuntimeRequirement,
  isToolRuntimeAvailable,
} from "../../shared/models/toolRegistry";
import { isModelToolConfigured } from "../../shared/webSearch/toolAvailability";
import { hasTokenUsage, sumSessionTokenUsage } from "../../shared/chat/tokenUsage";
import { isPngDataUrl, isTabCaptureImageAttachment, TAB_CAPTURE_VISIBLE_MESSAGE_TYPE, type TabCaptureVisibleResponse } from "../../shared/tabCapture";
import type { ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatTokenUsage, PromptTemplate, SendShortcut } from "../../shared/types";
import { useAppStore, type ChatFollowUpItem } from "../state/appStore";
import { resolveEffectiveChatPreferences } from "../state/appStorePreferences";
import { BoundaryChoiceDialog } from "./BoundaryChoiceDialog";
import { PromptInlineEditor } from "./PromptInlineEditor";

const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TOKEN_KILO_THRESHOLD = 1_000;
const TOKEN_MEGA_THRESHOLD = 1_000_000;
const EMPTY_FOLLOW_UPS: ChatFollowUpItem[] = [];
const SWITCH_ICON_PATHS = {
  appendContext: "M7 7h10M12 7v10M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z",
  stream: "M13 2 5 14h6l-1 8 8-12h-6l1-8Z",
  toolCalling: "M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.6 2.6-3-3 2.6-2.6Z",
  extractText: "M6 4h12M6 8h12M6 12h8M6 16h12M6 20h8",
  extractAll: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 13h8M8 17h5",
} as const;

type SwitchIconName = keyof typeof SWITCH_ICON_PATHS;
type BrowserAutomationMode = "normal_restricted" | "controlled_enhanced" | "full_access";

const BROWSER_AUTOMATION_MODE_OPTIONS: Array<{ mode: BrowserAutomationMode; label: string; description: string; iconPath: string }> = [
  {
    mode: "normal_restricted",
    label: "普通模式",
    description: "默认受限，只读、脱敏、固定模板",
    iconPath: "M12 3 5 6v5c0 4 2.8 7.4 7 10 4.2-2.6 7-6 7-10V6l-7-3Z",
  },
  {
    mode: "controlled_enhanced",
    label: "受控增强",
    description: "允许 AI 请求一次性边界授权",
    iconPath: "M5 12a7 7 0 0 1 14 0M8 12h8M12 8v8",
  },
  {
    mode: "full_access",
    label: "完全访问",
    description: "最高风险，允许原样执行高权限工具",
    iconPath: "M12 3 4 7v5c0 4.4 3.2 7.6 8 9 4.8-1.4 8-4.6 8-9V7l-8-4ZM12 8v5M12 16h.01",
  },
];

interface ChatComposerProps {
  canSend: boolean;
  matchedRuleLabel: string;
}

interface ComposerSwitchProps {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  icon: SwitchIconName;
  label: string;
  onToggle: () => void;
}

function ComposerSwitch({ ariaLabel, checked, disabled, icon, label, onToggle }: ComposerSwitchProps) {
  return (
    <button
      className="composer-switch"
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      title={label}
      onClick={onToggle}
    >
      <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={SWITCH_ICON_PATHS[icon]} />
      </svg>
    </button>
  );
}

export function ChatComposer({ canSend, matchedRuleLabel }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [promptInvocations, setPromptInvocations] = useState<ChatPromptInvocation[]>([]);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashStartIndex, setSlashStartIndex] = useState<number | undefined>();
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [followUpQueueOpen, setFollowUpQueueOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<{ left: number; top: number } | undefined>();
  const [composing, setComposing] = useState(false);
  const imageInputId = useId();
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentModelSupportsVision = useAppStore((state) => Boolean(state.models.find((model) => model.id === state.selectedModelId)?.supportsVision));
  const sendShortcut = useAppStore((state) => state.chatPreferences.sendShortcut);
  const followUpBehavior = useAppStore((state) => state.chatPreferences.followUpBehavior);
  const toolCallingEnabled = useAppStore((state) => {
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    return activeSession?.chatPreferenceOverrides?.toolCallingEnabled ?? state.chatPreferences.toolCallingEnabled;
  });
  const enabledToolIds = useAppStore((state) => {
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    return activeSession?.chatPreferenceOverrides?.enabledToolIds ?? state.chatPreferences.enabledToolIds;
  });
  const promptTemplates = useAppStore((state) => state.promptTemplates);
  const streamMode = useAppStore((state) => state.streamMode);
  const browserControlEnabled = useAppStore((state) => state.browserControlEnabled);
  const browserAutomationMode = useAppStore((state) => state.browserAutomationMode);
  const pendingBoundaryChoice = useAppStore((state) => state.pendingBoundaryChoice);
  const contextMode = useAppStore((state) => state.contextMode);
  const appendPageContextToSystemPrompt = useAppStore((state) => state.appendPageContextToSystemPrompt);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const activeSession = useAppStore((state) =>
    state.privateModeActive
      ? state.privateChatSession
      : state.chatSessions.find((session) => session.id === state.activeSessionId),
  );
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const chatPreferences = useAppStore((state) => state.chatPreferences);
  const activeFollowUps = useAppStore((state) => {
    const sessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
    return sessionId ? state.followUpsBySessionId[sessionId] ?? EMPTY_FOLLOW_UPS : EMPTY_FOLLOW_UPS;
  });
  const contextTabs = useAppStore((state) => state.contextTabs);
  const contextTabsLoading = useAppStore((state) => state.contextTabsLoading);
  const contextTabsError = useAppStore((state) => state.contextTabsError);
  const mcpSettings = useAppStore((state) => state.mcpSettings);
  const webSearchSettings = useAppStore((state) => state.webSearchSettings);
  const setStreamMode = useAppStore((state) => state.setStreamMode);
  const setBrowserAutomationMode = useAppStore((state) => state.setBrowserAutomationMode);
  const setContextMode = useAppStore((state) => state.setContextMode);
  const setComposerHasDraft = useAppStore((state) => state.setComposerHasDraft);
  const setAppendPageContextToSystemPrompt = useAppStore((state) => state.setAppendPageContextToSystemPrompt);
  const updateActiveSessionChatPreferences = useAppStore((state) => state.updateActiveSessionChatPreferences);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const loadContextTabs = useAppStore((state) => state.loadContextTabs);
  const toggleContextTabSelection = useAppStore((state) => state.toggleContextTabSelection);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);
  const submitChatFollowUp = useAppStore((state) => state.submitChatFollowUp);
  const removeChatFollowUp = useAppStore((state) => state.removeChatFollowUp);
  const guideChatFollowUp = useAppStore((state) => state.guideChatFollowUp);
  const abortActiveChatTask = useAppStore((state) => state.abortActiveChatTask);
  const respondBoundaryChoice = useAppStore((state) => state.respondBoundaryChoice);
  const registeredTools = useMemo(() => getRegisteredModelTools(mcpSettings), [mcpSettings]);
  const registeredToolGroups = useMemo(() => getModelToolGroups(registeredTools), [registeredTools]);
  const effectiveBrowserAutomationMode: BrowserAutomationMode = browserControlEnabled ? browserAutomationMode : "normal_restricted";
  const effectiveChatPreferences = useMemo(
    () => resolveEffectiveChatPreferences(chatPreferences, activeSession?.chatPreferenceOverrides),
    [activeSession?.chatPreferenceOverrides, chatPreferences],
  );
  const requestPageContext = useMemo(() => {
    const shouldInjectPageContext = (activeSession?.messages.length ?? 0) === 0 && appendPageContextToSystemPrompt;
    return shouldInjectPageContext ? (pageContext.formatted ? pageContext.text : createPageContextPrompt(pageContext)) : "";
  }, [activeSession?.messages.length, appendPageContextToSystemPrompt, pageContext]);
  const currentContextTokens = useMemo(() => {
    const trimmedInput = input.trim();
    const hasDraft = Boolean(trimmedInput || attachments.length || promptInvocations.length);
    const draftMessage: ChatMessage | undefined = hasDraft
      ? {
          id: "current-draft-message",
          role: "user",
          content: trimmedInput,
          createdAt: 0,
          modelId: activeSession?.selectedModelId || selectedModelId,
          endpointType: "openai_chat",
          streamMode,
          systemPrompt: effectiveChatPreferences.systemPrompt,
          contextPrompt: requestPageContext,
          contextMode,
          attachments: attachments.length ? attachments : undefined,
          promptInvocations: promptInvocations.length ? promptInvocations : undefined,
        }
      : undefined;
    return estimateChatContextTokens({
        systemPrompt: effectiveChatPreferences.systemPrompt,
        pageContext: requestPageContext,
        messages: draftMessage ? [...(activeSession?.messages ?? []), draftMessage] : activeSession?.messages ?? [],
        tokenUsageEntries: activeSession?.tokenUsageEntries,
      });
  }, [
    activeSession?.messages,
    activeSession?.selectedModelId,
    activeSession?.tokenUsageEntries,
    attachments,
    contextMode,
    effectiveChatPreferences.systemPrompt,
    input,
    promptInvocations,
    requestPageContext,
    selectedModelId,
    streamMode,
  ]);
  const runtimeEditableToolIds = useMemo(
    () => registeredTools
      .filter((tool) => isToolRuntimeAvailable(tool, browserControlEnabled, effectiveBrowserAutomationMode) && isModelToolConfigured(tool, webSearchSettings))
      .map((tool) => tool.id),
    [browserControlEnabled, effectiveBrowserAutomationMode, registeredTools, webSearchSettings],
  );

  useEffect(() => {
    setComposerHasDraft(input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0);
  }, [attachments.length, input, promptInvocations.length, setComposerHasDraft]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery, slashMenuOpen]);

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
    if (!toolMenuOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (toolMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolMenuOpen(false);
      }
    };

    updateToolMenuPosition();
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateToolMenuPosition);
    window.addEventListener("scroll", updateToolMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateToolMenuPosition);
      window.removeEventListener("scroll", updateToolMenuPosition, true);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!modeMenuOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".composer-mode-menu-wrap")) {
        return;
      }

      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

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
    await sendChatMessage(content, sendingAttachments, sendingPromptInvocations);
  };

  const submitFollowUp = async (behavior = followUpBehavior) => {
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
    await submitChatFollowUp(content, sendingAttachments, sendingPromptInvocations, { behavior });
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const isComposingInput = composing || event.nativeEvent.isComposing;
    if (slashMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if (!isComposingInput && (event.key === "ArrowDown" || event.key === "ArrowUp") && filteredPromptTemplates.length > 0) {
        event.preventDefault();
        setSlashActiveIndex((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % filteredPromptTemplates.length
            : (current - 1 + filteredPromptTemplates.length) % filteredPromptTemplates.length,
        );
        return;
      }
      if (!isComposingInput && (event.key === "Enter" || event.key === "Tab") && filteredPromptTemplates[slashActiveIndex]) {
        event.preventDefault();
        handleSelectPrompt(filteredPromptTemplates[slashActiveIndex]);
        return;
      }
      if (isComposingInput && event.key === "Enter") {
        event.preventDefault();
        return;
      }
    }

    const isOppositeFollowUpShortcut = sending && isCtrlShiftEnter(event);
    if (isComposingInput || (!isOppositeFollowUpShortcut && !isSendShortcut(event, sendShortcut))) {
      return;
    }

    event.preventDefault();
    const hasDraft = input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0;
    if (!hasDraft || (!sending && !canSend)) {
      return;
    }

    if (sending) {
      void submitFollowUp(isOppositeFollowUpShortcut ? getOppositeFollowUpBehavior(followUpBehavior) : followUpBehavior);
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

  const handleSelectPrompt = (prompt: PromptTemplate) => {
    setPromptInvocations((current) => [
      ...current,
      {
        promptId: prompt.id,
        title: prompt.title,
        contentSnapshot: prompt.content,
      },
    ]);
    setInput((current) => {
      return removeSlashCommandSegment(current, slashStartIndex);
    });
    setSlashMenuOpen(false);
    setSlashQuery("");
    setSlashStartIndex(undefined);
    setSlashActiveIndex(0);
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

  const handleToolToggle = (toolId: string, checked: boolean) => {
    const tool = registeredTools.find((item) => item.id === toolId);
    if (tool && !isToolRuntimeAvailable(tool, browserControlEnabled, effectiveBrowserAutomationMode)) {
      return;
    }
    if (tool && !isModelToolConfigured(tool, webSearchSettings)) {
      return;
    }
    const nextToolIds = checked ? [...enabledToolIds, toolId] : enabledToolIds.filter((id) => id !== toolId);
    void updateActiveSessionChatPreferences({ enabledToolIds: Array.from(new Set(nextToolIds)) });
  };

  const updateToolMenuPosition = () => {
    const rect = toolMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const menuWidth = Math.min(window.innerWidth - 24, 320);
    const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
    setToolMenuPosition({
      left: Math.max(12, Math.min(centeredLeft, window.innerWidth - menuWidth - 12)),
      top: Math.max(12, rect.top - 12),
    });
  };

  const toggleToolMenu = () => {
    if (!toolMenuOpen) {
      updateToolMenuPosition();
    }
    setToolMenuOpen((value) => !value);
  };

  const contextModeLabel = contextMode === "all" ? "提取所有" : "提取文本";
  const toolCallingLabel = `工具调用：${toolCallingEnabled ? "已启用" : "已关闭"}`;
  const browserAutomationModeLabel = BROWSER_AUTOMATION_MODE_OPTIONS.find((option) => option.mode === effectiveBrowserAutomationMode)?.label ?? "普通模式";
  const filteredPromptTemplates = filterPromptTemplates(promptTemplates, slashQuery);
  const hasDraft = input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0;
  const canSubmit = canSend && hasDraft;
  const sessionTokenUsage = sumSessionTokenUsage(activeSession);
  const submitButtonLabel = sending && !hasDraft ? "终止" : "发送";
  const visibleQueuedFollowUps = activeFollowUps.filter((item) => item.behavior === "queue");
  const nextFollowUp = visibleQueuedFollowUps[0];

  return (
    <section className="chat-composer" aria-label="聊天输入区">
      {activeSession && visibleQueuedFollowUps.length > 0 ? (
        <div className={followUpQueueOpen ? "follow-up-queue follow-up-queue-expanded" : "follow-up-queue follow-up-queue-collapsed"} aria-label="排队对话">
          {followUpQueueOpen ? (
            <>
              <div className="follow-up-queue-header">
                <button
                  className="follow-up-queue-icon-button follow-up-queue-toggle"
                  type="button"
                  aria-label="折叠排队对话"
                  aria-expanded={followUpQueueOpen}
                  title="折叠排队对话"
                  onClick={() => setFollowUpQueueOpen(false)}
                >
                  <CollapseQueueIcon />
                </button>
              </div>
              <div className="follow-up-queue-list">
              {visibleQueuedFollowUps.map((item, index) => (
                <div className="follow-up-queue-item" key={item.id}>
                  <span className="follow-up-queue-content">{item.content || "图片消息"}</span>
                  {item.attachments?.length ? <span className="follow-up-queue-meta">{item.attachments.length} 张图片</span> : null}
                  <button
                    className="follow-up-queue-icon-button follow-up-remove-button"
                    type="button"
                    aria-label={`删除第 ${index + 1} 条排队对话：${formatFollowUpActionLabel(item)}`}
                    title={`删除第 ${index + 1} 条排队对话`}
                    onClick={() => removeChatFollowUp(activeSession.id, item.id)}
                  >
                    <DeleteFollowUpIcon />
                    </button>
                  <button
                    className="follow-up-queue-icon-button follow-up-guide-button"
                    type="button"
                    aria-label={`引导第 ${index + 1} 条排队对话：${formatFollowUpActionLabel(item)}`}
                    title={`引导第 ${index + 1} 条排队对话`}
                    onClick={() => guideChatFollowUp(activeSession.id, item.id)}
                  >
                    <GuideFollowUpIcon />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : nextFollowUp ? (
            <div className="follow-up-queue-preview" aria-label="下一条排队对话">
              <span className="follow-up-queue-content">{nextFollowUp.content || "图片消息"}</span>
              {nextFollowUp.attachments?.length ? <span className="follow-up-queue-meta">{nextFollowUp.attachments.length} 张图片</span> : null}
              <button
                className="follow-up-queue-icon-button follow-up-remove-button"
                type="button"
                aria-label={`删除下一条排队对话：${formatFollowUpActionLabel(nextFollowUp)}`}
                title="删除下一条排队对话"
                onClick={() => removeChatFollowUp(activeSession.id, nextFollowUp.id)}
              >
                <DeleteFollowUpIcon />
              </button>
              <button
                className="follow-up-queue-icon-button follow-up-guide-button"
                type="button"
                aria-label={`引导下一条排队对话：${formatFollowUpActionLabel(nextFollowUp)}`}
                title="引导下一条排队对话"
                onClick={() => guideChatFollowUp(activeSession.id, nextFollowUp.id)}
              >
                <GuideFollowUpIcon />
              </button>
              <button
                className="follow-up-queue-icon-button follow-up-queue-toggle"
                type="button"
                aria-label="展开排队对话"
                aria-expanded={followUpQueueOpen}
                title="展开排队对话"
                onClick={() => setFollowUpQueueOpen(true)}
              >
                <ExpandQueueIcon />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
        <TokenUsageMeter usage={sessionTokenUsage} contextTokens={currentContextTokens} sending={sending} />
        <button
          className="ui-button-secondary context-view-button"
          type="button"
          onClick={() => {
            setContextDialogOpen(true);
            void loadContextTabs();
          }}
        >
          选择标签页
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
      </div>
      {pageContext.truncated ? <p className="text-sm text-[var(--color-warning)]">内容已截断，请细化 CSS/XPath</p> : null}
      {pageContext.error ? <p className="text-sm text-[var(--color-error)]">{pageContext.error}</p> : null}
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
            {filteredPromptTemplates.length > 0 ? (
              filteredPromptTemplates.map((prompt, index) => (
                <button
                  key={prompt.id}
                  className={index === slashActiveIndex ? "slash-command-option slash-command-option-active" : "slash-command-option"}
                  type="button"
                  role="option"
                  aria-selected={index === slashActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectPrompt(prompt)}
                >
                  <span className="slash-command-title">{prompt.title}</span>
                  <span className="slash-command-content">{prompt.content}</span>
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
          <div className="composer-mode-menu-wrap">
            <button
              className={`composer-mode-trigger composer-mode-trigger-${effectiveBrowserAutomationMode}`}
              type="button"
              aria-label="浏览器自动化模式"
              aria-haspopup="listbox"
              aria-expanded={modeMenuOpen}
              disabled={!browserControlEnabled}
              title="浏览器自动化模式"
              onClick={() => setModeMenuOpen((open) => !open)}
            >
              <span>{browserAutomationModeLabel}</span>
              <span className="composer-mode-chevron" aria-hidden="true" />
            </button>
            {modeMenuOpen && browserControlEnabled ? (
              <div className="composer-mode-menu" role="listbox" aria-label="浏览器自动化模式">
                <div className="composer-mode-menu-header">
                  <span>选择浏览器自动化模式</span>
                  <span>本轮生效</span>
                </div>
                {BROWSER_AUTOMATION_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    className={`composer-mode-option composer-mode-option-${option.mode}`}
                    type="button"
                    role="option"
                    aria-selected={option.mode === effectiveBrowserAutomationMode}
                    onClick={() => {
                      setModeMenuOpen(false);
                      void setBrowserAutomationMode(option.mode);
                    }}
                  >
                    <svg className="composer-mode-option-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={option.iconPath} />
                    </svg>
                    <span className="composer-mode-option-copy">
                      <span className="composer-mode-option-title">{option.label}</span>
                      <span className="composer-mode-option-description">{option.description}</span>
                    </span>
                    <span className="composer-mode-option-check" aria-hidden="true">
                      {option.mode === effectiveBrowserAutomationMode ? "✓" : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <ComposerSwitch ariaLabel="流式响应" checked={streamMode} icon="stream" label="流式响应" onToggle={() => setStreamMode(!streamMode)} />
          <div className="composer-tool-menu-wrap" ref={toolMenuRef}>
            <button
              ref={toolMenuButtonRef}
              className="composer-switch"
              type="button"
              aria-label={toolCallingLabel}
              aria-expanded={toolMenuOpen}
              aria-haspopup="dialog"
              aria-pressed={toolCallingEnabled}
              title={toolCallingLabel}
              onClick={toggleToolMenu}
            >
              <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={SWITCH_ICON_PATHS.toolCalling} />
              </svg>
            </button>
            {toolMenuOpen ? (
              <div
                className="composer-tool-menu"
                role="dialog"
                aria-label="工具调用设置"
                style={toolMenuPosition ? { left: toolMenuPosition.left, top: toolMenuPosition.top } : undefined}
              >
                <div className="composer-tool-menu-actions">
                  <button
                    className="composer-tool-menu-action"
                    type="button"
                    onClick={() => void updateActiveSessionChatPreferences({ toolCallingEnabled: true })}
                  >
                    启用
                  </button>
                  <button
                    className="composer-tool-menu-action"
                    type="button"
                    onClick={() =>
                      void updateActiveSessionChatPreferences({
                        toolCallingEnabled: true,
                        enabledToolIds: runtimeEditableToolIds,
                      })
                    }
                  >
                    启用全部
                  </button>
                  <button
                    className="composer-tool-menu-action"
                    type="button"
                    onClick={() => void updateActiveSessionChatPreferences({ toolCallingEnabled: false })}
                  >
                    关闭
                  </button>
                </div>
                {registeredTools.length > 0 ? (
                  <div className="composer-tool-menu-list">
                    {registeredToolGroups.map((group) => (
                      <div key={group.id} className="composer-tool-menu-group">
                        <div className="composer-tool-menu-group-title">{group.label}</div>
                        {group.id === MODEL_TOOL_GROUP_BROWSER_AUTOMATION_ID && !browserControlEnabled ? (
                          <p className="composer-tool-menu-group-hint">需开启浏览器控制后才能启用本组工具。</p>
                        ) : null}
                        {group.tools.map((tool) => {
                          const toolDisplayName = tool.groupId === "mcp_remote" ? (tool.displayName ?? tool.name) : tool.name;
                          const runtimeAvailable = isToolRuntimeAvailable(tool, browserControlEnabled, effectiveBrowserAutomationMode);
                          const configured = isModelToolConfigured(tool, webSearchSettings);
                          const debuggerRuntime = tool.toolClassification ? isDebuggerRuntimeRequirement(tool.toolClassification.runtime) : false;
                          const active = runtimeAvailable && configured && enabledToolIds.includes(tool.id);
                          const disabled = !runtimeAvailable || !configured;
                          const unavailableDescription = !runtimeAvailable
                            ? "需开启浏览器控制"
                            : tool.id === TAVILY_SEARCH_TOOL_ID && !configured
                              ? "请先配置 Tavily API Key"
                              : "";
                          return (
                            <button
                              key={tool.id}
                              className={
                                [
                                  "composer-tool-menu-item",
                                  active ? "composer-tool-menu-item-active" : "",
                                  debuggerRuntime ? "composer-tool-menu-item-readonly" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")
                            }
                            type="button"
                            aria-pressed={active}
                            aria-label={`${toolDisplayName} ${tool.description ?? ""}`.trim()}
                            disabled={disabled}
                            onClick={() => handleToolToggle(tool.id, !active)}
                          >
                            <span className="composer-tool-menu-item-name">{toolDisplayName}</span>
                            {unavailableDescription ? <span className="composer-tool-menu-item-description">{unavailableDescription}</span> : null}
                            {tool.description ? <span className="composer-tool-menu-item-description">{tool.description}</span> : null}
                          </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="composer-tool-menu-empty">暂无可用工具</p>
                )}
              </div>
            ) : null}
          </div>
          <ComposerSwitch
            ariaLabel="拼接上下文"
            checked={appendPageContextToSystemPrompt}
            icon="appendContext"
            label="拼接上下文"
            onToggle={() => setAppendPageContextToSystemPrompt(!appendPageContextToSystemPrompt)}
          />
          <ComposerSwitch
            ariaLabel="提取模式"
            checked={contextMode === "all"}
            icon={contextMode === "all" ? "extractAll" : "extractText"}
            label={contextModeLabel}
            onToggle={() => setContextMode(contextMode === "all" ? "text" : "all")}
          />
        </div>
        <button
          className={sending && !hasDraft ? "ui-button-primary composer-abort-button" : "ui-button-primary"}
          type="button"
          disabled={sending ? false : !canSubmit}
          onClick={() => {
            if (sending && !hasDraft) {
              abortActiveChatTask();
              return;
            }
            void (sending ? submitFollowUp() : submit());
          }}
        >
          {submitButtonLabel}
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
                选择注入标签页
              </h2>
              <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭标签页选择" onClick={() => setContextDialogOpen(false)}>
                关闭
              </button>
            </div>
            <div className="context-tab-list" aria-label="可注入标签页">
              {contextTabsLoading ? <p className="context-tab-empty">正在读取标签页...</p> : null}
              {contextTabsError ? <p className="context-tab-error">{contextTabsError}</p> : null}
              {!contextTabsLoading && contextTabs.length === 0 ? <p className="context-tab-empty">暂无可注入的普通网页标签页</p> : null}
              {contextTabs.map((tab) => (
                <button
                  key={tab.tabId}
                  className={`context-tab-item${tab.selected ? " context-tab-item-active" : ""}`}
                  type="button"
                  aria-pressed={tab.selected}
                  aria-label={`注入 ${tab.title}`}
                  onClick={() => toggleContextTabSelection(tab.tabId)}
                >
                  <span className="context-tab-title-row">
                    <span className="context-tab-title">{tab.title}</span>
                    {tab.active ? <span className="context-tab-active-badge">当前</span> : null}
                    {tab.selected ? <span className="context-tab-selected-badge">注入</span> : null}
                  </span>
                  <span className="context-tab-url">{tab.url}</span>
                  {tab.error ? <span className="context-tab-error">{tab.error}</span> : null}
                </button>
              ))}
            </div>
            <p className="context-preview">{pageContext.text || "暂无上下文"}</p>
          </section>
        </>
      ) : null}
      {pendingBoundaryChoice ? (
        <BoundaryChoiceDialog
          request={pendingBoundaryChoice}
          onSubmit={(selectedChoiceIds, otherText) => void respondBoundaryChoice(pendingBoundaryChoice.requestId, selectedChoiceIds, otherText)}
        />
      ) : null}
    </section>
  );
}

function TokenUsageMeter({ usage, contextTokens, sending }: { usage: ChatTokenUsage; contextTokens: number; sending: boolean }) {
  const hasUsage = hasTokenUsage(usage);
  return (
    <div className={`token-usage-meter${hasUsage ? "" : " token-usage-meter-empty"}`} aria-label="Token 用量统计" title="当前上下文与当前会话累计 Token 用量">
      {hasUsage ? (
        <>
          <span>上下文 {formatTokenCount(contextTokens)}</span>
          <span>输入 {formatTokenCount(usage.inputTokens)}</span>
          <span>输出 {formatTokenCount(usage.outputTokens)}</span>
          <span>写入 {formatTokenCount(usage.cacheWriteTokens)}</span>
          <span>读取 {formatTokenCount(usage.cacheReadTokens)}</span>
        </>
      ) : (
        <span>
          上下文 {formatTokenCount(contextTokens)}
          {sending ? " · Token 统计中" : ""}
        </span>
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  if (value >= TOKEN_MEGA_THRESHOLD) {
    return `${trimTokenNumber(value / TOKEN_MEGA_THRESHOLD)}M`;
  }
  if (value >= TOKEN_KILO_THRESHOLD) {
    return `${trimTokenNumber(value / TOKEN_KILO_THRESHOLD)}k`;
  }
  return String(Math.max(0, Math.floor(value)));
}

function trimTokenNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
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

function filterPromptTemplates(promptTemplates: PromptTemplate[], query: string): PromptTemplate[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return promptTemplates;
  }

  return promptTemplates.filter((prompt) => {
    const searchableText = `${prompt.title}\n${prompt.content}`.toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
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
    case "alt_enter":
      return modifiers.altKey && !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey;
    default:
      return false;
  }
}

function isCtrlShiftEnter(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing;
}

function getOppositeFollowUpBehavior(behavior: "queue" | "guide"): "queue" | "guide" {
  return behavior === "queue" ? "guide" : "queue";
}

function formatFollowUpActionLabel(item: ChatFollowUpItem): string {
  const content = item.content.trim() || "图片消息";
  return content.length > 24 ? `${content.slice(0, 24)}...` : content;
}

function ExpandQueueIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M9 4H4v5" />
      <path d="M15 20h5v-5" />
    </svg>
  );
}

function CollapseQueueIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M9 9H4V4" />
      <path d="M15 15h5v5" />
    </svg>
  );
}

function DeleteFollowUpIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function GuideFollowUpIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 12h12" />
      <path d="m13 8 4 4-4 4" />
      <path d="M5 6h5" />
      <path d="M5 18h5" />
    </svg>
  );
}
