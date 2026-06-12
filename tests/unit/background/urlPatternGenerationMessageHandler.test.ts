import { describe, expect, it, vi } from "vitest";
import { handleUrlPatternGenerationMessage } from "../../../src/background/urlPatternGenerationMessageHandler";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

function createProvider(): ModelProvider {
  return {
    id: "provider-1",
    name: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createModel(): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "默认模型",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("URL 正则生成消息处理器", () => {
  it("未传 URL 时直接读取当前激活标签页地址", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify([
                "https://example\\.com/news/123",
                "https://example\\.com/news/\\d+",
                "https://example\\.com/news/.*",
                "https://example\\.com/.*",
                "https://.*",
              ]),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/news/123?from=home" }]),
      },
    });

    await handleUrlPatternGenerationMessage(
      {
        type: "extractionRule.generateUrlPatterns",
        provider: createProvider(),
        model: createModel(),
      },
      fetcher as unknown as typeof fetch,
    );

    const requestBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { messages: Array<{ content: string }> };
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(requestBody.messages.at(-1)?.content).toContain("当前 URL：https://example.com/news/123?from=home");
  });

  it("调用模型接口并解析 5 个正则候选", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify([
                "https://example\\.com/news/123",
                "https://example\\.com/news/\\d+",
                "https://example\\.com/news/.*",
                "https://example\\.com/.*",
                "https://.*",
              ]),
            },
          },
        ],
      }),
    });

    const result = await handleUrlPatternGenerationMessage(
      {
        type: "extractionRule.generateUrlPatterns",
        provider: createProvider(),
        model: createModel(),
        url: "https://example.com/news/123?from=home",
      },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      patterns: [
        "https://example\\.com/news/123",
        "https://example\\.com/news/\\d+",
        "https://example\\.com/news/.*",
        "https://example\\.com/.*",
        "https://.*",
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
  });

  it("URL 正则生成遇到可恢复失败时会按配置重试", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 500, statusText: "Server Error" }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(["https://example\\.com/.*"]),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await handleUrlPatternGenerationMessage(
      {
        type: "extractionRule.generateUrlPatterns",
        provider: createProvider(),
        model: createModel(),
        url: "https://example.com/news/123",
        retryCount: 5,
      },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      patterns: ["https://example\\.com/.*"],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
