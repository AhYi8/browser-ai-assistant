export const DEFAULT_MODEL_REQUEST_RETRY_COUNT = 5;

const RETRYABLE_STATUS_CODES = new Set([408, 429]);
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;
const RETRY_DELAY_JITTER_RATIO = 0.2;

export interface ModelRequestRetryOptions<T = unknown> {
  delay?: (durationMs: number) => Promise<void> | void;
  random?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetryResult?: (result: T) => boolean;
  onRetryResult?: (result: T) => Promise<void> | void;
}

export function normalizeModelRequestRetryCount(value: unknown, fallback = DEFAULT_MODEL_REQUEST_RETRY_COUNT): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.round(Math.min(20, Math.max(0, numberValue)));
}

export async function withModelRequestRetry<T>(operation: () => Promise<T>, retryCount: number, options: ModelRequestRetryOptions<T> = {}): Promise<T> {
  const normalizedRetryCount = normalizeModelRequestRetryCount(retryCount);
  const maxAttempts = normalizedRetryCount + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      if (!shouldRetryOperationResult(result, options) || attempt === maxAttempts) {
        return result;
      }
      await options.onRetryResult?.(result);
      await waitBeforeRetry(attempt, result, options);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
      await waitBeforeRetry(attempt, undefined, options);
    }
  }

  throw lastError;
}

function shouldRetryOperationResult<T>(result: T, options: ModelRequestRetryOptions<T>): boolean {
  return options.shouldRetryResult?.(result) ?? shouldRetryResponseResult(result);
}

export function shouldRetryModelResponse(result: unknown): boolean {
  return shouldRetryResponseResult(result);
}

function shouldRetryResponseResult(result: unknown): boolean {
  if (typeof Response === "undefined" || !(result instanceof Response)) {
    return false;
  }

  return RETRYABLE_STATUS_CODES.has(result.status) || result.status >= 500;
}

async function waitBeforeRetry<T>(attempt: number, result: T | undefined, options: ModelRequestRetryOptions<T>): Promise<void> {
  const delay = options.delay ?? defaultDelay;
  const durationMs = resolveRetryDelayMs(attempt, result, options);
  await delay(durationMs);
}

function resolveRetryDelayMs<T>(attempt: number, result: T | undefined, options: ModelRequestRetryOptions<T>): number {
  const retryAfterDelayMs = parseRetryAfterDelayMs(result);
  if (retryAfterDelayMs !== undefined) {
    // 远端明确要求等待时优先尊重 Retry-After，避免限流时立即重试继续放大失败。
    return Math.min(retryAfterDelayMs, options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS);
  }

  const baseDelayMs = normalizeDelayBoundary(options.baseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS);
  const maxDelayMs = normalizeDelayBoundary(options.maxDelayMs, DEFAULT_RETRY_MAX_DELAY_MS);
  const exponentialDelayMs = Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs);
  const random = options.random ?? Math.random;
  // 抖动用于错开多个并发请求的重试时刻，减少同一时间再次打满上游限流。
  const jitterMs = Math.round(exponentialDelayMs * RETRY_DELAY_JITTER_RATIO * Math.max(0, Math.min(1, random())));

  return Math.min(exponentialDelayMs + jitterMs, maxDelayMs);
}

function parseRetryAfterDelayMs(result: unknown): number | undefined {
  if (typeof Response === "undefined" || !(result instanceof Response)) {
    return undefined;
  }

  const retryAfter = result.headers.get("Retry-After");
  if (!retryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAfterTimestamp = Date.parse(retryAfter);
  if (!Number.isFinite(retryAfterTimestamp)) {
    return undefined;
  }

  return Math.max(0, retryAfterTimestamp - Date.now());
}

function normalizeDelayBoundary(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return numberValue;
}

function defaultDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
