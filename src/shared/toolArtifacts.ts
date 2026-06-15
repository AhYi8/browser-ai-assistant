import type {
  ChatGenericToolAttachment,
  ChatJsSourceToolAttachment,
  ChatMessage,
  ChatNetworkContextAttachment,
  ChatNetworkToolAttachment,
  ChatToolCallRecord,
  ChatToolAttachment,
  ChatWebSearchResult,
  ChatWebSearchPayload,
  ChatWebSearchToolAttachment,
  JsSourceContext,
  JsSourceFetchFailure,
  JsSourceMatch,
  JsSourceResource,
} from "./types";
import { formatNetworkAttachmentForExport, formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "./networkContext";
import { createTavilySearchContextPrompt, formatTavilySearchAttachmentSummary } from "./webSearch/tavily";
import { truncateText } from "./utils/text";

const TOOL_ATTACHMENT_KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const GENERIC_DETAIL_LIMIT = 4000;

type ToolAttachmentAggregateGroup = {
  attachments: ChatToolAttachment[];
  toolDisplayName?: string;
};

export function createWebSearchToolAttachment(
  attachment: ChatWebSearchPayload,
  sourceToolCallId?: string,
): ChatWebSearchToolAttachment {
  return {
    id: sourceToolCallId ? `tool-attachment-${sourceToolCallId}` : `tool-attachment-web-search-${attachment.createdAt}`,
    kind: "web-search",
    title: "网络搜索结果",
    summary: formatTavilySearchAttachmentSummary(attachment),
    sourceToolCallId,
    createdAt: attachment.createdAt,
    redacted: false,
    truncated: attachment.truncated,
    provider: attachment.provider,
    query: attachment.query,
    answer: attachment.answer,
    results: attachment.results,
  };
}

export function createNetworkToolAttachment(attachment: ChatNetworkContextAttachment): ChatNetworkToolAttachment {
  const requests = attachment.requests.map(redactNetworkRequestDetail);
  return {
    id: attachment.id,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    createdAt: attachment.createdAt,
    redacted: true,
    truncated: attachment.truncated,
    requests,
  };
}

export function collectMessageToolAttachments(message: ChatMessage): ChatToolAttachment[] {
  return aggregateToolAttachments(collectRawMessageToolAttachments(message), message.toolCallRecords);
}

// 原始附件用于工具调用详情追溯；聚合附件用于消息展示、导出和后续追问，避免同一轮多次工具调用撑开附件区。
export function collectRawMessageToolAttachments(message: ChatMessage): ChatToolAttachment[] {
  const attachments = uniqueToolAttachmentsById(message.toolAttachments ?? []);
  const legacyAttachments: ChatToolAttachment[] = [];
  if (message.networkContextAttachment) {
    legacyAttachments.push(createNetworkToolAttachment(message.networkContextAttachment));
  }
  return mergeCompatibleToolAttachments(attachments, legacyAttachments);
}

export function aggregateToolAttachments(attachments: ChatToolAttachment[], records: ChatToolCallRecord[] = []): ChatToolAttachment[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const recordsByAttachmentId = createRecordsByAttachmentId(records);
  const groups = new Map<string, ToolAttachmentAggregateGroup>();
  const order: string[] = [];
  for (const attachment of attachments) {
    const target = createToolAttachmentAggregateTarget(attachment, recordsById, recordsByAttachmentId);
    if (!groups.has(target.key)) {
      groups.set(target.key, { attachments: [], toolDisplayName: target.toolDisplayName });
      order.push(target.key);
    }
    groups.get(target.key)?.attachments.push(attachment);
  }

  return order
    .map((groupKey) => {
      const group = groups.get(groupKey);
      return group ? aggregateToolAttachmentGroup(group) : undefined;
    })
    .filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
}

export function formatToolAttachmentForPrompt(attachment: ChatToolAttachment): string | undefined {
  if (isWebSearchToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史网络搜索结果：", createTavilySearchContextPrompt(attachment)].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = attachment.requests.map(redactNetworkRequestDetail);
    return ["后续追问需要继续参考以下历史 Network 请求详情：", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史 JS 源码片段：", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  if (attachment.details?.trim()) {
    return [`后续追问需要继续参考以下历史工具附件：${attachment.title}`, attachment.details.trim()].join("\n");
  }

  return attachment.summary.trim() ? [`后续追问需要继续参考以下历史工具附件：${attachment.title}`, attachment.summary.trim()].join("\n") : undefined;
}

export function formatToolAttachmentForExport(attachment: ChatToolAttachment): string {
  if (isWebSearchToolAttachment(attachment)) {
    return ["# 网络搜索结果附件", "", formatTavilySearchAttachmentSummary(attachment), "", createTavilySearchContextPrompt(attachment)].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = attachment.requests.map(redactNetworkRequestDetail);
    return ["# Network 请求详情附件", "", formatNetworkAttachmentSummary(requests), "", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["# JS 源码片段附件", "", formatJsSourceAttachmentSummary(attachment), "", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  return ["# 工具结果附件", "", attachment.summary, "", attachment.details ?? ""].join("\n").trim();
}

export function normalizeToolAttachment(value: unknown): ChatToolAttachment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Partial<ChatToolAttachment>;
  const kind = typeof source.kind === "string" ? source.kind.trim() : "";
  if (!TOOL_ATTACHMENT_KIND_PATTERN.test(kind)) {
    return undefined;
  }

  if (kind === "web-search") {
    return normalizeWebSearchToolAttachment(source);
  }

  if (kind === "network") {
    return normalizeNetworkToolAttachment(source);
  }

  if (kind === "js-source") {
    return normalizeJsSourceToolAttachment(source);
  }

  return normalizeGenericToolAttachment(source, kind);
}

export function isWebSearchToolAttachment(attachment: ChatToolAttachment): attachment is ChatWebSearchToolAttachment {
  return attachment.kind === "web-search" && "results" in attachment;
}

export function isNetworkToolAttachment(attachment: ChatToolAttachment): attachment is ChatNetworkToolAttachment {
  return attachment.kind === "network" && "requests" in attachment;
}

export function isJsSourceToolAttachment(attachment: ChatToolAttachment): attachment is ChatJsSourceToolAttachment {
  return attachment.kind === "js-source" && "resources" in attachment && "jsMatches" in attachment && "contexts" in attachment;
}

export function uniqueToolAttachmentsById(attachments: ChatToolAttachment[]): ChatToolAttachment[] {
  return uniqueBy(attachments, (attachment) => attachment.id);
}

export function mergeCompatibleToolAttachments(primary: ChatToolAttachment[], compatible: ChatToolAttachment[]): ChatToolAttachment[] {
  const result = uniqueToolAttachmentsById(primary);
  for (const attachment of compatible) {
    if (result.some((item) => isSameToolAttachmentContent(item, attachment))) {
      continue;
    }
    result.push(attachment);
  }
  return result;
}

function isSameToolAttachmentContent(left: ChatToolAttachment, right: ChatToolAttachment): boolean {
  return left.id === right.id || createToolAttachmentContentKey(left) === createToolAttachmentContentKey(right);
}

function createToolAttachmentContentKey(attachment: ChatToolAttachment): string {
  if (isWebSearchToolAttachment(attachment)) {
    return [
      attachment.kind,
      attachment.provider,
      normalizeComparableText(attachment.query),
      normalizeComparableText(attachment.answer ?? ""),
      ...attachment.results.map((result) =>
        [normalizeComparableText(result.url), normalizeComparableText(result.title), normalizeComparableText(result.content)].join("\u0001"),
      ),
    ].join("\u0000");
  }

  if (isNetworkToolAttachment(attachment)) {
    return [
      attachment.kind,
      ...attachment.requests.map((request) =>
        [normalizeComparableText(request.id), normalizeComparableText(request.method), normalizeComparableText(request.url), String(request.status ?? "")].join("\u0001"),
      ),
    ].join("\u0000");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return [
      attachment.kind,
      normalizeComparableText(attachment.query?.join(" ") ?? ""),
      ...attachment.resources.map((resource) => [resource.id, resource.source, normalizeComparableText(resource.url)].join("\u0001")),
      ...attachment.jsMatches.map((match) => [match.resourceId, String(match.position), normalizeComparableText(match.term)].join("\u0001")),
      ...attachment.contexts.map((context) => [context.resourceId, String(context.position)].join("\u0001")),
    ].join("\u0000");
  }

  return [attachment.kind, normalizeComparableText(attachment.title), normalizeComparableText(attachment.summary), normalizeComparableText(attachment.details ?? "")].join("\u0000");
}

function createRecordsByAttachmentId(records: ChatToolCallRecord[]): Map<string, ChatToolCallRecord> {
  const recordsByAttachmentId = new Map<string, ChatToolCallRecord>();
  for (const record of records) {
    for (const attachmentId of record.attachmentIds ?? []) {
      if (!recordsByAttachmentId.has(attachmentId)) {
        recordsByAttachmentId.set(attachmentId, record);
      }
    }
  }
  return recordsByAttachmentId;
}

function createToolAttachmentAggregateTarget(
  attachment: ChatToolAttachment,
  recordsById: Map<string, ChatToolCallRecord>,
  recordsByAttachmentId: Map<string, ChatToolCallRecord>,
): { key: string; toolDisplayName?: string } {
  // 兼容旧工具结果：有的历史或过渡数据只在工具记录里保存 attachmentIds，附件本身没有 sourceToolCallId。
  const record = attachment.sourceToolCallId ? recordsById.get(attachment.sourceToolCallId) : recordsByAttachmentId.get(attachment.id);
  if (record) {
    return { key: `tool:${record.toolId || record.name}`, toolDisplayName: record.displayName || record.name };
  }

  // 缺少工具记录的旧数据无法可靠判断“同一工具”，带调用 ID 的附件保守地按调用拆开。
  if (attachment.sourceToolCallId) {
    return { key: `${attachment.kind}\u0000call:${attachment.sourceToolCallId}` };
  }

  return { key: `${attachment.kind}\u0000legacy` };
}

export function aggregateToolAttachmentGroupByKind(attachments: ChatToolAttachment[]): ChatToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }
  return aggregateToolAttachmentGroup({ attachments });
}

function aggregateToolAttachmentGroup(group: ToolAttachmentAggregateGroup): ChatToolAttachment | undefined {
  const { attachments } = group;
  if (attachments.length === 0) {
    return undefined;
  }

  if (attachments.length === 1) {
    return attachments[0];
  }

  const kinds = uniqueNonEmptyStrings(attachments.map((attachment) => attachment.kind));
  if (kinds.length > 1) {
    return aggregateMixedKindToolAttachments(attachments, group.toolDisplayName);
  }

  const kind = kinds[0] ?? attachments[0].kind;
  if (kind === "web-search") {
    return aggregateWebSearchToolAttachments(attachments.filter(isWebSearchToolAttachment));
  }

  if (kind === "network") {
    return aggregateNetworkToolAttachments(attachments.filter(isNetworkToolAttachment));
  }

  if (kind === "js-source") {
    return aggregateJsSourceToolAttachments(attachments.filter(isJsSourceToolAttachment));
  }

  return aggregateGenericToolAttachments(kind, attachments);
}

function aggregateMixedKindToolAttachments(attachments: ChatToolAttachment[], toolDisplayName?: string): ChatGenericToolAttachment {
  const details = uniqueNonEmptyStrings(attachments.map(formatToolAttachmentForExport)).join("\n\n");
  const truncatedDetails = truncateText(details, GENERIC_DETAIL_LIMIT);
  return {
    id: `tool-attachment-tool-result-set-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "tool-result-set",
    title: `${toolDisplayName ?? attachments[0].title}结果`,
    summary: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.summary)).join("\n"),
    createdAt: Math.max(...attachments.map((attachment) => attachment.createdAt)),
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated) || truncatedDetails.truncated,
    details: truncatedDetails.text || undefined,
  };
}

function aggregateWebSearchToolAttachments(attachments: ChatWebSearchToolAttachment[]): ChatWebSearchToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const first = attachments[0];
  const results = uniqueBy(attachments.flatMap((attachment) => attachment.results), (result) => result.url.trim() || result.title.trim());
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatWebSearchToolAttachment = {
    id: `tool-attachment-web-search-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "web-search",
    title: first.title || "网络搜索结果",
    summary: "",
    createdAt,
    redacted: false,
    truncated: attachments.some((attachment) => attachment.truncated),
    provider: first.provider,
    query: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.query)).join("；"),
    answer: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.answer)).join("\n\n") || undefined,
    results,
  };
  return {
    ...aggregated,
    summary: formatTavilySearchAttachmentSummary(aggregated),
  };
}

function aggregateNetworkToolAttachments(attachments: ChatNetworkToolAttachment[]): ChatNetworkToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const requests = uniqueBy(
    attachments.flatMap((attachment) => attachment.requests.map(redactNetworkRequestDetail)),
    (request) => request.id.trim() || `${request.method}\u0000${request.url}\u0000${request.status ?? ""}`,
  );
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  return {
    id: `tool-attachment-network-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    createdAt,
    redacted: true,
    truncated: attachments.some((attachment) => attachment.truncated || attachment.requests.some((request) => request.truncated)),
    requests,
  };
}

function aggregateJsSourceToolAttachments(attachments: ChatJsSourceToolAttachment[]): ChatJsSourceToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const resources = uniqueBy(attachments.flatMap((attachment) => attachment.resources), (resource) => resource.id.trim() || resource.url.trim());
  const jsMatches = uniqueBy(attachments.flatMap((attachment) => attachment.jsMatches), (match) => `${match.resourceId}\u0000${match.position}\u0000${match.term}`);
  const contexts = uniqueBy(attachments.flatMap((attachment) => attachment.contexts), (context) => `${context.resourceId}\u0000${context.position}`);
  const failedFetches = uniqueBy(attachments.flatMap((attachment) => attachment.failedFetches), (failure) => `${failure.url}\u0000${failure.message}`);
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatJsSourceToolAttachment = {
    id: `tool-attachment-js-source-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "js-source",
    title: "JS 源码片段",
    summary: "",
    createdAt,
    redacted: true,
    truncated: attachments.some((attachment) => attachment.truncated),
    query: uniqueNonEmptyStrings(attachments.flatMap((attachment) => attachment.query)).slice(0, 20),
    resources,
    jsMatches,
    contexts,
    failedFetches,
  };
  return {
    ...aggregated,
    summary: formatJsSourceAttachmentSummary(aggregated),
  };
}

function aggregateGenericToolAttachments(kind: string, attachments: ChatToolAttachment[]): ChatGenericToolAttachment {
  const first = attachments[0];
  const details = uniqueNonEmptyStrings(
    attachments.map((attachment) => ("details" in attachment && typeof attachment.details === "string" ? attachment.details : undefined)),
  ).join("\n\n");
  const truncatedDetails = truncateText(details, GENERIC_DETAIL_LIMIT);
  return {
    id: `tool-attachment-${kind}-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind,
    title: first.title,
    summary: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.summary)).join("\n"),
    createdAt: Math.max(...attachments.map((attachment) => attachment.createdAt)),
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated) || truncatedDetails.truncated,
    details: truncatedDetails.text || undefined,
  };
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

function uniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeWebSearchToolAttachment(source: Partial<ChatToolAttachment>): ChatWebSearchToolAttachment | undefined {
  const query = "query" in source && typeof source.query === "string" ? source.query.trim() : "";
  const provider = "provider" in source && source.provider === "tavily" ? source.provider : undefined;
  const results = "results" in source && Array.isArray(source.results) ? source.results : undefined;
  if (!query || !provider || !results) {
    return undefined;
  }

  const attachment = {
    provider,
    query,
    answer: "answer" in source && typeof source.answer === "string" && source.answer.trim() ? source.answer.trim() : undefined,
    results: results
      .map((item): ChatWebSearchResult | undefined => {
        if (!item || typeof item !== "object") {
          return undefined;
        }
        const result = item as { title?: unknown; url?: unknown; content?: unknown; rawContent?: unknown; score?: unknown; publishedDate?: unknown };
        const url = typeof result.url === "string" ? result.url.trim() : "";
        const content = typeof result.content === "string" ? result.content.trim() : "";
        if (!url || !content) {
          return undefined;
        }
        return {
          title: typeof result.title === "string" && result.title.trim() ? result.title.trim() : url,
          url,
          content,
          rawContent: typeof result.rawContent === "string" && result.rawContent.trim() ? result.rawContent.trim() : undefined,
          score: typeof result.score === "number" && Number.isFinite(result.score) ? result.score : undefined,
          publishedDate: typeof result.publishedDate === "string" && result.publishedDate.trim() ? result.publishedDate.trim() : undefined,
        };
      })
      .filter((item): item is ChatWebSearchResult => Boolean(item)),
    createdAt: normalizeTimestamp(source.createdAt),
    truncated: typeof source.truncated === "boolean" ? source.truncated : false,
  };

  return {
    ...createWebSearchToolAttachment(attachment, normalizeOptionalString(source.sourceToolCallId)),
    id: normalizeId(source.id, `tool-attachment-web-search-${attachment.createdAt}`),
    title: normalizeOptionalString(source.title) ?? "网络搜索结果",
    summary: normalizeOptionalString(source.summary) ?? formatTavilySearchAttachmentSummary(attachment),
  };
}

function normalizeNetworkToolAttachment(source: Partial<ChatToolAttachment>): ChatNetworkToolAttachment | undefined {
  if (!("requests" in source) || !Array.isArray(source.requests)) {
    return undefined;
  }

  const requests = source.requests
    .map((item) => (item && typeof item === "object" ? redactNetworkRequestDetail(item as ChatNetworkToolAttachment["requests"][number]) : undefined))
    .filter((item): item is ChatNetworkToolAttachment["requests"][number] => Boolean(item));
  if (requests.length === 0) {
    return undefined;
  }

  return {
    id: normalizeId(source.id, `tool-attachment-network-${normalizeTimestamp(source.createdAt)}`),
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: true,
    truncated: typeof source.truncated === "boolean" ? source.truncated : false,
    requests,
  };
}

function normalizeJsSourceToolAttachment(source: Partial<ChatToolAttachment>): ChatJsSourceToolAttachment | undefined {
  const resources = "resources" in source && Array.isArray(source.resources)
    ? source.resources.map(normalizeJsSourceResource).filter((item): item is JsSourceResource => Boolean(item))
    : [];
  const jsMatches = "jsMatches" in source && Array.isArray(source.jsMatches)
    ? source.jsMatches.map(normalizeJsSourceMatch).filter((item): item is JsSourceMatch => Boolean(item))
    : [];
  const contexts = "contexts" in source && Array.isArray(source.contexts)
    ? source.contexts.map(normalizeJsSourceContext).filter((item): item is JsSourceContext => Boolean(item))
    : [];
  const failedFetches = "failedFetches" in source && Array.isArray(source.failedFetches)
    ? source.failedFetches.map(normalizeJsSourceFetchFailure).filter((item): item is JsSourceFetchFailure => Boolean(item))
    : [];
  if (
    !resources.length &&
    !jsMatches.length &&
    !contexts.length &&
    !failedFetches.length &&
    !normalizeOptionalString(source.title) &&
    !normalizeOptionalString(source.summary) &&
    !normalizeOptionalString(source.sourceToolCallId)
  ) {
    return undefined;
  }

  const attachment: ChatJsSourceToolAttachment = {
    id: normalizeId(source.id, `tool-attachment-js-source-${normalizeTimestamp(source.createdAt)}`),
    kind: "js-source",
    title: "JS 源码片段",
    summary: "",
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: true,
    truncated: source.truncated === true || resources.some((resource) => resource.truncated) || jsMatches.some((match) => match.truncated) || contexts.some((context) => context.truncated),
    query: "query" in source && Array.isArray(source.query) ? uniqueNonEmptyStrings(source.query.filter((item): item is string => typeof item === "string")) : undefined,
    resources,
    jsMatches,
    contexts,
    failedFetches,
  };
  return {
    ...attachment,
    summary: normalizeOptionalString(source.summary) ?? formatJsSourceAttachmentSummary(attachment),
  };
}

function normalizeGenericToolAttachment(source: Partial<ChatToolAttachment>, kind: string): ChatGenericToolAttachment | undefined {
  const title = normalizeOptionalString(source.title);
  const summary = normalizeOptionalString(source.summary);
  if (!title || !summary) {
    return undefined;
  }

  const truncatedDetails = "details" in source && typeof source.details === "string" ? truncateText(source.details, GENERIC_DETAIL_LIMIT) : undefined;
  return {
    id: normalizeId(source.id, `tool-attachment-${kind}-${normalizeTimestamp(source.createdAt)}`),
    kind,
    title,
    summary,
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: typeof source.redacted === "boolean" ? source.redacted : true,
    truncated: source.truncated === true || Boolean(truncatedDetails?.truncated),
    details: truncatedDetails?.text,
  };
}

function normalizeJsSourceResource(value: unknown): JsSourceResource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<JsSourceResource>;
  const id = normalizeOptionalString(source.id);
  const url = normalizeOptionalString(source.url);
  if (!id || !url || (source.source !== "network" && source.source !== "same-origin-fetch")) {
    return undefined;
  }
  return {
    id,
    source: source.source,
    url,
    mimeType: normalizeOptionalString(source.mimeType),
    size: typeof source.size === "number" && Number.isFinite(source.size) ? Math.max(0, Math.floor(source.size)) : 0,
    searchable: source.searchable !== false,
    fetchedAt: typeof source.fetchedAt === "number" && Number.isFinite(source.fetchedAt) ? source.fetchedAt : undefined,
    // redacted 表示历史数据重新进入统一脱敏/归一化管道，不代表该资源一定发生过替换。
    redacted: true,
    truncated: source.truncated === true,
  };
}

function normalizeJsSourceMatch(value: unknown): JsSourceMatch | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<JsSourceMatch>;
  const resourceId = normalizeOptionalString(source.resourceId);
  const url = normalizeOptionalString(source.url);
  const term = normalizeOptionalString(source.term);
  const snippet = normalizeOptionalString(source.snippet);
  if (!resourceId || !url || !term || !snippet || (source.source !== "network" && source.source !== "same-origin-fetch")) {
    return undefined;
  }
  return {
    resourceId,
    source: source.source,
    url,
    term,
    position: normalizeNonNegativeNumber(source.position),
    line: normalizePositiveNumber(source.line),
    column: normalizePositiveNumber(source.column),
    snippet,
    redacted: true,
    truncated: source.truncated === true,
  };
}

function normalizeJsSourceContext(value: unknown): JsSourceContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<JsSourceContext>;
  const resourceId = normalizeOptionalString(source.resourceId);
  const url = normalizeOptionalString(source.url);
  const snippet = normalizeOptionalString(source.snippet);
  if (!resourceId || !url || !snippet || (source.source !== "network" && source.source !== "same-origin-fetch")) {
    return undefined;
  }
  return {
    resourceId,
    source: source.source,
    url,
    position: normalizeNonNegativeNumber(source.position),
    line: normalizePositiveNumber(source.line),
    column: normalizePositiveNumber(source.column),
    snippet,
    redacted: true,
    truncated: source.truncated === true,
  };
}

function normalizeJsSourceFetchFailure(value: unknown): JsSourceFetchFailure | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<JsSourceFetchFailure>;
  const url = normalizeOptionalString(source.url);
  const message = normalizeOptionalString(source.message);
  return url && message ? { url, message } : undefined;
}

export function formatJsSourceAttachmentSummary(attachment: ChatJsSourceToolAttachment): string {
  return `JS 资源 ${attachment.resources.length} 个，命中 ${attachment.jsMatches.length} 个，上下文 ${attachment.contexts.length} 个，补位失败 ${attachment.failedFetches.length} 个。`;
}

function formatJsSourceAttachmentForText(attachment: ChatJsSourceToolAttachment): string {
  const sections: string[] = [];
  if (attachment.query?.length) {
    sections.push(`查询关键词：${attachment.query.join("、")}`);
  }
  if (attachment.resources.length) {
    sections.push(["资源：", ...attachment.resources.map((resource) => `- ${resource.id} | ${resource.source} | ${resource.url}`)].join("\n"));
  }
  if (attachment.jsMatches.length) {
    sections.push(["命中：", ...attachment.jsMatches.map((match) => `- ${match.resourceId}:${match.line}:${match.column} ${match.term}: ${match.snippet}`)].join("\n"));
  }
  if (attachment.contexts.length) {
    sections.push(["上下文：", ...attachment.contexts.map((context) => `- ${context.resourceId}:${context.line}:${context.column}\n${context.snippet}`)].join("\n"));
  }
  if (attachment.failedFetches.length) {
    sections.push(["同源补位失败：", ...attachment.failedFetches.map((failure) => `- ${failure.url}: ${failure.message}`)].join("\n"));
  }
  return sections.join("\n\n").trim();
}

function normalizeNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePositiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function normalizeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}
