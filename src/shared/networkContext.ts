import type { NetworkHeader, NetworkRequestDetail, NetworkRequestMeta, NetworkRequestTypeFilter } from "./types";
import { truncateText } from "./utils/text";

const REDACTED_VALUE = "[已脱敏]";
const BODY_LIMIT = 6000;
const FIELD_LIMIT = 1200;

const SENSITIVE_NAME_PATTERN = /(authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid)/i;
export const DEFAULT_NETWORK_RELEVANCE_PROMPT = [
  "请根据用户需求，从下面 Network 请求元数据中筛选最相关的请求。",
  "只返回 JSON，格式为：{\"requestIds\":[\"请求ID\"]}，不要输出解释。",
  "",
  "用户需求：{{userDemand}}",
  "",
  "Network 请求元数据：",
  "{{networkRequests}}",
].join("\n");
export const DEFAULT_NETWORK_REQUEST_TYPE_FILTERS: NetworkRequestTypeFilter[] = ["all"];
export const NETWORK_REQUEST_TYPE_FILTER_OPTIONS: Array<{ value: NetworkRequestTypeFilter; label: string; ariaLabel: string }> = [
  { value: "all", label: "All", ariaLabel: "采集全部 Network 请求类型" },
  { value: "fetch_xhr", label: "Fetch/XHR", ariaLabel: "采集 Fetch/XHR 请求" },
  { value: "doc", label: "Doc", ariaLabel: "采集 Doc 请求" },
  { value: "css", label: "CSS", ariaLabel: "采集 CSS 请求" },
  { value: "js", label: "JS", ariaLabel: "采集 JS 请求" },
  { value: "font", label: "Font", ariaLabel: "采集 Font 请求" },
  { value: "img", label: "Img", ariaLabel: "采集 Img 请求" },
  { value: "media", label: "Media", ariaLabel: "采集 Media 请求" },
  { value: "manifest", label: "Manifest", ariaLabel: "采集 Manifest 请求" },
  { value: "ws", label: "WS", ariaLabel: "采集 WS 请求" },
  { value: "wasm", label: "Wasm", ariaLabel: "采集 Wasm 请求" },
  { value: "other", label: "Other", ariaLabel: "采集 Other 请求" },
];

export function redactNetworkRequestDetail(detail: NetworkRequestDetail): NetworkRequestDetail {
  return {
    ...detail,
    url: redactUrl(detail.url),
    requestHeaders: redactHeaders(detail.requestHeaders),
    responseHeaders: redactHeaders(detail.responseHeaders),
    requestBody: redactBody(detail.requestBody),
    responseBody: redactBody(detail.responseBody),
    redacted: true,
  };
}

export function redactNetworkRequestMeta(meta: NetworkRequestMeta): NetworkRequestMeta {
  return {
    ...meta,
    url: redactUrl(meta.url),
    requestHeaders: redactHeaders(meta.requestHeaders),
    responseHeaders: redactHeaders(meta.responseHeaders),
    requestBody: redactBody(meta.requestBody),
  };
}

export function filterNetworkRequestsByType<T extends NetworkRequestMeta>(requests: T[], filters: NetworkRequestTypeFilter[]): T[] {
  if (filters.includes("all")) {
    return requests;
  }

  return requests.filter((request) => filters.includes(resolveNetworkRequestTypeFilter(request.resourceType)));
}

export function parseRelevantNetworkRequestIds(content: string, availableRequests: string[] | NetworkRequestMeta[]): string[] {
  const availableIds = availableRequests.map((request) => (typeof request === "string" ? request : request.id));
  const availableIdSet = new Set(availableIds);
  const candidates = parseRequestIdCandidates(content);
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    const id = resolveRequestIdCandidate(candidate, availableIds, availableIdSet);
    if (!id || seen.has(id)) {
      return [];
    }

    seen.add(id);
    return [id];
  });
}

export function createNetworkMetadataPrompt(input: { userDemand: string; requests: NetworkRequestMeta[]; promptTemplate?: string }): string {
  const requestLines = input.requests.map((request, index) =>
    [
      `${index + 1}. id=${request.id}`,
      `method=${request.method || "UNKNOWN"}`,
      `status=${request.status ?? "unknown"}`,
      `type=${request.resourceType ?? request.mimeType ?? "unknown"}`,
      `durationMs=${request.durationMs ?? "unknown"}`,
      `url=${request.url}`,
    ].join(" | "),
  );
  const networkRequests = requestLines.join("\n");
  const template = input.promptTemplate?.trim() || DEFAULT_NETWORK_RELEVANCE_PROMPT;
  const hasUserDemandPlaceholder = /\{\{\s*userDemand\s*\}\}/.test(template);
  const hasNetworkRequestsPlaceholder = /\{\{\s*networkRequests\s*\}\}/.test(template);
  const rendered = template
    .replace(/\{\{\s*userDemand\s*\}\}/g, input.userDemand)
    .replace(/\{\{\s*networkRequests\s*\}\}/g, networkRequests);
  const fallbackSections = [
    hasUserDemandPlaceholder ? "" : `用户需求：${input.userDemand}`,
    hasNetworkRequestsPlaceholder ? "" : ["Network 请求元数据：", networkRequests].join("\n"),
  ].filter(Boolean);

  return [rendered, ...fallbackSections].join("\n\n").trim();
}

export function createNetworkContextPrompt(input: { userDemand: string; details: NetworkRequestDetail[] }): string {
  const sections = input.details.map((detail, index) =>
    [
      `Request ${index + 1}: ${detail.method || "UNKNOWN"} ${detail.url}`,
      detail.status !== undefined ? `Status: ${detail.status}${detail.statusText ? ` ${detail.statusText}` : ""}` : "",
      detail.mimeType ? `MIME: ${detail.mimeType}` : "",
      detail.resourceType ? `Type: ${detail.resourceType}` : "",
      detail.durationMs !== undefined ? `Duration: ${detail.durationMs}ms` : "",
      detail.redacted ? "Redacted: true" : "Redacted: false",
      detail.truncated ? "Truncated: true" : "Truncated: false",
      formatHeaderBlock("Request headers", detail.requestHeaders),
      detail.requestBody ? `Request body:\n${truncateForPrompt(detail.requestBody, BODY_LIMIT)}` : "",
      formatHeaderBlock("Response headers", detail.responseHeaders),
      detail.responseBody ? `Response body:\n${truncateForPrompt(detail.responseBody, BODY_LIMIT)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return ["Network context:", `用户需求：${input.userDemand}`, "", sections.join("\n\n---\n\n")].join("\n").trim();
}

export function formatNetworkAttachmentSummary(details: NetworkRequestDetail[]): string {
  if (details.length === 0) {
    return "未注入 Network 请求";
  }

  const first = details[0];
  return `已注入 ${details.length} 个 Network 请求：${first.method || "UNKNOWN"} ${first.status ?? "unknown"} ${first.url}`;
}

export function formatNetworkAttachmentForExport(details: NetworkRequestDetail[]): string {
  if (details.length === 0) {
    return "";
  }

  return createNetworkContextPrompt({ userDemand: "聊天记录中保存的 Network 请求详情", details });
}

function parseRequestIdCandidates(content: string): string[] {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const parsedCandidates = parseRequestIdCandidatesFromValue(parsed);
    if (parsedCandidates.length > 0) {
      return parsedCandidates;
    }

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["requestIds", "ids", "requests"]) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value.flatMap((item) => {
            if (typeof item === "string") {
              return [item];
            }
            if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
              return [item.id];
            }
            return [];
          });
        }
      }
    }
  } catch {
    // 第三方模型可能返回编号列表；JSON 解析失败时继续走宽松文本解析。
  }

  return Array.from(trimmed.matchAll(/req-[\w.-]+/g)).map((match) => match[0]);
}

function resolveNetworkRequestTypeFilter(resourceType: string | undefined): NetworkRequestTypeFilter {
  switch (resourceType?.toLowerCase()) {
    case "fetch":
    case "xhr":
      return "fetch_xhr";
    case "document":
      return "doc";
    case "stylesheet":
      return "css";
    case "script":
      return "js";
    case "font":
      return "font";
    case "image":
      return "img";
    case "media":
      return "media";
    case "manifest":
      return "manifest";
    case "websocket":
      return "ws";
    case "wasm":
      return "wasm";
    default:
      return "other";
  }
}

function resolveRequestIdCandidate(candidate: string, availableIds: string[], availableIdSet: Set<string>): string | undefined {
  if (availableIdSet.has(candidate)) {
    return candidate;
  }

  const ordinalMatch = candidate.match(/^req-(\d+)$/i);
  if (!ordinalMatch) {
    return undefined;
  }

  const numericId = ordinalMatch[1];
  // Chrome HAR 的 _requestId 常见为裸数字；模型可能按提示格式误补成 req-N，因此先兼容真实裸编号。
  if (availableIdSet.has(numericId)) {
    return numericId;
  }

  const ordinal = Number(numericId);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > availableIds.length) {
    return undefined;
  }

  return availableIds[ordinal - 1];
}

function parseRequestIdCandidatesFromValue(value: unknown): string[] {
  if (typeof value === "string") {
    return parseRequestIdCandidates(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }
      return parseRequestIdCandidatesFromValue(item);
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directCandidates = ["requestIds", "ids", "requests"].flatMap((key) => parseRequestIdCandidatesFromValue(record[key]));
  if (directCandidates.length > 0) {
    return directCandidates;
  }

  if (typeof record.id === "string") {
    return [record.id];
  }

  const choiceCandidates = parseRequestIdCandidatesFromValue(record.choices);
  if (choiceCandidates.length > 0) {
    return choiceCandidates;
  }

  const messageCandidates = parseRequestIdCandidatesFromValue(record.message);
  if (messageCandidates.length > 0) {
    return messageCandidates;
  }

  return parseRequestIdCandidatesFromValue(record.content);
}

function redactHeaders(headers: NetworkHeader[] | undefined): NetworkHeader[] | undefined {
  if (!headers) {
    return undefined;
  }

  return headers.map((header) => ({
    ...header,
    value: isSensitiveName(header.name) ? REDACTED_VALUE : header.value,
  }));
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    const redactedParams = Array.from(url.searchParams.entries()).map(([key, paramValue]) =>
      `${encodeURIComponent(key)}=${isSensitiveName(key) ? REDACTED_VALUE : encodeURIComponent(paramValue)}`,
    );
    const query = redactedParams.length > 0 ? `?${redactedParams.join("&")}` : "";
    return `${url.origin}${url.pathname}${query}${url.hash}`;
  } catch {
    return value;
  }
}

function redactBody(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  try {
    return JSON.stringify(redactJsonValue(JSON.parse(value)));
  } catch {
    return redactFormEncodedBody(value);
  }
}

function redactJsonValue(value: unknown, key = ""): unknown {
  if (isSensitiveName(key)) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactJsonValue(entryValue, entryKey)]));
  }

  return value;
}

function redactFormEncodedBody(value: string): string {
  const params = new URLSearchParams(value);
  let changed = false;
  for (const key of Array.from(params.keys())) {
    if (isSensitiveName(key)) {
      params.set(key, REDACTED_VALUE);
      changed = true;
    }
  }

  return changed ? params.toString() : value;
}

function formatHeaderBlock(title: string, headers: NetworkHeader[] | undefined): string {
  if (!headers?.length) {
    return "";
  }

  return `${title}:\n${headers.map((header) => `${header.name}: ${truncateForPrompt(header.value, FIELD_LIMIT)}`).join("\n")}`;
}

function truncateForPrompt(value: string, maxLength: number): string {
  return truncateText(value, maxLength).text;
}

function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(name);
}
