import { createModelConfig } from "../models/modelCatalog";
import { createModelRequestPayload } from "../models/modelRequestPayload";
import type { ChatMessage, ModelProvider, ProviderModel } from "../types";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";

export type UrlPatternGenerationResponse =
  | {
      ok: true;
      patterns: string[];
    }
  | {
      ok: false;
      message: string;
    };

export async function generateUrlPatternsWithModel(
  provider: ModelProvider,
  providerModel: ProviderModel,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<UrlPatternGenerationResponse> {
  try {
    const model = createModelConfig(provider, providerModel);
    const payload = createModelRequestPayload(model, createGenerationMessages(url, model.id, model.endpointType), false);

    console.debug(`${DEBUG_PREFIX} 准备调用模型接口`, {
      resolvedUrl: url,
      endpointUrl: payload.url,
      endpointType: model.endpointType,
      modelId: model.modelId,
      bodyKeys: isObject(payload.body) ? Object.keys(payload.body) : [],
    });

    const response = await fetcher(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    });

    console.debug(`${DEBUG_PREFIX} 模型接口响应`, {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    });

    if (!response.ok) {
      const failureText = await response
        .clone()
        .text()
        .catch(() => "");
      console.warn(`${DEBUG_PREFIX} 模型接口返回失败状态`, {
        status: response.status,
        statusText: response.statusText,
        responsePreview: failureText.slice(0, 500),
      });
      return { ok: false, message: `AI 生成失败：${response.status} ${response.statusText}` };
    }

    const responseBody = await response.json();
    const responseText = extractResponseText(responseBody);
    const patterns = parseGeneratedPatterns(responseText);

    console.debug(`${DEBUG_PREFIX} 模型响应解析结果`, {
      responseTextLength: responseText.length,
      responseTextPreview: responseText.slice(0, 300),
      patternCount: patterns.length,
      patterns,
    });

    if (patterns.length === 0) {
      console.warn(`${DEBUG_PREFIX} 未解析到可用正则`, {
        responseBody,
      });
      return { ok: false, message: "AI 未返回可用的 URL 正则" };
    }

    return { ok: true, patterns: patterns.slice(0, 5) };
  } catch (error) {
    console.error(`${DEBUG_PREFIX} 生成流程异常`, error);
    return {
      ok: false,
      message: error instanceof Error ? `AI 生成失败：${error.message}` : "AI 生成失败",
    };
  }
}

function createGenerationMessages(url: string, modelId: string, endpointType: ModelProvider["endpointType"]): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: "url-pattern-system",
      role: "system",
      content: "你是浏览器插件的 URL 正则生成助手。只返回 JSON 字符串数组，不要解释。",
      createdAt: now,
      modelId,
      endpointType,
      contextMode: "text",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
    },
    {
      id: "url-pattern-user",
      role: "user",
      content: [
        "请基于当前 URL 生成 5 个从严格到宽泛的 JavaScript RegExp 正则字符串。",
        "要求：",
        "1. 返回 JSON 数组，数组内只包含字符串。",
        "2. 第 1 个尽量精确匹配当前 URL 的主要路径。",
        "3. 后续逐步放宽到同栏目、同站点、同协议或同域族。",
        "4. 正则必须能直接传入 new RegExp(pattern)。",
        `当前 URL：${url}`,
      ].join("\n"),
      createdAt: now,
      modelId,
      endpointType,
      contextMode: "text",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
    },
  ];
}

function extractResponseText(body: unknown): string {
  if (!isObject(body)) {
    return "";
  }

  const choices = body.choices;
  if (Array.isArray(choices)) {
    const firstChoice = choices[0];
    if (isObject(firstChoice) && isObject(firstChoice.message) && typeof firstChoice.message.content === "string") {
      return firstChoice.message.content;
    }
  }

  const content = body.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (isObject(item) && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export function parseGeneratedPatterns(text: string): string[] {
  const trimmedText = text.trim();
  const jsonText = trimmedText.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueValidPatterns(parsed);
    }

    if (isObject(parsed) && Array.isArray(parsed.patterns)) {
      return uniqueValidPatterns(parsed.patterns);
    }
  } catch {
    // AI 偶尔会返回编号列表，JSON 解析失败时继续走宽松解析。
  }

  return uniqueValidPatterns(
    jsonText
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+[\).、-]\s*/, "").trim())
      .filter(Boolean),
  );
}

function uniqueValidPatterns(values: unknown[]): string[] {
  const patterns: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const pattern = value.trim();
    if (!pattern || patterns.includes(pattern)) {
      continue;
    }

    try {
      new RegExp(pattern);
      patterns.push(pattern);
    } catch {
      continue;
    }
  }

  return patterns;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
