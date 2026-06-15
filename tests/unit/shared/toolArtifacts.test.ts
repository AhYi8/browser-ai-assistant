import { describe, expect, it } from "vitest";
import { collectMessageToolAttachments, collectRawMessageToolAttachments, formatToolAttachmentForExport, formatToolAttachmentForPrompt, normalizeToolAttachment } from "../../../src/shared/toolArtifacts";
import type { ChatMessage } from "../../../src/shared/types";

function createAssistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "已结合工具结果回答。",
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
    ...partial,
  };
}

describe("通用工具附件聚合", () => {
  it("会把同一条消息里的多次 Tavily 工具结果聚合成一个网络搜索附件", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-1",
          toolId: "web_search.tavily",
          name: "tavily_search",
          displayName: "Tavily 搜索",
          arguments: { query: "Tavily API" },
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-2",
          toolId: "web_search.tavily",
          name: "tavily_search",
          displayName: "Tavily 搜索",
          arguments: { query: "Chrome 扩展" },
          status: "success",
          startedAt: 2,
          completedAt: 3,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-search-1",
          kind: "web-search",
          title: "网络搜索结果",
          summary: "搜索问题：Tavily API",
          sourceToolCallId: "call-1",
          createdAt: 2,
          redacted: false,
          truncated: false,
          provider: "tavily",
          query: "Tavily API",
          answer: "答案 A",
          results: [
            { title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "Search endpoint." },
            { title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "重复结果会被去重。" },
          ],
        },
        {
          id: "attachment-search-2",
          kind: "web-search",
          title: "网络搜索结果",
          summary: "搜索问题：Chrome 扩展",
          sourceToolCallId: "call-2",
          createdAt: 3,
          redacted: false,
          truncated: true,
          provider: "tavily",
          query: "Chrome 扩展",
          answer: "答案 B",
          results: [{ title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "Chrome extension docs." }],
        },
      ],
    });

    const attachments = collectMessageToolAttachments(message);

    expect(collectRawMessageToolAttachments(message)).toHaveLength(2);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: "web-search",
      title: "网络搜索结果",
      query: "Tavily API；Chrome 扩展",
      answer: "答案 A\n\n答案 B",
      createdAt: 3,
      truncated: true,
    });
    expect(attachments[0]).toHaveProperty("results", [
      { title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "Search endpoint." },
      { title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "Chrome extension docs." },
    ]);
  });

  it("会把同一工具的通用附件合并为一个附件", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-1",
          toolId: "page.context",
          name: "read_page_context",
          displayName: "页面上下文",
          arguments: {},
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-2",
          toolId: "page.context",
          name: "read_page_context",
          displayName: "页面上下文",
          arguments: {},
          status: "success",
          startedAt: 3,
          completedAt: 4,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-page-1",
          kind: "page-context",
          title: "页面上下文",
          summary: "首页标题",
          sourceToolCallId: "call-1",
          createdAt: 2,
          redacted: true,
          truncated: false,
          details: "标题：首页",
        },
        {
          id: "attachment-page-2",
          kind: "page-context",
          title: "页面上下文",
          summary: "正文摘要",
          sourceToolCallId: "call-2",
          createdAt: 4,
          redacted: true,
          truncated: false,
          details: "正文：欢迎使用",
        },
      ],
    });

    expect(collectMessageToolAttachments(message)).toEqual([
      expect.objectContaining({
        kind: "page-context",
        title: "页面上下文",
        summary: "首页标题\n正文摘要",
        details: "标题：首页\n\n正文：欢迎使用",
        createdAt: 4,
      }),
    ]);
  });

  it("不同工具即使产出相同 kind 的附件也不会合并", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-page",
          toolId: "page.context",
          name: "read_page_context",
          displayName: "页面上下文",
          arguments: {},
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-tabs",
          toolId: "tabs.context",
          name: "read_tabs_context",
          displayName: "多标签页上下文",
          arguments: {},
          status: "success",
          startedAt: 3,
          completedAt: 4,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-page",
          kind: "page-context",
          title: "页面上下文",
          summary: "当前页",
          sourceToolCallId: "call-page",
          createdAt: 2,
          redacted: true,
          truncated: false,
          details: "当前页内容",
        },
        {
          id: "attachment-tabs",
          kind: "page-context",
          title: "页面上下文",
          summary: "多标签页",
          sourceToolCallId: "call-tabs",
          createdAt: 4,
          redacted: true,
          truncated: false,
          details: "多标签页内容",
        },
      ],
    });

    expect(collectMessageToolAttachments(message)).toEqual([
      expect.objectContaining({ id: "attachment-page", summary: "当前页" }),
      expect.objectContaining({ id: "attachment-tabs", summary: "多标签页" }),
    ]);
  });

  it("只通过工具记录 attachmentIds 关联附件时也按工具聚合", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-page-1",
          toolId: "page.context",
          name: "read_page_context",
          displayName: "页面上下文",
          arguments: {},
          status: "success",
          startedAt: 1,
          completedAt: 2,
          attachmentIds: ["attachment-page-1"],
        },
        {
          id: "call-page-2",
          toolId: "page.context",
          name: "read_page_context",
          displayName: "页面上下文",
          arguments: {},
          status: "success",
          startedAt: 3,
          completedAt: 4,
          attachmentIds: ["attachment-page-2"],
        },
        {
          id: "call-tabs",
          toolId: "tabs.context",
          name: "read_tabs_context",
          displayName: "多标签页上下文",
          arguments: {},
          status: "success",
          startedAt: 5,
          completedAt: 6,
          attachmentIds: ["attachment-tabs"],
        },
      ],
      toolAttachments: [
        {
          id: "attachment-page-1",
          kind: "page-context",
          title: "页面上下文",
          summary: "首页标题",
          createdAt: 2,
          redacted: true,
          truncated: false,
          details: "标题：首页",
        },
        {
          id: "attachment-page-2",
          kind: "page-context",
          title: "页面上下文",
          summary: "正文摘要",
          createdAt: 4,
          redacted: true,
          truncated: false,
          details: "正文：欢迎使用",
        },
        {
          id: "attachment-tabs",
          kind: "page-context",
          title: "页面上下文",
          summary: "多标签页",
          createdAt: 6,
          redacted: true,
          truncated: false,
          details: "多标签页内容",
        },
      ],
    });

    expect(collectMessageToolAttachments(message)).toEqual([
      expect.objectContaining({
        kind: "page-context",
        summary: "首页标题\n正文摘要",
        details: "标题：首页\n\n正文：欢迎使用",
      }),
      expect.objectContaining({
        id: "attachment-tabs",
        summary: "多标签页",
      }),
    ]);
  });

  it("同一工具产出不同 kind 的附件时会聚合为一个通用附件", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-analyze-1",
          toolId: "page.analyzer",
          name: "analyze_page",
          displayName: "页面分析",
          arguments: {},
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-analyze-2",
          toolId: "page.analyzer",
          name: "analyze_page",
          displayName: "页面分析",
          arguments: {},
          status: "success",
          startedAt: 3,
          completedAt: 4,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-page",
          kind: "page-context",
          title: "页面上下文",
          summary: "页面标题",
          sourceToolCallId: "call-analyze-1",
          createdAt: 2,
          redacted: true,
          truncated: false,
          details: "标题：首页",
        },
        {
          id: "attachment-network",
          kind: "network",
          title: "Network 请求详情",
          summary: "1 条请求",
          sourceToolCallId: "call-analyze-2",
          createdAt: 4,
          redacted: true,
          truncated: false,
          requests: [
            {
              id: "request-1",
              url: "https://example.com/api",
              method: "GET",
              redacted: true,
              truncated: false,
            },
          ],
        },
      ],
    });

    expect(collectMessageToolAttachments(message)).toEqual([
      expect.objectContaining({
        kind: "tool-result-set",
        title: "页面分析结果",
        summary: "页面标题\n1 条请求",
        createdAt: 4,
        redacted: true,
      }),
    ]);
  });

  it("读取原始附件时不会再消费旧版网络搜索字段", () => {
    const message = createAssistantMessage({
      toolAttachments: [
        {
          id: "tool-attachment-network-1",
          kind: "network",
          title: "Network 请求详情",
          summary: "1 条请求",
          createdAt: 1,
          redacted: true,
          truncated: false,
          requests: [
            {
              id: "request-1",
              url: "https://example.com/api",
              method: "GET",
              redacted: true,
              truncated: false,
            },
          ],
        },
      ],
      // 旧版 Tavily 字段已经退出消息协议；脏历史数据即使存在也不应重新进入展示、导出或后续追问。
      webSearchContextAttachment: {
        provider: "tavily",
        query: "Chrome Extension",
        answer: "搜索答案",
        results: [{ title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "扩展文档" }],
        createdAt: 2,
        truncated: false,
      },
    } as unknown as ChatMessage);

    const attachments = collectRawMessageToolAttachments(message);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ kind: "network" });
  });

  it("归一化通用附件详情被截断时会标记 truncated", () => {
    const longDetails = "长详情".repeat(1600);
    const attachment = normalizeToolAttachment({
      id: "attachment-generic-long",
      kind: "page-context",
      title: "页面上下文",
      summary: "长详情摘要",
      createdAt: 1,
      redacted: true,
      truncated: false,
      details: longDetails,
    });

    expect(attachment).toBeDefined();
    if (!attachment) {
      throw new Error("通用附件归一化结果不应为空");
    }
    expect(attachment).toMatchObject({
      kind: "page-context",
      truncated: true,
    });
    expect("details" in attachment && attachment.details?.length).toBeLessThan(longDetails.length);
  });

  it("归一化并聚合 JS 源码附件，导出和后续追问保留片段上下文", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-js-1",
          toolId: "js.search_sources",
          name: "js_search_sources",
          displayName: "搜索 JS 源码",
          arguments: { keywords: ["/api/search"] },
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-js-2",
          toolId: "js.search_sources",
          name: "js_search_sources",
          displayName: "搜索 JS 源码",
          arguments: { keywords: ["sign"] },
          status: "success",
          startedAt: 3,
          completedAt: 4,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-js-1",
          kind: "js-source",
          title: "JS 源码片段",
          summary: "JS 资源 1 个",
          sourceToolCallId: "call-js-1",
          createdAt: 2,
          redacted: true,
          truncated: false,
          query: ["/api/search"],
          resources: [
            {
              id: "script-1",
              source: "network",
              url: "https://example.com/app.js",
              mimeType: "application/javascript",
              size: 120,
              searchable: true,
              redacted: true,
              truncated: false,
            },
          ],
          jsMatches: [
            {
              resourceId: "script-1",
              source: "network",
              url: "https://example.com/app.js",
              term: "/api/search",
              position: 10,
              line: 1,
              column: 11,
              snippet: "fetch('/api/search')",
              redacted: true,
              truncated: false,
            },
          ],
          contexts: [],
          failedFetches: [],
        },
        {
          id: "attachment-js-2",
          kind: "js-source",
          title: "JS 源码片段",
          summary: "JS 上下文 1 个",
          sourceToolCallId: "call-js-2",
          createdAt: 4,
          redacted: true,
          truncated: true,
          query: ["sign"],
          resources: [],
          jsMatches: [],
          contexts: [
            {
              resourceId: "script-1",
              source: "network",
              url: "https://example.com/app.js",
              position: 20,
              line: 2,
              column: 5,
              snippet: "function sign(){ return '[已脱敏]'; }",
              redacted: true,
              truncated: true,
            },
          ],
          failedFetches: [{ url: "https://example.com/missing.js", message: "同源 JS 补位读取失败。" }],
        },
      ],
    });

    const [attachment] = collectMessageToolAttachments(message);

    expect(attachment).toMatchObject({
      kind: "js-source",
      title: "JS 源码片段",
      truncated: true,
      query: ["/api/search", "sign"],
    });
    expect(formatToolAttachmentForPrompt(attachment)).toContain("后续追问需要继续参考以下历史 JS 源码片段");
    expect(formatToolAttachmentForExport(attachment)).toContain("fetch('/api/search')");
    expect(formatToolAttachmentForExport(attachment)).toContain("同源 JS 补位读取失败");
  });

  it("同一消息内多个 JS 源码附件按结构化数据聚合，不降级为通用附件", () => {
    const message = createAssistantMessage({
      toolAttachments: [
        {
          id: "attachment-js-a",
          kind: "js-source",
          title: "JS 源码片段",
          summary: "a",
          createdAt: 1,
          redacted: true,
          truncated: false,
          resources: [
            {
              id: "script-a",
              source: "network",
              url: "https://example.com/a.js",
              size: 1,
              searchable: true,
              redacted: true,
              truncated: false,
            },
          ],
          jsMatches: [],
          contexts: [],
          failedFetches: [],
        },
        {
          id: "attachment-js-b",
          kind: "js-source",
          title: "JS 源码片段",
          summary: "b",
          createdAt: 2,
          redacted: true,
          truncated: false,
          resources: [
            {
              id: "script-b",
              source: "same-origin-fetch",
              url: "https://example.com/b.js",
              size: 1,
              searchable: true,
              redacted: true,
              truncated: false,
            },
          ],
          jsMatches: [],
          contexts: [],
          failedFetches: [],
        },
      ],
    });

    const [attachment] = collectMessageToolAttachments(message);

    expect(attachment).toMatchObject({
      kind: "js-source",
      resources: [
        expect.objectContaining({ id: "script-a" }),
        expect.objectContaining({ id: "script-b" }),
      ],
    });
    expect(attachment).not.toHaveProperty("details");
  });
  it("归一化空结果 JS 源码附件时会保留工具调用归属", () => {
    const attachment = normalizeToolAttachment({
      id: "attachment-js-empty",
      kind: "js-source",
      title: "JS 源码片段",
      summary: "没有找到 JS 源码命中",
      sourceToolCallId: "call-js-empty",
      createdAt: 10,
      redacted: true,
      truncated: false,
      resources: [],
      jsMatches: [],
      contexts: [],
      failedFetches: [],
    });

    expect(attachment).toMatchObject({
      id: "attachment-js-empty",
      kind: "js-source",
      title: "JS 源码片段",
      summary: "没有找到 JS 源码命中",
      sourceToolCallId: "call-js-empty",
      resources: [],
      jsMatches: [],
      contexts: [],
      failedFetches: [],
    });
  });
});
