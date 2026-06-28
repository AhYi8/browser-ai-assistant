import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutomationPlaybookSelectionPrompt,
  selectAutomationPlaybook,
} from "../../../src/background/automationPlaybookSelector";
import { getRegisteredAutomationPlaybooks } from "../../../src/shared/automationPlaybooks";
import type { ModelConfig } from "../../../src/shared/types";

function createModel(endpointType: ModelConfig["endpointType"] = "openai_chat"): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
    endpointType,
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
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

describe("浏览器自动化 Playbook AI 预选", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("从模型 JSON 中解析启用的 Playbook", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"playbookId\":\"network_api_analysis\",\"confidence\":\"high\",\"reason\":\"用户要求分析接口\"}" } }],
    }), { status: 200 }));
    const typedFetcher = fetcher as unknown as typeof fetch;

    const result = await selectAutomationPlaybook({
      model: createModel(),
      userContent: "分析当前页面这个接口参数",
      playbooks: getRegisteredAutomationPlaybooks(),
      retryCount: 0,
      fetcher: typedFetcher,
    });

    expect(result).toEqual({
      playbookId: "network_api_analysis",
      title: "Network/API 分析",
      source: "builtin",
      confidence: "high",
      reason: "用户要求分析接口",
    });
    const firstCall = fetcher.mock.calls[0] as unknown as Parameters<typeof fetch>;
    const requestBody = JSON.parse(String((firstCall[1] as RequestInit | undefined)?.body));
    expect(JSON.stringify(requestBody)).toContain("Network/API 分析");
    expect(JSON.stringify(requestBody)).not.toContain("任务策略：Network/API 分析");
  });

  it("返回 null、未知 ID、畸形 JSON 或模型失败时不阻断正式请求", async () => {
    const playbooks = getRegisteredAutomationPlaybooks();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(selectAutomationPlaybook({
      model: createModel(),
      userContent: "看看当前页面",
      playbooks,
      retryCount: 0,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"playbookId\":null,\"confidence\":\"low\",\"reason\":\"不需要\"}" } }] }), { status: 200 })) as unknown as typeof fetch,
    })).resolves.toBeUndefined();
    await expect(selectAutomationPlaybook({
      model: createModel(),
      userContent: "看看当前页面",
      playbooks,
      retryCount: 0,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"playbookId\":\"missing\",\"confidence\":\"high\",\"reason\":\"未知\"}" } }] }), { status: 200 })) as unknown as typeof fetch,
    })).resolves.toBeUndefined();
    await expect(selectAutomationPlaybook({
      model: createModel(),
      userContent: "看看当前页面",
      playbooks,
      retryCount: 0,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "不是 JSON" } }] }), { status: 200 })) as unknown as typeof fetch,
    })).resolves.toBeUndefined();
    await expect(selectAutomationPlaybook({
      model: createModel(),
      userContent: "看看当前页面",
      playbooks,
      retryCount: 0,
      fetcher: vi.fn(async () => new Response("bad", { status: 500 })) as unknown as typeof fetch,
    })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[automation-playbook] 已跳过任务策略预选：",
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it("Anthropic 模型也使用普通 JSON 提示路径", () => {
    const messages = createAutomationPlaybookSelectionPrompt({
      userContent: "排查当前页面错误",
      pageContextSummary: "标题：后台\nURL：https://example.com",
      playbooks: getRegisteredAutomationPlaybooks(),
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining("只返回 JSON") }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("排查当前页面错误") }),
    ]);
    expect(messages[1].content).toContain("标题：后台");
  });
});
