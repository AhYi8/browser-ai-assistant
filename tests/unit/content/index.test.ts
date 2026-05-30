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

  it("收到自动化点击动作后触发目标元素并返回最新 HTML", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;
    document.body.innerHTML = '<button id="next">下一页</button><main>第一页</main>';
    const button = document.querySelector("#next") as HTMLButtonElement;
    button.addEventListener("click", () => {
      document.querySelector("main")!.textContent = "第二页";
    });

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
        type: "automation.executeDomAction",
        action: { type: "click", selector: "#next" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          html: expect.stringContaining("第二页"),
        }),
      );
    });
  });

  it("拒绝缺少选择器的自动化点击动作", async () => {
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
    registeredListener?.(
      {
        type: "automation.executeDomAction",
        action: { type: "click" },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "自动化动作缺少选择器",
      });
    });
  });
});
