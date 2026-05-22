import { DEFAULT_CONTEXT_MAX_LENGTH } from "../shared/constants";
import type { ExtractionRule, PageContextExtractMode } from "../shared/types";
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
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPageContextExtractMessage(message)) {
    return false;
  }

  const result = extractPageText({
    url: window.location.href,
    rules: message.rules,
    maxLength: message.maxLength ?? DEFAULT_CONTEXT_MAX_LENGTH,
    extractMode: message.extractMode ?? "text",
  });

  sendResponse({
    ok: true,
    url: window.location.href,
    ...result,
  });

  return false;
});
