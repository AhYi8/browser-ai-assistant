import { normalizeText, truncateText } from "../shared/utils/text";
import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from "../shared/types";
import { getSelectorLines } from "../shared/extractionRules/validation";

export interface ExtractPageTextInput {
  url: string;
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback?: boolean;
}

export interface ExtractPageTextResult {
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
}

export function extractPageText(input: ExtractPageTextInput): ExtractPageTextResult {
  const extractMode = input.extractMode ?? "text";
  const allowFallback = input.allowFallback ?? true;
  const matchedRule = [...input.rules].sort((left, right) => left.sortOrder - right.sortOrder).find((rule) => matchUrl(rule.urlPattern, input.url));
  const extractedContent = matchedRule ? extractBySelectors(matchedRule.selectorsText, extractMode, input.selectorType) : "";
  const usedFallback = allowFallback && extractedContent.trim().length === 0;
  const rawContent = usedFallback ? extractGlobalContent(extractMode) : extractedContent;
  const normalizedContent = extractMode === "text" ? normalizeText(rawContent) : rawContent;
  const truncated = truncateText(normalizedContent, input.maxLength ?? Number.POSITIVE_INFINITY);

  return {
    ...truncated,
    usedFallback,
    matchedRuleId: matchedRule?.id,
  };
}

function matchUrl(pattern: string, url: string): boolean {
  try {
    return new RegExp(pattern).test(url);
  } catch {
    return false;
  }
}

function extractBySelectors(selectorsText: string, extractMode: PageContextExtractMode, selectorType?: ExtractionSelectorType): string {
  const selectors = getSelectorLines(selectorsText);
  const parts: string[] = [];

  for (const selector of selectors) {
    const selectorText = selectorType === "css"
      ? extractByCss(selector, extractMode)
      : selectorType === "xpath"
        ? extractByXPath(selector, extractMode)
        : extractByCss(selector, extractMode) || extractByXPath(selector, extractMode);
    if (selectorText) {
      parts.push(selectorText);
    }
  }

  return extractMode === "text" ? normalizeText(parts.join(" ")) : parts.join("\n");
}

function extractByCss(selector: string, extractMode: PageContextExtractMode): string {
  try {
    const nodes = Array.from(document.querySelectorAll(selector));
    return extractNodes(nodes, extractMode);
  } catch {
    return "";
  }
}

function extractByXPath(xpath: string, extractMode: PageContextExtractMode): string {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const nodes: Node[] = [];

    for (let index = 0; index < result.snapshotLength; index += 1) {
      const node = result.snapshotItem(index);
      if (node) {
        nodes.push(node);
      }
    }

    return extractNodes(nodes, extractMode);
  } catch {
    return "";
  }
}

function extractNodes(nodes: Node[], extractMode: PageContextExtractMode): string {
  if (extractMode === "text") {
    return normalizeText(nodes.map((node) => extractVisibleTextFromNode(node)).join(" "));
  }

  return nodes.map(serializeNodeContent).filter((content) => content !== "").join("\n");
}

function extractGlobalContent(extractMode: PageContextExtractMode): string {
  if (extractMode === "all") {
    return document.documentElement.outerHTML;
  }

  return extractVisibleTextFromNode(document.body);
}

function serializeNodeContent(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).outerHTML.trim();
  }

  return node.textContent ?? "";
}

function extractVisibleTextFromNode(root: Node): string {
  if (shouldSkipNode(root)) {
    return "";
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (!shouldSkipNode(currentNode)) {
      const text = normalizeText(currentNode.textContent ?? "");
      if (text) {
        parts.push(text);
      }
    }
    currentNode = walker.nextNode();
  }

  return normalizeText(parts.join(" "));
}

function shouldSkipNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) {
    return true;
  }

  if (!document.body.contains(element)) {
    return true;
  }

  return Boolean(element.closest("script, style, template, noscript, [hidden], [aria-hidden='true']")) || isElementHidden(element);
}

function isElementHidden(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
}
