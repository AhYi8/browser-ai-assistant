import { afterEach, describe, expect, it } from "vitest";
import { exportSyncSnapshot, restoreSyncSnapshot } from "../../../src/shared/sync/snapshot";
import {
  SYNC_ENCRYPTION_SECRET_KEY,
  SYNC_S3_SECRET_KEY,
  SYNC_WEBDAV_PASSWORD_KEY,
} from "../../../src/shared/sync/settings";
import { MCP_BEARER_TOKEN_SETTING_PREFIX, MCP_SETTINGS_KEY } from "../../../src/shared/mcp/settings";
import {
  clearDatabase,
  getAppSetting,
  getChatSessions,
  getModelProviders,
  getPromptTemplates,
  saveAppSetting,
  saveModelProvider,
  savePromptTemplate,
} from "../../../src/shared/storage/repositories";
import type { ChatSession, ModelProvider, PromptTemplate } from "../../../src/shared/types";

describe("同步快照", () => {
  afterEach(async () => {
    await clearDatabase();
  });

  it("导出当前插件域 IndexedDB 全量业务数据但过滤密钥", async () => {
    const provider: ModelProvider = {
      id: "provider-1",
      name: "渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    await saveModelProvider(provider);
    const prompt: PromptTemplate = {
      id: "prompt-1",
      title: "摘要",
      content: "总结页面重点",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    await savePromptTemplate(prompt);
    await saveAppSetting({ key: "syncEncryptionSecret", value: "secret", updatedAt: 1 });
    await saveAppSetting({ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 1 });

    const snapshot = await exportSyncSnapshot();

    expect(snapshot.modelProviders).toEqual([provider]);
    expect(snapshot.promptTemplates).toEqual([prompt]);
    expect(snapshot.appSettings).toEqual([
      { key: "syncSettings", value: { syncEnabled: true }, updatedAt: 1 },
    ]);
  });

  it("恢复快照会覆盖本地数据", async () => {
    await saveModelProvider({
      id: "old-provider",
      name: "旧渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://old.example.com",
      apiKey: "old",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const session: ChatSession = {
      id: "session-1",
      title: "恢复会话",
      archived: false,
      sortOrder: 2,
      createdAt: 2,
      updatedAt: 2,
      messages: [],
    };

    await restoreSyncSnapshot({
      version: 1,
      modelConfigs: [],
      modelProviders: [],
      providerModels: [],
      extractionRules: [],
      chatSessions: [session],
      chatFolders: [],
      appSettings: [{ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 2 }],
    });

    expect(await getModelProviders()).toEqual([]);
    expect(await getChatSessions()).toEqual([session]);
    await expect(getAppSetting("syncSettings")).resolves.toEqual({ syncEnabled: true });
  });

  it("恢复快照会保留本地同步密钥和远程凭据", async () => {
    await saveAppSetting({ key: SYNC_ENCRYPTION_SECRET_KEY, value: "local-secret", updatedAt: 1 });
    await saveAppSetting({ key: SYNC_WEBDAV_PASSWORD_KEY, value: "webdav-password", updatedAt: 1 });
    await saveAppSetting({ key: SYNC_S3_SECRET_KEY, value: "s3-secret", updatedAt: 1 });

    await restoreSyncSnapshot({
      version: 1,
      modelConfigs: [],
      modelProviders: [],
      providerModels: [],
      extractionRules: [],
      chatSessions: [],
      chatFolders: [],
      appSettings: [{ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 2 }],
    });

    await expect(getAppSetting(SYNC_ENCRYPTION_SECRET_KEY)).resolves.toBe("local-secret");
    await expect(getAppSetting(SYNC_WEBDAV_PASSWORD_KEY)).resolves.toBe("webdav-password");
    await expect(getAppSetting(SYNC_S3_SECRET_KEY)).resolves.toBe("s3-secret");
    await expect(getAppSetting("syncSettings")).resolves.toEqual({ syncEnabled: true });
  });

  it("恢复旧快照时允许缺少 Prompt 模板列表", async () => {
    await savePromptTemplate({
      id: "prompt-local",
      title: "本地提示词",
      content: "本地内容",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    await restoreSyncSnapshot({
      version: 1,
      modelConfigs: [],
      modelProviders: [],
      providerModels: [],
      extractionRules: [],
      chatSessions: [],
      chatFolders: [],
      appSettings: [],
    });

    expect(await getPromptTemplates()).toEqual([]);
  });
});

describe("网络搜索同步快照", () => {
  afterEach(async () => {
    await clearDatabase();
  });

  it("导出同步快照时只过滤 Tavily API Key 并保留非密钥配置", async () => {
    await saveAppSetting({
      key: "webSearchSettings",
      value: {
        provider: "tavily",
        tavily: {
          apiKeysText: "tvly-secret",
          apiKeyStrategy: "random",
          includeAnswer: "advanced",
          includeRawContent: "markdown",
          maxResults: 12,
        },
        updatedAt: 1,
      },
      updatedAt: 1,
    });

    const snapshot = await exportSyncSnapshot();

    expect(snapshot.appSettings.find((setting) => setting.key === "webSearchSettings")).toMatchObject({
      value: {
        provider: "tavily",
        tavily: {
          apiKeysText: "",
          apiKeyStrategy: "random",
          includeAnswer: "advanced",
          includeRawContent: "markdown",
          maxResults: 12,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("tvly-secret");
  });

  it("恢复同步快照时保留本地 Tavily API Key 并应用远端非密钥配置", async () => {
    await saveAppSetting({
      key: "webSearchSettings",
      value: {
        provider: "tavily",
        tavily: {
          apiKeysText: "local-tvly-secret",
          apiKeyStrategy: "round_robin",
          includeAnswer: "basic",
          includeRawContent: false,
          maxResults: 5,
        },
        updatedAt: 1,
      },
      updatedAt: 1,
    });

    await restoreSyncSnapshot({
      version: 1,
      modelConfigs: [],
      modelProviders: [],
      providerModels: [],
      extractionRules: [],
      chatSessions: [],
      chatFolders: [],
      appSettings: [
        {
          key: "webSearchSettings",
          value: {
            provider: "tavily",
            tavily: {
              apiKeysText: "",
              apiKeyStrategy: "random",
              includeAnswer: "advanced",
              includeRawContent: "markdown",
              maxResults: 12,
            },
            updatedAt: 2,
          },
          updatedAt: 2,
        },
      ],
    });

    expect(await getAppSetting("webSearchSettings")).toMatchObject({
      tavily: {
        apiKeysText: "local-tvly-secret",
        apiKeyStrategy: "random",
        includeAnswer: "advanced",
        includeRawContent: "markdown",
        maxResults: 12,
      },
    });
  });
});

describe("MCP 同步快照", () => {
  afterEach(async () => {
    await clearDatabase();
  });

  it("导出同步快照时过滤 MCP Bearer Token 并保留 server 配置", async () => {
    await saveAppSetting({
      key: MCP_SETTINGS_KEY,
      value: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "http://127.0.0.1:3000/mcp",
            enabled: true,
            tools: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      updatedAt: 1,
    });
    await saveAppSetting({ key: `${MCP_BEARER_TOKEN_SETTING_PREFIX}mysql`, value: "mcp-secret", updatedAt: 1 });

    const snapshot = await exportSyncSnapshot();

    expect(snapshot.appSettings.find((setting) => setting.key === MCP_SETTINGS_KEY)).toBeTruthy();
    expect(JSON.stringify(snapshot)).not.toContain("mcp-secret");
  });

  it("恢复同步快照时保留本地 MCP Bearer Token", async () => {
    await saveAppSetting({ key: `${MCP_BEARER_TOKEN_SETTING_PREFIX}mysql`, value: "local-mcp-secret", updatedAt: 1 });

    await restoreSyncSnapshot({
      version: 1,
      modelConfigs: [],
      modelProviders: [],
      providerModels: [],
      extractionRules: [],
      chatSessions: [],
      chatFolders: [],
      appSettings: [
        {
          key: MCP_SETTINGS_KEY,
          value: {
            servers: [
              {
                id: "mysql",
                name: "MySQL",
                endpointUrl: "http://127.0.0.1:3000/mcp",
                enabled: true,
                tools: [],
                createdAt: 2,
                updatedAt: 2,
              },
            ],
          },
          updatedAt: 2,
        },
      ],
    });

    await expect(getAppSetting(`${MCP_BEARER_TOKEN_SETTING_PREFIX}mysql`)).resolves.toBe("local-mcp-secret");
  });
});
