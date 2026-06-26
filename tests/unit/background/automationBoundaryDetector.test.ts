import { describe, expect, it, vi } from "vitest";
import { applyAutomationBoundaryConfirmation, detectAutomationBoundarySignals } from "../../../src/background/browserControl/automationBoundaryDetector";

describe("浏览器自动化权限边界检测", () => {
  it("检测脱敏、截断、请求重放、上下文扩展和 Runtime 边界", () => {
    const signals = detectAutomationBoundarySignals([
      "Authorization: [已脱敏]",
      "Truncated: true",
      "发送请求重放前必须先通过用户边界确认。",
      "需要 allowSameOriginFetch=true 才会读取同源 Source Map。",
      "完全访问授权仍处于后续阶段预留状态，当前版本已拒绝执行。",
    ].join("\n"));

    expect(signals.map((signal) => signal.id)).toEqual([
      "redacted_sensitive_fields",
      "truncated_summary",
      "request_replay_confirmation",
      "js_or_sourcemap_context_expansion",
      "runtime_or_full_access_boundary",
    ]);
  });

  it("检测到权限边界时通过统一弹窗确认并把确认结果回灌工具上下文", async () => {
    const confirmBoundary = vi.fn(async () => "用户已确认本轮允许扩展 JS/Source Map 上下文。");

    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "sourcemap_list_candidates",
      content: "Source Map 不包含 sourcesContent，本阶段不主动拉取原始源码文件。",
    }, confirmBoundary);

    expect(confirmBoundary).toHaveBeenCalledWith(expect.objectContaining({
      question: "允许处理JS/Source Map 上下文扩展吗？",
      reason: "本轮需要用户确认后才可继续。",
      choices: expect.arrayContaining([
        expect.objectContaining({
          id: "allow_js_or_sourcemap_context_expansion",
          title: "允许JS/Source Map 上下文扩展",
          description: "仅本轮生效，不保存长期权限。",
          grants: ["expand_js_or_sourcemap_context"],
        }),
      ]),
    }));
    expect(result.content).toContain("用户已确认本轮允许扩展 JS/Source Map 上下文。");
    expect(result.content).toContain("用户已经完成本轮边界确认");
  });

  it("检测同源 JS 与 Source Map 读取边界", () => {
    const signals = detectAutomationBoundarySignals([
      "同源 JS 补位拒绝跨域重定向。",
      "Source Map 请求被浏览器拒绝。",
      "inline Source Map 超过大小上限。",
    ].join("\n"));

    expect(signals.map((signal) => signal.id)).toEqual(["js_or_sourcemap_context_expansion"]);
  });

  it("检测请求重放沙箱拒绝边界", () => {
    const signals = detectAutomationBoundarySignals([
      "请求重放草案不存在、已过期或不属于当前页面。",
      "请求包含敏感 Header，受控增强模式下拒绝重放。",
      "请求重放沙箱 v1 只允许 GET、HEAD 和受限 POST。",
    ].join("\n"));

    expect(signals.map((signal) => signal.id)).toEqual(["request_replay_confirmation"]);
  });

  it("检测页面副作用操作边界并要求先请求用户确认", async () => {
    const signals = detectAutomationBoundarySignals([
      "即将执行的页面操作可能触发表单提交、删除、付款、发布或发送消息。",
      "请先向用户确认本次页面副作用操作。",
    ].join("\n"));

    expect(signals).toEqual([
      expect.objectContaining({
        id: "page_effect_confirmation",
        label: "页面副作用操作确认",
        risk: "high",
        grants: [],
      }),
    ]);

    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "click",
      content: "页面操作可能触发表单提交，请先请求用户确认。",
    });

    expect(result.content).toContain("页面副作用操作确认");
    expect(result.content).toContain("下一步必须先调用 boundary_request_user_choice");
  });

  it("检测跨站点跳转和第三方授权页边界并要求先请求用户确认", async () => {
    const signals = detectAutomationBoundarySignals([
      "即将从 https://app.example.com 跳转到 https://accounts.example-idp.com，属于跨站点跳转。",
      "目标页面可能是第三方授权页，请先请求用户确认。",
    ].join("\n"));

    expect(signals).toEqual([
      expect.objectContaining({
        id: "cross_site_navigation_confirmation",
        label: "跨站点跳转或第三方授权页确认",
        risk: "high",
        grants: [],
      }),
    ]);

    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "new_page",
      content: "操作将打开第三方授权页，请先请求用户确认。",
    });

    expect(result.content).toContain("跨站点跳转或第三方授权页确认");
    expect(result.content).toContain("下一步必须先调用 boundary_request_user_choice");
  });

  it("检测文件上传下载和本地文件访问边界并要求先请求用户确认", async () => {
    const signals = detectAutomationBoundarySignals([
      "即将处理文件上传，需要用户选择或确认本地文件。",
      "页面可能触发文件下载，请先请求用户确认。",
    ].join("\n"));

    expect(signals).toEqual([
      expect.objectContaining({
        id: "file_access_confirmation",
        label: "文件上传下载或本地文件访问确认",
        risk: "high",
        grants: [],
      }),
    ]);

    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "upload_file",
      content: "工具涉及读取本地文件路径或触发文件上传，请先请求用户确认。",
    });

    expect(result.content).toContain("文件上传下载或本地文件访问确认");
    expect(result.content).toContain("下一步必须先调用 boundary_request_user_choice");
  });

  it("检测运行时只读授权和安全路径边界", () => {
    const signals = detectAutomationBoundarySignals([
      "运行时只读分析未授权，无法执行 runtime.* 工具。",
      "运行时路径只允许安全的点号路径，不能传入 JavaScript 表达式。",
      "运行时路径不能只指向 window 或 globalThis。",
    ].join("\n"));

    expect(signals.map((signal) => signal.id)).toEqual(["runtime_or_full_access_boundary"]);
  });

  it("检测 Source Map 资源截断边界", () => {
    const signals = detectAutomationBoundarySignals("JS 资源已截断，sourceMappingURL 可能不准确。");

    expect(signals.map((signal) => signal.id)).toEqual(["truncated_summary"]);
  });

  it("确认能力不可用时强制提示模型下一步请求用户确认", async () => {
    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "replay_prepare_request",
      content: "发送请求重放前必须先通过用户边界确认。",
    });

    expect(result.content).toContain("下一步必须先调用 boundary_request_user_choice");
    expect(result.content).toContain("不得继续执行依赖该边界的分析、请求重放、上下文扩展或运行时扩展");
  });

  it("确认函数异常时保留原工具结果并 fail closed 提示模型确认边界", async () => {
    const result = await applyAutomationBoundaryConfirmation({
      toolCallId: "call-1",
      name: "network_get_request_details",
      content: "Authorization: [已脱敏]",
    }, async () => {
      throw new Error("dialog failed");
    });

    expect(result.content).toContain("Authorization: [已脱敏]");
    expect(result.content).toContain("下一步必须先调用 boundary_request_user_choice");
  });
});
