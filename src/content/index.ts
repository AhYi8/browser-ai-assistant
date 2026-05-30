import type { AutomationAction, ExtractionRule, PageContextExtractMode } from "../shared/types";
import { extractPageText } from "./extractPageText";

export interface PageContextExtractMessage {
  type: "pageContext.extract";
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
}

export interface PageContextExtractResponse {
  ok: true;
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
}

export interface AutomationExecuteDomActionMessage {
  type: "automation.executeDomAction";
  action: AutomationAction;
}

export interface AutomationExecuteDomActionResponse {
  ok: true;
  html: string;
  url: string;
  title: string;
}

function isPageContextExtractMessage(message: unknown): message is PageContextExtractMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "pageContext.extract" &&
      "rules" in message &&
      Array.isArray(message.rules),
  );
}

function isAutomationExecuteDomActionMessage(message: unknown): message is AutomationExecuteDomActionMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "automation.executeDomAction" &&
      "action" in message &&
      typeof message.action === "object" &&
      message.action !== null,
  );
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPageContextExtractMessage(message)) {
    if (!isAutomationExecuteDomActionMessage(message)) {
      return false;
    }

    void handleAutomationExecuteDomActionMessage(message).then(sendResponse);
    return true;
  }

  const result = extractPageText({
    url: window.location.href,
    rules: message.rules,
    maxLength: message.maxLength,
    extractMode: message.extractMode ?? "text",
  });

  sendResponse({
    ok: true,
    url: window.location.href,
    title: document.title,
    ...result,
  });

  return false;
});

async function handleAutomationExecuteDomActionMessage(message: AutomationExecuteDomActionMessage): Promise<AutomationExecuteDomActionResponse | { ok: false; message: string }> {
  try {
    const action = message.action;
    const result = executeAutomationAction(action);
    if (!result.ok) {
      return result;
    }

    await waitForDomSettled(action);

    return {
      ok: true,
      html: document.documentElement.outerHTML,
      url: window.location.href,
      title: document.title,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `自动化动作执行失败：${error.message}` : "自动化动作执行失败",
    };
  }
}

function executeAutomationAction(action: AutomationAction): { ok: true } | { ok: false; message: string } {
  if (action.type === "none") {
    return { ok: true };
  }

  if (action.type === "extractHtml") {
    return { ok: true };
  }

  if (action.type === "runSandboxExtraction") {
    return { ok: true };
  }

  if (action.type === "click") {
    if (!action.selector?.trim()) {
      return { ok: false, message: "自动化动作缺少选择器" };
    }

    const element = document.querySelector(action.selector);
    if (!(element instanceof HTMLElement)) {
      return { ok: false, message: "未找到可点击元素" };
    }

    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    element.click();
    return { ok: true };
  }

  if (action.type === "input") {
    if (!action.selector?.trim()) {
      return { ok: false, message: "自动化动作缺少选择器" };
    }

    const element = document.querySelector(action.selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement)) {
      return { ok: false, message: "未找到可输入元素" };
    }

    if ("value" in element && typeof action.value === "string") {
      element.value = action.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      element.textContent = action.value ?? "";
    }
    return { ok: true };
  }

  if (action.type === "scroll") {
    window.scrollTo({ top: action.scrollY ?? window.scrollY, behavior: "auto" });
    return { ok: true };
  }

  if (action.type === "wait") {
    return { ok: true };
  }

  if (action.type === "navigate") {
    if (!action.url?.trim()) {
      return { ok: false, message: "自动化动作缺少 URL" };
    }

    window.location.assign(action.url);
    return { ok: true };
  }

  return { ok: false, message: "不支持的自动化动作" };
}

async function waitForDomSettled(action: AutomationAction): Promise<void> {
  const timeoutMs = Math.max(0, action.timeoutMs ?? 200);
  if (timeoutMs === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), timeoutMs);
  });
}
