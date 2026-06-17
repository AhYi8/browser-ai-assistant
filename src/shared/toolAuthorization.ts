export type ToolAuthorizationMode = "normal" | "runtime_readonly" | "full_access_reserved";

export type ToolRiskCapability =
  | "browser_control"
  | "network_read"
  | "runtime_readonly"
  | "full_access_reserved";

export interface ToolAuthorizationContext {
  mode: ToolAuthorizationMode;
  tabId?: number;
  createdAt: number;
  expiresAt?: number;
  reason?: string;
}

export const NORMAL_TOOL_AUTHORIZATION_CONTEXT: ToolAuthorizationContext = {
  mode: "normal",
  createdAt: 0,
};

export function isRuntimeReadonlyAuthorized(context: ToolAuthorizationContext, tabId: number | undefined, now = Date.now()): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  if (context.mode !== "runtime_readonly") {
    return false;
  }

  if (context.expiresAt !== undefined && context.expiresAt <= now) {
    return false;
  }

  return context.tabId === tabId;
}

export function isUnsupportedReservedAuthorization(context: ToolAuthorizationContext): boolean {
  return context.mode === "full_access_reserved";
}
