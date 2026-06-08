import { validateModelConfig } from "./modelValidation";
import type { ModelValidationResult } from "./types";
import type { ChatSessionPreferenceOverrides, ModelConfig, ModelProvider, ProviderModel } from "../types";

export interface RemoteModelInfo {
  id: string;
  displayName: string;
}

export interface ModelListRequest {
  url: string;
  headers: Record<string, string>;
}

type Fetcher = typeof fetch;
type ModelConfigPreferenceOverrides = Pick<ChatSessionPreferenceOverrides, "systemPrompt" | "temperature" | "maxTokens" | "topK">;

export function createListModelsRequest(provider: ModelProvider): ModelListRequest {
  if (provider.endpointType === "anthropic_messages") {
    return {
      url: createEndpointUrl(provider.endpointUrl, "anthropic_models"),
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }

  return {
    url: createEndpointUrl(provider.endpointUrl, "openai_models"),
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
  };
}

export async function fetchProviderModels(provider: ModelProvider, fetcher: Fetcher = fetch): Promise<RemoteModelInfo[]> {
  const request = createListModelsRequest(provider);
  const response = await fetcher(request.url, {
    method: "GET",
    headers: request.headers,
  });

  if (!response.ok) {
    throw new Error(`获取模型列表失败：${response.status} ${response.statusText}`);
  }

  return parseModelListResponse(await response.json());
}

export function parseModelListResponse(responseBody: unknown): RemoteModelInfo[] {
  if (!isObject(responseBody) || !Array.isArray(responseBody.data)) {
    return [];
  }

  return responseBody.data
    .map((item) => {
      if (!isObject(item) || typeof item.id !== "string" || item.id.trim().length === 0) {
        return undefined;
      }

      const displayName =
        typeof item.display_name === "string" && item.display_name.trim().length > 0
          ? item.display_name
          : typeof item.displayName === "string" && item.displayName.trim().length > 0
            ? item.displayName
            : item.id;

      return {
        id: item.id,
        displayName,
      };
    })
    .filter((item): item is RemoteModelInfo => Boolean(item));
}

export async function testProviderModel(
  provider: ModelProvider,
  model: ProviderModel,
  fetcher: Fetcher = fetch,
): Promise<ModelValidationResult> {
  const result = await validateModelConfig(createModelConfig(provider, model), fetcher);

  return result.ok
    ? {
        ok: true,
        message: "模型测试通过",
      }
    : {
        ok: false,
        message: result.message.replace("API Key 校验失败", "模型测试失败"),
      };
}

export function createModelConfig(
  provider: ModelProvider,
  model: ProviderModel,
  overrides: ChatSessionPreferenceOverrides = {},
): ModelConfig {
  return {
    ...model,
    ...pickModelConfigPreferenceOverrides(overrides),
    name: model.displayName,
    channelName: provider.name,
    endpointType: provider.endpointType,
    endpointUrl: provider.endpointUrl,
    apiKey: provider.apiKey,
  };
}

export function createEndpointUrl(
  endpointUrl: string,
  endpointKind: "openai_chat" | "anthropic_messages" | "openai_models" | "anthropic_models",
): string {
  const url = new URL(endpointUrl.trim());
  const suffixByKind = {
    openai_chat: ["v1", "chat", "completions"],
    anthropic_messages: ["v1", "messages"],
    openai_models: ["v1", "models"],
    anthropic_models: ["v1", "models"],
  } satisfies Record<typeof endpointKind, string[]>;
  const targetSuffix = suffixByKind[endpointKind];
  const currentSegments = url.pathname.split("/").filter(Boolean);

  // 用户配置只要求填写基础域名；这里同时兼容历史上已保存完整接口路径的用户数据。
  const knownSuffixes = [
    ["v1", "chat", "completions"],
    ["chat", "completions"],
    ["v1", "messages"],
    ["messages"],
    ["v1", "models"],
    ["models"],
  ];
  const baseSegments = removeKnownEndpointSuffix(currentSegments, knownSuffixes);

  url.pathname = `/${[...baseSegments, ...targetSuffix].join("/")}`;
  return url.toString();
}

function removeKnownEndpointSuffix(segments: string[], knownSuffixes: string[][]): string[] {
  for (const suffix of knownSuffixes) {
    if (segments.length < suffix.length) {
      continue;
    }

    const start = segments.length - suffix.length;
    const matched = suffix.every((segment, index) => segments[start + index] === segment);
    if (matched) {
      return segments.slice(0, start);
    }
  }

  return segments;
}

function pickModelConfigPreferenceOverrides(overrides: ChatSessionPreferenceOverrides): ModelConfigPreferenceOverrides {
  const modelOverrides: ModelConfigPreferenceOverrides = {};

  if (overrides.systemPrompt !== undefined) {
    modelOverrides.systemPrompt = overrides.systemPrompt;
  }
  if (overrides.temperature !== undefined) {
    modelOverrides.temperature = overrides.temperature;
  }
  if (overrides.maxTokens !== undefined) {
    modelOverrides.maxTokens = overrides.maxTokens;
  }
  if (overrides.topK !== undefined) {
    modelOverrides.topK = overrides.topK;
  }

  return modelOverrides;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
