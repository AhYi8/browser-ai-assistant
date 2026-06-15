import {
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME,
} from "../../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";
import type { ChatNetworkToolAttachment, NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from "../../shared/types";
import { createNetworkContextPrompt, formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "../../shared/networkContext";
import { truncateText } from "../../shared/utils/text";
import { isJavaScriptDetail } from "./jsSourceIndex";
import { JsSourceToolExecutor } from "./jsSourceToolExecutor";
import type { BrowserNetworkRecorder, NetworkRequestFilter, NetworkWaitFilter } from "./networkRecorder";

type NetworkToolName =
  | typeof NETWORK_LIST_REQUESTS_TOOL_ID
  | typeof NETWORK_LIST_REQUESTS_TOOL_NAME
  | typeof NETWORK_GET_REQUEST_DETAILS_TOOL_ID
  | typeof NETWORK_GET_REQUEST_DETAILS_TOOL_NAME
  | typeof NETWORK_CLEAR_REQUESTS_TOOL_ID
  | typeof NETWORK_CLEAR_REQUESTS_TOOL_NAME
  | typeof NETWORK_WAIT_FOR_REQUESTS_TOOL_ID
  | typeof NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME
  | typeof NETWORK_COMPARE_REQUESTS_TOOL_ID
  | typeof NETWORK_COMPARE_REQUESTS_TOOL_NAME
  | typeof NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID
  | typeof NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME
  | typeof NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID
  | typeof NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME;

interface NetworkRecorderLike {
  isEnabled: boolean | (() => boolean);
  listRequests(filter?: NetworkRequestFilter): NetworkRequestMeta[];
  getDetails(requestIds: string[]): Promise<NetworkRequestDetail[]>;
  clear(): void;
  waitForRequests(filter?: NetworkWaitFilter): Promise<NetworkRequestMeta[]>;
}

interface ParameterCandidate {
  location: string;
  name: string;
  value: string;
  reason: string;
}

const NETWORK_DISABLED_MESSAGE = "Network 采集尚未启用，请先开启浏览器控制。";
const REQUEST_IDS_INVALID_MESSAGE = "requestIds 必须是包含 1 到 100 个非空字符串的数组。";
const MAX_DETAIL_IDS = 100;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_LIST_LIMIT = 200;
const MAX_FILTER_TEXT_LENGTH = 200;
const MAX_METHOD_LENGTH = 32;
const MAX_RESOURCE_TYPE_LENGTH = 64;
const MAX_KEYWORDS = 20;
const JS_SNIPPET_RADIUS = 120;
const DEFAULT_JS_KEYWORDS = ["sign", "signature", "encrypt", "crypto", "md5", "sha", "aes", "nonce", "timestamp", "token"];
const NETWORK_TOOL_NAMES = new Set<string>([
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
]);

export class BrowserNetworkToolExecutor {
  private jsSourceExecutor: JsSourceToolExecutor | undefined;

  constructor(private readonly recorder: NetworkRecorderLike | BrowserNetworkRecorder) {}

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!this.isEnabled()) {
      return createErrorResult(toolCall, NETWORK_DISABLED_MESSAGE);
    }

    if (!isNetworkToolName(toolCall.name)) {
      return createErrorResult(toolCall, `未知的 Network 工具：${toolCall.name}。`);
    }

    try {
      return await this.executeTool(toolCall);
    } catch {
      return createErrorResult(toolCall, "Network 工具执行失败，请稍后重试。");
    }
  }

  private async executeTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (isToolCallName(toolCall.name, NETWORK_CLEAR_REQUESTS_TOOL_ID, NETWORK_CLEAR_REQUESTS_TOOL_NAME)) {
      this.recorder.clear();
      this.getJsSourceExecutor().clear();
      return { toolCallId: toolCall.id, name: toolCall.name, content: "已清空当前受控页面的 Network 请求缓存。" };
    }

    if (isToolCallName(toolCall.name, NETWORK_LIST_REQUESTS_TOOL_ID, NETWORK_LIST_REQUESTS_TOOL_NAME)) {
      const requests = this.recorder.listRequests(normalizeRequestFilter(toolCall.arguments));
      return createNetworkResult(toolCall, formatRequestList(requests), requests.map(createMetaDetail));
    }

    if (isToolCallName(toolCall.name, NETWORK_WAIT_FOR_REQUESTS_TOOL_ID, NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME)) {
      const requests = await this.recorder.waitForRequests(normalizeWaitFilter(toolCall.arguments));
      const content = requests.length ? `已捕获 ${requests.length} 个匹配的 Network 请求：\n${formatRequestList(requests)}` : "等待 Network 请求超时，未捕获到匹配请求。";
      return createNetworkResult(toolCall, content, requests.map(createMetaDetail));
    }

    if (isToolCallName(toolCall.name, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME) && toolCall.arguments.requestIds === undefined) {
      const jsResult = await this.getJsSourceExecutor().searchForNetworkCompatibility(toolCall.arguments);
      return createNetworkResult(toolCall, jsResult.content, jsResult.resources.map((resource) => createMetaDetail({
        id: resource.id,
        url: resource.url,
        method: "GET",
        mimeType: resource.mimeType,
        resourceType: "Script",
      })));
    }

    const requestIds = normalizeRequestIds(toolCall.arguments.requestIds);
    if (!requestIds.ok) {
      return createErrorResult(toolCall, requestIds.message);
    }

    const details = await this.recorder.getDetails(requestIds.requestIds);
    if (isToolCallName(toolCall.name, NETWORK_GET_REQUEST_DETAILS_TOOL_ID, NETWORK_GET_REQUEST_DETAILS_TOOL_NAME)) {
      return createNetworkResult(toolCall, createNetworkContextPrompt({ userDemand: "Network 工具读取请求详情", details }), details);
    }

    if (isToolCallName(toolCall.name, NETWORK_COMPARE_REQUESTS_TOOL_ID, NETWORK_COMPARE_REQUESTS_TOOL_NAME)) {
      return createNetworkResult(toolCall, compareRequests(details), details);
    }

    if (isToolCallName(toolCall.name, NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME)) {
      return createNetworkResult(toolCall, formatParameterCandidates(findParameterCandidates(details)), details);
    }

    return createNetworkResult(toolCall, extractJsCandidates(details, toolCall.arguments), details);
  }

  private isEnabled(): boolean {
    return typeof this.recorder.isEnabled === "function" ? this.recorder.isEnabled() : this.recorder.isEnabled;
  }

  private getJsSourceExecutor(): JsSourceToolExecutor {
    this.jsSourceExecutor ??= new JsSourceToolExecutor({
      recorder: this.recorder,
      getCurrentPageUrl: async () => "",
      fetcher: { fetch: async () => ({ ok: false, url: "", message: "同源 JS 补位不可用于 Network 兼容入口。" }) },
    });
    return this.jsSourceExecutor;
  }
}

function isNetworkToolName(name: string): name is NetworkToolName {
  return NETWORK_TOOL_NAMES.has(name);
}

function isToolCallName(name: string, legacyId: string, publicName: string): boolean {
  return name === legacyId || name === publicName;
}

function normalizeRequestFilter(args: Record<string, unknown>): NetworkRequestFilter {
  return {
    urlIncludes: normalizeOptionalString(args.urlIncludes, MAX_FILTER_TEXT_LENGTH),
    method: normalizeOptionalString(args.method, MAX_METHOD_LENGTH),
    resourceType: normalizeOptionalString(args.resourceType, MAX_RESOURCE_TYPE_LENGTH),
    status: typeof args.status === "number" && Number.isInteger(args.status) ? args.status : undefined,
    limit: normalizeLimit(args.limit),
  };
}

function normalizeWaitFilter(args: Record<string, unknown>): NetworkWaitFilter {
  return {
    ...normalizeRequestFilter(args),
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
  };
}

function normalizeRequestIds(value: unknown): { ok: true; requestIds: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DETAIL_IDS) {
    return { ok: false, message: REQUEST_IDS_INVALID_MESSAGE };
  }

  const requestIds = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (requestIds.some((item) => !item || item.length > MAX_REQUEST_ID_LENGTH)) {
    return { ok: false, message: REQUEST_IDS_INVALID_MESSAGE };
  }

  return { ok: true, requestIds: Array.from(new Set(requestIds)) };
}

function normalizeOptionalString(value: unknown, maxLength = MAX_FILTER_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIST_LIMIT);
}

function formatRequestList(requests: NetworkRequestMeta[]): string {
  if (requests.length === 0) {
    return "未找到匹配的 Network 请求。";
  }

  return requests
    .map((request, index) =>
      `${index + 1}. id=${request.id} | ${request.method || "GET"} | ${request.status ?? "unknown"} | ${request.resourceType ?? "unknown"} | ${request.url}`,
    )
    .join("\n");
}

function createMetaDetail(meta: NetworkRequestMeta): NetworkRequestDetail {
  return redactNetworkRequestDetail({
    ...meta,
    truncated: false,
    redacted: true,
  });
}

function createNetworkResult(toolCall: ModelToolCall, content: string, details: NetworkRequestDetail[]): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    ...(details.length ? { toolAttachments: [createNetworkAttachment(toolCall.id, details)] } : {}),
  };
}

function createNetworkAttachment(sourceToolCallId: string, details: NetworkRequestDetail[]): ChatNetworkToolAttachment {
  const requests = details.map(redactNetworkRequestDetail);
  return {
    id: `tool-attachment-${sourceToolCallId}`,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    sourceToolCallId,
    createdAt: Date.now(),
    redacted: true,
    truncated: requests.some((request) => request.truncated),
    requests,
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

function compareRequests(details: NetworkRequestDetail[]): string {
  if (details.length < 2) {
    return "至少需要两个请求才能进行对比。";
  }

  const fieldsByRequest = details.map(flattenRequestFields);
  const allKeys = Array.from(new Set(fieldsByRequest.flatMap((fields) => Array.from(fields.keys())))).sort();
  const stableFields: string[] = [];
  const changedFields: string[] = [];
  for (const key of allKeys) {
    const values = fieldsByRequest.map((fields) => fields.get(key) ?? "");
    const uniqueValues = Array.from(new Set(values));
    if (uniqueValues.length <= 1) {
      stableFields.push(`${key}=${truncateText(uniqueValues[0] ?? "", 160).text}`);
    } else {
      changedFields.push(`${key}: ${uniqueValues.map((value) => truncateText(value, 80).text).join(" -> ")}`);
    }
  }

  const candidates = findParameterCandidates(details);
  return [
    "Network 请求对比结果",
    "",
    "稳定字段：",
    stableFields.slice(0, 30).map((item) => `- ${item}`).join("\n") || "- 无",
    "",
    "变化字段：",
    changedFields.slice(0, 50).map((item) => `- ${item}`).join("\n") || "- 无",
    "",
    "疑似关键参数：",
    formatParameterCandidates(candidates),
  ].join("\n");
}

function flattenRequestFields(detail: NetworkRequestDetail): Map<string, string> {
  const fields = new Map<string, string>();
  fields.set("method", detail.method);
  fields.set("path", safeUrl(detail.url).pathname);
  for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
    fields.set(`query.${key}`, value);
  }
  for (const header of detail.requestHeaders ?? []) {
    fields.set(`requestHeader.${header.name.toLowerCase()}`, header.value);
  }
  for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
    fields.set(`body.${key}`, value);
  }
  return fields;
}

function findParameterCandidates(details: NetworkRequestDetail[]): ParameterCandidate[] {
  const candidates: ParameterCandidate[] = [];
  for (const detail of details) {
    for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
      appendCandidate(candidates, "query", key, value);
    }
    for (const header of detail.requestHeaders ?? []) {
      appendCandidate(candidates, "requestHeader", header.name, header.value);
    }
    for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
      appendCandidate(candidates, "body", key, value);
    }
  }
  return candidates;
}

function appendCandidate(candidates: ParameterCandidate[], location: string, name: string, value: string): void {
  const lowerName = name.toLowerCase();
  const lowerValue = value.toLowerCase();
  const reasons: string[] = [];
  if (/sign|signature|sig|x-sign/.test(lowerName)) {
    reasons.push("疑似签名字段");
  }
  if (/timestamp|time|ts|_t/.test(lowerName)) {
    reasons.push("疑似时间戳字段");
  }
  if (/nonce|uuid|requestid|traceid|random/.test(lowerName)) {
    reasons.push("疑似随机数或请求标识字段");
  }
  if (/token|authorization|cookie/.test(lowerName)) {
    reasons.push("疑似凭据字段");
  }
  if (/^[a-f0-9]{24,}$/i.test(value) || /^[a-z0-9_-]{32,}$/i.test(value) || /[+/=]{2,}/.test(value) || lowerValue.includes("%3d")) {
    reasons.push("疑似加密或编码载荷");
  }

  for (const reason of reasons) {
    candidates.push({ location, name, value: truncateText(value, 160).text, reason });
  }
}

function formatParameterCandidates(candidates: ParameterCandidate[]): string {
  if (candidates.length === 0) {
    return "未发现明显的参数候选。";
  }

  return candidates
    .slice(0, 80)
    .map((candidate) => `- ${candidate.reason}: ${candidate.location}.${candidate.name}=${candidate.value}`)
    .join("\n");
}

function extractJsCandidates(details: NetworkRequestDetail[], args: Record<string, unknown>): string {
  const keywords = normalizeStringArray(args.keywords);
  const urlIncludes = normalizeOptionalString(args.urlIncludes);
  const searchTerms = keywords.length ? keywords : DEFAULT_JS_KEYWORDS;
  const sections: string[] = [];
  for (const detail of details) {
    if (!isJavaScriptDetail(detail)) {
      continue;
    }

    const body = detail.responseBody ?? "";
    const matches = [...searchTerms, ...(urlIncludes ? [urlIncludes] : [])].flatMap((term) => findSnippets(body, term));
    if (matches.length === 0) {
      continue;
    }

    sections.push([
      `JS 候选资源：${detail.url}`,
      ...matches.slice(0, 8).map((match) => `- 命中 ${match.term}: ${match.snippet}`),
    ].join("\n"));
  }

  return sections.length ? sections.join("\n\n") : "未找到匹配的 JS 候选资源。";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim().slice(0, MAX_FILTER_TEXT_LENGTH) : "")).filter(Boolean))).slice(0, MAX_KEYWORDS);
}

function findSnippets(text: string, term: string): Array<{ term: string; snippet: string }> {
  if (!text || !term) {
    return [];
  }

  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const index = lowerText.indexOf(lowerTerm);
  if (index < 0) {
    return [];
  }

  const start = Math.max(0, index - JS_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + term.length + JS_SNIPPET_RADIUS);
  return [{ term, snippet: truncateText(text.slice(start, end).replace(/\s+/g, " "), 320).text }];
}

function parseBodyFields(body: string | undefined, requestHeaders: NetworkHeader[] | undefined): Array<[string, string]> {
  if (!body) {
    return [];
  }

  if (isJsonBody(requestHeaders)) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return flattenJson(parsed);
    } catch {
      return [["body", truncateText(body, 320).text]];
    }
  }

  if (isFormUrlEncoded(requestHeaders)) {
    const params = new URLSearchParams(body);
    return Array.from(params.entries());
  }

  return [["body", truncateText(body, 320).text]];
}

function isJsonBody(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === "content-type" && header.value.toLowerCase().includes("json")) ?? false;
}

function isFormUrlEncoded(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === "content-type" && header.value.toLowerCase().includes("application/x-www-form-urlencoded")) ?? false;
}

function flattenJson(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value !== "object") {
    return [[prefix || "value", String(value)]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, item]) => flattenJson(item, prefix ? `${prefix}.${key}` : key));
}

function safeUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return new URL(value, "https://example.invalid");
  }
}
