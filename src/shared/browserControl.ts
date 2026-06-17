export const BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE = "browserControl.setEnabled";
export const BROWSER_CONTROL_DETACHED_MESSAGE_TYPE = "browserControl.detached";
export const BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE = "browserControl.setRuntimeReadonly";
export const BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE = "browserControl.runtimeReadonlyChanged";

export interface BrowserControlSetEnabledMessage {
  type: typeof BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE;
  enabled: boolean;
  tabId?: number;
}

export interface BrowserControlDetachedMessage {
  type: typeof BROWSER_CONTROL_DETACHED_MESSAGE_TYPE;
  tabId?: number;
  reason: "canceled_by_user" | "target_closed" | "tab_removed" | "disabled_by_user" | "unknown";
}

export interface BrowserControlSetRuntimeReadonlyMessage {
  type: typeof BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE;
  enabled: boolean;
  reason?: string;
  // 预留给后续多受控页授权校验；当前阶段 background 只信任已 attach 的当前 tab。
  tabId?: number;
}

export interface BrowserControlRuntimeReadonlyChangedMessage {
  type: typeof BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE;
  enabled: boolean;
  tabId?: number;
  expiresAt?: number;
}

export type BrowserControlMessage = BrowserControlSetEnabledMessage | BrowserControlSetRuntimeReadonlyMessage;
export type BrowserControlRuntimeEvent = BrowserControlDetachedMessage | BrowserControlRuntimeReadonlyChangedMessage;

export type BrowserControlResponse =
  | {
      ok: true;
      attached: boolean;
      tabId?: number;
      expiresAt?: number;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "edge://",
  "about:",
  "chrome-extension://",
  "view-source:",
];

const RESTRICTED_URL_PREFIXES_EXACT = [
  "https://chromewebstore.google.com",
  "https://chrome.google.com/webstore",
];

export function getBrowserControlTabUrl(tab: Pick<chrome.tabs.Tab, "url" | "pendingUrl"> | undefined): string {
  return tab?.url || tab?.pendingUrl || "";
}

export function isBrowserControlRestrictedUrl(urlRaw: string): boolean {
  const url = urlRaw.trim().toLowerCase();
  if (!url) {
    return true;
  }

  return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
    RESTRICTED_URL_PREFIXES_EXACT.some((prefix) => url.startsWith(prefix));
}
