import { handleModelCatalogMessage, type ModelCatalogMessage } from "./modelCatalogMessageHandler";
import { handleChatSendMessage, type ChatSendMessage } from "./modelRequestHandler";
import { handlePageContextMessage, type PageContextExtractMessage } from "./pageContextMessageHandler";
import {
  handleCurrentTabUrlMessage,
  handleUrlPatternGenerationMessage,
  type CurrentTabUrlMessage,
  type UrlPatternGenerationMessage,
} from "./urlPatternGenerationMessageHandler";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-side-panel",
    title: "打开 AI 助手",
    contexts: ["page"],
  });
});

async function openSidePanel(tabId?: number) {
  if (!tabId) {
    return;
  }

  await chrome.sidePanel.open({ tabId });
}

chrome.action.onClicked.addListener((tab) => {
  void openSidePanel(tab.id);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-side-panel") {
    return;
  }

  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => openSidePanel(tab?.id));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "open-side-panel") {
    return;
  }

  void openSidePanel(tab?.id);
});

type RuntimeMessage =
  | ModelCatalogMessage
  | PageContextExtractMessage
  | UrlPatternGenerationMessage
  | CurrentTabUrlMessage
  | ChatSendMessage;

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "extractionRule.generateUrlPatterns") {
    console.debug(`${DEBUG_PREFIX} background 入口收到 runtime 消息`, {
      type: message.type,
      debugRequestId: message.debugRequestId,
      providerId: message.provider?.id,
      modelId: message.model?.id,
      url: message.url,
    });
  }

  if (message.type === "extractionRule.generateUrlPatterns") {
    void handleUrlPatternGenerationMessage(message)
      .then((response) => {
        console.debug(`${DEBUG_PREFIX} background 入口发送 runtime 响应`, {
          debugRequestId: message.debugRequestId,
          response,
        });
        sendResponse(response);
      })
      .catch((error) => {
        console.error(`${DEBUG_PREFIX} background 入口处理生成消息异常`, {
          debugRequestId: message.debugRequestId,
          error,
        });
        sendResponse({
          ok: false,
          message: error instanceof Error ? `AI 生成失败：${error.message}` : "AI 生成失败",
        });
      });
    return true;
  }

  if (message.type === "extractionRule.getCurrentTabUrl") {
    console.debug(`${DEBUG_PREFIX} background 入口收到当前标签页 URL 请求`, {
      debugRequestId: message.debugRequestId,
    });
    void handleCurrentTabUrlMessage(message)
      .then((response) => {
        console.debug(`${DEBUG_PREFIX} background 入口返回当前标签页 URL`, {
          debugRequestId: message.debugRequestId,
          response,
        });
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "未找到当前活动页面 URL",
        });
      });
    return true;
  }

  if (message.type === "pageContext.extract") {
    void handlePageContextMessage(message).then(sendResponse);
    return true;
  }

  if (message.type === "chat.send") {
    void handleChatSendMessage(message).then(sendResponse);
    return true;
  }

  if (message.type !== "modelCatalog.list" && message.type !== "modelCatalog.test") {
    return false;
  }

  void handleModelCatalogMessage(message).then(sendResponse);
  return true;
});

export {};
