import {
  JS_EXTRACT_CONTEXT_TOOL_ID,
  JS_EXTRACT_CONTEXT_TOOL_NAME,
  JS_LIST_RESOURCES_TOOL_ID,
  JS_LIST_RESOURCES_TOOL_NAME,
  JS_SEARCH_SOURCES_TOOL_ID,
  JS_SEARCH_SOURCES_TOOL_NAME,
} from "../../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";
import type {
  ChatJsSourceToolAttachment,
  JsSourceContext,
  JsSourceFetchFailure,
  JsSourceMatch,
  JsSourceResource,
  NetworkRequestDetail,
  NetworkRequestMeta,
} from "../../shared/types";
import { truncateText } from "../../shared/utils/text";
import { JsSourceIndex, isJavaScriptDetail, isJavaScriptMetaLike } from "./jsSourceIndex";
import { SameOriginJsFetcher, type SameOriginJsFetchResult } from "./sameOriginJsFetcher";
import type { NetworkRequestFilter } from "./networkRecorder";

type JsSourceToolName =
  | typeof JS_LIST_RESOURCES_TOOL_ID
  | typeof JS_LIST_RESOURCES_TOOL_NAME
  | typeof JS_SEARCH_SOURCES_TOOL_ID
  | typeof JS_SEARCH_SOURCES_TOOL_NAME
  | typeof JS_EXTRACT_CONTEXT_TOOL_ID
  | typeof JS_EXTRACT_CONTEXT_TOOL_NAME;

interface JsSourceRecorderLike {
  isEnabled: boolean | (() => boolean);
  listRequests(filter?: NetworkRequestFilter): NetworkRequestMeta[];
  getDetails(requestIds: string[]): Promise<NetworkRequestDetail[]>;
}

export interface JsSourceToolExecutorOptions {
  recorder: JsSourceRecorderLike;
  getCurrentPageUrl: () => Promise<string>;
  fetcher?: Pick<SameOriginJsFetcher, "fetch">;
}

const JS_SOURCE_DISABLED_MESSAGE = "JS 源码检索依赖 Network 采集，请先开启浏览器控制。";
const KEYWORDS_INVALID_MESSAGE = "keywords 必须是包含 1 到 20 个非空字符串的数组。";
const RESOURCE_ID_INVALID_MESSAGE = "resourceId 必须是非空字符串。";
const POSITION_INVALID_MESSAGE = "position 必须是大于等于 0 的有限数字。";
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 200;
const MAX_URLS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_RESOURCE_IDS = 100;
const DEFAULT_RESOURCE_LIMIT = 100;
const DEFAULT_MATCH_LIMIT = 50;
const JS_SOURCE_TOOL_NAMES = new Set<string>([
  JS_LIST_RESOURCES_TOOL_ID,
  JS_LIST_RESOURCES_TOOL_NAME,
  JS_SEARCH_SOURCES_TOOL_ID,
  JS_SEARCH_SOURCES_TOOL_NAME,
  JS_EXTRACT_CONTEXT_TOOL_ID,
  JS_EXTRACT_CONTEXT_TOOL_NAME,
]);

export class JsSourceToolExecutor {
  private readonly index = new JsSourceIndex();
  private readonly fetcher: Pick<SameOriginJsFetcher, "fetch">;

  constructor(private readonly options: JsSourceToolExecutorOptions) {
    this.fetcher = options.fetcher ?? new SameOriginJsFetcher();
  }

  clear(): void {
    this.index.clear();
  }

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!this.isEnabled()) {
      return createErrorResult(toolCall, JS_SOURCE_DISABLED_MESSAGE);
    }
    if (!JS_SOURCE_TOOL_NAMES.has(toolCall.name)) {
      return createErrorResult(toolCall, `未知的 JS 源码工具：${toolCall.name}。`);
    }

    try {
      await this.refreshNetworkResources();
      if (isToolCallName(toolCall.name, JS_LIST_RESOURCES_TOOL_ID, JS_LIST_RESOURCES_TOOL_NAME)) {
        return this.listResources(toolCall);
      }
      if (isToolCallName(toolCall.name, JS_SEARCH_SOURCES_TOOL_ID, JS_SEARCH_SOURCES_TOOL_NAME)) {
        return await this.searchSources(toolCall);
      }
      return this.extractContext(toolCall);
    } catch {
      return createErrorResult(toolCall, "JS 源码工具执行失败，请稍后重试。");
    }
  }

  async searchForNetworkCompatibility(args: Record<string, unknown>): Promise<{ content: string; resources: JsSourceResource[]; matches: JsSourceMatch[]; truncated: boolean }> {
    if (this.isEnabled()) {
      await this.refreshNetworkResources();
    }
    const keywords = normalizeKeywords(args.keywords);
    const urlIncludes = normalizeOptionalString(args.urlIncludes, MAX_KEYWORD_LENGTH);
    const terms = keywords.ok && keywords.keywords.length ? keywords.keywords : [];
    if (urlIncludes) {
      terms.push(urlIncludes);
    }
    const fallbackTerms = terms.length ? terms : ["sign", "signature", "encrypt", "crypto", "md5", "sha", "aes", "nonce", "timestamp", "token"];
    const result = this.index.search(fallbackTerms, { maxMatches: DEFAULT_MATCH_LIMIT });
    return {
      content: formatSearchResult(result.matches, [], result.truncated),
      resources: this.index.listResources(),
      matches: result.matches,
      truncated: result.truncated,
    };
  }

  private async refreshNetworkResources(): Promise<void> {
    const listedRequests = this.options.recorder.listRequests({ limit: DEFAULT_RESOURCE_LIMIT });
    const metas = Array.isArray(listedRequests) ? listedRequests.filter(isJavaScriptMeta) : [];
    if (metas.length === 0) {
      // 兼容阶段一旧入口：无 JS 资源时仍走一次详情读取，保持既有 mock/调用口径稳定。
      await this.options.recorder.getDetails([]);
      return;
    }
    const details = await this.options.recorder.getDetails(metas.slice(0, MAX_RESOURCE_IDS).map((request) => request.id));
    this.index.upsertNetworkDetails(details.filter(isJavaScriptDetail));
  }

  private listResources(toolCall: ModelToolCall): ModelToolResult {
    const resources = this.index.listResources();
    return createJsSourceResult(toolCall, formatResourceList(resources), { resources });
  }

  private async searchSources(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const keywords = normalizeKeywords(toolCall.arguments.keywords);
    if (!keywords.ok) {
      return createErrorResult(toolCall, keywords.message);
    }

    const failedFetches = toolCall.arguments.allowSameOriginFetch === true
      ? await this.fetchSameOriginResources(normalizeStringArray(toolCall.arguments.urls, MAX_URLS, MAX_URL_LENGTH))
      : [];
    const result = this.index.search(keywords.keywords, { maxMatches: normalizeLimit(toolCall.arguments.limit, DEFAULT_MATCH_LIMIT) });
    return createJsSourceResult(toolCall, formatSearchResult(result.matches, failedFetches, result.truncated), {
      query: keywords.keywords,
      resources: this.index.listResources(),
      matches: result.matches,
      failedFetches,
      truncated: result.truncated,
    });
  }

  private extractContext(toolCall: ModelToolCall): ModelToolResult {
    const resourceId = normalizeOptionalString(toolCall.arguments.resourceId, 256);
    if (!resourceId) {
      return createErrorResult(toolCall, RESOURCE_ID_INVALID_MESSAGE);
    }
    const position = toolCall.arguments.position;
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
      return createErrorResult(toolCall, POSITION_INVALID_MESSAGE);
    }

    const context = this.index.extractContext(resourceId, position);
    if (!context) {
      return createJsSourceResult(toolCall, "未找到指定 JS 资源或位置。", { resources: this.index.listResources() });
    }

    return createJsSourceResult(toolCall, formatContexts([context]), {
      resources: this.index.listResources().filter((resource) => resource.id === resourceId),
      contexts: [context],
      truncated: context.truncated,
    });
  }

  private async fetchSameOriginResources(urls: string[]): Promise<JsSourceFetchFailure[]> {
    const pageUrl = await this.options.getCurrentPageUrl();
    const failures: JsSourceFetchFailure[] = [];
    for (const url of urls) {
      const result: SameOriginJsFetchResult = await this.fetcher.fetch(url, pageUrl);
      if (result.ok) {
        this.index.upsertFetchedResource(result.resource);
      } else {
        failures.push({ url: result.url, message: result.message });
      }
    }
    return failures;
  }

  private isEnabled(): boolean {
    return typeof this.options.recorder.isEnabled === "function" ? this.options.recorder.isEnabled() : this.options.recorder.isEnabled;
  }
}

function createJsSourceResult(
  toolCall: ModelToolCall,
  content: string,
  payload: {
    query?: string[];
    resources?: JsSourceResource[];
    matches?: JsSourceMatch[];
    contexts?: JsSourceContext[];
    failedFetches?: JsSourceFetchFailure[];
    truncated?: boolean;
  },
): ModelToolResult {
  const attachment = createJsSourceAttachment(toolCall.id, payload);
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    toolAttachments: [attachment],
  };
}

function createJsSourceAttachment(
  sourceToolCallId: string,
  payload: {
    query?: string[];
    resources?: JsSourceResource[];
    matches?: JsSourceMatch[];
    contexts?: JsSourceContext[];
    failedFetches?: JsSourceFetchFailure[];
    truncated?: boolean;
  },
): ChatJsSourceToolAttachment {
  const resources = payload.resources ?? [];
  const matches = payload.matches ?? [];
  const contexts = payload.contexts ?? [];
  const failedFetches = payload.failedFetches ?? [];
  return {
    id: `tool-attachment-${sourceToolCallId}`,
    kind: "js-source",
    title: "JS 源码片段",
    summary: formatJsSourceSummary(resources, matches, contexts, failedFetches),
    sourceToolCallId,
    createdAt: Date.now(),
    redacted: true,
    truncated: payload.truncated === true || resources.some((resource) => resource.truncated) || matches.some((match) => match.truncated) || contexts.some((context) => context.truncated),
    query: payload.query,
    resources,
    jsMatches: matches,
    contexts,
    failedFetches,
  };
}

function createErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function formatResourceList(resources: JsSourceResource[]): string {
  if (resources.length === 0) {
    return "当前未找到可检索的 JS 资源。";
  }
  return resources
    .map((resource, index) =>
      `${index + 1}. id=${resource.id} | ${resource.source} | ${resource.mimeType ?? "unknown"} | ${resource.size} chars | ${resource.url}`,
    )
    .join("\n");
}

function formatSearchResult(matches: JsSourceMatch[], failures: JsSourceFetchFailure[], truncated: boolean): string {
  const sections: string[] = [];
  if (matches.length) {
    sections.push([
      `找到 ${matches.length} 个 JS 源码命中${truncated ? "（结果已截断）" : ""}：`,
      ...matches.map((match) => `- ${match.source} ${match.resourceId}:${match.line}:${match.column} ${match.url} 命中 ${match.term}: ${match.snippet}`),
    ].join("\n"));
  } else {
    sections.push("未找到匹配的 JS 源码片段。");
  }
  if (failures.length) {
    sections.push(["同源补位失败：", ...failures.map((failure) => `- ${failure.url}: ${failure.message}`)].join("\n"));
  }
  return sections.join("\n\n");
}

function formatContexts(contexts: JsSourceContext[]): string {
  return contexts
    .map((context) => [
      `JS 上下文：${context.resourceId}:${context.line}:${context.column}`,
      `来源：${context.source}`,
      `URL：${context.url}`,
      context.truncated ? "Truncated: true" : "Truncated: false",
      "",
      context.snippet,
    ].join("\n"))
    .join("\n\n");
}

function formatJsSourceSummary(resources: JsSourceResource[], matches: JsSourceMatch[], contexts: JsSourceContext[], failures: JsSourceFetchFailure[]): string {
  return `JS 资源 ${resources.length} 个，命中 ${matches.length} 个，上下文 ${contexts.length} 个，补位失败 ${failures.length} 个。`;
}

function normalizeKeywords(value: unknown): { ok: true; keywords: string[] } | { ok: false; message: string } {
  const keywords = normalizeStringArray(value, MAX_KEYWORDS, MAX_KEYWORD_LENGTH);
  if (keywords.length === 0) {
    return { ok: false, message: KEYWORDS_INVALID_MESSAGE };
  }
  return { ok: true, keywords };
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => normalizeOptionalString(item, maxLength)).filter((item): item is string => Boolean(item)))).slice(0, maxItems);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? truncateText(trimmed, maxLength).text : undefined;
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), DEFAULT_MATCH_LIMIT);
}

function isToolCallName(name: string, legacyId: string, publicName: string): boolean {
  return name === legacyId || name === publicName;
}

function isJavaScriptMeta(meta: NetworkRequestMeta): boolean {
  return isJavaScriptMetaLike(meta);
}
