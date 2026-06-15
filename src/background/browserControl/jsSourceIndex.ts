import type { JsSourceContext, JsSourceMatch, JsSourceResource, NetworkRequestDetail } from "../../shared/types";
import { truncateText } from "../../shared/utils/text";

export interface JsSourceFetchedResourceInput {
  id: string;
  source: "same-origin-fetch";
  url: string;
  mimeType?: string;
  content: string;
  fetchedAt: number;
}

export interface JsSourceSearchOptions {
  maxMatches?: number;
  snippetRadius?: number;
}

export interface JsSourceContextOptions {
  radius?: number;
}

interface IndexedJsSourceResource extends JsSourceResource {
  content: string;
  lineStarts: number[];
}

const DEFAULT_MAX_MATCHES = 50;
const DEFAULT_SNIPPET_RADIUS = 160;
const DEFAULT_CONTEXT_RADIUS = 600;
const MAX_SNIPPET_LENGTH = 420;
const MAX_CONTEXT_LENGTH = 1800;
const MAX_INDEXED_CONTENT_LENGTH = 1_000_000;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|csrf|xsrf)\b\s*[:=]\s*(['"`])[^'"`]{1,500}\2/gi;

export class JsSourceIndex {
  private readonly resourcesById = new Map<string, IndexedJsSourceResource>();

  clear(): void {
    this.resourcesById.clear();
  }

  upsertNetworkDetails(details: NetworkRequestDetail[]): void {
    for (const detail of details) {
      if (!isJavaScriptDetail(detail) || !detail.responseBody) {
        continue;
      }

      this.upsertResource({
        id: detail.id,
        source: "network",
        url: detail.url,
        mimeType: detail.mimeType,
        content: detail.responseBody,
        truncated: detail.truncated,
      });
    }
  }

  upsertFetchedResource(resource: JsSourceFetchedResourceInput): void {
    this.upsertResource({
      id: resource.id,
      source: resource.source,
      url: resource.url,
      mimeType: resource.mimeType,
      content: resource.content,
      fetchedAt: resource.fetchedAt,
      truncated: false,
    });
  }

  listResources(): JsSourceResource[] {
    return Array.from(this.resourcesById.values()).map(({ content: _content, lineStarts: _lineStarts, ...resource }) => resource);
  }

  search(keywords: string[], options: JsSourceSearchOptions = {}): { matches: JsSourceMatch[]; truncated: boolean } {
    const maxMatches = clampInteger(options.maxMatches, 1, DEFAULT_MAX_MATCHES, DEFAULT_MAX_MATCHES);
    const radius = clampInteger(options.snippetRadius, 40, 800, DEFAULT_SNIPPET_RADIUS);
    const matches: JsSourceMatch[] = [];
    for (const resource of this.resourcesById.values()) {
      const lowerContent = resource.content.toLowerCase();
      for (const term of keywords) {
        const normalizedTerm = term.trim();
        if (!normalizedTerm) {
          continue;
        }
        const lowerTerm = normalizedTerm.toLowerCase();
        let position = lowerContent.indexOf(lowerTerm);
        while (position >= 0) {
          matches.push(createMatch(resource, normalizedTerm, position, radius));
          if (matches.length >= maxMatches) {
            return { matches, truncated: true };
          }
          position = lowerContent.indexOf(lowerTerm, position + Math.max(lowerTerm.length, 1));
        }
      }
    }

    return { matches, truncated: false };
  }

  extractContext(resourceId: string, position: number, options: JsSourceContextOptions = {}): JsSourceContext | undefined {
    const resource = this.resourcesById.get(resourceId);
    if (!resource || !Number.isFinite(position)) {
      return undefined;
    }

    const normalizedPosition = Math.min(Math.max(Math.floor(position), 0), resource.content.length);
    const radius = clampInteger(options.radius, 80, 3000, DEFAULT_CONTEXT_RADIUS);
    const start = Math.max(0, normalizedPosition - radius);
    const end = Math.min(resource.content.length, normalizedPosition + radius);
    const truncated = truncateText(resource.content.slice(start, end), MAX_CONTEXT_LENGTH);
    const redacted = redactJsSourceSnippet(truncated.text);
    const location = calculateLineColumn(resource.lineStarts, normalizedPosition);
    return {
      resourceId: resource.id,
      source: resource.source,
      url: resource.url,
      position: normalizedPosition,
      line: location.line,
      column: location.column,
      snippet: redacted.text,
      redacted: redacted.redacted,
      truncated: truncated.truncated || start > 0 || end < resource.content.length,
    };
  }

  private upsertResource(input: {
    id: string;
    source: "network" | "same-origin-fetch";
    url: string;
    mimeType?: string;
    content: string;
    fetchedAt?: number;
    truncated: boolean;
  }): void {
    const truncatedContent = truncateText(input.content, MAX_INDEXED_CONTENT_LENGTH);
    this.resourcesById.set(input.id, {
      id: input.id,
      source: input.source,
      url: input.url,
      mimeType: input.mimeType,
      size: input.content.length,
      searchable: true,
      fetchedAt: input.fetchedAt,
      // redacted 表示内容已经过脱敏管道处理，不代表原始源码一定包含敏感字段。
      redacted: true,
      truncated: input.truncated || truncatedContent.truncated,
      content: truncatedContent.text,
      lineStarts: createLineStarts(truncatedContent.text),
    });
  }
}

export function isJavaScriptDetail(detail: NetworkRequestDetail): boolean {
  const pathname = getUrlPathname(detail.url).toLowerCase();
  const mimeType = detail.mimeType?.toLowerCase() ?? "";
  const resourceType = detail.resourceType?.toLowerCase() ?? "";
  return resourceType === "script" || /\.(?:m?js)$/i.test(pathname) || isTrustedJavaScriptMime(mimeType);
}

export function isJavaScriptMetaLike(meta: { url: string; mimeType?: string; resourceType?: string }): boolean {
  const pathname = getUrlPathname(meta.url).toLowerCase();
  const mimeType = meta.mimeType?.toLowerCase() ?? "";
  const resourceType = meta.resourceType?.toLowerCase() ?? "";
  return resourceType === "script" || /\.(?:m?js)$/i.test(pathname) || isTrustedJavaScriptMime(mimeType);
}

export function redactJsSourceSnippet(value: string): { text: string; redacted: boolean } {
  let redacted = false;
  const text = value.replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, name: string) => {
    redacted = true;
    return `${name} = "[已脱敏]"`;
  });
  return { text, redacted };
}

function createMatch(resource: IndexedJsSourceResource, term: string, position: number, radius: number): JsSourceMatch {
  const start = Math.max(0, position - radius);
  const end = Math.min(resource.content.length, position + term.length + radius);
  const truncated = truncateText(resource.content.slice(start, end), MAX_SNIPPET_LENGTH);
  const redacted = redactJsSourceSnippet(truncated.text.replace(/\s+/g, " "));
  const location = calculateLineColumn(resource.lineStarts, position);
  return {
    resourceId: resource.id,
    source: resource.source,
    url: resource.url,
    term,
    position,
    line: location.line,
    column: location.column,
    snippet: redacted.text,
    redacted: redacted.redacted,
    truncated: truncated.truncated || start > 0 || end < resource.content.length,
  };
}

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function calculateLineColumn(lineStarts: number[], position: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= position) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: position - lineStarts[lineIndex] + 1,
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function getUrlPathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}

function isTrustedJavaScriptMime(mimeType: string): boolean {
  const normalized = mimeType.split(";", 1)[0]?.trim() ?? "";
  return normalized === "application/javascript" ||
    normalized === "text/javascript" ||
    normalized === "application/ecmascript" ||
    normalized === "text/ecmascript" ||
    normalized === "application/x-javascript";
}
