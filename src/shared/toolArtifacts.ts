import type {
  AutomationPlaybookSelection,
  AutomationFailureSummary,
  AutomationReportType,
  AutomationReportStep,
  AutomationTimelineEvent,
  ChatAutomationReportToolAttachment,
  ChatBrowserScreenshotToolAttachment,
  ChatGenericToolAttachment,
  ChatJsSourceToolAttachment,
  ChatMessage,
  ChatNetworkContextAttachment,
  ChatNetworkToolAttachment,
  ChatSourceMapToolAttachment,
  ChatToolCallRecord,
  ChatToolAttachment,
  ChatWebSearchResult,
  ChatWebSearchPayload,
  ChatWebSearchToolAttachment,
  ToolAttachmentContextMode,
  JsSourceContext,
  JsSourceFetchFailure,
  JsSourceMatch,
  JsSourceResource,
  SourceMapCandidate,
  SourceMapOriginalContext,
  SourceMapResolvedLocation,
} from "./types";
import { formatNetworkAttachmentForExport, formatNetworkAttachmentSummary, redactNetworkRequestDetail, redactNetworkText } from "./networkContext";
import { isPngDataUrl } from "./tabCapture";
import { createTavilySearchContextPrompt, formatTavilySearchAttachmentSummary } from "./webSearch/tavily";
import { truncateText } from "./utils/text";

const TOOL_ATTACHMENT_KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const GENERIC_DETAIL_LIMIT = 4000;
const AUTOMATION_EVIDENCE_LIMIT = 500;
const AUTOMATION_CONCLUSION_LIMIT = 800;
const TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT = 50;
const TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT = 500;
const TOOL_ATTACHMENT_CONTEXT_URL_LIMIT = 240;
const SENSITIVE_INLINE_PATTERN = /\b(token|access_token|refresh_token|password|passwd|secret|api[_-]?key|authorization|session|cookie|csrf|jwt)\s*[:=]\s*([^\s,;&"'<>]+)/gi;
const BEARER_INLINE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export type ChatToolAttachmentsById = Record<string, ChatToolAttachment>;

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

export function createAutomationReportToolAttachment(input: {
  objective: string;
  conclusion: string;
  records: ChatToolCallRecord[];
  attachments?: ChatToolAttachment[];
  playbook?: AutomationPlaybookSelection;
  createdAt?: number;
}): ChatAutomationReportToolAttachment | undefined {
  const steps = input.records.map((record) => createAutomationReportStep(record, input.attachments ?? []));
  const timeline = createAutomationTimeline(input.records, steps);
  const createdAt = input.createdAt ?? Math.max(...input.records.map((record) => record.completedAt ?? record.startedAt), Date.now());
  const report = normalizeAutomationReportToolAttachment({
    id: `tool-attachment-automation-report-${createdAt}`,
    kind: "automation-report",
    title: "自动化任务报告",
    reportType: inferAutomationReportType(input.records),
    objective: input.objective,
    conclusion: input.conclusion,
    playbook: normalizeAutomationReportPlaybook(input.playbook),
    createdAt,
    redacted: true,
    truncated: false,
    steps,
    timeline,
    failureSummary: createAutomationFailureSummary(steps),
    fullAccessIncluded: input.records.some((record) => record.toolId.startsWith("full_access.")),
  } as Partial<ChatToolAttachment>);
  return report;
}

export function collectMessageToolAttachments(message: ChatMessage, toolAttachmentsById?: ChatToolAttachmentsById): ChatToolAttachment[] {
  return aggregateToolAttachments(collectRawMessageToolAttachments(message, toolAttachmentsById), message.toolCallRecords);
}

// 原始附件用于工具调用详情追溯；聚合附件用于消息展示、导出和后续追问，避免同一轮多次工具调用撑开附件区。
export function collectRawMessageToolAttachments(message: ChatMessage, toolAttachmentsById?: ChatToolAttachmentsById): ChatToolAttachment[] {
  const referencedAttachments = (message.toolAttachmentIds ?? [])
    .map((id) => toolAttachmentsById?.[id])
    .filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
  const attachments = uniqueToolAttachmentsById([...referencedAttachments, ...(message.toolAttachments ?? [])]);
  const legacyAttachments: ChatToolAttachment[] = [];
  if (message.networkContextAttachment) {
    legacyAttachments.push(createNetworkToolAttachment(message.networkContextAttachment));
  }
  return mergeCompatibleToolAttachments(attachments, legacyAttachments);
}

export function collectMessageToolAttachmentIds(message: ChatMessage, toolAttachmentsById?: ChatToolAttachmentsById): string[] {
  const ids = new Set<string>();
  for (const id of message.toolAttachmentIds ?? []) {
    if (typeof id === "string" && id.trim()) {
      ids.add(id.trim());
    }
  }
  for (const attachment of collectRawMessageToolAttachments(message, toolAttachmentsById)) {
    ids.add(attachment.id);
  }
  return [...ids];
}

export function mergeToolAttachmentsIntoStore(
  current: ChatToolAttachmentsById | undefined,
  attachments: ChatToolAttachment[] | undefined,
  options: { detailPoolKeepLimit?: number } = {},
): ChatToolAttachmentsById | undefined {
  const next: ChatToolAttachmentsById = { ...(current ?? {}) };
  for (const attachment of prepareToolAttachmentsForPersistence(attachments, options)) {
    next[attachment.id] = attachment;
  }
  return Object.keys(next).length ? next : undefined;
}

export function mergeToolAttachmentStores(
  current: ChatToolAttachmentsById | undefined,
  nextStore: ChatToolAttachmentsById | undefined,
  options: { detailPoolKeepLimit?: number } = {},
): ChatToolAttachmentsById | undefined {
  return mergeToolAttachmentsIntoStore(current, nextStore ? Object.values(nextStore) : undefined, options);
}

export function prepareToolAttachmentsForPersistence(
  attachments: ChatToolAttachment[] | undefined,
  options: { detailPoolKeepLimit?: number } = {},
): ChatToolAttachment[] {
  const keepLimit = normalizeToolDetailPoolKeepLimit(options.detailPoolKeepLimit, 500);
  return (attachments ?? [])
    .map((attachment) => applyToolAttachmentRetentionPolicy(attachment, keepLimit))
    .filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
}

export function normalizeToolDetailPoolKeepLimit(value: unknown, fallback = 500): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(0, Math.round(numberValue));
}

function applyToolAttachmentRetentionPolicy(attachment: ChatToolAttachment, keepLimit: number): ChatToolAttachment | undefined {
  if (isNetworkToolAttachment(attachment)) {
    return applyNetworkAttachmentRetentionPolicy(attachment, keepLimit);
  }

  if (isJsSourceToolAttachment(attachment)) {
    return applyJsSourceAttachmentRetentionPolicy(attachment, keepLimit);
  }

  if (isSourceMapToolAttachment(attachment)) {
    return applySourceMapAttachmentRetentionPolicy(attachment, keepLimit);
  }

  return attachment;
}

function applyNetworkAttachmentRetentionPolicy(
  attachment: ChatNetworkToolAttachment,
  keepLimit: number,
): ChatNetworkToolAttachment | undefined {
  const relevantRequests = attachment.requests.filter((request) => !isDiscardableNetworkNoise(request));
  if (relevantRequests.length === 0) {
    return undefined;
  }

  const requests = keepLimit > 0
    ? relevantRequests.slice(0, keepLimit)
    : relevantRequests.map(createNetworkRequestSummaryOnly);
  return {
    ...attachment,
    requests,
    retentionMode: keepLimit > 0 && requests.some(hasNetworkRequestDetailPayload) ? "detail_pool" : "summary",
    summary: formatNetworkAttachmentSummary(requests),
    truncated: attachment.truncated || relevantRequests.length > requests.length,
  };
}

function applyJsSourceAttachmentRetentionPolicy(
  attachment: ChatJsSourceToolAttachment,
  keepLimit: number,
): ChatJsSourceToolAttachment | undefined {
  const resources = attachment.resources.slice(0, keepLimit || TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT);
  const jsMatches = keepLimit > 0 ? attachment.jsMatches.slice(0, keepLimit) : [];
  const contexts = keepLimit > 0 ? attachment.contexts.slice(0, keepLimit) : [];
  if (!resources.length && !jsMatches.length && !contexts.length && !attachment.failedFetches.length) {
    return undefined;
  }

  const nextAttachment: ChatJsSourceToolAttachment = {
    ...attachment,
    resources,
    jsMatches,
    contexts,
    retentionMode: jsMatches.length || contexts.length ? "detail_pool" : "summary",
    truncated: attachment.truncated ||
      attachment.resources.length > resources.length ||
      attachment.jsMatches.length > jsMatches.length ||
      attachment.contexts.length > contexts.length,
  };
  return {
    ...nextAttachment,
    summary: formatJsSourceAttachmentSummary(nextAttachment),
  };
}

function applySourceMapAttachmentRetentionPolicy(
  attachment: ChatSourceMapToolAttachment,
  keepLimit: number,
): ChatSourceMapToolAttachment | undefined {
  const candidates = attachment.candidates.slice(0, keepLimit || TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT);
  const resolvedLocations = attachment.resolvedLocations.slice(0, keepLimit || TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT);
  const originalContexts = keepLimit > 0 ? attachment.originalContexts.slice(0, keepLimit) : [];
  if (!candidates.length && !resolvedLocations.length && !originalContexts.length && !attachment.failures.length) {
    return undefined;
  }

  const nextAttachment: ChatSourceMapToolAttachment = {
    ...attachment,
    candidates,
    resolvedLocations,
    originalContexts,
    retentionMode: originalContexts.length ? "detail_pool" : "summary",
    truncated: attachment.truncated ||
      attachment.candidates.length > candidates.length ||
      attachment.resolvedLocations.length > resolvedLocations.length ||
      attachment.originalContexts.length > originalContexts.length,
  };
  return {
    ...nextAttachment,
    summary: formatSourceMapAttachmentSummary(nextAttachment),
  };
}

function createNetworkRequestSummaryOnly(request: ChatNetworkToolAttachment["requests"][number]): ChatNetworkToolAttachment["requests"][number] {
  return {
    id: request.id,
    url: request.url,
    method: request.method,
    status: request.status,
    statusText: request.statusText,
    mimeType: request.mimeType,
    resourceType: request.resourceType,
    startedAt: request.startedAt,
    durationMs: request.durationMs,
    failed: request.failed,
    error: request.error,
    truncated: request.truncated,
    redacted: true,
  };
}

function hasNetworkRequestDetailPayload(request: ChatNetworkToolAttachment["requests"][number]): boolean {
  return Boolean(
    request.requestHeaders?.length ||
    request.responseHeaders?.length ||
    request.requestBody?.trim() ||
    request.responseBody?.trim(),
  );
}

function isDiscardableNetworkNoise(request: ChatNetworkToolAttachment["requests"][number]): boolean {
  const resourceType = (request.resourceType ?? "").toLowerCase();
  const mimeType = (request.mimeType ?? "").toLowerCase();
  const url = request.url.toLowerCase();
  const staticResource = (
    ["image", "font", "media", "stylesheet"].includes(resourceType) ||
    /^(image|font|audio|video)\//.test(mimeType) ||
    /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|css)(?:[?#]|$)/i.test(url)
  );
  const noisyEndpoint = /(doubleclick|googletagmanager|google-analytics|analytics|collect|beacon|sentry|adsystem|adservice|tracking|track|umeng|cnzz)/i.test(url);
  return Boolean(staticResource || noisyEndpoint);
}

export function uniqueToolAttachmentIds(ids: readonly string[] | undefined): string[] | undefined {
  const unique = uniqueNonEmptyStrings((ids ?? []).filter((item): item is string => typeof item === "string"));
  return unique.length ? unique : undefined;
}

export function moveMessageToolAttachmentsToRefs(message: ChatMessage): ChatMessage {
  const legacyAttachments = message.networkContextAttachment ? [createNetworkToolAttachment(message.networkContextAttachment)] : [];
  const attachmentIds = uniqueToolAttachmentIds([
    ...(message.toolAttachmentIds ?? []),
    ...(message.toolAttachments ?? []).map((attachment) => attachment.id),
    ...legacyAttachments.map((attachment) => attachment.id),
  ]);
  const {
    toolAttachments: _toolAttachments,
    networkContextAttachment: _networkContextAttachment,
    ...messageWithoutInlineToolAttachments
  } = message;
  return {
    ...messageWithoutInlineToolAttachments,
    toolAttachmentIds: attachmentIds,
  };
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
    const requests = shouldPreserveNetworkAttachmentRaw(attachment) ? attachment.requests : attachment.requests.map(redactNetworkRequestDetail);
    return ["后续追问需要继续参考以下历史 Network 请求详情：", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史 JS 源码片段：", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史 Source Map 解析结果：", formatSourceMapAttachmentForText(attachment)].join("\n");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [
      "后续追问可参考一张历史浏览器截图附件，但正文只保留元数据，不注入图片 base64：",
      formatBrowserScreenshotAttachmentSummary(attachment),
    ].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下自动化任务报告：", formatAutomationReportAttachmentForText(attachment)].join("\n");
  }

  if (attachment.details?.trim()) {
    return [`后续追问需要继续参考以下历史工具附件：${attachment.title}`, attachment.details.trim()].join("\n");
  }

  return attachment.summary.trim() ? [`后续追问需要继续参考以下历史工具附件：${attachment.title}`, attachment.summary.trim()].join("\n") : undefined;
}

export function formatToolAttachmentForPromptSummary(
  attachment: ChatToolAttachment,
  mode: ToolAttachmentContextMode = "summary",
): string | undefined {
  if (mode === "none") {
    return undefined;
  }

  if (isWebSearchToolAttachment(attachment)) {
    return [
      "后续追问可参考以下历史网络搜索摘要：",
      formatWebSearchAttachmentForPromptSummary(attachment),
    ].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    return [
      "后续追问可参考以下历史 Network 请求摘要；完整 body/header 仅保存在附件弹窗，不默认注入模型上下文：",
      formatNetworkAttachmentForPromptSummary(attachment),
    ].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return [
      "后续追问可参考以下历史 JS 资源摘要；完整源码仅保存在附件弹窗，不默认注入模型上下文：",
      formatJsSourceAttachmentForPromptSummary(attachment),
    ].join("\n");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return [
      "后续追问可参考以下历史 Source Map 摘要；完整原始片段仅保存在附件弹窗，不默认注入模型上下文：",
      formatSourceMapAttachmentForPromptSummary(attachment),
    ].join("\n");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [
      "后续追问可参考一张历史浏览器截图附件；正文只保留元数据，不注入图片 base64：",
      formatBrowserScreenshotAttachmentSummary(attachment),
    ].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["后续追问可参考以下自动化任务报告摘要：", formatAutomationReportSummary(attachment)].join("\n");
  }

  const summary = attachment.summary.trim();
  return summary ? [`后续追问可参考以下历史工具附件摘要：${attachment.title}`, summary].join("\n") : undefined;
}

export function formatToolAttachmentForExport(attachment: ChatToolAttachment): string {
  if (isWebSearchToolAttachment(attachment)) {
    return ["# 网络搜索结果附件", "", formatTavilySearchAttachmentSummary(attachment), "", createTavilySearchContextPrompt(attachment)].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = shouldPreserveNetworkAttachmentRaw(attachment) ? attachment.requests : attachment.requests.map(redactNetworkRequestDetail);
    return ["# Network 请求详情附件", "", formatNetworkAttachmentSummary(requests), "", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["# JS 源码片段附件", "", formatJsSourceAttachmentSummary(attachment), "", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return ["# Source Map 解析附件", "", formatSourceMapAttachmentSummary(attachment), "", formatSourceMapAttachmentForText(attachment)].join("\n");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return ["# 浏览器截图附件", "", formatBrowserScreenshotAttachmentSummary(attachment)].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["# 自动化任务报告附件", "", formatAutomationReportAttachmentForText(attachment)].join("\n");
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

  if (kind === "source-map") {
    return normalizeSourceMapToolAttachment(source);
  }

  if (kind === "browser-screenshot") {
    return normalizeBrowserScreenshotToolAttachment(source);
  }

  if (kind === "automation-report") {
    return normalizeAutomationReportToolAttachment(source);
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

export function isSourceMapToolAttachment(attachment: ChatToolAttachment): attachment is ChatSourceMapToolAttachment {
  return attachment.kind === "source-map" && "candidates" in attachment && "resolvedLocations" in attachment && "originalContexts" in attachment;
}

export function isBrowserScreenshotToolAttachment(attachment: ChatToolAttachment): attachment is ChatBrowserScreenshotToolAttachment {
  return attachment.kind === "browser-screenshot" && "dataUrl" in attachment && "mediaType" in attachment && "target" in attachment;
}

export function isAutomationReportToolAttachment(attachment: ChatToolAttachment): attachment is ChatAutomationReportToolAttachment {
  return attachment.kind === "automation-report" && "steps" in attachment && Array.isArray(attachment.steps);
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

  if (isSourceMapToolAttachment(attachment)) {
    return [
      attachment.kind,
      ...attachment.candidates.map((candidate) => [candidate.resourceId, candidate.source, normalizeComparableText(candidate.url ?? ""), candidate.status].join("\u0001")),
      ...attachment.resolvedLocations.map((location) => [location.resourceId, String(location.generatedLine), String(location.generatedColumn), normalizeComparableText(location.source ?? "")].join("\u0001")),
      ...attachment.originalContexts.map((context) => [context.resourceId, String(context.generatedLine), String(context.generatedColumn), normalizeComparableText(context.source ?? "")].join("\u0001")),
    ].join("\u0000");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [attachment.kind, attachment.target, attachment.uid ?? "", attachment.dataUrl].join("\u0000");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return [
      attachment.kind,
      normalizeComparableText(attachment.objective),
      ...attachment.steps.map((step) => [step.toolCallId, step.toolName, step.status, normalizeComparableText(step.evidence)].join("\u0001")),
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

  if (kind === "source-map") {
    return aggregateSourceMapToolAttachments(attachments.filter(isSourceMapToolAttachment));
  }

  if (kind === "browser-screenshot") {
    return attachments[0];
  }

  if (kind === "automation-report") {
    return aggregateAutomationReportToolAttachments(attachments.filter(isAutomationReportToolAttachment));
  }

  if (attachments.length === 1) {
    return attachments[0];
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

  const preserveRaw = attachments.every(shouldPreserveNetworkAttachmentRaw);
  const requests = uniqueBy(
    attachments.flatMap((attachment) => shouldPreserveNetworkAttachmentRaw(attachment)
      ? attachment.requests
      : attachment.requests.map(redactNetworkRequestDetail)),
    (request) => request.id.trim() || `${request.method}\u0000${request.url}\u0000${request.status ?? ""}`,
  );
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  return {
    id: `tool-attachment-network-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    createdAt,
    redacted: !preserveRaw,
    fullAccess: preserveRaw || undefined,
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

function aggregateSourceMapToolAttachments(attachments: ChatSourceMapToolAttachment[]): ChatSourceMapToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const candidates = uniqueBy(attachments.flatMap((attachment) => attachment.candidates), (candidate) =>
    `${candidate.resourceId}\u0000${candidate.source}\u0000${candidate.url ?? ""}\u0000${candidate.status}`,
  );
  const resolvedLocations = uniqueBy(attachments.flatMap((attachment) => attachment.resolvedLocations), (location) =>
    `${location.resourceId}\u0000${location.generatedLine}\u0000${location.generatedColumn}\u0000${location.source ?? ""}`,
  );
  const originalContexts = uniqueBy(attachments.flatMap((attachment) => attachment.originalContexts), (context) =>
    `${context.resourceId}\u0000${context.generatedLine}\u0000${context.generatedColumn}\u0000${context.source ?? ""}`,
  );
  const failures = uniqueBy(attachments.flatMap((attachment) => attachment.failures), (failure) =>
    `${failure.resourceId ?? ""}\u0000${failure.url ?? ""}\u0000${failure.message}`,
  );
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatSourceMapToolAttachment = {
    id: `tool-attachment-source-map-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "source-map",
    title: "Source Map 解析结果",
    summary: "",
    createdAt,
    redacted: true,
    truncated: attachments.some((attachment) => attachment.truncated),
    candidates,
    resolvedLocations,
    originalContexts,
    failures,
  };
  return {
    ...aggregated,
    summary: formatSourceMapAttachmentSummary(aggregated),
  };
}

function aggregateAutomationReportToolAttachments(attachments: ChatAutomationReportToolAttachment[]): ChatAutomationReportToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const steps = uniqueBy(attachments.flatMap((attachment) => attachment.steps), (step) => step.toolCallId || `${step.toolName}\u0000${step.startedAt}`);
  const timeline = uniqueBy(attachments.flatMap((attachment) => attachment.timeline), (event) => event.id || `${event.type}\u0000${event.at}\u0000${event.label}`);
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const fullAccessIncluded = attachments.some((attachment) => attachment.fullAccessIncluded);
  const playbook = attachments.map((attachment) => attachment.playbook).find((item): item is AutomationPlaybookSelection => Boolean(item));
  const report: ChatAutomationReportToolAttachment = {
    id: `tool-attachment-automation-report-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "automation-report",
    title: "自动化任务报告",
    summary: "",
    createdAt,
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated),
    objective: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.objective)).join("；") || "未记录任务目标",
    conclusion: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.conclusion)).join("\n") || "暂无结论",
    playbook,
    reportType: aggregateAutomationReportType(attachments),
    steps,
    timeline: timeline.sort((a, b) => a.at - b.at),
    failureSummary: createAutomationFailureSummary(steps),
    fullAccessIncluded,
  };
  return {
    ...report,
    summary: formatAutomationReportSummary(report),
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

  const preserveRaw = isFullAccessNetworkAttachmentSource(source);
  const requests = source.requests
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const request = item as ChatNetworkToolAttachment["requests"][number];
      return preserveRaw ? { ...request, redacted: false } : redactNetworkRequestDetail(request);
    })
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
    redacted: !preserveRaw,
    fullAccess: preserveRaw || undefined,
    truncated: typeof source.truncated === "boolean" ? source.truncated : false,
    requests,
  };
}

function shouldPreserveNetworkAttachmentRaw(attachment: ChatNetworkToolAttachment): boolean {
  return attachment.fullAccess === true && attachment.redacted === false;
}

function isFullAccessNetworkAttachmentSource(source: Partial<ChatToolAttachment>): source is Partial<ChatNetworkToolAttachment> {
  return "fullAccess" in source && source.fullAccess === true && source.redacted === false;
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

function normalizeSourceMapToolAttachment(source: Partial<ChatToolAttachment>): ChatSourceMapToolAttachment | undefined {
  const candidates = "candidates" in source && Array.isArray(source.candidates)
    ? source.candidates.map(normalizeSourceMapCandidate).filter((item): item is SourceMapCandidate => Boolean(item))
    : [];
  const resolvedLocations = "resolvedLocations" in source && Array.isArray(source.resolvedLocations)
    ? source.resolvedLocations.map(normalizeSourceMapResolvedLocation).filter((item): item is SourceMapResolvedLocation => Boolean(item))
    : [];
  const originalContexts = "originalContexts" in source && Array.isArray(source.originalContexts)
    ? source.originalContexts.map(normalizeSourceMapOriginalContext).filter((item): item is SourceMapOriginalContext => Boolean(item))
    : [];
  const failures = "failures" in source && Array.isArray(source.failures)
    ? source.failures.map(normalizeSourceMapFailure).filter((item): item is ChatSourceMapToolAttachment["failures"][number] => Boolean(item))
    : [];
  if (
    !candidates.length &&
    !resolvedLocations.length &&
    !originalContexts.length &&
    !failures.length &&
    !normalizeOptionalString(source.title) &&
    !normalizeOptionalString(source.summary) &&
    !normalizeOptionalString(source.sourceToolCallId)
  ) {
    return undefined;
  }

  const attachment: ChatSourceMapToolAttachment = {
    id: normalizeId(source.id, `tool-attachment-source-map-${normalizeTimestamp(source.createdAt)}`),
    kind: "source-map",
    title: "Source Map 解析结果",
    summary: "",
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: true,
    truncated: source.truncated === true || originalContexts.some((context) => context.truncated),
    candidates,
    resolvedLocations,
    originalContexts,
    failures,
  };
  return {
    ...attachment,
    summary: normalizeOptionalString(source.summary) ?? formatSourceMapAttachmentSummary(attachment),
  };
}

function normalizeBrowserScreenshotToolAttachment(source: Partial<ChatToolAttachment>): ChatBrowserScreenshotToolAttachment | undefined {
  const raw = source as Record<string, unknown>;
  const dataUrl = isPngDataUrl(raw.dataUrl) ? raw.dataUrl : undefined;
  const target = raw.target === "element" ? "element" : raw.target === "viewport" ? "viewport" : undefined;
  const byteSize = typeof raw.byteSize === "number" && Number.isFinite(raw.byteSize) && raw.byteSize > 0
    ? Math.floor(raw.byteSize)
    : estimatePngDataUrlBytes(dataUrl);
  if (!dataUrl || !target || byteSize <= 0) {
    return undefined;
  }

  const attachment: ChatBrowserScreenshotToolAttachment = {
    id: normalizeId(source.id, `tool-attachment-browser-screenshot-${normalizeTimestamp(source.createdAt)}`),
    kind: "browser-screenshot",
    title: normalizeOptionalString(source.title) ?? "浏览器截图",
    summary: "",
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: false,
    truncated: source.truncated === true,
    mediaType: "image/png",
    dataUrl,
    target,
    uid: normalizeOptionalString(raw.uid),
    byteSize,
    clip: normalizeScreenshotClip(raw.clip),
  };

  return {
    ...attachment,
    summary: normalizeOptionalString(source.summary) ?? formatBrowserScreenshotAttachmentSummary(attachment),
  };
}

function normalizeAutomationReportToolAttachment(source: Partial<ChatToolAttachment>): ChatAutomationReportToolAttachment | undefined {
  const raw = source as Partial<ChatAutomationReportToolAttachment>;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map(normalizeAutomationReportStep).filter((item): item is AutomationReportStep => Boolean(item))
    : [];
  if (steps.length === 0) {
    return undefined;
  }

  const attachment: ChatAutomationReportToolAttachment = {
    id: normalizeId(source.id, `tool-attachment-automation-report-${normalizeTimestamp(source.createdAt)}`),
    kind: "automation-report",
    title: "自动化任务报告",
    summary: "",
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: true,
    truncated: source.truncated === true || steps.some((step) => step.evidence.length >= 500),
    reportType: normalizeAutomationReportType(raw.reportType, steps),
    objective: redactAndTruncateAutomationText(raw.objective, 500) || "未记录任务目标",
    conclusion: redactAndTruncateAutomationText(raw.conclusion, 800) || "暂无结论",
    playbook: normalizeAutomationReportPlaybook(raw.playbook),
    steps,
    timeline: normalizeAutomationTimeline(raw.timeline, steps),
    failureSummary: normalizeAutomationFailureSummary(raw.failureSummary, steps),
    fullAccessIncluded: raw.fullAccessIncluded === true,
  };
  return {
    ...attachment,
    summary: formatAutomationReportSummary(attachment),
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

function estimatePngDataUrlBytes(dataUrl: string | undefined): number {
  if (!dataUrl || !isPngDataUrl(dataUrl)) {
    return 0;
  }
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function normalizeScreenshotClip(value: unknown): ChatBrowserScreenshotToolAttachment["clip"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<NonNullable<ChatBrowserScreenshotToolAttachment["clip"]>>;
  const clip = {
    x: normalizeFiniteNumber(source.x),
    y: normalizeFiniteNumber(source.y),
    width: normalizeFiniteNumber(source.width),
    height: normalizeFiniteNumber(source.height),
    scale: normalizeFiniteNumber(source.scale),
  };
  if (clip.x === undefined || clip.y === undefined || clip.width === undefined || clip.height === undefined || clip.scale === undefined || clip.width <= 0 || clip.height <= 0) {
    return undefined;
  }
  return clip as NonNullable<ChatBrowserScreenshotToolAttachment["clip"]>;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatBrowserScreenshotAttachmentSummary(attachment: ChatBrowserScreenshotToolAttachment): string {
  const target = attachment.target === "element" && attachment.uid ? `元素 ${attachment.uid}` : "当前视口";
  const clip = attachment.clip ? `，区域 x=${attachment.clip.x} y=${attachment.clip.y} width=${attachment.clip.width} height=${attachment.clip.height}` : "";
  return `${target}截图，PNG，${formatAttachmentByteSize(attachment.byteSize)}${clip}。`;
}

function formatAttachmentByteSize(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${Math.round(kb * 10) / 10} KB`;
  }
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
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

export function formatSourceMapAttachmentSummary(attachment: ChatSourceMapToolAttachment): string {
  return `Source Map 候选 ${attachment.candidates.length} 个，映射 ${attachment.resolvedLocations.length} 个，原始片段 ${attachment.originalContexts.length} 个，失败 ${attachment.failures.length} 个。`;
}

export function formatAutomationReportSummary(attachment: ChatAutomationReportToolAttachment): string {
  const successCount = attachment.steps.filter((step) => step.status === "success").length;
  const errorCount = attachment.steps.filter((step) => step.status === "error").length;
  const fullAccess = attachment.fullAccessIncluded ? "，包含完全访问原文结果" : "";
  const playbook = attachment.playbook ? `，策略=${attachment.playbook.title}` : "";
  return `任务报告：总步骤=${attachment.steps.length}，成功=${successCount}，失败=${errorCount}${playbook}${fullAccess}。`;
}

export function formatAutomationReportTypeLabel(type: AutomationReportType): string {
  if (type === "page_inspection") {
    return "页面巡检";
  }
  if (type === "form_diagnosis") {
    return "表单诊断";
  }
  if (type === "interface_analysis") {
    return "接口分析";
  }
  return "通用自动化";
}

function formatWebSearchAttachmentForPromptSummary(attachment: ChatWebSearchToolAttachment): string {
  const lines = [
    `查询：${attachment.query}`,
    `摘要：${attachment.answer || attachment.summary}`,
    ...attachment.results.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((result, index) =>
      `${index + 1}. ${truncateText(result.title, 120).text} | ${truncateText(result.url, TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}\n${truncateText(result.content, TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT).text}`,
    ),
  ];
  if (attachment.results.length > TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT) {
    lines.push(`已省略 ${attachment.results.length - TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT} 条搜索结果。`);
  }
  return lines.filter((line) => line.trim()).join("\n");
}

function formatNetworkAttachmentForPromptSummary(attachment: ChatNetworkToolAttachment): string {
  const sections = [attachment.summary.trim()];
  for (const request of attachment.requests.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT)) {
    sections.push(formatNetworkRequestForPromptSummary(request));
  }
  if (attachment.requests.length > TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT) {
    sections.push(`已省略 ${attachment.requests.length - TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT} 条请求。`);
  }
  if (attachment.truncated || attachment.redacted) {
    sections.push(`附件状态：${attachment.redacted ? '已脱敏' : '未脱敏'}，${attachment.truncated ? '已截断' : '未截断'}。`);
  }
  return sections.filter((item) => item.trim()).join("\n");
}

function formatNetworkRequestForPromptSummary(request: ChatNetworkToolAttachment["requests"][number]): string {
  const flags = [
    request.failed ? 'failed' : undefined,
    request.redacted ? 'redacted' : undefined,
    request.truncated ? 'truncated' : undefined,
  ].filter(Boolean).join(',');
  const lines = [
    `- ${request.id || 'unknown'}`,
    `${request.method || 'GET'} ${request.status ?? '-'} ${request.statusText ?? ''}`.trim(),
    request.resourceType || request.mimeType || 'unknown',
    truncateText(request.url, TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text,
    flags ? `标记=${flags}` : '',
    formatNetworkRequestFieldSummary(request),
    request.error ? `错误=${truncateText(request.error, TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT).text}` : '',
  ].filter(Boolean);
  return lines.join(' | ');
}

function formatNetworkRequestFieldSummary(request: ChatNetworkToolAttachment["requests"][number]): string {
  const fieldGroups = [
    formatNamedFields('query', collectUrlParamNames(request.url)),
    formatNamedFields('requestHeaders', (request.requestHeaders ?? []).map((header) => header.name)),
    formatNamedFields('responseHeaders', (request.responseHeaders ?? []).map((header) => header.name)),
    formatNamedFields('requestBody', collectPayloadFieldPaths(request.requestBody)),
    formatNamedFields('responseBody', collectPayloadFieldPaths(request.responseBody)),
  ].filter(Boolean);

  return fieldGroups.length ? `fields=${fieldGroups.join('; ')}` : '';
}

function formatNamedFields(label: string, fields: string[]): string {
  const uniqueFields = uniqueNonEmptyStrings(fields).slice(0, 30);
  return uniqueFields.length ? `${label}[${uniqueFields.join(', ')}]` : '';
}

function collectUrlParamNames(urlText: string): string[] {
  try {
    return Array.from(new URL(urlText).searchParams.keys());
  } catch {
    const queryStart = urlText.indexOf('?');
    if (queryStart < 0) {
      return [];
    }
    const queryEnd = urlText.indexOf('#', queryStart);
    const query = urlText.slice(queryStart + 1, queryEnd >= 0 ? queryEnd : undefined);
    return Array.from(new URLSearchParams(query).keys());
  }
}

function collectPayloadFieldPaths(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    return collectJsonFieldPaths(JSON.parse(value));
  } catch {
    if (!value.includes("=") && !value.includes("&")) {
      return [`text:${value.length}chars`];
    }

    try {
      const keys = Array.from(new URLSearchParams(value).keys());
      return keys.length ? keys : [`text:${value.length}chars`];
    } catch {
      return [`text:${value.length}chars`];
    }
  }
}

function collectJsonFieldPaths(value: unknown, prefix = '', output: string[] = []): string[] {
  if (output.length >= 80) {
    return output;
  }
  if (Array.isArray(value)) {
    if (!prefix) {
      output.push('[]');
    }
    if (value.length > 0) {
      collectJsonFieldPaths(value[0], `${prefix}[]`, output);
    }
    return output;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      output.push(path);
      collectJsonFieldPaths((value as Record<string, unknown>)[key], path, output);
      if (output.length >= 80) {
        break;
      }
    }
  }
  return output;
}
function formatJsSourceAttachmentForPromptSummary(attachment: ChatJsSourceToolAttachment): string {
  const sections: string[] = [formatJsSourceAttachmentSummary(attachment)];
  if (attachment.query?.length) {
    sections.push(`查询关键词：${attachment.query.join("、")}`);
  }
  if (attachment.resources.length) {
    sections.push([
      "资源：",
      ...attachment.resources.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((resource) =>
        `- ${resource.id} | ${resource.source} | ${formatAttachmentByteSize(resource.size)} | ${resource.mimeType ?? "-"} | ${truncateText(resource.url, TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}${resource.truncated ? " | truncated" : ""}`,
      ),
      ...(attachment.resources.length > TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT ? [`已省略 ${attachment.resources.length - TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT} 个资源。`] : []),
    ].join("\n"));
  }
  if (attachment.jsMatches.length) {
    sections.push([
      "命中：",
      ...attachment.jsMatches.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((match) =>
        `- ${match.resourceId}:${match.line}:${match.column} ${match.term}: ${truncateText(match.snippet, TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT).text}`,
      ),
      ...(attachment.jsMatches.length > TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT ? [`已省略 ${attachment.jsMatches.length - TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT} 个命中。`] : []),
    ].join("\n"));
  }
  if (attachment.contexts.length) {
    sections.push([
      "上下文片段：",
      ...attachment.contexts.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((context) =>
        `- ${context.resourceId}:${context.line}:${context.column}\n${truncateText(context.snippet, TOOL_ATTACHMENT_CONTEXT_TEXT_LIMIT).text}`,
      ),
      ...(attachment.contexts.length > TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT ? [`已省略 ${attachment.contexts.length - TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT} 个上下文片段。`] : []),
    ].join("\n"));
  }
  if (attachment.failedFetches.length) {
    sections.push([
      "同源补位失败：",
      ...attachment.failedFetches.slice(0, 20).map((failure) => `- ${truncateText(failure.url, TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}: ${failure.message}`),
    ].join("\n"));
  }
  return sections.filter((section) => section.trim()).join("\n\n");
}

function formatSourceMapAttachmentForPromptSummary(attachment: ChatSourceMapToolAttachment): string {
  const sections: string[] = [formatSourceMapAttachmentSummary(attachment)];
  if (attachment.candidates.length) {
    sections.push([
      "候选：",
      ...attachment.candidates.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((candidate) =>
        `- ${candidate.resourceId} | ${candidate.source} | ${candidate.status} | ${candidate.inline ? "inline" : truncateText(candidate.url ?? "", TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text || "无 URL"}`,
      ),
    ].join("\n"));
  }
  if (attachment.resolvedLocations.length) {
    sections.push([
      "映射：",
      ...attachment.resolvedLocations.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((location) =>
        `- ${location.resourceId}:${location.generatedLine}:${location.generatedColumn} -> ${truncateText(location.source ?? "未映射", TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}:${location.originalLine ?? "-"}:${location.originalColumn ?? "-"}`,
      ),
    ].join("\n"));
  }
  if (attachment.originalContexts.length) {
    sections.push([
      "原始片段位置：",
      ...attachment.originalContexts.slice(0, TOOL_ATTACHMENT_CONTEXT_ITEM_LIMIT).map((context) =>
        `- ${context.resourceId}:${context.generatedLine}:${context.generatedColumn} -> ${truncateText(context.source ?? "未映射", TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}:${context.originalLine ?? "-"}:${context.originalColumn ?? "-"}${context.truncated ? " | truncated" : ""}`,
      ),
    ].join("\n"));
  }
  if (attachment.failures.length) {
    sections.push([
      "失败：",
      ...attachment.failures.slice(0, 20).map((failure) => `- ${failure.resourceId ?? truncateText(failure.url ?? "unknown", TOOL_ATTACHMENT_CONTEXT_URL_LIMIT).text}: ${failure.message}`),
    ].join("\n"));
  }
  return sections.filter((section) => section.trim()).join("\n\n");
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

function formatAutomationReportAttachmentForText(attachment: ChatAutomationReportToolAttachment): string {
  const lines = [
    `目标：${attachment.objective}`,
    `结论：${attachment.conclusion}`,
    ...(attachment.playbook
      ? [
          `本次使用策略：${attachment.playbook.title}`,
          `策略来源：${attachment.playbook.source}`,
          `选择置信度：${attachment.playbook.confidence}`,
          `选择理由：${attachment.playbook.reason}`,
        ]
      : []),
    `任务类型：${formatAutomationReportTypeLabel(attachment.reportType)}`,
    `摘要：${formatAutomationReportSummary(attachment)}`,
    `完全访问原文结果：${attachment.fullAccessIncluded ? "是" : "否"}`,
    "时间线：",
    ...attachment.timeline.map((event, index) => `${index + 1}. [${event.type}] ${event.label} - ${event.detail}`),
    "步骤：",
    ...attachment.steps.map((step, index) =>
      `${index + 1}. [${step.status}] ${step.displayName} (${step.toolName}) - ${step.evidence}${step.attachmentKinds.length ? `；附件=${step.attachmentKinds.join("、")}` : ""}`,
    ),
  ];
  if (attachment.failureSummary && attachment.failureSummary.failedStepCount > 0) {
    lines.push(
      "失败摘要：",
      `失败步骤数：${attachment.failureSummary.failedStepCount}`,
      `失败工具：${attachment.failureSummary.failedTools.join("、") || "无"}`,
      `可恢复动作：${attachment.failureSummary.recoverableActions.join("；") || "无"}`,
    );
  }
  return lines.join("\n");
}

function formatSourceMapAttachmentForText(attachment: ChatSourceMapToolAttachment): string {
  const sections: string[] = [];
  if (attachment.candidates.length) {
    sections.push(["候选：", ...attachment.candidates.map((candidate) =>
      `- ${candidate.resourceId} | ${candidate.source} | ${candidate.status} | ${formatSourceMapCandidateLocation(candidate)}${candidate.message ? ` | ${candidate.message}` : ""}`,
    )].join("\n"));
  }
  if (attachment.resolvedLocations.length) {
    sections.push(["映射：", ...attachment.resolvedLocations.map((location) =>
      `- ${location.resourceId}:${location.generatedLine}:${location.generatedColumn} -> ${location.source ?? "未映射"}:${location.originalLine ?? "-"}:${location.originalColumn ?? "-"}${location.message ? ` | ${location.message}` : ""}`,
    )].join("\n"));
  }
  if (attachment.originalContexts.length) {
    sections.push(["原始源码片段：", ...attachment.originalContexts.map((context) =>
      `- ${context.resourceId}:${context.generatedLine}:${context.generatedColumn} -> ${context.source ?? "未映射"}:${context.originalLine ?? "-"}:${context.originalColumn ?? "-"}\n${context.snippet ?? context.message ?? ""}`,
    )].join("\n"));
  }
  if (attachment.failures.length) {
    sections.push(["失败：", ...attachment.failures.map((failure) => `- ${failure.resourceId ?? failure.url ?? "unknown"}: ${failure.message}`)].join("\n"));
  }
  return sections.join("\n\n").trim();
}

function formatSourceMapCandidateLocation(candidate: SourceMapCandidate): string {
  if (candidate.inline) {
    return "inline";
  }
  return candidate.url ? "外部 Source Map" : "无 URL";
}

function normalizeSourceMapCandidate(value: unknown): SourceMapCandidate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<SourceMapCandidate>;
  const resourceId = normalizeOptionalString(source.resourceId);
  const resourceUrl = normalizeOptionalString(source.resourceUrl);
  if (!resourceId || !resourceUrl || !isSourceMapCandidateSource(source.source) || !isSourceMapCandidateStatus(source.status)) {
    return undefined;
  }
  return {
    resourceId,
    resourceUrl,
    source: source.source,
    url: normalizeOptionalString(source.url),
    inline: source.inline === true,
    status: source.status,
    parsed: source.parsed === true,
    message: normalizeOptionalString(source.message),
  };
}

function normalizeSourceMapResolvedLocation(value: unknown): SourceMapResolvedLocation | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<SourceMapResolvedLocation>;
  const resourceId = normalizeOptionalString(source.resourceId);
  const resourceUrl = normalizeOptionalString(source.resourceUrl);
  if (!resourceId || !resourceUrl) {
    return undefined;
  }
  return {
    resourceId,
    resourceUrl,
    generatedLine: normalizePositiveNumber(source.generatedLine),
    generatedColumn: normalizePositiveNumber(source.generatedColumn),
    source: normalizeOptionalString(source.source),
    originalLine: source.originalLine === undefined ? undefined : normalizePositiveNumber(source.originalLine),
    originalColumn: source.originalColumn === undefined ? undefined : normalizePositiveNumber(source.originalColumn),
    name: normalizeOptionalString(source.name),
    ignored: source.ignored === true,
    hasSourceContent: source.hasSourceContent === true,
    message: normalizeOptionalString(source.message),
  };
}

function normalizeSourceMapOriginalContext(value: unknown): SourceMapOriginalContext | undefined {
  const location = normalizeSourceMapResolvedLocation(value);
  if (!location || !value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<SourceMapOriginalContext>;
  return {
    ...location,
    snippet: normalizeOptionalString(source.snippet),
    redacted: true,
    truncated: source.truncated === true,
  };
}

function normalizeSourceMapFailure(value: unknown): ChatSourceMapToolAttachment["failures"][number] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as { resourceId?: unknown; url?: unknown; message?: unknown };
  const message = normalizeOptionalString(source.message);
  if (!message) {
    return undefined;
  }
  return {
    resourceId: normalizeOptionalString(source.resourceId),
    url: normalizeOptionalString(source.url),
    message,
  };
}

function normalizeAutomationReportStep(value: unknown): AutomationReportStep | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<AutomationReportStep>;
  const toolCallId = normalizeOptionalString(source.toolCallId);
  const toolName = normalizeOptionalString(source.toolName);
  const displayName = normalizeOptionalString(source.displayName) ?? toolName;
  if (!toolCallId || !toolName || !displayName || !isToolCallStatus(source.status)) {
    return undefined;
  }
  return {
    toolCallId,
    toolName,
    displayName,
    status: source.status,
    startedAt: normalizeTimestamp(source.startedAt),
    completedAt: typeof source.completedAt === "number" && Number.isFinite(source.completedAt) ? source.completedAt : undefined,
    evidence: redactAndTruncateAutomationText(source.evidence, 500) || "无工具结果摘要",
    attachmentKinds: Array.isArray(source.attachmentKinds) ? uniqueNonEmptyStrings(source.attachmentKinds.filter((item): item is string => typeof item === "string")).slice(0, 20) : [],
  };
}

function normalizeAutomationTimeline(value: unknown, steps: AutomationReportStep[]): AutomationTimelineEvent[] {
  const timeline = Array.isArray(value)
    ? value.map(normalizeAutomationTimelineEvent).filter((item): item is AutomationTimelineEvent => Boolean(item))
    : [];
  if (timeline.length > 0) {
    return uniqueBy(timeline, (event) => event.id).sort((a, b) => a.at - b.at).slice(0, 100);
  }
  return createAutomationTimelineFromSteps(steps);
}

function normalizeAutomationTimelineEvent(value: unknown): AutomationTimelineEvent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<AutomationTimelineEvent>;
  const type = isAutomationTimelineEventType(source.type) ? source.type : undefined;
  const label = redactAndTruncateAutomationText(source.label, 160);
  const detail = redactAndTruncateAutomationText(source.detail, 500);
  if (!type || !label || !detail) {
    return undefined;
  }
  return {
    id: normalizeId(source.id, `automation-timeline-${type}-${normalizeTimestamp(source.at)}`),
    type,
    at: normalizeTimestamp(source.at),
    label,
    detail,
    toolCallId: normalizeOptionalString(source.toolCallId),
    status: isToolCallStatus(source.status) ? source.status : undefined,
  };
}

function createAutomationReportStep(record: ChatToolCallRecord, attachments: ChatToolAttachment[]): AutomationReportStep {
  const attachmentKinds = uniqueNonEmptyStrings(
    attachments
      .filter((attachment) => record.attachmentIds?.includes(attachment.id) || attachment.sourceToolCallId === record.id)
      .map((attachment) => attachment.kind),
  );
  return {
    toolCallId: record.id,
    toolName: record.name,
    displayName: record.displayName || record.name,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    evidence: redactAndTruncateAutomationText(record.errorMessage || record.resultSummary || "无工具结果摘要", AUTOMATION_EVIDENCE_LIMIT),
    attachmentKinds,
  };
}

function createAutomationTimeline(records: ChatToolCallRecord[], steps: AutomationReportStep[]): AutomationTimelineEvent[] {
  const stepByToolCallId = new Map(steps.map((step) => [step.toolCallId, step]));
  const events = records.flatMap((record) => {
    const step = stepByToolCallId.get(record.id);
    if (!step) {
      return [];
    }
    const toolEvent: AutomationTimelineEvent = {
      id: `automation-timeline-tool-${record.id}`,
      type: getAutomationTimelineEventType(record),
      at: record.completedAt ?? record.startedAt,
      label: step.displayName,
      detail: step.evidence,
      toolCallId: step.toolCallId,
      status: step.status,
    };
    if (step.status !== "error") {
      return [toolEvent];
    }
    const recoveryEvent: AutomationTimelineEvent = {
      id: `automation-timeline-recovery-${record.id}`,
      type: "failure_recovery",
      at: (record.completedAt ?? record.startedAt) + 1,
      label: "失败恢复建议",
      detail: "检查失败步骤的参数、页面状态或授权边界后重试。",
      toolCallId: step.toolCallId,
      status: step.status,
    };
    return [toolEvent, recoveryEvent];
  });
  return events.sort((a, b) => a.at - b.at).slice(0, 100);
}

function createAutomationTimelineFromSteps(steps: AutomationReportStep[]): AutomationTimelineEvent[] {
  return steps.flatMap((step) => {
    const toolEvent: AutomationTimelineEvent = {
      id: `automation-timeline-tool-${step.toolCallId}`,
      type: getAutomationTimelineEventTypeFromStep(step),
      at: step.completedAt ?? step.startedAt,
      label: step.displayName,
      detail: step.evidence,
      toolCallId: step.toolCallId,
      status: step.status,
    };
    if (step.status !== "error") {
      return [toolEvent];
    }
    const recoveryEvent: AutomationTimelineEvent = {
      id: `automation-timeline-recovery-${step.toolCallId}`,
      type: "failure_recovery",
      at: (step.completedAt ?? step.startedAt) + 1,
      label: "失败恢复建议",
      detail: "检查失败步骤的参数、页面状态或授权边界后重试。",
      toolCallId: step.toolCallId,
      status: step.status,
    };
    return [toolEvent, recoveryEvent];
  });
}

function getAutomationTimelineEventType(record: ChatToolCallRecord): AutomationTimelineEvent["type"] {
  const key = `${record.toolId}\n${record.name}`;
  if (key.includes("boundary.request_user_choice") || key.includes("boundary_request_user_choice")) {
    return "user_confirmation";
  }
  if (key.includes("wait_for")) {
    return "wait";
  }
  if (
    key.includes("browser.navigate_page") ||
    key.includes("browser_navigate_page") ||
    key.includes("browser.new_page") ||
    key.includes("browser_new_page") ||
    key.includes("browser.select_page") ||
    key.includes("browser_select_page") ||
    key.includes("browser.close_page") ||
    key.includes("browser_close_page")
  ) {
    return "page_change";
  }
  return "tool_call";
}

function getAutomationTimelineEventTypeFromStep(step: AutomationReportStep): AutomationTimelineEvent["type"] {
  const key = `${step.toolName}\n${step.displayName}`;
  if (key.includes("boundary_request_user_choice") || key.includes("用户确认")) {
    return "user_confirmation";
  }
  if (key.includes("wait_for") || key.includes("等待")) {
    return "wait";
  }
  if (key.includes("navigate_page") || key.includes("new_page") || key.includes("select_page") || key.includes("close_page") || key.includes("导航")) {
    return "page_change";
  }
  return "tool_call";
}

function inferAutomationReportType(records: ChatToolCallRecord[]): AutomationReportType {
  const keys = records.map((record) => `${record.toolId}\n${record.name}`).join("\n");
  if (keys.includes("network.") || keys.includes("network_") || keys.includes("js.") || keys.includes("js_") || keys.includes("sourcemap.") || keys.includes("sourcemap_")) {
    return "interface_analysis";
  }
  if (keys.includes("browser.analyze_form") || keys.includes("browser_analyze_form")) {
    return "form_diagnosis";
  }
  if (
    keys.includes("browser.get_page_state") ||
    keys.includes("browser_get_page_state") ||
    keys.includes("browser.get_console_messages") ||
    keys.includes("browser_get_console_messages") ||
    keys.includes("browser.screenshot") ||
    keys.includes("browser_screenshot") ||
    keys.includes("browser.collect_diagnostics") ||
    keys.includes("browser_collect_diagnostics")
  ) {
    return "page_inspection";
  }
  return "general";
}

function normalizeAutomationReportType(value: unknown, steps: AutomationReportStep[]): AutomationReportType {
  return isAutomationReportType(value) ? value : inferAutomationReportTypeFromSteps(steps);
}

function aggregateAutomationReportType(attachments: ChatAutomationReportToolAttachment[]): AutomationReportType {
  const types = attachments.map((attachment) => attachment.reportType);
  if (types.includes("interface_analysis")) {
    return "interface_analysis";
  }
  if (types.includes("form_diagnosis")) {
    return "form_diagnosis";
  }
  if (types.includes("page_inspection")) {
    return "page_inspection";
  }
  return "general";
}

function inferAutomationReportTypeFromSteps(steps: AutomationReportStep[]): AutomationReportType {
  const keys = steps.map((step) => `${step.toolName}\n${step.displayName}`).join("\n");
  if (keys.includes("network.") || keys.includes("network_") || keys.includes("js.") || keys.includes("js_") || keys.includes("sourcemap.") || keys.includes("sourcemap_")) {
    return "interface_analysis";
  }
  if (keys.includes("analyze_form") || keys.includes("表单")) {
    return "form_diagnosis";
  }
  if (keys.includes("get_page_state") || keys.includes("get_console_messages") || keys.includes("screenshot") || keys.includes("collect_diagnostics") || keys.includes("页面")) {
    return "page_inspection";
  }
  return "general";
}

function normalizeAutomationFailureSummary(value: unknown, steps: AutomationReportStep[]): AutomationFailureSummary | undefined {
  const fallback = createAutomationFailureSummary(steps);
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const source = value as Partial<AutomationFailureSummary>;
  const failedStepCount = normalizeNonNegativeNumber(source.failedStepCount);
  const failedTools = Array.isArray(source.failedTools)
    ? uniqueNonEmptyStrings(source.failedTools.filter((item): item is string => typeof item === "string").map((item) => redactAndTruncateAutomationText(item, 120))).slice(0, 20)
    : fallback?.failedTools ?? [];
  const recoverableActions = Array.isArray(source.recoverableActions)
    ? uniqueNonEmptyStrings(source.recoverableActions.filter((item): item is string => typeof item === "string").map((item) => redactAndTruncateAutomationText(item, 200))).slice(0, 10)
    : fallback?.recoverableActions ?? [];
  return failedStepCount > 0 ? { failedStepCount, failedTools, recoverableActions } : undefined;
}

function normalizeAutomationReportPlaybook(value: unknown): AutomationPlaybookSelection | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<AutomationPlaybookSelection>;
  const playbookId = normalizeOptionalString(source.playbookId);
  const title = normalizeOptionalString(source.title);
  const reason = normalizeOptionalString(source.reason);
  const validSource = source.source === "builtin" || source.source === "skill" || source.source === "user" ? source.source : undefined;
  const confidence = source.confidence === "high" || source.confidence === "medium" || source.confidence === "low" ? source.confidence : undefined;
  if (!playbookId || !title || !validSource || !confidence || !reason) {
    return undefined;
  }
  return {
    playbookId,
    title: redactAndTruncateAutomationText(title, 120) || title,
    source: validSource,
    confidence,
    reason: redactAndTruncateAutomationText(reason, 200) || reason,
  };
}

function createAutomationFailureSummary(steps: AutomationReportStep[]): AutomationFailureSummary | undefined {
  const failedSteps = steps.filter((step) => step.status === "error");
  if (failedSteps.length === 0) {
    return undefined;
  }
  return {
    failedStepCount: failedSteps.length,
    failedTools: uniqueNonEmptyStrings(failedSteps.map((step) => step.displayName)).slice(0, 20),
    recoverableActions: ["检查失败步骤的参数、页面状态或授权边界后重试。"],
  };
}

function redactAndTruncateAutomationText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }
  return truncateText(redactAutomationText(text), maxLength).text;
}

function redactInlineSensitiveText(value: string): string {
  return value
    .replace(BEARER_INLINE_PATTERN, "Bearer [已脱敏]")
    .replace(SENSITIVE_INLINE_PATTERN, (_match, key: string) => `${key}=[已脱敏]`);
}

function redactAutomationText(value: string): string {
  const inlineRedacted = redactInlineSensitiveText(value);
  const trimmed = inlineRedacted.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || isPlainFormEncodedText(trimmed)) {
    return redactNetworkText(trimmed);
  }
  return inlineRedacted.replace(/https?:\/\/[^\s)）]+/g, (url) => redactNetworkText(url));
}

function isPlainFormEncodedText(value: string): boolean {
  return /^[^=\s]+=[^=\s]+(?:&[^=\s]+=[^=\s]+)*$/.test(value);
}

function isToolCallStatus(value: unknown): value is AutomationReportStep["status"] {
  return value === "running" || value === "success" || value === "error";
}

function isAutomationTimelineEventType(value: unknown): value is AutomationTimelineEvent["type"] {
  return value === "tool_call" || value === "page_change" || value === "wait" || value === "user_confirmation" || value === "failure_recovery";
}

function isAutomationReportType(value: unknown): value is AutomationReportType {
  return value === "general" || value === "page_inspection" || value === "form_diagnosis" || value === "interface_analysis";
}

function isSourceMapCandidateSource(value: unknown): value is SourceMapCandidate["source"] {
  return value === "response-header" || value === "x-source-map-header" || value === "source-mapping-url" || value === "inline";
}

function isSourceMapCandidateStatus(value: unknown): value is SourceMapCandidate["status"] {
  return value === "available" || value === "fetchable" || value === "blocked" || value === "failed";
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
