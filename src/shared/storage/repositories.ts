import { db } from "./db";
import type { SyncDataSnapshot } from "../sync/types";
import type {
  AppSetting,
  AutomationFlow,
  ChatFolder,
  ChatSession,
  ExtractionRule,
  ModelConfig,
  ModelProvider,
  PromptTemplate,
  ProviderModel,
} from "../types";

export async function saveModelConfig(model: ModelConfig): Promise<void> {
  await db.modelConfigs.put(model);
}

export async function getModelConfigs(): Promise<ModelConfig[]> {
  return db.modelConfigs.orderBy("updatedAt").toArray();
}

export async function saveModelProvider(provider: ModelProvider): Promise<void> {
  await db.modelProviders.put(provider);
}

export async function getModelProviders(): Promise<ModelProvider[]> {
  return db.modelProviders.orderBy("updatedAt").toArray();
}

export async function deleteModelProvider(providerId: string): Promise<void> {
  await db.transaction("rw", [db.modelProviders, db.providerModels], async () => {
    await db.modelProviders.delete(providerId);
    await db.providerModels.where("providerId").equals(providerId).delete();
  });
}

export async function saveProviderModel(model: ProviderModel): Promise<void> {
  await db.providerModels.put(model);
}

export async function getProviderModels(providerId?: string): Promise<ProviderModel[]> {
  const models = providerId
    ? await db.providerModels.where("providerId").equals(providerId).sortBy("updatedAt")
    : await db.providerModels.orderBy("updatedAt").toArray();

  return models;
}

export async function deleteProviderModel(modelId: string): Promise<void> {
  await db.providerModels.delete(modelId);
}

export async function saveAppSetting(setting: AppSetting): Promise<void> {
  await db.appSettings.put(setting);
}

export async function getAppSetting<T = unknown>(key: string): Promise<T | undefined> {
  const setting = await db.appSettings.get(key);
  return setting?.value as T | undefined;
}

export async function saveExtractionRule(rule: ExtractionRule): Promise<void> {
  await db.extractionRules.put(rule);
}

export async function getExtractionRules(): Promise<ExtractionRule[]> {
  return db.extractionRules.orderBy("sortOrder").toArray();
}

export async function deleteExtractionRule(ruleId: string): Promise<void> {
  await db.extractionRules.delete(ruleId);
}

export async function savePromptTemplate(prompt: PromptTemplate): Promise<void> {
  await db.promptTemplates.put(prompt);
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  return db.promptTemplates.orderBy("sortOrder").toArray();
}

export async function deletePromptTemplate(promptId: string): Promise<void> {
  await db.promptTemplates.delete(promptId);
}

export async function reorderPromptTemplates(orderedIds: string[]): Promise<void> {
  await db.transaction("rw", db.promptTemplates, async () => {
    const prompts = await getPromptTemplates();
    const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
    if (orderedIds.length !== prompts.length || orderedIds.some((id) => !promptsById.has(id))) {
      console.warn("[BrowserAIAssistant] Prompt 模板排序参数无效，已忽略本次排序", {
        orderedIds,
        existingIds: prompts.map((prompt) => prompt.id),
      });
      return;
    }

    const now = Date.now();
    await db.promptTemplates.bulkPut(
      orderedIds.map((id, index) => ({
        ...promptsById.get(id)!,
        sortOrder: (index + 1) * 10,
        updatedAt: now,
      })),
    );
  });
}

export async function saveAutomationFlow(flow: AutomationFlow): Promise<void> {
  await db.automationFlows.put(flow);
}

export async function getAutomationFlows(): Promise<AutomationFlow[]> {
  return db.automationFlows.orderBy("updatedAt").reverse().toArray();
}

export async function deleteAutomationFlow(flowId: string): Promise<void> {
  await db.automationFlows.delete(flowId);
}

export async function moveExtractionRule(ruleId: string, direction: "up" | "down"): Promise<void> {
  await db.transaction("rw", db.extractionRules, async () => {
    const rules = await getExtractionRules();
    const currentIndex = rules.findIndex((rule) => rule.id === ruleId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rules.length) {
      return;
    }

    const now = Date.now();
    const currentRule = rules[currentIndex];
    const targetRule = rules[targetIndex];
    await Promise.all([
      db.extractionRules.put({ ...currentRule, sortOrder: targetRule.sortOrder, updatedAt: now }),
      db.extractionRules.put({ ...targetRule, sortOrder: currentRule.sortOrder, updatedAt: now }),
    ]);
  });
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  await db.chatSessions.put(session);
}

export async function getChatSession(id: string): Promise<ChatSession | undefined> {
  const session = await db.chatSessions.get(id);
  return session ? normalizeChatSession(session) : undefined;
}

export async function getChatSessions(): Promise<ChatSession[]> {
  const sessions = await db.chatSessions.orderBy("updatedAt").reverse().toArray();
  return sessions.map(normalizeChatSession);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await db.chatSessions.delete(sessionId);
}

export async function updateChatSession(
  sessionId: string,
  updater: (session: ChatSession) => ChatSession | undefined,
): Promise<ChatSession | undefined> {
  return db.transaction("rw", db.chatSessions, async () => {
    const session = await getChatSession(sessionId);
    if (!session) {
      return undefined;
    }

    const nextSession = updater(session);
    if (!nextSession) {
      return undefined;
    }

    await db.chatSessions.put(nextSession);
    return nextSession;
  });
}

export async function saveChatFolder(folder: ChatFolder): Promise<void> {
  await db.chatFolders.put(folder);
}

export async function getChatFolders(): Promise<ChatFolder[]> {
  return db.chatFolders.orderBy("sortOrder").toArray();
}

export async function deleteChatFolder(folderId: string): Promise<void> {
  await db.transaction("rw", [db.chatFolders, db.chatSessions], async () => {
    await db.chatFolders.delete(folderId);
    const sessions = await db.chatSessions.where("folderId").equals(folderId).toArray();
    await Promise.all(
      sessions.map((session) =>
        db.chatSessions.put({
          ...normalizeChatSession(session),
          folderId: undefined,
        }),
      ),
    );
  });
}

export async function clearDatabase(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.modelConfigs,
      db.modelProviders,
      db.providerModels,
      db.extractionRules,
      db.promptTemplates,
      db.automationFlows,
      db.chatSessions,
      db.chatFolders,
      db.appSettings,
    ],
    async () => {
      await Promise.all([
        db.modelConfigs.clear(),
        db.modelProviders.clear(),
        db.providerModels.clear(),
        db.extractionRules.clear(),
        db.promptTemplates.clear(),
        db.automationFlows.clear(),
        db.chatSessions.clear(),
        db.chatFolders.clear(),
        db.appSettings.clear(),
      ]);
    },
  );
}

export async function exportAllDataForSync(): Promise<SyncDataSnapshot> {
  const [modelConfigs, modelProviders, providerModels, extractionRules, promptTemplates, automationFlows, chatSessions, chatFolders, appSettings] = await Promise.all([
    db.modelConfigs.toArray(),
    db.modelProviders.toArray(),
    db.providerModels.toArray(),
    db.extractionRules.toArray(),
    db.promptTemplates.toArray(),
    db.automationFlows.toArray(),
    db.chatSessions.toArray(),
    db.chatFolders.toArray(),
    db.appSettings.toArray(),
  ]);

  return {
    version: 1,
    modelConfigs,
    modelProviders,
    providerModels,
    extractionRules,
    promptTemplates,
    automationFlows,
    chatSessions: chatSessions.map(normalizeChatSession),
    chatFolders,
    appSettings,
  };
}

export async function replaceAllDataFromSync(snapshot: SyncDataSnapshot): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.modelConfigs,
      db.modelProviders,
      db.providerModels,
      db.extractionRules,
      db.promptTemplates,
      db.automationFlows,
      db.chatSessions,
      db.chatFolders,
      db.appSettings,
    ],
    async () => {
      await Promise.all([
        db.modelConfigs.clear(),
        db.modelProviders.clear(),
        db.providerModels.clear(),
        db.extractionRules.clear(),
        db.promptTemplates.clear(),
        db.automationFlows.clear(),
        db.chatSessions.clear(),
        db.chatFolders.clear(),
        db.appSettings.clear(),
      ]);
      await Promise.all([
        db.modelConfigs.bulkPut(snapshot.modelConfigs),
        db.modelProviders.bulkPut(snapshot.modelProviders),
        db.providerModels.bulkPut(snapshot.providerModels),
        db.extractionRules.bulkPut(snapshot.extractionRules),
        db.promptTemplates.bulkPut(snapshot.promptTemplates ?? []),
        db.automationFlows.bulkPut(snapshot.automationFlows ?? []),
        db.chatSessions.bulkPut(snapshot.chatSessions),
        db.chatFolders.bulkPut(snapshot.chatFolders),
        db.appSettings.bulkPut(snapshot.appSettings),
      ]);
    },
  );
}

function normalizeChatSession(session: ChatSession): ChatSession {
  return {
    ...session,
    archived: session.archived ?? false,
    messages: session.messages.map((message) => ({
      ...message,
      contextMode: message.contextMode ?? "text",
    })),
  };
}
