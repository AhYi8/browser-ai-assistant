import type { ChatSession, ChatTokenUsage, ChatTokenUsageEntry, ChatTokenUsageSource, EndpointType } from "../types";

const EMPTY_TOKEN_USAGE: ChatTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
const TOKEN_USAGE_SCHEMA_VERSION = 1;

export function createEmptyTokenUsage(): ChatTokenUsage {
  return { ...EMPTY_TOKEN_USAGE };
}

export function createTokenUsageEntry(input: {
  usage: ChatTokenUsage;
  source: ChatTokenUsageSource;
  modelId: string;
  endpointType: EndpointType;
  createdAt?: number;
}): ChatTokenUsageEntry | undefined {
  const usage = normalizeTokenUsage(input.usage);
  if (!hasTokenUsage(usage)) {
    return undefined;
  }

  const createdAt = input.createdAt ?? Date.now();
  return {
    id: `token-usage-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    usageSchemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
    source: input.source,
    modelId: input.modelId,
    endpointType: input.endpointType,
    createdAt,
    ...usage,
  };
}

export function normalizeTokenUsage(value: Partial<ChatTokenUsage> | undefined): ChatTokenUsage {
  return {
    inputTokens: normalizeTokenCount(value?.inputTokens),
    outputTokens: normalizeTokenCount(value?.outputTokens),
    cacheWriteTokens: normalizeTokenCount(value?.cacheWriteTokens),
    cacheReadTokens: normalizeTokenCount(value?.cacheReadTokens),
  };
}

export function normalizeTokenUsageEntries(value: unknown): ChatTokenUsageEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((item): ChatTokenUsageEntry | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const source = item as Partial<ChatTokenUsageEntry>;
      if (!source.id || typeof source.id !== "string" || !isValidTokenUsageSource(source.source) || source.usageSchemaVersion !== TOKEN_USAGE_SCHEMA_VERSION) {
        return undefined;
      }

      const usage = normalizeTokenUsage(source);
      if (!hasTokenUsage(usage)) {
        return undefined;
      }

      return {
        id: source.id,
        usageSchemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
        source: source.source,
        modelId: typeof source.modelId === "string" ? source.modelId : "",
        endpointType: source.endpointType === "anthropic_messages" ? "anthropic_messages" : "openai_chat",
        createdAt: normalizeTimestamp(source.createdAt),
        ...usage,
      };
    })
    .filter((item): item is ChatTokenUsageEntry => Boolean(item));

  return entries.length ? entries : undefined;
}

export function sumSessionTokenUsage(session: ChatSession | undefined): ChatTokenUsage {
  return sumTokenUsageEntries(session?.tokenUsageEntries);
}

export function sumTokenUsageEntries(entries: ChatTokenUsageEntry[] | undefined): ChatTokenUsage {
  return sumTokenUsages((entries ?? []).filter(isCurrentTokenUsageEntry));
}

export function mergeTokenUsageEntries(
  current: ChatTokenUsageEntry[] | undefined,
  next: ChatTokenUsageEntry[] | undefined,
): ChatTokenUsageEntry[] | undefined {
  const merged = [...(normalizeTokenUsageEntries(current) ?? [])];
  for (const entry of normalizeTokenUsageEntries(next) ?? []) {
    if (!merged.some((item) => item.id === entry.id)) {
      merged.push(entry);
    }
  }
  return merged.length ? merged : undefined;
}

export function sumTokenUsages(usages: Array<Partial<ChatTokenUsage> | undefined>): ChatTokenUsage {
  return usages.reduce<ChatTokenUsage>((total, usage) => addTokenUsage(total, usage), createEmptyTokenUsage());
}

export function addTokenUsage(left: Partial<ChatTokenUsage> | undefined, right: Partial<ChatTokenUsage> | undefined): ChatTokenUsage {
  const normalizedLeft = normalizeTokenUsage(left);
  const normalizedRight = normalizeTokenUsage(right);
  return {
    inputTokens: normalizedLeft.inputTokens + normalizedRight.inputTokens,
    outputTokens: normalizedLeft.outputTokens + normalizedRight.outputTokens,
    cacheWriteTokens: normalizedLeft.cacheWriteTokens + normalizedRight.cacheWriteTokens,
    cacheReadTokens: normalizedLeft.cacheReadTokens + normalizedRight.cacheReadTokens,
  };
}

export function maxTokenUsage(left: Partial<ChatTokenUsage> | undefined, right: Partial<ChatTokenUsage> | undefined): ChatTokenUsage {
  const normalizedLeft = normalizeTokenUsage(left);
  const normalizedRight = normalizeTokenUsage(right);
  return {
    inputTokens: Math.max(normalizedLeft.inputTokens, normalizedRight.inputTokens),
    outputTokens: Math.max(normalizedLeft.outputTokens, normalizedRight.outputTokens),
    cacheWriteTokens: Math.max(normalizedLeft.cacheWriteTokens, normalizedRight.cacheWriteTokens),
    cacheReadTokens: Math.max(normalizedLeft.cacheReadTokens, normalizedRight.cacheReadTokens),
  };
}

export function hasTokenUsage(usage: Partial<ChatTokenUsage> | undefined): boolean {
  const normalized = normalizeTokenUsage(usage);
  return normalized.inputTokens > 0 || normalized.outputTokens > 0 || normalized.cacheWriteTokens > 0 || normalized.cacheReadTokens > 0;
}

export function normalizeModelTokenUsage(data: unknown): ChatTokenUsage | undefined {
  const source = getUsageSource(data);
  if (!source) {
    return undefined;
  }

  const openAICachedTokens = readNestedOptionalTokenCount(source, ["prompt_tokens_details", "cached_tokens"]);
  const deepSeekCacheReadTokens = readOptionalTokenCount(source, "prompt_cache_hit_tokens");
  const deepSeekCacheMissTokens = readOptionalTokenCount(source, "prompt_cache_miss_tokens");
  const cacheReadTokens = deepSeekCacheReadTokens ?? openAICachedTokens ?? readOptionalTokenCount(source, "cache_read_input_tokens") ?? 0;
  const cacheWriteTokens = readOptionalTokenCount(source, "cache_creation_input_tokens") ?? 0;
  const promptTokens = readOptionalTokenCount(source, "prompt_tokens") ?? 0;
  const inputTokens = deepSeekCacheMissTokens ?? readOptionalTokenCount(source, "input_tokens") ?? Math.max(0, promptTokens - cacheReadTokens);
  const outputTokens = readOptionalTokenCount(source, "completion_tokens") ?? readOptionalTokenCount(source, "output_tokens") ?? 0;

  const usage = normalizeTokenUsage({
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  });

  return hasTokenUsage(usage) ? usage : undefined;
}

function getUsageSource(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const source = data as Record<string, unknown>;
  if (source.usage && typeof source.usage === "object" && !Array.isArray(source.usage)) {
    return source.usage as Record<string, unknown>;
  }

  // Anthropic 流式 message_start 事件会把 usage 放在 message 内。
  if (source.message && typeof source.message === "object" && !Array.isArray(source.message)) {
    const message = source.message as Record<string, unknown>;
    if (message.usage && typeof message.usage === "object" && !Array.isArray(message.usage)) {
      return message.usage as Record<string, unknown>;
    }
  }

  return undefined;
}

function readNestedOptionalTokenCount(source: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return normalizeOptionalTokenCount(current);
}

function readOptionalTokenCount(source: Record<string, unknown>, key: string): number | undefined {
  return key in source ? normalizeOptionalTokenCount(source[key]) : undefined;
}

function normalizeOptionalTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function normalizeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isValidTokenUsageSource(value: unknown): value is ChatTokenUsageSource {
  return value === "chat" || value === "tool_decision" || value === "tool_final" || value === "title";
}

function isCurrentTokenUsageEntry(value: ChatTokenUsageEntry): boolean {
  return value.usageSchemaVersion === TOKEN_USAGE_SCHEMA_VERSION;
}
