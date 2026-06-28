import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from "../shared/types";

export interface PageContextExtractMessage {
  type: "pageContext.extract";
  tabId?: number;
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback?: boolean;
}

export interface PageContextListTabsMessage {
  type: "pageContext.listTabs";
}

export interface PageContextTabInfo {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
}

export type PageContextListTabsResponse =
  | {
      ok: true;
      tabs: PageContextTabInfo[];
    }
  | {
      ok: false;
      message: string;
    };

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

export async function handlePageContextMessage(message: PageContextExtractMessage, chromeApi: typeof chrome = chrome): Promise<PageContextExtractResponse> {
  try {
    const [activeTab] = message.tabId ? [] : await chromeApi.tabs.query({ active: true, currentWindow: true });
    const tabId = message.tabId ?? activeTab?.id;
    if (!tabId) {
      return { ok: false, message: "未找到当前活动页面" };
    }

    const extractMessage = {
      type: "pageContext.extract",
      rules: message.rules,
      maxLength: message.maxLength,
      extractMode: message.extractMode ?? "text",
      selectorType: message.selectorType,
      allowFallback: message.allowFallback,
    };

    try {
      return await chromeApi.tabs.sendMessage(tabId, extractMessage);
    } catch (error) {
      if (!isMissingContentScriptError(error)) {
        throw error;
      }

      await injectContentScript(tabId, chromeApi);
      return await chromeApi.tabs.sendMessage(tabId, extractMessage);
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `提取当前页面失败：${error.message}` : "提取当前页面失败",
    };
  }
}

export async function handlePageContextListTabsMessage(chromeApi: typeof chrome = chrome): Promise<PageContextListTabsResponse> {
  try {
    const tabs = await chromeApi.tabs.query({ currentWindow: true });
    return {
      ok: true,
      tabs: tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => typeof tab.id === "number" && isInjectablePageUrl(tab.url))
        .map((tab) => ({
          tabId: tab.id,
          title: tab.title?.trim() || tab.url,
          url: tab.url,
          active: Boolean(tab.active),
        })),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `获取标签页列表失败：${error.message}` : "获取标签页列表失败",
    };
  }
}

async function injectContentScript(tabId: number, chromeApi: typeof chrome = chrome): Promise<void> {
  try {
    await chromeApi.scripting.executeScript({
      target: { tabId },
      files: ["content/index.js"],
    });
  } catch (error) {
    throw new Error(error instanceof Error ? `当前页面无法注入内容脚本：${error.message}` : "当前页面无法注入内容脚本");
  }
}

function isInjectablePageUrl(url: string | undefined): url is string {
  if (!url) {
    return false;
  }

  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function isMissingContentScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}
