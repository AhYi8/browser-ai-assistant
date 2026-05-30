import type { AutomationAction } from "../shared/types";

export interface AutomationExecuteDomActionMessage {
  type: "automation.executeDomAction";
  action: AutomationAction;
}

export interface AutomationNavigateTabMessage {
  type: "automation.navigateTab";
  url: string;
}

export type AutomationMessage = AutomationExecuteDomActionMessage | AutomationNavigateTabMessage;

export type AutomationExecuteDomActionResponse =
  | {
      ok: true;
      html: string;
      url: string;
      title?: string;
    }
  | {
      ok: false;
      message: string;
    };

export type AutomationNavigateTabResponse =
  | {
      ok: true;
      tabId: number;
      url: string;
    }
  | {
      ok: false;
      message: string;
    };

export async function handleAutomationExecuteDomActionMessage(
  message: AutomationExecuteDomActionMessage,
): Promise<AutomationExecuteDomActionResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, message: "未找到当前活动页面" };
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (!isMissingContentScriptError(error)) {
        throw error;
      }

      await injectContentScript(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `自动化动作执行失败：${error.message}` : "自动化动作执行失败",
    };
  }
}

export async function handleAutomationNavigateTabMessage(message: AutomationNavigateTabMessage): Promise<AutomationNavigateTabResponse> {
  try {
    const url = message.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, message: "自动化跳转 URL 必须以 http:// 或 https:// 开头" };
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, message: "未找到当前活动页面" };
    }

    await chrome.tabs.update(tab.id, { url });
    return { ok: true, tabId: tab.id, url };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `自动化跳转失败：${error.message}` : "自动化跳转失败",
    };
  }
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/index.js"],
    });
  } catch (error) {
    throw new Error(error instanceof Error ? `当前页面无法注入内容脚本：${error.message}` : "当前页面无法注入内容脚本");
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}
