import type { ExtractionRule, PageContextExtractMode } from "../shared/types";

export interface PageContextExtractMessage {
  type: "pageContext.extract";
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
}

export type PageContextExtractResponse =
  | {
      ok: true;
      url: string;
      title?: string;
      text: string;
      truncated: boolean;
      usedFallback: boolean;
      matchedRuleId?: string;
    }
  | {
      ok: false;
      message: string;
    };

export async function handlePageContextMessage(message: PageContextExtractMessage): Promise<PageContextExtractResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, message: "未找到当前活动页面" };
    }

    const extractMessage = {
      type: "pageContext.extract",
      rules: message.rules,
      maxLength: message.maxLength,
      extractMode: message.extractMode ?? "text",
    };

    try {
      return await chrome.tabs.sendMessage(tab.id, extractMessage);
    } catch (error) {
      if (!isMissingContentScriptError(error)) {
        throw error;
      }

      await injectContentScript(tab.id);
      return await chrome.tabs.sendMessage(tab.id, extractMessage);
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `提取当前页面失败：${error.message}` : "提取当前页面失败",
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
