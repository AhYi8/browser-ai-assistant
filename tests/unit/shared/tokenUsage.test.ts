import { describe, expect, it } from "vitest";
import {
  mergeTokenUsageEntries,
  normalizeModelTokenUsage,
  normalizeTokenUsageEntries,
  sumTokenUsageEntries,
  sumTokenUsages,
} from "../../../src/shared/chat/tokenUsage";

describe("Token 用量归一化", () => {
  it("归一化 OpenAI-compatible usage 并扣除缓存读取 Token", () => {
    expect(
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: {
            cached_tokens: 50,
          },
        },
      }),
    ).toEqual({
      inputTokens: 70,
      outputTokens: 30,
      cacheWriteTokens: 0,
      cacheReadTokens: 50,
    });
  });

  it("优先按 DeepSeek cache hit/miss 字段统计输入和缓存读取", () => {
    expect(
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 200,
          completion_tokens: 40,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 120,
        },
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      cacheWriteTokens: 0,
      cacheReadTokens: 80,
    });
  });

  it("DeepSeek 未返回 cache miss 时按 cache hit 扣减输入", () => {
    expect(
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 4000,
          completion_tokens: 100,
          prompt_cache_hit_tokens: 1024,
        },
      }),
    ).toEqual({
      inputTokens: 2976,
      outputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 1024,
    });
  });

  it("保留供应商显式返回的 0 值并只在字段缺失时回退", () => {
    expect(
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 120,
          completion_tokens: 0,
          output_tokens: 30,
          prompt_cache_hit_tokens: 0,
          prompt_tokens_details: { cached_tokens: 50 },
        },
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("归一化 Anthropic usage 中的缓存写入和缓存读取", () => {
    expect(
      normalizeModelTokenUsage({
        usage: {
          input_tokens: 90,
          output_tokens: 20,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 40,
        },
      }),
    ).toEqual({
      inputTokens: 90,
      outputTokens: 20,
      cacheWriteTokens: 30,
      cacheReadTokens: 40,
    });
  });

  it("过滤非法历史条目并汇总有效会话用量", () => {
    const entries = normalizeTokenUsageEntries([
      {
        id: "entry-1",
        usageSchemaVersion: 1,
        source: "chat",
        modelId: "model-1",
        endpointType: "openai_chat",
        createdAt: 1,
        inputTokens: 10,
        outputTokens: 2,
        cacheWriteTokens: 0,
        cacheReadTokens: 5,
      },
      {
        id: "entry-empty",
        usageSchemaVersion: 1,
        source: "chat",
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
      { id: "entry-invalid", usageSchemaVersion: 1, source: "unknown", inputTokens: 99 },
      { id: "entry-old-schema", source: "chat", inputTokens: 99, outputTokens: 99 },
    ]);

    expect(sumTokenUsageEntries(entries)).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheWriteTokens: 0,
      cacheReadTokens: 5,
    });
  });

  it("按 id 合并并过滤旧口径 Token 用量条目", () => {
    expect(
      mergeTokenUsageEntries(
        [
          {
            id: "entry-1",
            usageSchemaVersion: 1,
            source: "chat",
            modelId: "model-1",
            endpointType: "openai_chat",
            createdAt: 1,
            inputTokens: 10,
            outputTokens: 2,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
          },
          {
            id: "old-entry",
            source: "chat",
            inputTokens: 99,
            outputTokens: 99,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
          } as never,
        ],
        [
          {
            id: "entry-1",
            usageSchemaVersion: 1,
            source: "chat",
            modelId: "model-1",
            endpointType: "openai_chat",
            createdAt: 2,
            inputTokens: 999,
            outputTokens: 999,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
          },
          {
            id: "entry-2",
            usageSchemaVersion: 1,
            source: "tool_final",
            modelId: "model-1",
            endpointType: "openai_chat",
            createdAt: 3,
            inputTokens: 20,
            outputTokens: 4,
            cacheWriteTokens: 0,
            cacheReadTokens: 5,
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({ id: "entry-1", inputTokens: 10, outputTokens: 2 }),
      expect.objectContaining({ id: "entry-2", inputTokens: 20, outputTokens: 4, cacheReadTokens: 5 }),
    ]);

    expect(mergeTokenUsageEntries(undefined, [])).toBeUndefined();
  });

  it("按供应商 usage 合计标题、工具决策和最终回答的 Token 用量", () => {
    const usages = [
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 87,
          completion_tokens: 118,
          completion_tokens_details: { reasoning_tokens: 111 },
          prompt_tokens_details: { cached_tokens: 0 },
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 87,
        },
      }),
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 2496,
          completion_tokens: 252,
          completion_tokens_details: { reasoning_tokens: 150 },
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
      normalizeModelTokenUsage({
        usage: {
          prompt_tokens: 4034,
          completion_tokens: 495,
          completion_tokens_details: { reasoning_tokens: 224 },
          prompt_tokens_details: { cached_tokens: 2048 },
        },
      }),
    ];

    expect(sumTokenUsages(usages)).toEqual({
      inputTokens: 4569,
      outputTokens: 865,
      cacheWriteTokens: 0,
      cacheReadTokens: 2048,
    });
  });
});
