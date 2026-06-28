import type { ExtractionSelectorType } from "../types";

export interface ExtractionRuleDraft {
  alias: string;
  urlPattern: string;
  selectorsText: string;
}

export type ExtractionRuleValidationResult = { ok: true } | { ok: false; message: string };

export function validateExtractionRuleDraft(draft: ExtractionRuleDraft): ExtractionRuleValidationResult {
  const urlPattern = draft.urlPattern.trim();
  if (!urlPattern) {
    return { ok: false, message: "URL 正则不能为空" };
  }

  try {
    new RegExp(urlPattern);
  } catch {
    return { ok: false, message: "URL 正则格式不正确" };
  }

  const selectors = getSelectorLines(draft.selectorsText);
  if (selectors.length === 0) {
    return { ok: false, message: "请至少填写一条 CSS 或 XPath" };
  }

  for (const [index, selector] of selectors.entries()) {
    if (!isValidExtractionSelector(selector)) {
      return { ok: false, message: `第 ${index + 1} 行 CSS/XPath 格式不正确` };
    }
  }

  return { ok: true };
}

export function validateExtractionSelector(selectorText: string, selectorType?: ExtractionSelectorType): ExtractionRuleValidationResult {
  const selectors = getSelectorLines(selectorText);
  if (selectors.length === 0) {
    return { ok: false, message: "请至少填写一条 CSS 或 XPath" };
  }

  for (const [index, selector] of selectors.entries()) {
    if (!isValidExtractionSelector(selector, selectorType)) {
      return { ok: false, message: `第 ${index + 1} 行 CSS/XPath 格式不正确` };
    }
  }

  return { ok: true };
}

export function getSelectorLines(selectorsText: string): string[] {
  return selectorsText
    .split(/\r?\n/)
    .map((selector) => selector.trim())
    .filter(Boolean);
}

function isValidExtractionSelector(selector: string, selectorType?: ExtractionSelectorType): boolean {
  if (selectorType === "css") {
    return isValidCssSelector(selector);
  }
  if (selectorType === "xpath") {
    return isValidXPath(selector);
  }
  return isValidCssSelector(selector) || isValidXPath(selector);
}

function isValidCssSelector(selector: string): boolean {
  try {
    if (typeof document !== "undefined") {
      document.createDocumentFragment().querySelector(selector);
      return true;
    }
    // background service worker 没有 DOM，只做保守语法检查，避免明显畸形输入继续进入内容脚本。
    return isConservativelyValidCssSelector(selector);
  } catch {
    return false;
  }
}

function isValidXPath(selector: string): boolean {
  try {
    if (typeof document !== "undefined" && typeof XPathResult !== "undefined") {
      document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return true;
    }
    // background service worker 没有 XPath 解析器，只接受形态明确且括号/引号闭合的 XPath。
    return /^(\/|\.\/|\()/.test(selector) && hasBalancedSelectorDelimiters(selector);
  } catch {
    return false;
  }
}

function hasBalancedSelectorDelimiters(selector: string): boolean {
  const stack: string[] = [];
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  const pairs: Record<string, string> = {
    "]": "[",
    ")": "(",
  };

  for (const char of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(") {
      stack.push(char);
      continue;
    }
    if (char === "]" || char === ")") {
      if (stack.pop() !== pairs[char]) {
        return false;
      }
    }
  }

  return !quote && stack.length === 0;
}

function isConservativelyValidCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!hasBalancedSelectorDelimiters(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("/") || /^[>+~]/.test(trimmed) || /[>+~]\s*$/.test(trimmed)) {
    return false;
  }
  return !trimmed.includes(",,");
}
