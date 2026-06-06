import { describe, expect, it } from "vitest";
import {
  createNetworkMetadataPrompt,
  createNetworkContextPrompt,
  DEFAULT_NETWORK_RELEVANCE_PROMPT,
  DEFAULT_NETWORK_REQUEST_TYPE_FILTERS,
  filterNetworkRequestsByType,
  formatNetworkAttachmentSummary,
  parseRelevantNetworkRequestIds,
  redactNetworkRequestDetail,
  redactNetworkRequestMeta,
} from "../../../src/shared/networkContext";
import type { NetworkRequestDetail, NetworkRequestMeta } from "../../../src/shared/types";

function createDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: "req-1",
    url: "https://api.example.com/users?token=secret-token&safe=1",
    method: "POST",
    status: 200,
    statusText: "OK",
    mimeType: "application/json",
    resourceType: "xhr",
    startedAt: "2026-06-04T10:00:00.000Z",
    durationMs: 120,
    requestHeaders: [
      { name: "Authorization", value: "Bearer secret" },
      { name: "X-Trace", value: "trace-1" },
    ],
    responseHeaders: [
      { name: "Set-Cookie", value: "sid=secret" },
      { name: "Content-Type", value: "application/json" },
    ],
    requestBody: '{"password":"123456","name":"张三"}',
    responseBody: '{"access_token":"abc","ok":true}',
    truncated: false,
    redacted: false,
    ...partial,
  };
}

describe("Network 上下文", () => {
  it("脱敏请求详情中的敏感 header、URL 参数和正文键名", () => {
    const detail = redactNetworkRequestDetail(createDetail());

    expect(detail.url).toBe("https://api.example.com/users?token=[已脱敏]&safe=1");
    expect(detail.requestHeaders).toEqual([
      { name: "Authorization", value: "[已脱敏]" },
      { name: "X-Trace", value: "trace-1" },
    ]);
    expect(detail.responseHeaders).toEqual([
      { name: "Set-Cookie", value: "[已脱敏]" },
      { name: "Content-Type", value: "application/json" },
    ]);
    expect(detail.requestBody).toContain('"password":"[已脱敏]"');
    expect(detail.responseBody).toContain('"access_token":"[已脱敏]"');
    expect(detail.redacted).toBe(true);
  });

  it("从 AI 筛选响应中解析合法请求 ID 并过滤不存在的 ID", () => {
    const ids = parseRelevantNetworkRequestIds('{"requestIds":["req-2","missing","req-1"]}', ["req-1", "req-2"]);

    expect(ids).toEqual(["req-2", "req-1"]);
  });

  it("兼容模型接口返回的完整 OpenAI 响应 JSON", () => {
    const ids = parseRelevantNetworkRequestIds(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "{\"requestIds\":[\"req-13\"]}",
              reasoning_content: "只返回 JSON",
              role: "assistant",
            },
          },
        ],
      }),
      ["req-13"],
    );

    expect(ids).toEqual(["req-13"]);
  });

  it("兼容模型接口返回多个 requestIds 的完整 OpenAI 响应 JSON", () => {
    const ids = parseRelevantNetworkRequestIds(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "{\"requestIds\":[\"req-8\",\"req-10\",\"req-11\",\"req-12\",\"req-13\",\"req-14\",\"req-16\",\"req-17\",\"req-18\"]}",
              reasoning_content: "用户要分析所有接口。",
              role: "assistant",
            },
          },
        ],
      }),
      ["req-8", "req-10", "req-11", "req-12", "req-13", "req-14", "req-16", "req-17", "req-18"],
    );

    expect(ids).toEqual(["req-8", "req-10", "req-11", "req-12", "req-13", "req-14", "req-16", "req-17", "req-18"]);
  });

  it("模型返回 req-N 编号但真实请求 ID 不匹配时按元数据序号映射", () => {
    const ids = parseRelevantNetworkRequestIds(
      '{"requestIds":["req-2","req-4"]}',
      [
        { id: "chrome-a", url: "https://example.com/a", method: "GET" },
        { id: "chrome-b", url: "https://example.com/b", method: "GET" },
        { id: "chrome-c", url: "https://example.com/c", method: "GET" },
        { id: "chrome-d", url: "https://example.com/d", method: "GET" },
      ],
    );

    expect(ids).toEqual(["chrome-b", "chrome-d"]);
  });

  it("筛选阶段使用的 Network 元数据也会先脱敏", () => {
    const meta = redactNetworkRequestMeta({
      id: "req-1",
      url: "https://api.example.com/users?api_key=secret&safe=1",
      method: "GET",
      requestHeaders: [{ name: "Cookie", value: "sid=secret" }],
      requestBody: "token=secret&name=test",
    });

    expect(meta.url).toBe("https://api.example.com/users?api_key=[已脱敏]&safe=1");
    expect(meta.requestHeaders).toEqual([{ name: "Cookie", value: "[已脱敏]" }]);
    expect(meta.requestBody).toBe("token=%5B%E5%B7%B2%E8%84%B1%E6%95%8F%5D&name=test");
  });

  it("默认 Network 相关性筛选 Prompt 保留当前硬编码结构", () => {
    const prompt = createNetworkMetadataPrompt({
      userDemand: "分析登录接口",
      requests: [{ id: "req-1", url: "https://api.example.com/login", method: "POST", status: 500 }],
    });

    expect(DEFAULT_NETWORK_RELEVANCE_PROMPT).toContain("{{userDemand}}");
    expect(DEFAULT_NETWORK_RELEVANCE_PROMPT).toContain("{{networkRequests}}");
    expect(prompt).toContain("请根据用户需求，从下面 Network 请求元数据中筛选最相关的请求。");
    expect(prompt).toContain("只返回 JSON");
    expect(prompt).toContain("用户需求：分析登录接口");
    expect(prompt).toContain("1. id=req-1 | method=POST | status=500");
  });

  it("Network 相关性筛选 Prompt 支持用户需求和请求元数据占位符", () => {
    const prompt = createNetworkMetadataPrompt({
      userDemand: "分析用户接口",
      requests: [{ id: "req-2", url: "https://api.example.com/users", method: "GET", status: 200 }],
      promptTemplate: "自定义筛选：{{ userDemand }}\n候选请求：\n{{ networkRequests }}",
    });

    expect(prompt).toContain("自定义筛选：分析用户接口");
    expect(prompt).toContain("1. id=req-2 | method=GET | status=200");
  });

  it("Network 相关性筛选 Prompt 缺少占位符时会追加必要上下文", () => {
    const prompt = createNetworkMetadataPrompt({
      userDemand: "分析订单接口",
      requests: [{ id: "req-3", url: "https://api.example.com/orders", method: "GET", status: 200 }],
      promptTemplate: "只返回最相关请求 ID。",
    });

    expect(prompt).toContain("只返回最相关请求 ID。");
    expect(prompt).toContain("用户需求：分析订单接口");
    expect(prompt).toContain("Network 请求元数据：");
    expect(prompt).toContain("id=req-3");
  });

  it("将筛选后的请求详情格式化为正式模型可读上下文", () => {
    const prompt = createNetworkContextPrompt({
      userDemand: "分析登录接口",
      details: [redactNetworkRequestDetail(createDetail())],
    });

    expect(prompt).toContain("Network context:");
    expect(prompt).toContain("用户需求：分析登录接口");
    expect(prompt).toContain("POST https://api.example.com/users");
    expect(prompt).toContain("Request headers:");
    expect(prompt).toContain("Response body:");
  });

  it("生成 AI 消息旁 Network 附件摘要", () => {
    expect(formatNetworkAttachmentSummary([createDetail({ status: 500, method: "GET" })])).toBe("已注入 1 个 Network 请求：GET 500 https://api.example.com/users?token=secret-token&safe=1");
  });

  it("默认 Network 请求类型过滤保持采集全部类型", () => {
    expect(DEFAULT_NETWORK_REQUEST_TYPE_FILTERS).toEqual(["all"]);
  });

  it("按聊天偏好筛选 Fetch/XHR 与图片请求类型", () => {
    const requests: NetworkRequestMeta[] = [
      { id: "fetch-1", url: "https://example.com/api", method: "GET", resourceType: "fetch" },
      { id: "xhr-1", url: "https://example.com/xhr", method: "GET", resourceType: "xhr" },
      { id: "img-1", url: "https://example.com/logo.png", method: "GET", resourceType: "image" },
      { id: "doc-1", url: "https://example.com", method: "GET", resourceType: "document" },
    ];

    expect(filterNetworkRequestsByType(requests, ["fetch_xhr", "img"]).map((request) => request.id)).toEqual(["fetch-1", "xhr-1", "img-1"]);
  });

  it("未知或未上报的 Network 请求类型归入 Other", () => {
    const requests: NetworkRequestMeta[] = [
      { id: "preflight-1", url: "https://example.com/cors", method: "OPTIONS", resourceType: "preflight" },
      { id: "unknown-1", url: "https://example.com/unknown", method: "GET" },
      { id: "script-1", url: "https://example.com/app.js", method: "GET", resourceType: "script" },
    ];

    expect(filterNetworkRequestsByType(requests, ["other"]).map((request) => request.id)).toEqual(["preflight-1", "unknown-1"]);
  });
});
