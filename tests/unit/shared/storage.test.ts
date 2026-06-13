import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATABASE_NAME } from "../../../src/shared/constants";
import {
  clearDatabase,
  deleteChatFolder,
  deleteChatSession,
  deleteExtractionRule,
  deleteModelProvider,
  deleteProviderModel,
  getChatFolders,
  getChatSessions,
  saveChatSession,
  saveChatFolder,
  saveExtractionRule,
  saveModelProvider,
  saveProviderModel,
  getChatSession,
  getExtractionRules,
  getModelProviders,
  getProviderModels,
  moveExtractionRule,
  deletePromptTemplate,
  getPromptTemplates,
  reorderPromptTemplates,
  savePromptTemplate,
} from "../../../src/shared/storage/repositories";
import { db } from "../../../src/shared/storage/db";
import type { ChatFolder, ChatSession, ExtractionRule, ModelProvider, PromptTemplate, ProviderModel } from "../../../src/shared/types";

const LEGACY_VERSION_2_SCHEMA = {
  modelConfigs: "id, channelName, endpointType, updatedAt",
  modelProviders: "id, name, endpointType, updatedAt",
  providerModels: "id, providerId, displayName, updatedAt",
  extractionRules: "id, sortOrder, urlPattern, updatedAt",
  chatSessions: "id, folderId, archived, sortOrder, updatedAt",
  chatFolders: "id, sortOrder, updatedAt",
  appSettings: "key, updatedAt",
};

function createProvider(): ModelProvider {
  return {
    id: "provider-1",
    name: "主渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createModel(): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "默认 OpenAI",
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

async function deleteDatabaseByName(name: string): Promise<void> {
  await db.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("删除测试数据库被阻塞"));
  });
}

describe("存储仓库", () => {
  afterEach(async () => {
    await clearDatabase();
  });

  it("保存并读取渠道与渠道下模型配置", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);

    expect(await getModelProviders()).toEqual([provider]);
    expect(await getProviderModels("provider-1")).toEqual([model]);
  });

  it("删除渠道时同时删除渠道下模型", async () => {
    const provider = createProvider();
    const model = createModel();

    await saveModelProvider(provider);
    await saveProviderModel(model);
    await deleteModelProvider("provider-1");

    expect(await getModelProviders()).toEqual([]);
    expect(await getProviderModels("provider-1")).toEqual([]);
  });

  it("可以删除单个渠道模型", async () => {
    const model = createModel();

    await saveProviderModel(model);
    await deleteProviderModel("model-1");

    expect(await getProviderModels("provider-1")).toEqual([]);
  });

  it("保存并读取提取规则", async () => {
    const rule: ExtractionRule = {
      id: "rule-1",
      alias: "文章正文",
      urlPattern: "https://example.com/.*",
      selectorsText: "main\n//*[@id='content']",
      sortOrder: 2,
      createdAt: 1,
      updatedAt: 2,
    };

    await saveExtractionRule(rule);

    expect(await getExtractionRules()).toEqual([rule]);
  });

  it("按 sortOrder 读取、移动和删除提取规则", async () => {
    const first: ExtractionRule = {
      id: "rule-first",
      alias: "第一条",
      urlPattern: "https://first.example.com/.*",
      selectorsText: "main",
      sortOrder: 10,
      createdAt: 1,
      updatedAt: 1,
    };
    const second: ExtractionRule = {
      id: "rule-second",
      alias: "第二条",
      urlPattern: "https://second.example.com/.*",
      selectorsText: "article",
      sortOrder: 20,
      createdAt: 2,
      updatedAt: 2,
    };

    await saveExtractionRule(second);
    await saveExtractionRule(first);

    expect((await getExtractionRules()).map((rule) => rule.id)).toEqual(["rule-first", "rule-second"]);

    await moveExtractionRule("rule-second", "up");

    expect((await getExtractionRules()).map((rule) => rule.id)).toEqual(["rule-second", "rule-first"]);

    await deleteExtractionRule("rule-second");

    expect((await getExtractionRules()).map((rule) => rule.id)).toEqual(["rule-first"]);
  });

  it("按 sortOrder 读取、重排和删除 Prompt 模板", async () => {
    const first: PromptTemplate = {
      id: "prompt-first",
      title: "第一条",
      content: "优先总结页面风险",
      sortOrder: 10,
      createdAt: 1,
      updatedAt: 1,
    };
    const second: PromptTemplate = {
      id: "prompt-second",
      title: "第二条",
      content: "输出行动清单",
      sortOrder: 20,
      createdAt: 2,
      updatedAt: 2,
    };

    await savePromptTemplate(second);
    await savePromptTemplate(first);

    expect((await getPromptTemplates()).map((prompt) => prompt.id)).toEqual(["prompt-first", "prompt-second"]);

    await reorderPromptTemplates(["prompt-second", "prompt-first"]);

    expect((await getPromptTemplates()).map((prompt) => prompt.id)).toEqual(["prompt-second", "prompt-first"]);

    await deletePromptTemplate("prompt-second");

    expect((await getPromptTemplates()).map((prompt) => prompt.id)).toEqual(["prompt-first"]);
  });

  it("从 v2 数据库升级时保留旧数据并新增 Prompt 模板表", async () => {
    const provider = createProvider();
    await deleteDatabaseByName(DATABASE_NAME);

    const legacyDb = new Dexie(DATABASE_NAME);
    legacyDb.version(2).stores(LEGACY_VERSION_2_SCHEMA);
    await legacyDb.open();
    await legacyDb.table("modelProviders").put(provider);
    await legacyDb.close();

    await db.open();

    expect(await getModelProviders()).toEqual([provider]);

    const prompt: PromptTemplate = {
      id: "prompt-after-upgrade",
      title: "升级后提示词",
      content: "确认升级后可写入新表",
      sortOrder: 10,
      createdAt: 1,
      updatedAt: 1,
    };
    await savePromptTemplate(prompt);

    expect(await getPromptTemplates()).toEqual([prompt]);
  });

  it("Prompt 模板排序参数无效时保留原顺序并输出告警", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const first: PromptTemplate = {
        id: "prompt-first",
        title: "第一条",
        content: "优先总结页面风险",
        sortOrder: 10,
        createdAt: 1,
        updatedAt: 1,
      };
      const second: PromptTemplate = {
        id: "prompt-second",
        title: "第二条",
        content: "输出行动清单",
        sortOrder: 20,
        createdAt: 2,
        updatedAt: 2,
      };

      await savePromptTemplate(first);
      await savePromptTemplate(second);
      await reorderPromptTemplates(["prompt-second", "missing-prompt"]);

      expect((await getPromptTemplates()).map((prompt) => prompt.id)).toEqual(["prompt-first", "prompt-second"]);
      expect(warnSpy).toHaveBeenCalledWith("[BrowserAIAssistant] Prompt 模板排序参数无效，已忽略本次排序", {
        orderedIds: ["prompt-second", "missing-prompt"],
        existingIds: ["prompt-first", "prompt-second"],
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("保存并读取聊天会话", async () => {
    const session: ChatSession = {
      id: "session-1",
      title: "示例会话",
      folderId: undefined,
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "总结页面",
          createdAt: 1,
          modelId: "model-1",
          endpointType: "openai_chat",
          streamMode: true,
          contextMode: "text",
          matchedRuleId: "rule-1",
          systemPrompt: "你是网页助手",
          contextPrompt: "页面内容",
          promptInvocations: [
            {
              promptId: "prompt-legacy",
              title: "旧提示词",
              contentSnapshot: "旧提示词内容",
            },
          ],
        },
      ],
    };

    await saveChatSession(session);

    expect(await getChatSession("session-1")).toEqual(session);
  });

  it("读取聊天会话时会忽略旧版网络搜索附件字段", async () => {
    const session = {
      id: "session-web-search-dirty",
      title: "脏附件会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-dirty",
          role: "assistant",
          assistantMessageKind: "final-answer",
          content: "旧数据",
          createdAt: 1,
          reasoningContent: { text: "not-string" },
          webSearchContextAttachment: {
            provider: "tavily",
            query: "Tavily",
            results: "not-array",
            createdAt: 1,
            truncated: false,
          },
        },
      ],
    } as unknown as ChatSession;

    await saveChatSession(session);

    const message = (await getChatSession("session-web-search-dirty"))?.messages[0];
    expect(message?.toolAttachments).toBeUndefined();
    expect(message && "webSearchContextAttachment" in message).toBe(false);
    expect(message?.reasoningContent).toBeUndefined();
    expect(message?.assistantMessageKind).toBeUndefined();
  });

  it("读取聊天会话时会忽略旧版网络搜索字段但继续保留新工具附件", async () => {
    const session = {
      id: "session-mixed-tool-attachments",
      title: "混合附件会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-mixed",
          role: "assistant",
          content: "已结合工具结果回答。",
          createdAt: 1,
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
          webSearchContextAttachment: {
            provider: "tavily",
            query: "Chrome Extension",
            answer: "搜索答案",
            results: [{ title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "扩展文档" }],
            createdAt: 2,
            truncated: false,
          },
        },
      ],
    } as unknown as ChatSession;

    await saveChatSession(session);

    const message = (await getChatSession("session-mixed-tool-attachments"))?.messages[0];
    expect(message?.toolAttachments?.map((attachment) => attachment.kind)).toEqual(["network"]);
  });

  it("读取聊天会话时会丢弃旧版 Tavily 当前聊天覆盖字段", async () => {
    const session = {
      id: "session-web-search-overrides",
      title: "旧覆盖会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      chatPreferenceOverrides: {
        webSearchIncludeAnswer: "advanced",
        webSearchIncludeRawContent: "markdown",
        webSearchMaxResults: 12,
        toolCallingEnabled: true,
        enabledToolIds: ["web_search.tavily"],
        networkRelevanceBatchSize: 25,
        browserAutomationMaxToolIterations: 77,
        networkRequestTypeFilters: ["fetch_xhr", "invalid"],
      },
      messages: [],
    } as unknown as ChatSession;

    await saveChatSession(session);

    expect((await getChatSession("session-web-search-overrides"))?.chatPreferenceOverrides).toEqual({
      toolCallingEnabled: true,
      enabledToolIds: ["web_search.tavily"],
      networkRelevanceBatchSize: 25,
      browserAutomationMaxToolIterations: 77,
      networkRequestTypeFilters: ["fetch_xhr"],
    });
  });

  it("保存并读取聊天文件夹", async () => {
    const folder: ChatFolder = {
      id: "folder-1",
      name: "工作资料",
      sortOrder: 10,
      createdAt: 1,
      updatedAt: 2,
    };

    await saveChatFolder(folder);

    expect(await getChatFolders()).toEqual([folder]);
  });

  it("删除聊天文件夹时会话回到默认文件夹", async () => {
    const folder: ChatFolder = {
      id: "folder-1",
      name: "工作资料",
      sortOrder: 10,
      createdAt: 1,
      updatedAt: 1,
    };
    const session: ChatSession = {
      id: "session-1",
      title: "示例会话",
      folderId: "folder-1",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [],
    };

    await saveChatFolder(folder);
    await saveChatSession(session);
    await deleteChatFolder("folder-1");

    expect(await getChatFolders()).toEqual([]);
    expect(await getChatSession("session-1")).toEqual({
      ...session,
      folderId: undefined,
    });
  });

  it("按更新时间倒序读取聊天会话并支持删除", async () => {
    const older: ChatSession = {
      id: "session-old",
      title: "旧会话",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 10,
      messages: [],
    };
    const newer: ChatSession = {
      id: "session-new",
      title: "新会话",
      folderId: "folder-1",
      archived: true,
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 20,
      messages: [],
    };

    await saveChatSession(older);
    await saveChatSession(newer);

    expect((await getChatSessions()).map((session) => session.id)).toEqual(["session-new", "session-old"]);

    await deleteChatSession("session-new");

    expect((await getChatSessions()).map((session) => session.id)).toEqual(["session-old"]);
  });

  it("读取旧聊天会话时补齐新增字段", async () => {
    const legacySession = {
      id: "session-legacy",
      title: "旧会话",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-legacy",
          role: "user" as const,
          content: "总结页面",
          createdAt: 1,
          modelId: "model-1",
          endpointType: "openai_chat" as const,
          streamMode: true,
          systemPrompt: "你是网页助手",
          contextPrompt: "页面内容",
        },
      ],
    };

    await db.chatSessions.put(legacySession as ChatSession);

    const expectedSession: ChatSession = {
      ...legacySession,
      archived: false,
      messages: [
        {
          ...legacySession.messages[0],
          contextMode: "text",
        },
      ],
    };

    expect(await getChatSession("session-legacy")).toEqual(expectedSession);
    expect(await getChatSessions()).toEqual([expectedSession]);
  });

  it("清空数据库会直接清理聊天文件夹", async () => {
    const folder: ChatFolder = {
      id: "folder-clear",
      name: "临时资料",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    await saveChatFolder(folder);
    await clearDatabase();

    expect(await getChatFolders()).toEqual([]);
  });
  it("读取旧网络搜索附件时不会再归一化为通用工具附件", async () => {
    const session = {
      id: "session-web-search-tool-attachment",
      title: "旧附件兼容",
      archived: false,
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "message-web-search-tool-attachment",
          role: "assistant",
          content: "已搜索。",
          createdAt: 1,
          webSearchContextAttachment: {
            provider: "tavily",
            query: "Tavily API",
            results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
            createdAt: 3,
            truncated: false,
          },
        },
      ],
    } as unknown as ChatSession;

    await saveChatSession(session);

    expect((await getChatSession("session-web-search-tool-attachment"))?.messages[0].toolAttachments).toBeUndefined();
  });
});
