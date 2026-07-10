import { describe, expect, it } from "vitest";
import { collectMessageToolAttachments, collectRawMessageToolAttachments, createAutomationReportToolAttachment, formatToolAttachmentForExport, formatToolAttachmentForPrompt, formatToolAttachmentForPromptSummary, normalizeToolAttachment, prepareToolAttachmentsForPersistence } from "../../../src/shared/toolArtifacts";
import type { ChatMessage, ChatToolCallRecord } from "../../../src/shared/types";

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

function createToolRecord(partial: Partial<ChatToolCallRecord>): ChatToolCallRecord {
  return {
    id: "call-1",
    toolId: "browser.get_page_state",
    name: "browser_get_page_state",
    displayName: "浏览器页面状态",
    arguments: {},
    status: "success",
    startedAt: 1,
    ...partial,
  };
}

describe("通用工具附件聚合", () => {
  it("共享聚合入口会重新脱敏用户临时允许展示的 Network 附件", () => {
    const message = createAssistantMessage({
      toolAttachments: [
        {
          id: "attachment-network-raw",
          kind: "network",
          title: "Network 请求详情",
          summary: "原始详情",
          sourceToolCallId: "call-network",
          createdAt: 2,
          redacted: false,
          truncated: false,
          requests: [
            {
              id: "req-1",
              url: "https://example.com/login?token=secret",
              method: "POST",
              requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
              requestBody: "{\"password\":\"123456\"}",
              responseBody: "{\"token\":\"secret\",\"ok\":true}",
              redacted: false,
              truncated: false,
            },
          ],
        },
      ],
    });

    const [attachment] = collectMessageToolAttachments(message);

    expect(attachment).toMatchObject({ kind: "network", redacted: true });
    expect(formatToolAttachmentForPrompt(attachment)).not.toContain("123456");
    expect(formatToolAttachmentForPrompt(attachment)).not.toContain("Bearer secret");
    expect(formatToolAttachmentForExport(attachment)).not.toContain("123456");
    expect(formatToolAttachmentForExport(attachment)).not.toContain("Bearer secret");
    expect(formatToolAttachmentForExport(attachment)).toContain("[已脱敏]");
  });

  it("完全访问 Network 附件归一化和聚合后仍保留原文", () => {
    const message = createAssistantMessage({
      toolAttachments: [
        {
          id: "attachment-network-full-access",
          kind: "network",
          title: "Network 请求详情",
          summary: "原始详情",
          sourceToolCallId: "call-network",
          createdAt: 2,
          redacted: false,
          fullAccess: true,
          truncated: false,
          requests: [
            {
              id: "req-1",
              url: "https://example.com/login?token=secret",
              method: "POST",
              requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
              requestBody: "{\"password\":\"123456\"}",
              responseBody: "{\"token\":\"secret\",\"ok\":true}",
              redacted: false,
              truncated: false,
            },
          ],
        },
      ],
    });

    const [attachment] = collectMessageToolAttachments(message);

    expect(attachment).toMatchObject({ kind: "network", redacted: false, fullAccess: true });
    expect(formatToolAttachmentForPrompt(attachment)).toContain("123456");
    expect(formatToolAttachmentForPrompt(attachment)).toContain("Bearer secret");
    expect(formatToolAttachmentForExport(attachment)).toContain("123456");
    expect(formatToolAttachmentForExport(attachment)).toContain("Bearer secret");
    expect(formatToolAttachmentForExport(attachment)).not.toContain("[已脱敏]");
  });

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

  it("自动化报告附件可归一化、导出并用于后续追问上下文", () => {
    const attachment = normalizeToolAttachment({
      id: "automation-report-1",
      kind: "automation-report",
      title: "自动化任务报告",
      summary: "任务报告：总步骤=2，成功=1，失败=1",
      createdAt: 10,
      redacted: true,
      truncated: false,
      objective: "排查登录失败 token=secret",
      conclusion: "发现 Network 500 token=secret",
      fullAccessIncluded: false,
      playbook: {
        playbookId: "site_diagnostics",
        title: "现场诊断",
        source: "builtin",
        confidence: "high",
        reason: "用户要求排查当前页面错误 token=secret",
      },
      timeline: [
        {
          id: "event-1",
          type: "tool_call",
          at: 1,
          label: "调用页面状态工具",
          detail: "读取 token=secret",
          toolCallId: "call-1",
          status: "success",
        },
        {
          id: "event-2",
          type: "failure_recovery",
          at: 4,
          label: "失败恢复建议",
          detail: "检查 password=123456 后重试",
          toolCallId: "call-2",
          status: "error",
        },
      ],
      steps: [
        {
          toolCallId: "call-1",
          toolName: "get_page_state",
          displayName: "浏览器页面状态",
          status: "success",
          startedAt: 1,
          completedAt: 2,
          evidence: "页面已加载 token=secret",
          attachmentKinds: ["network"],
        },
        {
          toolCallId: "call-2",
          toolName: "network_list_requests",
          displayName: "列出 Network 请求",
          status: "error",
          startedAt: 3,
          completedAt: 4,
          evidence: "请求失败 password=123456",
        },
      ],
      failureSummary: {
        failedStepCount: 1,
        failedTools: ["列出 Network 请求"],
        recoverableActions: ["检查失败步骤的参数、页面状态或授权边界后重试。"],
      },
    });

    expect(attachment).toMatchObject({
      kind: "automation-report",
      redacted: true,
      reportType: "interface_analysis",
      playbook: expect.objectContaining({
        playbookId: "site_diagnostics",
        title: "现场诊断",
        reason: "用户要求排查当前页面错误 token=[已脱敏]",
      }),
      objective: "排查登录失败 token=[已脱敏]",
      conclusion: "发现 Network 500 token=[已脱敏]",
      timeline: [
        expect.objectContaining({ detail: "读取 token=[已脱敏]" }),
        expect.objectContaining({ detail: "检查 password=[已脱敏] 后重试" }),
      ],
      steps: [
        expect.objectContaining({ evidence: "页面已加载 token=[已脱敏]" }),
        expect.objectContaining({ evidence: "请求失败 password=[已脱敏]" }),
      ],
    });
    expect(formatToolAttachmentForPrompt(attachment!)).toContain("后续追问需要继续参考以下自动化任务报告");
    expect(formatToolAttachmentForPrompt(attachment!)).not.toContain("secret");
    expect(formatToolAttachmentForPrompt(attachment!)).not.toContain("123456");
    expect(formatToolAttachmentForExport(attachment!)).toContain("# 自动化任务报告附件");
    expect(formatToolAttachmentForExport(attachment!)).toContain("任务类型：接口分析");
    expect(formatToolAttachmentForExport(attachment!)).toContain("本次使用策略：现场诊断");
    expect(formatToolAttachmentForExport(attachment!)).toContain("选择置信度：high");
    expect(formatToolAttachmentForExport(attachment!)).toContain("时间线：");
    expect(formatToolAttachmentForExport(attachment!)).toContain("失败恢复建议");
    expect(formatToolAttachmentForExport(attachment!)).toContain("失败工具：列出 Network 请求");
    expect(formatToolAttachmentForExport(attachment!)).not.toContain("secret");
    expect(formatToolAttachmentForExport(attachment!)).not.toContain("123456");
  });

  it("自动化报告会按工具证据推导页面巡检和表单诊断任务类型", () => {
    const pageInspectionReport = createAutomationReportToolAttachment({
      objective: "巡检页面状态",
      conclusion: "页面加载正常。",
      records: [
        createToolRecord({
          id: "call-page",
          toolId: "browser.get_page_state",
          name: "browser_get_page_state",
          displayName: "浏览器页面状态",
          resultSummary: "页面已加载",
        }),
        createToolRecord({
          id: "call-console",
          toolId: "browser.get_console_messages",
          name: "browser_get_console_messages",
          displayName: "读取 Console 消息",
          resultSummary: "无错误",
        }),
      ],
    });
    const formDiagnosisReport = createAutomationReportToolAttachment({
      objective: "诊断表单提交失败",
      conclusion: "必填字段缺失。",
      records: [
        createToolRecord({
          id: "call-form",
          toolId: "browser.analyze_form",
          name: "browser_analyze_form",
          displayName: "分析表单",
          resultSummary: "发现 1 个必填字段缺失",
        }),
      ],
    });

    expect(pageInspectionReport?.reportType).toBe("page_inspection");
    expect(formDiagnosisReport?.reportType).toBe("form_diagnosis");
    expect(formatToolAttachmentForPrompt(pageInspectionReport!)).toContain("任务类型：页面巡检");
    expect(formatToolAttachmentForPrompt(formDiagnosisReport!)).toContain("任务类型：表单诊断");
  });

  it("自动化报告会把等待、用户确认和页面变化记录到时间线", () => {
    const attachment = createAutomationReportToolAttachment({
      objective: "完成跨页表单操作",
      conclusion: "已经完成确认。",
      createdAt: 50,
      records: [
        createToolRecord({
          id: "call-navigate",
          toolId: "browser.navigate_page",
          name: "browser_navigate_page",
          displayName: "浏览器页面导航",
          status: "success",
          startedAt: 1,
          completedAt: 2,
          resultSummary: "已跳转到下一页",
        }),
        createToolRecord({
          id: "call-wait",
          toolId: "browser.wait_for_state",
          name: "browser_wait_for_state",
          displayName: "等待页面状态",
          status: "success",
          startedAt: 3,
          completedAt: 4,
          resultSummary: "readyState=complete",
        }),
        createToolRecord({
          id: "call-confirm",
          toolId: "boundary.request_user_choice",
          name: "boundary_request_user_choice",
          displayName: "请求用户确认",
          status: "success",
          startedAt: 5,
          completedAt: 6,
          resultSummary: "用户确认继续",
        }),
      ],
    });

    expect(attachment?.timeline).toEqual([
      expect.objectContaining({ type: "page_change", toolCallId: "call-navigate", detail: "已跳转到下一页" }),
      expect.objectContaining({ type: "wait", toolCallId: "call-wait", detail: "readyState=complete" }),
      expect.objectContaining({ type: "user_confirmation", toolCallId: "call-confirm", detail: "用户确认继续" }),
    ]);
    expect(formatToolAttachmentForPrompt(attachment!)).toContain("[page_change]");
    expect(formatToolAttachmentForPrompt(attachment!)).toContain("[wait]");
    expect(formatToolAttachmentForPrompt(attachment!)).toContain("[user_confirmation]");
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

  it("归一化浏览器截图附件并在后续追问中只提供元数据", () => {
    const attachment = normalizeToolAttachment({
      id: "attachment-screenshot",
      kind: "browser-screenshot",
      title: "浏览器截图",
      summary: "当前视口截图，PNG，3 B。",
      sourceToolCallId: "call-screenshot",
      createdAt: 2,
      redacted: false,
      truncated: false,
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,QUJD",
      target: "viewport",
      byteSize: 3,
    });

    expect(attachment).toMatchObject({
      kind: "browser-screenshot",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,QUJD",
      target: "viewport",
      byteSize: 3,
    });
    expect(formatToolAttachmentForPrompt(attachment!)).toContain("后续追问可参考一张历史浏览器截图附件");
    expect(formatToolAttachmentForPrompt(attachment!)).not.toContain("QUJD");
    expect(formatToolAttachmentForExport(attachment!)).toContain("# 浏览器截图附件");
    expect(formatToolAttachmentForExport(attachment!)).not.toContain("QUJD");
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

  it("归一化并聚合 Source Map 附件，导出和后续追问保留有限原始片段", () => {
    const message = createAssistantMessage({
      toolCallRecords: [
        {
          id: "call-map-1",
          toolId: "sourcemap.extract_original_context",
          name: "sourcemap_extract_original_context",
          displayName: "提取原始源码上下文",
          arguments: { resourceId: "script-1", line: 1, column: 20 },
          status: "success",
          startedAt: 1,
          completedAt: 2,
        },
        {
          id: "call-map-2",
          toolId: "sourcemap.extract_original_context",
          name: "sourcemap_extract_original_context",
          displayName: "提取原始源码上下文",
          arguments: {},
          status: "success",
          startedAt: 3,
          completedAt: 4,
        },
      ],
      toolAttachments: [
        {
          id: "attachment-map-1",
          kind: "source-map",
          title: "Source Map 解析结果",
          summary: "Source Map 候选 1 个",
          sourceToolCallId: "call-map-1",
          createdAt: 2,
          redacted: true,
          truncated: true,
          candidates: [
            {
              resourceId: "script-1",
              resourceUrl: "https://example.com/app.js",
              source: "source-mapping-url",
              url: "https://example.com/app.js.map?token=secret",
              inline: false,
              status: "available",
              parsed: true,
            },
          ],
          resolvedLocations: [
            {
              resourceId: "script-1",
              resourceUrl: "https://example.com/app.js",
              generatedLine: 1,
              generatedColumn: 20,
              source: "src/app.ts",
              originalLine: 2,
              originalColumn: 5,
              ignored: false,
              hasSourceContent: true,
            },
          ],
          originalContexts: [
            {
              resourceId: "script-1",
              resourceUrl: "https://example.com/app.js",
              generatedLine: 1,
              generatedColumn: 20,
              source: "src/app.ts",
              originalLine: 2,
              originalColumn: 5,
              ignored: false,
              hasSourceContent: true,
              snippet: "export function sign(){ return token = \"[已脱敏]\"; }",
              redacted: true,
              truncated: true,
            },
          ],
          failures: [],
        },
        {
          id: "attachment-map-2",
          kind: "source-map",
          title: "Source Map 解析结果",
          summary: "失败 1 个",
          sourceToolCallId: "call-map-2",
          createdAt: 4,
          redacted: true,
          truncated: false,
          candidates: [],
          resolvedLocations: [],
          originalContexts: [],
          failures: [{ resourceId: "script-2", message: "未发现 Source Map 候选。" }],
        },
      ],
    });

    const [attachment] = collectMessageToolAttachments(message);

    expect(attachment).toMatchObject({
      kind: "source-map",
      title: "Source Map 解析结果",
      truncated: true,
      candidates: [expect.objectContaining({ resourceId: "script-1" })],
      failures: [expect.objectContaining({ resourceId: "script-2" })],
    });
    expect(formatToolAttachmentForPrompt(attachment)).toContain("后续追问需要继续参考以下历史 Source Map 解析结果");
    expect(formatToolAttachmentForPrompt(attachment)).toContain("外部 Source Map");
    expect(formatToolAttachmentForPrompt(attachment)).not.toContain("app.js.map?token=secret");
    expect(formatToolAttachmentForExport(attachment)).toContain("src/app.ts");
    expect(formatToolAttachmentForExport(attachment)).toContain("[已脱敏]");
    expect(formatToolAttachmentForExport(attachment)).not.toContain("app.js.map?token=secret");
  });
  it("持久化 Network 附件时会丢弃明显无关的静态噪音", () => {
    const [attachment] = prepareToolAttachmentsForPersistence([
      {
        id: "attachment-network-noise",
        kind: "network",
        title: "Network 请求详情",
        summary: "2 条请求",
        createdAt: 1,
        redacted: true,
        truncated: false,
        requests: [
          {
            id: "image-1",
            url: "https://static.example.com/logo.png",
            method: "GET",
            status: 200,
            resourceType: "image",
            mimeType: "image/png",
            redacted: true,
            truncated: false,
          },
          {
            id: "api-1",
            url: "https://api.example.com/conversation/list?page=1",
            method: "POST",
            status: 200,
            resourceType: "xhr",
            mimeType: "application/json",
            requestHeaders: [{ name: "x-trace-id", value: "trace-123" }],
            requestBody: "{\"page\":1,\"token\":\"secret\"}",
            responseBody: "{\"items\":[{\"id\":\"conv-1\",\"title\":\"demo\"}]}",
            redacted: true,
            truncated: false,
          },
        ],
      },
    ]);

    expect(attachment).toMatchObject({
      kind: "network",
      retentionMode: "detail_pool",
      requests: [expect.objectContaining({ id: "api-1" })],
    });
    expect(attachment && "requests" in attachment && attachment.requests).toHaveLength(1);
  });

  it("Network 后续上下文摘要只保留字段名和 ID，不展开 header/body value", () => {
    const [attachment] = prepareToolAttachmentsForPersistence([
      {
        id: "attachment-network-detail",
        kind: "network",
        title: "Network 请求详情",
        summary: "1 条请求",
        createdAt: 1,
        redacted: true,
        truncated: false,
        requests: [
          {
            id: "req-login",
            url: "https://api.example.com/login?redirect=/home&token=secret",
            method: "POST",
            status: 200,
            resourceType: "xhr",
            mimeType: "application/json",
            requestHeaders: [{ name: "authorization", value: "Bearer secret-token" }],
            responseHeaders: [{ name: "content-type", value: "application/json" }],
            requestBody: "{\"username\":\"alice\",\"password\":\"123456\"}",
            responseBody: "{\"token\":\"server-secret\",\"user\":{\"id\":\"u1\"}}",
            redacted: true,
            truncated: false,
          },
        ],
      },
    ]);

    const prompt = attachment ? formatToolAttachmentForPromptSummary(attachment) ?? "" : "";

    expect(prompt).toContain("req-login");
    expect(prompt).toContain("requestHeaders[authorization]");
    expect(prompt).toContain("requestBody[username, password]");
    expect(prompt).toContain("responseBody[token, user, user.id]");
    expect(prompt).not.toContain("Bearer secret-token");
    expect(prompt).not.toContain("123456");
    expect(prompt).not.toContain("server-secret");
  });

  it("Network 详情池会按配置上限裁剪，0 表示仅保留摘要形态", () => {
    const requests = Array.from({ length: 3 }, (_, index) => ({
      id: `api-${index + 1}`,
      url: `https://api.example.com/items/${index + 1}`,
      method: "GET",
      status: 200,
      resourceType: "xhr",
      requestHeaders: [{ name: "x-id", value: `trace-${index + 1}` }],
      responseBody: `{"id":${index + 1},"name":"item-${index + 1}"}`,
      redacted: true,
      truncated: false,
    }));

    const [limited] = prepareToolAttachmentsForPersistence([
      {
        id: "attachment-network-limit",
        kind: "network",
        title: "Network 请求详情",
        summary: "3 条请求",
        createdAt: 1,
        redacted: true,
        truncated: false,
        requests,
      },
    ], { detailPoolKeepLimit: 2 });
    const [summaryOnly] = prepareToolAttachmentsForPersistence([
      {
        id: "attachment-network-summary",
        kind: "network",
        title: "Network 请求详情",
        summary: "3 条请求",
        createdAt: 1,
        redacted: true,
        truncated: false,
        requests,
      },
    ], { detailPoolKeepLimit: 0 });

    expect(limited).toMatchObject({ kind: "network", retentionMode: "detail_pool", truncated: true });
    expect(limited && "requests" in limited && limited.requests).toHaveLength(2);
    expect(summaryOnly).toMatchObject({ kind: "network", retentionMode: "summary" });
    expect(summaryOnly && "requests" in summaryOnly && summaryOnly.requests[0]).not.toHaveProperty("responseBody");
    expect(summaryOnly && "requests" in summaryOnly && summaryOnly.requests[0]).not.toHaveProperty("requestHeaders");
  });
});
