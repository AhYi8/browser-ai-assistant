import { db } from "./db";
import type { SyncDataSnapshot } from "../sync/types";
import type {
  AppSetting,
  ChatFolder,
  ChatMessage,
  ChatSessionPreferenceOverrides,
  ChatSession,
  ChatToolAttachment,
  ChatToolCallRecord,
  ExtractionRule,
  ModelConfig,
  ModelProvider,
  PromptTemplate,
  ProviderModel,
} from "../types";
import { createNetworkToolAttachment, mergeCompatibleToolAttachments, normalizeToolAttachment } from "../toolArtifacts";
import { normalizeTokenUsageEntries } from "../chat/tokenUsage";

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
        db.chatSessions.clear(),
        db.chatFolders.clear(),
        db.appSettings.clear(),
      ]);
    },
  );
}

export async function exportAllDataForSync(): Promise<SyncDataSnapshot> {
  const [modelConfigs, modelProviders, providerModels, extractionRules, promptTemplates, chatSessions, chatFolders, appSettings] = await Promise.all([
    db.modelConfigs.toArray(),
    db.modelProviders.toArray(),
    db.providerModels.toArray(),
    db.extractionRules.toArray(),
    db.promptTemplates.toArray(),
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
    chatPreferenceOverrides: normalizeChatPreferenceOverrides(session.chatPreferenceOverrides),
    messages: session.messages.map(normalizeChatMessage),
    tokenUsageEntries: normalizeTokenUsageEntries(session.tokenUsageEntries),
  };
}

function normalizeChatPreferenceOverrides(value: unknown): ChatSessionPreferenceOverrides | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const overrides: ChatSessionPreferenceOverrides = {};
  if (typeof source.systemPrompt === "string" && source.systemPrompt.trim()) {
    overrides.systemPrompt = source.systemPrompt;
  }
  if (typeof source.contextCompressionPrompt === "string" && source.contextCompressionPrompt.trim()) {
    overrides.contextCompressionPrompt = source.contextCompressionPrompt;
  }
  if (typeof source.contextCompressionThresholdPercent === "number" && Number.isFinite(source.contextCompressionThresholdPercent)) {
    overrides.contextCompressionThresholdPercent = source.contextCompressionThresholdPercent;
  }
  if (typeof source.browserAutomationMaxToolIterations === "number" && Number.isFinite(source.browserAutomationMaxToolIterations)) {
    overrides.browserAutomationMaxToolIterations = source.browserAutomationMaxToolIterations;
  }
  if (typeof source.toolCallingEnabled === "boolean") {
    overrides.toolCallingEnabled = source.toolCallingEnabled;
  }
  if (Array.isArray(source.enabledToolIds)) {
    overrides.enabledToolIds = source.enabledToolIds.filter((item): item is string => typeof item === "string");
  }
  if (typeof source.temperature === "number" && Number.isFinite(source.temperature)) {
    overrides.temperature = source.temperature;
  }
  if (typeof source.maxTokens === "number" && Number.isFinite(source.maxTokens)) {
    overrides.maxTokens = source.maxTokens;
  }
  if (typeof source.topK === "number" && Number.isFinite(source.topK)) {
    overrides.topK = source.topK;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  // Tavily 旧字段已退出消息协议，读取历史脏数据时必须剥离，避免同步快照或后续保存继续传播。
  const { webSearchContextAttachment: _discardedWebSearchContextAttachment, ...messageWithoutLegacyWebSearch } = message as ChatMessage & {
    webSearchContextAttachment?: unknown;
  };
  const normalizedToolAttachments = normalizeChatToolAttachments(message.toolAttachments);
  const legacyToolAttachments = createLegacyToolAttachments(message);
  const toolAttachments = mergeCompatibleToolAttachments(normalizedToolAttachments, legacyToolAttachments ?? []);
  return {
    ...messageWithoutLegacyWebSearch,
    assistantMessageKind:
      message.assistantMessageKind === "tool_call_turn" || message.assistantMessageKind === "context_summary"
        ? message.assistantMessageKind
        : undefined,
    contextMode: message.contextMode ?? "text",
    reasoningContent: typeof message.reasoningContent === "string" ? message.reasoningContent : undefined,
    toolCallRecords: normalizeChatToolCallRecords(message.toolCallRecords),
    toolAttachments: toolAttachments.length ? toolAttachments : undefined,
    tokenUsageEntryIds: Array.isArray(message.tokenUsageEntryIds)
      ? message.tokenUsageEntryIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : undefined,
  };
}

function createLegacyToolAttachments(message: ChatMessage): ChatToolAttachment[] | undefined {
  const attachments: ChatToolAttachment[] = [];
  if (message.networkContextAttachment) {
    attachments.push(createNetworkToolAttachment(message.networkContextAttachment));
  }
  return attachments.length ? attachments : undefined;
}

function normalizeChatToolCallRecords(value: unknown): ChatToolCallRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const records = value
    .map((item): ChatToolCallRecord | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const source = item as Partial<ChatToolCallRecord>;
      const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "";
      const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : "";
      const toolId = typeof source.toolId === "string" && source.toolId.trim() ? source.toolId.trim() : name;
      const displayName = typeof source.displayName === "string" && source.displayName.trim() ? source.displayName.trim() : name;
      const status = source.status === "success" || source.status === "error" || source.status === "running" ? source.status : undefined;
      if (!id || !name || !status) {
        return undefined;
      }

      return {
        id,
        toolId,
        name,
        displayName,
        arguments: source.arguments && typeof source.arguments === "object" && !Array.isArray(source.arguments) ? source.arguments : {},
        status,
        startedAt: typeof source.startedAt === "number" && Number.isFinite(source.startedAt) ? source.startedAt : Date.now(),
        completedAt: typeof source.completedAt === "number" && Number.isFinite(source.completedAt) ? source.completedAt : undefined,
        resultSummary: typeof source.resultSummary === "string" && source.resultSummary.trim() ? source.resultSummary.trim() : undefined,
        errorMessage: typeof source.errorMessage === "string" && source.errorMessage.trim() ? source.errorMessage.trim() : undefined,
        attachmentIds: Array.isArray(source.attachmentIds) ? source.attachmentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : undefined,
      };
    })
    .filter((item): item is ChatToolCallRecord => Boolean(item));

  return records.length ? records : undefined;
}

function normalizeChatToolAttachments(value: unknown): ChatToolAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeToolAttachment).filter((item): item is ChatToolAttachment => Boolean(item));
}
