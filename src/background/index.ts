import { handleModelCatalogMessage, type ModelCatalogMessage } from "./modelCatalogMessageHandler";
import { handleChatSendMessage, type ChatSendMessage } from "./modelRequestHandler";
import { handlePageContextMessage, type PageContextExtractMessage } from "./pageContextMessageHandler";
import {
  handleAutomationExecuteDomActionMessage,
  handleAutomationNavigateTabMessage,
  type AutomationMessage,
} from "./automationMessageHandler";
import type { TabCaptureVisibleMessage } from "../shared/tabCapture";
import { handleSyncAlarm, handleSyncBackupMessage, restoreSyncAlarmFromSettings, type SyncBackupMessage } from "./syncBackupHandler";
import { handleTabCaptureVisibleMessage } from "./tabCaptureMessageHandler";
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
  runRestoreSyncAlarmFromSettings();
});

chrome.runtime.onStartup.addListener(() => {
  runRestoreSyncAlarmFromSettings();
});

function runRestoreSyncAlarmFromSettings(): void {
  void restoreSyncAlarmFromSettings().catch((error) => {
    console.error("自动同步定时任务恢复失败", error);
  });
}

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
  | ChatSendMessage
  | TabCaptureVisibleMessage
  | SyncBackupMessage
  | AutomationMessage;

interface ChatStreamStartMessage {
  type: "chat.stream.start";
  payload: ChatSendMessage;
}

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

  if (message.type === "tab.captureVisible") {
    void handleTabCaptureVisibleMessage().then(sendResponse);
    return true;
  }

  if (message.type === "automation.executeDomAction") {
    void handleAutomationExecuteDomActionMessage(message).then(sendResponse);
    return true;
  }

  if (message.type === "automation.navigateTab") {
    void handleAutomationNavigateTabMessage(message).then(sendResponse);
    return true;
  }

  if (message.type === "sync.backupNow" || message.type === "sync.restoreNow" || message.type === "sync.configureAlarm") {
    void handleSyncBackupMessage(message).then(sendResponse);
    return true;
  }

  if (message.type !== "modelCatalog.list" && message.type !== "modelCatalog.test") {
    return false;
  }

  void handleModelCatalogMessage(message).then(sendResponse);
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleSyncAlarm(alarm);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat.stream") {
    return;
  }

  const handlePortMessage = (message: ChatStreamStartMessage) => {
    if (message.type !== "chat.stream.start") {
      return;
    }

    void handleChatSendMessage(message.payload, fetch, {
      onContentChunk: (content) => port.postMessage({ type: "chunk", content }),
      onThinkingChunk: (content) => port.postMessage({ type: "thinking", content }),
    })
      .then((response) => {
        if (response.ok) {
          port.postMessage({ type: "complete", content: response.content, thinking: response.thinking });
          return;
        }

        port.postMessage({ type: "error", message: response.message });
      })
      .catch(() => {
        port.postMessage({ type: "error", message: "模型请求失败，请稍后重试" });
      });
  };

  port.onMessage.addListener(handlePortMessage);
});

export {};
