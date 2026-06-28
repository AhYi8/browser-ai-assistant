import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { normalizeModelRequestRetryCount, shouldRetryModelResponse, withModelRequestRetry } from "../shared/models/modelRequestRetry";
import type { ModelRequestMessage } from "../shared/models/types";
import {
  normalizeAutomationPlaybookSelection,
  type AutomationPlaybook,
} from "../shared/automationPlaybooks";
import type { AutomationPlaybookSelection, ModelConfig } from "../shared/types";
import { extractAssistantResponseData } from "./modelAssistantResponseParser";

type Fetcher = typeof fetch;

export function createAutomationPlaybookSelectionPrompt(input: {
  userContent: string;
  pageContextSummary?: string;
  playbooks: AutomationPlaybook[];
}): ModelRequestMessage[] {
  const candidates = input.playbooks.map((playbook) => ({
    id: playbook.id,
    title: playbook.title,
    description: playbook.description,
    tags: playbook.tags,
    risk: playbook.risk,
    recommendedCapabilities: playbook.recommendedCapabilities,
  }));

  return [
    {
      role: "system",
      content: [
        "你是浏览器自动化任务策略预选器。只返回 JSON，不要输出 Markdown、解释或额外文本。",
        "你只能从候选 Playbook 中选择一个最适合本次用户需求的策略；如果不需要浏览器自动化策略，playbookId 返回 null。",
        '返回格式必须是：{"playbookId": string | null, "confidence": "low" | "medium" | "high", "reason": string}。',
        "不要请求工具，不要生成最终回答，不要把候选策略全文复制到 reason。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `用户需求：${input.userContent}`,
        input.pageContextSummary?.trim() ? `页面摘要：\n${input.pageContextSummary.trim()}` : "页面摘要：无",
        `候选 Playbook：\n${JSON.stringify(candidates, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}

export async function selectAutomationPlaybook(input: {
  model: ModelConfig;
  userContent: string;
  pageContextSummary?: string;
  playbooks: AutomationPlaybook[];
  retryCount?: number;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}): Promise<AutomationPlaybookSelection | undefined> {
  if (input.playbooks.length === 0) {
    return undefined;
  }
  const fetcher = input.fetcher ?? fetch;
  const messages = createAutomationPlaybookSelectionPrompt({
    userContent: input.userContent,
    pageContextSummary: input.pageContextSummary,
    playbooks: input.playbooks,
  });
  try {
    const payload = createModelRequestPayload(input.model, messages, false);
    const requestInit: RequestInit = {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
      signal: input.signal,
    };
    const responseData = await withModelRequestRetry(
      () => fetchAndReadSelectionResponse(fetcher, payload.url, requestInit),
      normalizeModelRequestRetryCount(input.retryCount),
      {
        shouldRetryResult: (result) => result.retryable,
        onRetryResult: (result) => result.response.body?.cancel().catch(() => undefined),
      },
    );
    if (!responseData.response.ok) {
      warnPlaybookSelectionSkipped("模型响应失败", { status: responseData.response.status });
      return undefined;
    }
    const content = extractAssistantResponseData(responseData.data).content;
    const parsed = parseSelectionJson(content);
    if (!parsed || parsed.playbookId === null) {
      warnPlaybookSelectionSkipped(parsed?.playbookId === null ? "模型未选择策略" : "模型响应 JSON 无效");
      return undefined;
    }
    const selection = normalizeAutomationPlaybookSelection(parsed, input.playbooks);
    if (!selection) {
      warnPlaybookSelectionSkipped("模型返回未知或禁用策略");
    }
    return selection;
  } catch (error) {
    warnPlaybookSelectionSkipped("预选请求异常", { errorName: error instanceof Error ? error.name : typeof error });
    return undefined;
  }
}

async function fetchAndReadSelectionResponse(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; data?: unknown; retryable: boolean }> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    return { response, retryable: shouldRetryModelResponse(response) };
  }
  try {
    return { response, data: await response.json(), retryable: false };
  } catch {
    warnPlaybookSelectionSkipped("模型响应 JSON 读取失败", { status: response.status });
    return { response, data: undefined, retryable: false };
  }
}

function warnPlaybookSelectionSkipped(reason: string, details: Record<string, unknown> = {}): void {
  console.warn("[automation-playbook] 已跳过任务策略预选：", {
    reason,
    ...details,
  });
}

function parseSelectionJson(content: string): { playbookId: string | null; confidence?: unknown; reason?: unknown } | undefined {
  const text = content.trim();
  if (!text) {
    return undefined;
  }
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object" || !("playbookId" in parsed)) {
      return undefined;
    }
    const source = parsed as { playbookId?: unknown; confidence?: unknown; reason?: unknown };
    if (source.playbookId !== null && typeof source.playbookId !== "string") {
      return undefined;
    }
    return {
      playbookId: source.playbookId,
      confidence: source.confidence,
      reason: source.reason,
    };
  } catch {
    return undefined;
  }
}

function extractJsonObjectText(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return source.slice(start, end + 1);
}
