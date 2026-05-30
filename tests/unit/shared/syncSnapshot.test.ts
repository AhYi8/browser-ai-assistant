import { afterEach, describe, expect, it } from "vitest";
import { exportSyncSnapshot, restoreSyncSnapshot } from "../../../src/shared/sync/snapshot";
import {
  SYNC_ENCRYPTION_SECRET_KEY,
  SYNC_S3_SECRET_KEY,
  SYNC_WEBDAV_PASSWORD_KEY,
} from "../../../src/shared/sync/settings";
import {
  clearDatabase,
  getAppSetting,
  getAutomationFlows,
  getChatSessions,
  getModelProviders,
  getPromptTemplates,
  saveAutomationFlow,
  saveAppSetting,
  saveModelProvider,
  savePromptTemplate,
} from "../../../src/shared/storage/repositories";
import type { AutomationFlow, ChatSession, ModelProvider, PromptTemplate } from "../../../src/shared/types";

function createAutomationFlow(): AutomationFlow {
  return {
    id: "automation-flow-1",
    name: "导出订单",
    description: "提取订单列表",
    urlPattern: "https://example\\.com/orders.*",
    sopSteps: ["确认订单范围", "提取列表数据"],
    actions: [{ type: "extractHtml" }],
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    lastRunAt: 3,
    lastRunStatus: "success",
  };
}

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
    const flow = createAutomationFlow();
    await saveAutomationFlow(flow);
    await saveAppSetting({ key: "syncEncryptionSecret", value: "secret", updatedAt: 1 });
    await saveAppSetting({ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 1 });

    const snapshot = await exportSyncSnapshot();

    expect(snapshot.modelProviders).toEqual([provider]);
    expect(snapshot.promptTemplates).toEqual([prompt]);
    expect(snapshot.automationFlows).toEqual([flow]);
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
      automationFlows: [createAutomationFlow()],
      chatSessions: [session],
      chatFolders: [],
      appSettings: [{ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 2 }],
    });

    expect(await getModelProviders()).toEqual([]);
    expect(await getChatSessions()).toEqual([session]);
    expect(await getAutomationFlows()).toEqual([createAutomationFlow()]);
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
      automationFlows: [],
      chatSessions: [],
      chatFolders: [],
      appSettings: [{ key: "syncSettings", value: { syncEnabled: true }, updatedAt: 2 }],
    });

    await expect(getAppSetting(SYNC_ENCRYPTION_SECRET_KEY)).resolves.toBe("local-secret");
    await expect(getAppSetting(SYNC_WEBDAV_PASSWORD_KEY)).resolves.toBe("webdav-password");
    await expect(getAppSetting(SYNC_S3_SECRET_KEY)).resolves.toBe("s3-secret");
    await expect(getAppSetting("syncSettings")).resolves.toEqual({ syncEnabled: true });
  });

  it("恢复旧快照时允许缺少 Prompt 模板列表和自动化流程列表", async () => {
    await savePromptTemplate({
      id: "prompt-local",
      title: "本地提示词",
      content: "本地内容",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await saveAutomationFlow(createAutomationFlow());

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
    expect(await getAutomationFlows()).toEqual([]);
  });
});
