import type { NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from "../../shared/types";
import { redactNetworkRequestDetail, redactNetworkRequestMeta } from "../../shared/networkContext";
import { truncateText } from "../../shared/utils/text";

export interface BrowserNetworkConnection {
  addEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void;
  removeEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void;
  getResponseBody(requestId: string): Promise<{ body?: string; base64Encoded?: boolean }>;
}

export interface NetworkRequestFilter {
  urlIncludes?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  limit?: number;
}

export interface NetworkWaitFilter extends NetworkRequestFilter {
  timeoutMs?: number;
}

export interface NetworkIdleWaitOptions {
  idleMs?: number;
  timeoutMs?: number;
}

interface CachedNetworkRequest {
  meta: NetworkRequestMeta;
  requestTimestamp?: number;
  responseTimestamp?: number;
  loadingFinished?: boolean;
  failed?: boolean;
  error?: string;
}

interface NetworkRequestReadOptions {
  redacted?: boolean;
}

const MAX_BODY_LENGTH = 12000;
const MAX_CACHED_REQUESTS = 1000;
const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const MAX_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_IDLE_MS = 500;
const MAX_IDLE_MS = 5000;

export class BrowserNetworkRecorder {
  private enabledTabId: number | undefined;
  private readonly requestsById = new Map<string, CachedNetworkRequest>();
  private readonly waiters = new Set<{
    filter: NetworkWaitFilter;
    options: NetworkRequestReadOptions;
    resolve: (requests: NetworkRequestMeta[]) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly handleEvent = (method: string, params?: Record<string, unknown>) => {
    this.handleNetworkEvent(method, params);
  };

  constructor(private readonly connection: BrowserNetworkConnection) {}

  get isEnabled(): boolean {
    return this.enabledTabId !== undefined;
  }

  start(tabId: number): void {
    this.stop();
    this.enabledTabId = tabId;
    this.connection.addEventListener(this.handleEvent);
  }

  stop(): void {
    if (this.enabledTabId === undefined) {
      return;
    }

    this.connection.removeEventListener(this.handleEvent);
    this.enabledTabId = undefined;
    this.clear();
    this.resolveWaiters([]);
  }

  clear(): void {
    this.requestsById.clear();
  }

  listRequests(filter: NetworkRequestFilter = {}, options: NetworkRequestReadOptions = {}): NetworkRequestMeta[] {
    const requests = Array.from(this.requestsById.values()).map((cached) => options.redacted === false ? { ...cached.meta } : redactNetworkRequestMeta(cached.meta));
    const filtered = requests.filter((request) => matchesFilter(request, filter));
    const limit = normalizeLimit(filter.limit) ?? DEFAULT_LIST_LIMIT;
    return filtered.slice(-limit);
  }

  getRawRequestMeta(requestId: string): NetworkRequestMeta | undefined {
    const cached = this.requestsById.get(requestId);
    return cached ? { ...cached.meta } : undefined;
  }

  async getDetails(requestIds: string[], options: { redacted?: boolean } = {}): Promise<NetworkRequestDetail[]> {
    const details: NetworkRequestDetail[] = [];
    for (const requestId of requestIds) {
      const cached = this.requestsById.get(requestId);
      if (!cached) {
        continue;
      }

      const responseBody = shouldReadResponseBody(cached.meta) ? await this.readResponseBody(requestId) : undefined;
      const detail = {
        ...cached.meta,
        responseBody: responseBody?.body,
        responseBodyEncoding: responseBody?.encoding,
        truncated: Boolean(responseBody?.truncated),
        redacted: false,
      };
      details.push(options.redacted === false ? detail : redactNetworkRequestDetail(detail));
    }

    return details;
  }

  waitForRequests(filter: NetworkWaitFilter = {}, options: NetworkRequestReadOptions = {}): Promise<NetworkRequestMeta[]> {
    const existing = this.listRequests(filter, options);
    if (existing.length > 0) {
      return Promise.resolve(existing);
    }

    const timeoutMs = normalizeTimeout(filter.timeoutMs);
    return new Promise((resolve) => {
      const waiter = {
        filter,
        options,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve([]);
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  waitForIdle(options: NetworkIdleWaitOptions = {}): Promise<{ ok: true; idleMs: number } | { ok: false; message: string }> {
    const idleMs = normalizeIdleMs(options.idleMs);
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    return new Promise((resolve) => {
      let done = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        done = true;
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        this.connection.removeEventListener(listener);
      };
      const finishIdle = () => {
        if (done) {
          return;
        }
        cleanup();
        resolve({ ok: true, idleMs });
      };
      const scheduleIdleCheck = () => {
        if (done) {
          return;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        if (this.getPendingRequestCount() > 0) {
          return;
        }
        idleTimer = setTimeout(finishIdle, idleMs);
      };
      const listener = (method: string) => {
        if (method === "Network.requestWillBeSent" || method === "Network.responseReceived" || method === "Network.loadingFinished" || method === "Network.loadingFailed") {
          scheduleIdleCheck();
        }
      };
      timeoutTimer = setTimeout(() => {
        if (done) {
          return;
        }
        const pendingCount = this.getPendingRequestCount();
        cleanup();
        resolve({ ok: false, message: `等待 Network 空闲超时，仍有 ${pendingCount} 个请求进行中。` });
      }, timeoutMs);
      this.connection.addEventListener(listener);
      scheduleIdleCheck();
    });
  }

  getPendingRequestCount(): number {
    return Array.from(this.requestsById.values()).filter((request) => !request.loadingFinished && !request.failed).length;
  }

  private handleNetworkEvent(method: string, params: Record<string, unknown> | undefined): void {
    if (!params) {
      return;
    }

    if (method === "Network.requestWillBeSent") {
      this.handleRequestWillBeSent(params);
      return;
    }

    if (method === "Network.responseReceived") {
      this.handleResponseReceived(params);
      return;
    }

    if (method === "Network.loadingFinished") {
      this.handleLoadingFinished(params);
      return;
    }

    if (method === "Network.loadingFailed") {
      this.handleLoadingFailed(params);
    }
  }

  private handleRequestWillBeSent(params: Record<string, unknown>): void {
    const requestId = normalizeString(params.requestId);
    const request = normalizeRecord(params.request);
    if (!requestId || !request) {
      return;
    }

    const timestamp = normalizeNumber(params.timestamp);
    const wallTime = normalizeNumber(params.wallTime);
    const meta: NetworkRequestMeta = {
      id: requestId,
      url: normalizeString(request.url),
      method: normalizeString(request.method) || "GET",
      resourceType: normalizeString(params.type),
      startedAt: wallTime ? new Date(wallTime * 1000).toISOString() : undefined,
      requestHeaders: normalizeHeaders(request.headers),
      requestBody: truncateOptional(normalizeString(request.postData)),
      failed: false,
    };

    this.requestsById.set(requestId, { meta, requestTimestamp: timestamp });
    this.trimCachedRequests();
    this.resolveMatchingWaiters();
  }

  private handleResponseReceived(params: Record<string, unknown>): void {
    const requestId = normalizeString(params.requestId);
    const cached = requestId ? this.requestsById.get(requestId) : undefined;
    const response = normalizeRecord(params.response);
    if (!cached || !response) {
      return;
    }

    cached.responseTimestamp = normalizeNumber(params.timestamp);
    cached.meta = {
      ...cached.meta,
      status: normalizeNumber(response.status),
      statusText: normalizeString(response.statusText),
      mimeType: normalizeString(response.mimeType),
      resourceType: normalizeString(params.type) || cached.meta.resourceType,
      responseHeaders: normalizeHeaders(response.headers),
    };
    this.resolveMatchingWaiters();
  }

  private handleLoadingFinished(params: Record<string, unknown>): void {
    const requestId = normalizeString(params.requestId);
    const cached = requestId ? this.requestsById.get(requestId) : undefined;
    if (!cached) {
      return;
    }

    cached.loadingFinished = true;
    const finishedTimestamp = normalizeNumber(params.timestamp);
    if (cached.requestTimestamp !== undefined && finishedTimestamp !== undefined) {
      cached.meta = {
        ...cached.meta,
        durationMs: Math.max(0, Math.round((finishedTimestamp - cached.requestTimestamp) * 1000)),
      };
    }
    this.resolveMatchingWaiters();
  }

  private handleLoadingFailed(params: Record<string, unknown>): void {
    const requestId = normalizeString(params.requestId);
    const cached = requestId ? this.requestsById.get(requestId) : undefined;
    if (!cached) {
      return;
    }

    cached.failed = true;
    cached.error = normalizeString(params.errorText);
    cached.meta = {
      ...cached.meta,
      failed: true,
      error: cached.error,
    };
    this.resolveMatchingWaiters();
  }

  private async readResponseBody(requestId: string): Promise<{ body?: string; encoding?: string; truncated: boolean } | undefined> {
    try {
      const response = await this.connection.getResponseBody(requestId);
      const rawBody = response.body ?? "";
      const body = response.base64Encoded ? decodeBase64(rawBody) : rawBody;
      const truncated = truncateText(body, MAX_BODY_LENGTH);
      return {
        body: truncated.text,
        encoding: response.base64Encoded ? "base64" : "utf-8",
        truncated: truncated.truncated,
      };
    } catch {
      return undefined;
    }
  }

  private resolveMatchingWaiters(): void {
    for (const waiter of Array.from(this.waiters)) {
      const requests = this.listRequests(waiter.filter, waiter.options);
      if (requests.length === 0) {
        continue;
      }

      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(requests);
    }
  }

  private resolveWaiters(requests: NetworkRequestMeta[]): void {
    for (const waiter of Array.from(this.waiters)) {
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(requests);
    }
  }

  private trimCachedRequests(): void {
    while (this.requestsById.size > MAX_CACHED_REQUESTS) {
      const oldestRequestId = this.findOldestFinishedRequestId() ?? this.requestsById.keys().next().value;
      if (typeof oldestRequestId !== "string") {
        return;
      }
      this.requestsById.delete(oldestRequestId);
    }
  }

  private findOldestFinishedRequestId(): string | undefined {
    for (const [requestId, cached] of this.requestsById) {
      if (cached.loadingFinished || cached.failed || cached.meta.status !== undefined) {
        return requestId;
      }
    }
    return undefined;
  }
}

function matchesFilter(request: NetworkRequestMeta, filter: NetworkRequestFilter): boolean {
  if (filter.urlIncludes && !request.url.includes(filter.urlIncludes)) {
    return false;
  }
  if (filter.method && request.method.toUpperCase() !== filter.method.toUpperCase()) {
    return false;
  }
  if (filter.resourceType && request.resourceType?.toLowerCase() !== filter.resourceType.toLowerCase()) {
    return false;
  }
  if (filter.status !== undefined && request.status !== filter.status) {
    return false;
  }
  return true;
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_CACHED_REQUESTS);
}

function normalizeTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WAIT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(value), MAX_WAIT_TIMEOUT_MS);
}

function normalizeIdleMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_IDLE_MS;
  }
  return Math.min(Math.floor(value), MAX_IDLE_MS);
}

function shouldReadResponseBody(meta: NetworkRequestMeta): boolean {
  const mimeType = meta.mimeType?.toLowerCase() ?? "";
  const resourceType = meta.resourceType?.toLowerCase() ?? "";
  const url = meta.url.toLowerCase();
  if (resourceType && ["image", "media", "font"].includes(resourceType)) {
    return false;
  }
  if (/^(image|audio|video|font)\//.test(mimeType) || mimeType === "application/octet-stream" || mimeType === "application/pdf" || mimeType.includes("zip")) {
    return false;
  }
  if (/\.(png|jpe?g|gif|webp|avif|ico|svg|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf|pdf|zip|rar|7z)(?:[?#]|$)/i.test(url)) {
    return false;
  }
  return true;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeHeaders(value: unknown): NetworkHeader[] | undefined {
  const headers = normalizeRecord(value);
  if (!headers) {
    return undefined;
  }

  const result = Object.entries(headers)
    .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
    .map(([name, headerValue]) => ({ name, value: truncateText(headerValue, MAX_BODY_LENGTH).text }));
  return result.length ? result : undefined;
}

function truncateOptional(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return truncateText(value, MAX_BODY_LENGTH).text;
}

function decodeBase64(value: string): string {
  try {
    return atob(value);
  } catch {
    return value;
  }
}
