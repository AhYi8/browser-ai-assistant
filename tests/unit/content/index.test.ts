import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionRule } from "../../../src/shared/types";

function createRule(): ExtractionRule {
  return {
    id: "rule-1",
    alias: "正文",
    urlPattern: "https://example.com/.*",
    selectorsText: "main",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("content 脚本消息", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head><title>Test Page</title></head><body><main>正文内容</main></body>";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://example.com/article"),
    });
  });

  it("收到提取消息后返回当前页提取结果", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    const keepChannelOpen = registeredListener?.(
      {
        type: "pageContext.extract",
        rules: [createRule()],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      url: "https://example.com/article",
      title: "Test Page",
      text: "正文内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("收到提取所有模式消息后返回当前页 HTML", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    const keepChannelOpen = registeredListener?.(
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 500,
        extractMode: "all",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        url: "https://example.com/article",
        title: "Test Page",
        truncated: false,
        usedFallback: true,
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("<main>正文内容</main>"),
      }),
    );
  });
});
