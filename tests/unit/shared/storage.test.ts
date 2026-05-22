import { afterEach, describe, expect, it } from "vitest";
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
} from "../../../src/shared/storage/repositories";
import { db } from "../../../src/shared/storage/db";
import type { ChatFolder, ChatSession, ExtractionRule, ModelProvider, ProviderModel } from "../../../src/shared/types";

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
        },
      ],
    };

    await saveChatSession(session);

    expect(await getChatSession("session-1")).toEqual(session);
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
});
