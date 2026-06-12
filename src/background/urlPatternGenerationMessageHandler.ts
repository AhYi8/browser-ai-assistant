import {
  generateUrlPatternsWithModel,
  parseGeneratedPatterns,
  type UrlPatternGenerationResponse,
} from "../shared/extractionRules/urlPatternGeneration";
import type { ModelProvider, ProviderModel } from "../shared/types";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";

export interface UrlPatternGenerationMessage {
  type: "extractionRule.generateUrlPatterns";
  provider: ModelProvider;
  model: ProviderModel;
  url?: string;
  debugRequestId?: string;
  retryCount?: number;
}

export interface CurrentTabUrlMessage {
  type: "extractionRule.getCurrentTabUrl";
  debugRequestId?: string;
}

export type CurrentTabUrlResponse =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      message: string;
    };

export { parseGeneratedPatterns };

export async function handleUrlPatternGenerationMessage(
  message: UrlPatternGenerationMessage,
  fetcher: typeof fetch = fetch,
): Promise<UrlPatternGenerationResponse> {
  try {
    console.debug(`${DEBUG_PREFIX} 后台收到生成请求`, {
      providerId: message.provider.id,
      providerName: message.provider.name,
      endpointType: message.provider.endpointType,
      endpointUrl: message.provider.endpointUrl,
      modelId: message.model.id,
      modelName: message.model.displayName,
      modelValue: message.model.modelId,
      inputUrl: message.url,
      debugRequestId: message.debugRequestId,
    });

    const url = message.url?.trim() || (await getCurrentTabUrl(message.debugRequestId));
    return generateUrlPatternsWithModel(message.provider, message.model, url, fetcher, message.retryCount);
  } catch (error) {
    console.error(`${DEBUG_PREFIX} 后台生成流程异常`, error);
    return {
      ok: false,
      message: error instanceof Error ? `AI 生成失败：${error.message}` : "AI 生成失败",
    };
  }
}

export async function handleCurrentTabUrlMessage(message: CurrentTabUrlMessage): Promise<CurrentTabUrlResponse> {
  try {
    return {
      ok: true,
      url: await getCurrentTabUrl(message.debugRequestId),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "未找到当前活动页面 URL",
    };
  }
}

async function getCurrentTabUrl(debugRequestId?: string): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.debug(`${DEBUG_PREFIX} 读取当前激活标签页 URL`, {
    debugRequestId,
    tabId: tab?.id,
    url: tab?.url,
    title: tab?.title,
  });

  if (!tab?.url) {
    throw new Error("未找到当前活动页面 URL");
  }

  return tab.url;
}
