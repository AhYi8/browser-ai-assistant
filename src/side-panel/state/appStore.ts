import { create, type StoreApi } from "zustand";
import { buildChatRequestMessages } from "../../shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../shared/chat/modelConfig";
import type { RemoteModelInfo } from "../../shared/models/modelCatalog";
import { createTitleGenerationMessages, generateSessionTitle } from "../../shared/models/titleGeneration";
import {
  deleteChatSession,
  deleteExtractionRule,
  deleteModelProvider,
  deleteProviderModel,
  getAppSetting,
  getChatFolders,
  getChatSessions,
  getExtractionRules,
  getModelProviders,
  getProviderModels,
  saveAppSetting,
  saveChatFolder,
  saveChatSession,
  moveExtractionRule,
  saveExtractionRule,
  saveModelProvider,
  saveProviderModel,
  updateChatSession,
} from "../../shared/storage/repositories";
import { validateExtractionRuleDraft } from "../../shared/extractionRules/validation";
import { generateUrlPatternsWithModel } from "../../shared/extractionRules/urlPatternGeneration";
import {
  DEFAULT_SYNC_SECRETS,
  DEFAULT_SYNC_SETTINGS,
  getSyncSecrets,
  getSyncSettings,
  saveSyncSettings,
  SYNC_ENCRYPTION_SECRET_KEY,
  SYNC_S3_SECRET_KEY,
  SYNC_WEBDAV_PASSWORD_KEY,
} from "../../shared/sync/settings";
import type { SyncSecrets, SyncSettings } from "../../shared/sync/types";
import type {
  ChatFolder,
  ChatImageAttachment,
  ChatMessage,
  ChatPreferenceValues,
  ChatSession,
  ChatSessionPreferenceOverrides,
  EndpointType,
  ExtractionRule,
  ModelProvider,
  PageContextExtractMode,
  ProviderModel,
  SendShortcut,
} from "../../shared/types";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";

interface RequestFailure {
  message: string;
}

interface ChannelOperationState {
  loading: boolean;
  message?: string;
  error?: string;
}

interface ModelConnectivityState {
  loading: boolean;
  success?: boolean;
  error?: string;
}

interface PageContextState {
  loading: boolean;
  url?: string;
  text: string;
  extractMode: PageContextExtractMode;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
  error?: string;
}

interface SyncOperationState {
  loading: boolean;
  message?: string;
  error?: string;
}

interface AppState {
  providers: ModelProvider[];
  models: ProviderModel[];
  extractionRules: ExtractionRule[];
  chatSessions: ChatSession[];
  chatFolders: ChatFolder[];
  pageContext: PageContextState;
  remoteModels: Record<string, RemoteModelInfo[]>;
  channelOperations: Record<string, ChannelOperationState>;
  modelConnectivity: Record<string, ModelConnectivityState>;
  selectedModelId: string;
  defaultChatModelId: string;
  chatPreferences: ChatPreferenceValues;
  activeSessionId: string;
  pendingDeleteSessionId?: string;
  composerHasDraft: boolean;
  appendPageContextToSystemPrompt: boolean;
  streamMode: boolean;
  sending: boolean;
  contextMode: PageContextExtractMode;
  syncSettings: SyncSettings;
  syncSecrets: SyncSecrets;
  syncOperation: SyncOperationState;
  failure?: RequestFailure;
  addExampleModel: () => void;
  addProvider: () => ModelProvider;
  updateProvider: (providerId: string, updates: Partial<Pick<ModelProvider, "name" | "endpointType" | "endpointUrl" | "apiKey">>) => void;
  addModel: (providerId: string) => ProviderModel;
  addRemoteModel: (providerId: string, remoteModel: RemoteModelInfo) => ProviderModel;
  updateModel: (modelId: string, updates: Partial<Pick<ProviderModel, "displayName" | "modelId" | "temperature" | "maxTokens" | "topK" | "systemPrompt" | "supportsVision">>) => void;
  setTitleModel: (modelId: string) => void;
  setDefaultChatModel: (modelId: string) => Promise<void>;
  updateChatPreferences: (updates: Partial<ChatPreferenceValues>) => Promise<void>;
  updateActiveSessionChatPreferences: (updates: ChatSessionPreferenceOverrides) => Promise<void>;
  deleteProvider: (providerId: string) => void;
  deleteModel: (modelId: string) => void;
  loadChannelConfig: () => Promise<void>;
  loadChatData: () => Promise<void>;
  createChatSession: (options?: { preserveSelectedModel?: boolean }) => Promise<ChatSession>;
  selectChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, title: string) => Promise<void>;
  archiveChatSession: (sessionId: string) => Promise<void>;
  requestDeleteChatSession: (sessionId: string) => void;
  confirmDeleteChatSession: (sessionId: string) => Promise<void>;
  clearPendingDeleteSession: () => void;
  createChatFolder: (name: string) => Promise<ChatFolder>;
  renameChatFolder: (folderId: string, name: string) => Promise<void>;
  moveChatSessionToFolder: (sessionId: string, folderId: string | undefined) => Promise<void>;
  loadExtractionRules: () => Promise<void>;
  saveRuleDraft: (ruleId: string | undefined, draft: Pick<ExtractionRule, "alias" | "urlPattern" | "selectorsText">) => Promise<{ ok: true; rule: ExtractionRule } | { ok: false; message: string }>;
  deleteRule: (ruleId: string) => Promise<void>;
  moveRule: (ruleId: string, direction: "up" | "down") => Promise<void>;
  refreshPageContext: () => Promise<void>;
  generateUrlPatterns: (modelId?: string) => Promise<{ ok: true; patterns: string[] } | { ok: false; message: string }>;
  fetchRemoteModels: (providerId: string) => Promise<void>;
  testModel: (providerId: string, modelId: string) => Promise<void>;
  selectModel: (modelId: string) => void;
  setComposerHasDraft: (hasDraft: boolean) => void;
  setAppendPageContextToSystemPrompt: (enabled: boolean) => void;
  setStreamMode: (streamMode: boolean) => void;
  setContextMode: (contextMode: PageContextExtractMode) => void;
  loadSyncSettings: () => Promise<void>;
  updateSyncSettings: (updates: Partial<SyncSettings>) => Promise<void>;
  updateSyncSecret: (key: keyof SyncSecrets, value: string) => Promise<void>;
  backupNow: () => Promise<void>;
  restoreNow: () => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatImageAttachment[]) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  reset: () => void;
}

const exampleProvider: ModelProvider = {
  id: "provider-1",
  name: "默认渠道",
  endpointType: "openai_chat",
  endpointUrl: "https://api.example.com/v1/chat/completions",
  apiKey: "sk-example",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const exampleModel: ProviderModel = {
  id: "model-1",
  providerId: exampleProvider.id,
  displayName: "默认 OpenAI",
  modelId: "gpt-test",
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: "你是网页助手",
  isTitleModel: false,
  supportsVision: false,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const DEFAULT_CHAT_PREFERENCES: ChatPreferenceValues = {
  systemPrompt: "你是网页助手",
  temperature: 0.7,
  maxTokens: 1024,
  topK: undefined,
  sendShortcut: "enter",
  historyDrawerDefaultOpen: true,
};

export const useAppStore = create<AppState>()((set, get) => ({
  providers: [],
  models: [],
  extractionRules: [],
  chatSessions: [],
  chatFolders: [],
  pageContext: {
    loading: false,
    text: "",
    extractMode: "text",
    truncated: false,
    usedFallback: true,
  },
  remoteModels: {},
  channelOperations: {},
  modelConnectivity: {},
  selectedModelId: "",
  defaultChatModelId: "",
  chatPreferences: DEFAULT_CHAT_PREFERENCES,
  activeSessionId: "",
  composerHasDraft: false,
  appendPageContextToSystemPrompt: true,
  streamMode: true,
  sending: false,
  contextMode: "text",
  syncSettings: DEFAULT_SYNC_SETTINGS,
  syncSecrets: DEFAULT_SYNC_SECRETS,
  syncOperation: {
    loading: false,
  },
  addExampleModel: () =>
    set(() => {
      void saveModelProvider(exampleProvider);
      void saveProviderModel(exampleModel);

      return {
        providers: [exampleProvider],
        models: [exampleModel],
        selectedModelId: exampleModel.id,
      };
    }),
  addProvider: () => {
    const now = Date.now();
    const index = get().providers.length + 1;
    const provider: ModelProvider = {
      id: `provider-${now}-${index}`,
      name: `新渠道 ${index}`,
      endpointType: "openai_chat",
      endpointUrl: "https://api.openai.com",
      apiKey: "",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({ providers: [...state.providers, provider] }));
    void saveModelProvider(provider);
    return provider;
  },
  updateProvider: (providerId, updates) =>
    set((state) => {
      const providers = state.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              ...updates,
              endpointType: updates.endpointType ? (updates.endpointType as EndpointType) : provider.endpointType,
              updatedAt: Date.now(),
            }
          : provider,
      );
      const updatedProvider = providers.find((provider) => provider.id === providerId);

      if (updatedProvider) {
        void saveModelProvider(updatedProvider);
      }

      return { providers };
    }),
  addModel: (providerId) => createAndStoreModel(providerId, get, set),
  addRemoteModel: (providerId, remoteModel) =>
    createAndStoreModel(providerId, get, set, {
      displayName: remoteModel.displayName,
      modelId: remoteModel.id,
    }),
  updateModel: (modelId, updates) =>
    set((state) => {
      const models = state.models.map((model) =>
        model.id === modelId
          ? {
              ...model,
              ...updates,
              updatedAt: Date.now(),
            }
          : model,
      );
      const updatedModel = models.find((model) => model.id === modelId);

      if (updatedModel) {
        void saveProviderModel(updatedModel);
      }

      return { models };
    }),
  setTitleModel: (modelId) =>
    set((state) => {
      const now = Date.now();
      const models = state.models.map((model) => {
        const isTitleModel = Boolean(modelId) && model.id === modelId;
        if (model.isTitleModel === isTitleModel) {
          return model;
        }

        return {
          ...model,
          isTitleModel,
          updatedAt: now,
        };
      });

      // 标题生成模型是全局唯一配置；保存所有变化项，避免刷新后出现多个标题模型。
      void Promise.all(models.filter((model, index) => model !== state.models[index]).map(saveProviderModel));

      return { models };
    }),
  setDefaultChatModel: async (modelId) => {
    const normalizedModelId = modelId.trim();

    await saveAppSetting({
      key: "defaultChatModelId",
      value: normalizedModelId,
      updatedAt: Date.now(),
    });

    set({ defaultChatModelId: normalizedModelId });
  },
  updateChatPreferences: async (updates) => {
    const preferences = normalizeChatPreferences({
      ...get().chatPreferences,
      ...updates,
    });

    await saveAppSetting({
      key: "chatPreferences",
      value: preferences,
      updatedAt: Date.now(),
    });

    set({ chatPreferences: preferences });
  },
  updateActiveSessionChatPreferences: async (updates) => {
    const state = get();
    const now = Date.now();
    const existingSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    const activeSession =
      existingSession ??
      ({
        id: `session-${now}`,
        title: "新对话",
        archived: false,
        sortOrder: now,
        createdAt: now,
        updatedAt: now,
        messages: [],
      } satisfies ChatSession);
    const chatPreferenceOverrides = normalizeChatPreferenceOverrides({
      ...activeSession.chatPreferenceOverrides,
      ...updates,
    });
    const nextSession: ChatSession = {
      ...activeSession,
      updatedAt: now,
      chatPreferenceOverrides,
    };

    await saveChatSession(nextSession);
    set((current) => ({
      activeSessionId: nextSession.id,
      chatSessions: upsertSession(current.chatSessions, nextSession),
    }));
  },
  deleteProvider: (providerId) =>
    set((state) => {
      const removedModelIds = new Set(state.models.filter((model) => model.providerId === providerId).map((model) => model.id));
      const models = state.models.filter((model) => model.providerId !== providerId);
      const selectedModelId = removedModelIds.has(state.selectedModelId) ? models[0]?.id ?? "" : state.selectedModelId;
      const shouldClearDefaultChatModel = removedModelIds.has(state.defaultChatModelId);
      const defaultChatModelId = shouldClearDefaultChatModel ? "" : state.defaultChatModelId;
      const { [providerId]: _remoteModels, ...remoteModels } = state.remoteModels;
      const { [providerId]: _operation, ...channelOperations } = state.channelOperations;
      const modelConnectivity = Object.fromEntries(
        Object.entries(state.modelConnectivity).filter(([modelId]) => !removedModelIds.has(modelId)),
      );

      removedModelIds.forEach(clearModelConnectivityResetTimer);

      void deleteModelProvider(providerId);
      if (shouldClearDefaultChatModel) {
        // 默认对话模型不能指向已删除模型，否则刷新后会留下无效配置。
        void saveAppSetting({ key: "defaultChatModelId", value: "", updatedAt: Date.now() });
      }

      return {
        providers: state.providers.filter((provider) => provider.id !== providerId),
        models,
        selectedModelId,
        defaultChatModelId,
        remoteModels,
        channelOperations,
        modelConnectivity,
      };
    }),
  deleteModel: (modelId) =>
    set((state) => {
      const models = state.models.filter((model) => model.id !== modelId);
      const selectedModelId = state.selectedModelId === modelId ? models[0]?.id ?? "" : state.selectedModelId;
      const shouldClearDefaultChatModel = state.defaultChatModelId === modelId;
      const defaultChatModelId = shouldClearDefaultChatModel ? "" : state.defaultChatModelId;
      const { [modelId]: _operation, ...modelConnectivity } = state.modelConnectivity;

      clearModelConnectivityResetTimer(modelId);

      void deleteProviderModel(modelId);
      if (shouldClearDefaultChatModel) {
        // 默认对话模型不能指向已删除模型，否则刷新后会留下无效配置。
        void saveAppSetting({ key: "defaultChatModelId", value: "", updatedAt: Date.now() });
      }

      return {
        models,
        selectedModelId,
        defaultChatModelId,
        modelConnectivity,
      };
    }),
  loadChannelConfig: async () => {
    const [providers, models, savedDefaultChatModelId, savedChatPreferences] = await Promise.all([
      getModelProviders(),
      getProviderModels(),
      getAppSetting<string>("defaultChatModelId"),
      getAppSetting<Partial<ChatPreferenceValues>>("chatPreferences"),
    ]);
    const defaultChatModelId = resolveConfiguredModelId(savedDefaultChatModelId ?? "", models, providers);
    const currentSelectedModelId = get().selectedModelId;
    const selectedModelStillExists = Boolean(
      currentSelectedModelId && resolveAvailableModelId(currentSelectedModelId, models, providers) === currentSelectedModelId,
    );

    set({
      providers,
      models,
      defaultChatModelId,
      chatPreferences: normalizeChatPreferences(savedChatPreferences),
      selectedModelId: selectedModelStillExists ? currentSelectedModelId : (defaultChatModelId || resolveAvailableModelId("", models, providers)),
    });
  },
  loadChatData: async () => {
    const [chatSessions, chatFolders] = await Promise.all([getChatSessions(), getChatFolders()]);
    set((state) => ({
      chatSessions,
      chatFolders,
      activeSessionId:
        state.activeSessionId && chatSessions.some((session) => session.id === state.activeSessionId)
          ? state.activeSessionId
          : (chatSessions[0]?.id ?? ""),
    }));
  },
  createChatSession: async (options) => {
    const now = Date.now();
    const currentState = get();
    const selectedModelId = options?.preserveSelectedModel
      ? resolveAvailableModelId(currentState.selectedModelId, currentState.models, currentState.providers)
      : resolveAvailableModelId(currentState.defaultChatModelId, currentState.models, currentState.providers);
    const session: ChatSession = {
      id: `session-${now}`,
      title: "新对话",
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    await saveChatSession(session);
    set((state) => ({
      chatSessions: [session, ...state.chatSessions],
      activeSessionId: session.id,
      selectedModelId,
      pendingDeleteSessionId: undefined,
    }));
    return session;
  },
  selectChatSession: (sessionId) => set({ activeSessionId: sessionId, pendingDeleteSessionId: undefined }),
  renameChatSession: async (sessionId, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    const session = get().chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    const updatedSession = { ...session, title: trimmedTitle, titleGenerating: false };
    await saveChatSession(updatedSession);
    set((state) => ({
      chatSessions: state.chatSessions.map((item) => (item.id === sessionId ? updatedSession : item)),
    }));
  },
  archiveChatSession: async (sessionId) => {
    const session = get().chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    const updatedSession = { ...session, archived: true, updatedAt: Date.now() };
    await saveChatSession(updatedSession);
    set((state) => ({
      chatSessions: state.chatSessions.map((item) => (item.id === sessionId ? updatedSession : item)),
      pendingDeleteSessionId: undefined,
    }));
  },
  requestDeleteChatSession: (sessionId) => set({ pendingDeleteSessionId: sessionId }),
  confirmDeleteChatSession: async (sessionId) => {
    await deleteChatSession(sessionId);
    set((state) => {
      const chatSessions = state.chatSessions.filter((session) => session.id !== sessionId);
      return {
        chatSessions,
        activeSessionId: state.activeSessionId === sessionId ? (chatSessions[0]?.id ?? "") : state.activeSessionId,
        pendingDeleteSessionId: undefined,
      };
    });
  },
  clearPendingDeleteSession: () => set({ pendingDeleteSessionId: undefined }),
  createChatFolder: async (name) => {
    const now = Date.now();
    const folder: ChatFolder = {
      id: `folder-${now}`,
      name: name.trim() || "新文件夹",
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
    };
    await saveChatFolder(folder);
    set((state) => ({ chatFolders: [...state.chatFolders, folder] }));
    return folder;
  },
  renameChatFolder: async (folderId, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    if (!get().chatFolders.some((item) => item.id === folderId)) {
      return;
    }

    try {
      const latestFolder = get().chatFolders.find((item) => item.id === folderId);
      if (!latestFolder) {
        return;
      }

      const updatedAt = Date.now();
      await saveChatFolder({ ...latestFolder, name: trimmedName, updatedAt });
      set((state) => {
        const currentFolder = state.chatFolders.find((item) => item.id === folderId);
        if (!currentFolder) {
          return {};
        }

        return {
          chatFolders: state.chatFolders.map((item) =>
            item.id === folderId ? { ...item, name: trimmedName, updatedAt } : item,
          ),
        };
      });
    } catch {
      set({ failure: { message: "文件夹保存失败，请重试" } });
    }
  },
  moveChatSessionToFolder: async (sessionId, folderId) => {
    const initialState = get();
    const initialSession = initialState.chatSessions.find((item) => item.id === sessionId);
    if (!initialSession || initialSession.archived) {
      return;
    }

    if (folderId && !initialState.chatFolders.some((folder) => folder.id === folderId)) {
      return;
    }

    try {
      const latestState = get();
      const latestSession = latestState.chatSessions.find((item) => item.id === sessionId);
      if (!latestSession || latestSession.archived || (folderId && !latestState.chatFolders.some((folder) => folder.id === folderId))) {
        return;
      }

      const updatedAt = Date.now();
      await saveChatSession({ ...latestSession, folderId, updatedAt });
      set((current) => {
        const currentSession = current.chatSessions.find((item) => item.id === sessionId);
        if (!currentSession || currentSession.archived || (folderId && !current.chatFolders.some((folder) => folder.id === folderId))) {
          return {};
        }

        return {
          chatSessions: current.chatSessions.map((item) =>
            item.id === sessionId ? { ...item, folderId, updatedAt } : item,
          ),
          pendingDeleteSessionId: undefined,
        };
      });
    } catch {
      set({ failure: { message: "会话移动失败，请重试" } });
    }
  },
  loadExtractionRules: async () => {
    const extractionRules = await getExtractionRules();
    set({ extractionRules });
  },
  saveRuleDraft: async (ruleId, draft) => {
    const validation = validateExtractionRuleDraft(draft);
    if (!validation.ok) {
      return validation;
    }

    const now = Date.now();
    const existingRule = ruleId ? get().extractionRules.find((rule) => rule.id === ruleId) : undefined;
    const nextSortOrder =
      existingRule?.sortOrder ?? Math.max(0, ...get().extractionRules.map((rule) => rule.sortOrder)) + 10;
    const rule: ExtractionRule = {
      id: existingRule?.id ?? `rule-${now}`,
      alias: draft.alias.trim(),
      urlPattern: draft.urlPattern.trim(),
      selectorsText: draft.selectorsText.trim(),
      sortOrder: nextSortOrder,
      createdAt: existingRule?.createdAt ?? now,
      updatedAt: now,
    };

    await saveExtractionRule(rule);
    await get().loadExtractionRules();
    void get().refreshPageContext();
    return { ok: true, rule };
  },
  deleteRule: async (ruleId) => {
    await deleteExtractionRule(ruleId);
    await get().loadExtractionRules();
    void get().refreshPageContext();
  },
  moveRule: async (ruleId, direction) => {
    await moveExtractionRule(ruleId, direction);
    await get().loadExtractionRules();
    void get().refreshPageContext();
  },
  refreshPageContext: async () => {
    const requestedContextMode = get().contextMode;
    const requestId = ++pageContextRefreshSequence;
    set((state) => ({
      pageContext: {
        ...state.pageContext,
        extractMode: requestedContextMode,
        loading: true,
        error: undefined,
      },
    }));

    const response = await sendRuntimeMessage<
      | {
          ok: true;
          url?: string;
          text: string;
          truncated: boolean;
          usedFallback: boolean;
          matchedRuleId?: string;
        }
      | { ok: false; message?: string }
    >({
      type: "pageContext.extract",
      rules: get().extractionRules,
      maxLength: undefined,
      extractMode: requestedContextMode,
    });

    if (requestId !== pageContextRefreshSequence) {
      return;
    }

    if (!response) {
      set((state) => ({
        pageContext: {
          ...state.pageContext,
          loading: false,
          error: "提取当前页面失败",
        },
      }));
      return;
    }

    if (response.ok) {
      set({
        pageContext: {
          loading: false,
          url: response.url,
          text: response.text,
          extractMode: requestedContextMode,
          truncated: response.truncated,
          usedFallback: response.usedFallback,
          matchedRuleId: response.matchedRuleId,
        },
      });
      return;
    }

    set((state) => ({
      pageContext: {
        ...state.pageContext,
        loading: false,
        error: response.message ?? "提取当前页面失败",
      },
    }));
  },
  generateUrlPatterns: async (modelId) => {
    const state = get();
    const debugRequestId = `url-pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.debug(`${DEBUG_PREFIX} 前端开始生成 URL 正则`, {
      debugRequestId,
      requestedModelId: modelId,
      providerCount: state.providers.length,
      modelCount: state.models.length,
      selectedModelId: state.selectedModelId,
      pageContextUrl: state.pageContext.url,
    });

    const model = modelId
      ? state.models.find((item) => item.id === modelId)
      : state.models.find((item) => item.id === state.selectedModelId) ?? state.models.find((item) => item.enabled);
    const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
    if (!provider || !model) {
      console.warn(`${DEBUG_PREFIX} 前端未找到可用模型或渠道`, {
        debugRequestId,
        requestedModelId: modelId,
        foundModel: Boolean(model),
        foundProvider: Boolean(provider),
      });
      return { ok: false, message: "请先配置可用模型后再使用 AI 生成" };
    }

    const urlResult = state.pageContext.url
      ? ({ ok: true, url: state.pageContext.url } as const)
      : await getCurrentTabUrlForGeneration(debugRequestId);
    if (!urlResult.ok) {
      console.warn(`${DEBUG_PREFIX} 前端获取当前 URL 失败`, {
        debugRequestId,
        message: urlResult.message,
      });
      return { ok: false, message: urlResult.message };
    }

    console.debug(`${DEBUG_PREFIX} 前端准备直接调用模型生成`, {
      debugRequestId,
      providerId: provider.id,
      providerName: provider.name,
      endpointType: provider.endpointType,
      endpointUrl: provider.endpointUrl,
      modelId: model.id,
      modelName: model.displayName,
      modelValue: model.modelId,
      url: urlResult.url,
    });

    try {
      const response = await generateUrlPatternsWithModel(provider, model, urlResult.url);

      console.debug(`${DEBUG_PREFIX} 前端收到生成响应`, {
        debugRequestId,
        response,
      });

      return response.ok ? response : { ok: false, message: response.message ?? "AI 生成失败" };
    } catch (error) {
      console.error(`${DEBUG_PREFIX} 前端生成流程异常`, {
        debugRequestId,
        error,
      });
      return { ok: false, message: "AI 生成失败" };
    }
  },
  fetchRemoteModels: async (providerId) => {
    const provider = get().providers.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }

    setChannelOperation(set, providerId, { loading: true });

    const response = await sendRuntimeMessage<{ ok: boolean; models?: RemoteModelInfo[]; message?: string }>({
      type: "modelCatalog.list",
      provider,
    });

    if (response.ok) {
      set((state) => ({
        remoteModels: {
          ...state.remoteModels,
          [providerId]: response.models ?? [],
        },
        channelOperations: {
          ...state.channelOperations,
          [providerId]: {
            loading: false,
            message: "模型列表获取成功",
          },
        },
      }));
      return;
    }

    setChannelOperation(set, providerId, { loading: false, error: response.message ?? "获取模型列表失败" });
  },
  testModel: async (providerId, modelId) => {
    const provider = get().providers.find((item) => item.id === providerId);
    const model = get().models.find((item) => item.id === modelId);
    if (!provider || !model) {
      return;
    }

    setModelConnectivity(set, modelId, { loading: true });

    const response = await sendRuntimeMessage<{ ok: boolean; message: string }>({
      type: "modelCatalog.test",
      provider,
      model,
    });

    if (response.ok) {
      setModelConnectivity(set, modelId, { loading: false, success: true });
      scheduleModelConnectivityReset(set, modelId);
      return;
    }

    setModelConnectivity(set, modelId, { loading: false, error: response.message });
  },
  selectModel: (modelId) => set({ selectedModelId: modelId }),
  setComposerHasDraft: (hasDraft) => set({ composerHasDraft: hasDraft }),
  setAppendPageContextToSystemPrompt: (enabled) => set({ appendPageContextToSystemPrompt: enabled }),
  setStreamMode: (streamMode) => set({ streamMode }),
  setContextMode: (contextMode) => {
    set((state) => ({
      contextMode,
      pageContext: {
        ...state.pageContext,
        extractMode: contextMode,
      },
    }));
    void get().refreshPageContext();
  },
  loadSyncSettings: async () => {
    const [syncSettings, syncSecrets] = await Promise.all([getSyncSettings(), getSyncSecrets()]);
    set({ syncSettings, syncSecrets });
  },
  updateSyncSettings: async (updates) => {
    const current = get().syncSettings;
    const syncSettings: SyncSettings = {
      ...current,
      ...updates,
      webdav: {
        ...current.webdav,
        ...updates.webdav,
      },
      s3: {
        ...current.s3,
        ...updates.s3,
      },
    };

    await saveSyncSettings(syncSettings);
    set({ syncSettings });

    if (updates.autoSyncEnabled !== undefined || updates.intervalMinutes !== undefined || updates.syncEnabled !== undefined) {
      await sendRuntimeMessage({ type: "sync.configureAlarm", settings: syncSettings });
    }
  },
  updateSyncSecret: async (key, value) => {
    const normalizedValue = value.trim();

    await saveAppSetting({
      key: getSyncSecretSettingKey(key),
      value: normalizedValue,
      updatedAt: Date.now(),
    });
    set((state) => ({
      syncSecrets: {
        ...state.syncSecrets,
        [key]: normalizedValue,
      },
    }));

  },
  backupNow: async () => {
    set({ syncOperation: { loading: true } });
    const response = await sendRuntimeMessage<{ ok: boolean; message?: string }>({ type: "sync.backupNow" });
    set({
      syncOperation: response?.ok
        ? { loading: false, message: response.message ?? "备份完成" }
        : { loading: false, error: response?.message ?? "备份失败，请重试" },
    });
  },
  restoreNow: async () => {
    set({ syncOperation: { loading: true } });
    const response = await sendRuntimeMessage<{ ok: boolean; message?: string }>({ type: "sync.restoreNow" });

    if (response?.ok) {
      // 恢复已经在后台完成覆盖写入；这里并行刷新互不依赖的前端状态，避免串行等待拖慢恢复反馈。
      await Promise.all([get().loadChannelConfig(), get().loadChatData(), get().loadExtractionRules(), get().loadSyncSettings()]);
      set({ syncOperation: { loading: false, message: response.message ?? "恢复完成" } });
      return;
    }

    set({ syncOperation: { loading: false, error: response?.message ?? "恢复失败，请重试" } });
  },
  sendChatMessage: (content, attachments = []) => sendChatMessageWithState({ content, attachments, get, set }),
  regenerateMessage: (messageId) => regenerateChatMessage({ messageId, get, set }),
  reset: () => {
    clearAllModelConnectivityResetTimers();
    pageContextRefreshSequence += 1;

    set({
      providers: [],
      models: [],
      extractionRules: [],
      chatSessions: [],
      chatFolders: [],
      pageContext: {
        loading: false,
        text: "",
        extractMode: "text",
        truncated: false,
        usedFallback: true,
      },
      remoteModels: {},
      channelOperations: {},
      modelConnectivity: {},
      selectedModelId: "",
      defaultChatModelId: "",
      chatPreferences: DEFAULT_CHAT_PREFERENCES,
      activeSessionId: "",
      pendingDeleteSessionId: undefined,
      composerHasDraft: false,
      appendPageContextToSystemPrompt: true,
      streamMode: true,
      sending: false,
      contextMode: "text",
      syncSettings: DEFAULT_SYNC_SETTINGS,
      syncSecrets: DEFAULT_SYNC_SECRETS,
      syncOperation: {
        loading: false,
      },
      failure: undefined,
    });
  },
}));

let pageContextRefreshSequence = 0;

function resolveAvailableModelId(modelId: string, models: ProviderModel[], providers: ModelProvider[]): string {
  const availableModels = models.filter((model) => {
    const provider = providers.find((item) => item.id === model.providerId);
    return model.enabled && provider?.enabled;
  });

  if (modelId && availableModels.some((model) => model.id === modelId)) {
    return modelId;
  }

  return availableModels[0]?.id ?? "";
}

function resolveConfiguredModelId(modelId: string, models: ProviderModel[], providers: ModelProvider[]): string {
  if (!modelId) {
    return "";
  }

  const resolvedModelId = resolveAvailableModelId(modelId, models, providers);
  return resolvedModelId === modelId ? modelId : "";
}

function createDefaultSessionTitle(content: string): string {
  return content.length > 20 ? `${content.slice(0, 20)}...` : content;
}

function normalizeChatPreferences(value?: Partial<ChatPreferenceValues>): ChatPreferenceValues {
  return {
    systemPrompt:
      typeof value?.systemPrompt === "string" && value.systemPrompt.trim()
        ? value.systemPrompt.trim()
        : DEFAULT_CHAT_PREFERENCES.systemPrompt,
    temperature: normalizeNumber(value?.temperature, DEFAULT_CHAT_PREFERENCES.temperature, 0, 2),
    maxTokens: Math.round(normalizeNumber(value?.maxTokens, DEFAULT_CHAT_PREFERENCES.maxTokens, 1, 200_000)),
    topK: normalizeOptionalInteger(value?.topK, 1, 1_000),
    sendShortcut: normalizeSendShortcut(value?.sendShortcut),
    historyDrawerDefaultOpen: value?.historyDrawerDefaultOpen ?? DEFAULT_CHAT_PREFERENCES.historyDrawerDefaultOpen,
  };
}

function normalizeSendShortcut(value: unknown): SendShortcut {
  return isSendShortcutValue(value) ? value : DEFAULT_CHAT_PREFERENCES.sendShortcut;
}

function isSendShortcutValue(value: unknown): value is SendShortcut {
  return typeof value === "string" && ["enter", "shift_enter", "ctrl_enter", "ctrl_shift_enter", "alt_enter"].includes(value);
}

function normalizeChatPreferenceOverrides(value?: ChatSessionPreferenceOverrides): ChatSessionPreferenceOverrides {
  const overrides: ChatSessionPreferenceOverrides = {};

  if (typeof value?.systemPrompt === "string" && value.systemPrompt.trim()) {
    overrides.systemPrompt = value.systemPrompt.trim();
  }
  if (value?.temperature !== undefined) {
    overrides.temperature = normalizeNumber(value.temperature, DEFAULT_CHAT_PREFERENCES.temperature, 0, 2);
  }
  if (value?.maxTokens !== undefined) {
    overrides.maxTokens = Math.round(normalizeNumber(value.maxTokens, DEFAULT_CHAT_PREFERENCES.maxTokens, 1, 200_000));
  }
  if (value?.topK !== undefined) {
    overrides.topK = normalizeOptionalInteger(value.topK, 1, 1_000);
  }

  return overrides;
}

function resolveEffectiveChatPreferences(
  preferences: ChatPreferenceValues,
  overrides?: ChatSessionPreferenceOverrides,
): Required<Pick<ChatSessionPreferenceOverrides, "systemPrompt" | "temperature" | "maxTokens">> &
  Pick<ChatSessionPreferenceOverrides, "topK"> {
  const normalizedOverrides = normalizeChatPreferenceOverrides({
    systemPrompt: overrides?.systemPrompt ?? preferences.systemPrompt,
    temperature: overrides?.temperature ?? preferences.temperature,
    maxTokens: overrides?.maxTokens ?? preferences.maxTokens,
    topK: overrides?.topK ?? preferences.topK,
  });

  return {
    systemPrompt: normalizedOverrides.systemPrompt ?? preferences.systemPrompt,
    temperature: normalizedOverrides.temperature ?? preferences.temperature,
    maxTokens: normalizedOverrides.maxTokens ?? preferences.maxTokens,
    topK: normalizedOverrides.topK,
  };
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function normalizeOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return Math.round(normalizeNumber(value, min, min, max));
}

function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const nextSessions = sessions.filter((item) => item.id !== session.id);
  return [session, ...nextSessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

function getSyncSecretSettingKey(key: keyof SyncSecrets): string {
  if (key === "webDavPassword") {
    return SYNC_WEBDAV_PASSWORD_KEY;
  }
  if (key === "s3SecretKey") {
    return SYNC_S3_SECRET_KEY;
  }

  return SYNC_ENCRYPTION_SECRET_KEY;
}

async function getCurrentTabUrlForGeneration(debugRequestId: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  console.debug(`${DEBUG_PREFIX} 前端请求后台读取当前标签页 URL`, {
    debugRequestId,
  });

  const response = await sendRuntimeMessage<{ ok: true; url: string } | { ok: false; message?: string }>({
    type: "extractionRule.getCurrentTabUrl",
    debugRequestId,
  });

  console.debug(`${DEBUG_PREFIX} 前端收到当前标签页 URL 响应`, {
    debugRequestId,
    response,
    runtimeLastError: globalThis.chrome?.runtime?.lastError?.message,
  });

  if (!response) {
    return { ok: false, message: "未获取到当前页面 URL" };
  }

  return response.ok ? response : { ok: false, message: response.message ?? "未获取到当前页面 URL" };
}

type StoreGetter = StoreApi<AppState>["getState"];
type StoreSetter = StoreApi<AppState>["setState"];

type ChatSendMessage = {
  type: "chat.send";
  model: ReturnType<typeof createModelConfig>;
  messages: ChatMessage[];
  stream: boolean;
};

interface SendChatMessageWithStateInput {
  content: string;
  attachments?: ChatImageAttachment[];
  get: StoreGetter;
  set: StoreSetter;
}

interface RegenerateChatMessageInput {
  messageId: string;
  get: StoreGetter;
  set: StoreSetter;
}

interface RunChatRequestInput {
  state: AppState;
  session: ChatSession;
  userMessage: ChatMessage;
  existingMessages: ChatMessage[];
  nextMessages: ChatMessage[];
  shouldGenerateTitle: boolean;
  nextTitle: string;
  fallbackTitle: string;
  model: ProviderModel;
  provider: ModelProvider;
  get: StoreGetter;
  set: StoreSetter;
}

interface GenerateTitleForSessionInput {
  sessionId: string;
  fallbackTitle: string;
  userContent: string;
  pageContext: string;
  assistantContent?: string;
  get: StoreGetter;
  set: StoreSetter;
}

function hasAvailableTitleModel(state: AppState): boolean {
  const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
  const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
  return Boolean(titleModel && titleProvider?.enabled);
}

async function sendChatMessageWithState(input: SendChatMessageWithStateInput): Promise<void> {
  const trimmedContent = input.content.trim();
  const imageAttachments = (input.attachments ?? []).filter((attachment) => attachment.mediaType.startsWith("image/"));
  if ((!trimmedContent && imageAttachments.length === 0) || input.get().sending) {
    return;
  }

  const state = input.get();
  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }
  if (imageAttachments.length > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return;
  }

  const now = Date.now();
  const baseSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
  const effectiveChatPreferences = resolveEffectiveChatPreferences(state.chatPreferences, baseSession?.chatPreferenceOverrides);
  const session =
    baseSession ??
    {
      id: `session-${now}`,
      title: createDefaultSessionTitle(trimmedContent),
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  const userMessage: ChatMessage = {
    id: `message-${now}-user`,
    role: "user",
    content: trimmedContent,
    createdAt: now,
    modelId: model.id,
    endpointType: provider.endpointType,
    streamMode: state.streamMode,
    systemPrompt: effectiveChatPreferences.systemPrompt,
    contextPrompt: state.pageContext.text,
    contextMode: state.contextMode,
    matchedRuleId: state.pageContext.matchedRuleId,
    attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
  };

  await runChatRequest({
    state,
    session,
    userMessage,
    existingMessages: session.messages,
    nextMessages: [...session.messages, userMessage],
    shouldGenerateTitle: session.messages.length === 0 && hasAvailableTitleModel(state),
    nextTitle: session.messages.length === 0 ? createDefaultSessionTitle(trimmedContent) : session.title,
    fallbackTitle: session.messages.length === 0 ? createDefaultSessionTitle(trimmedContent) : session.title,
    model,
    provider,
    get: input.get,
    set: input.set,
  });
}

async function regenerateChatMessage(input: RegenerateChatMessageInput): Promise<void> {
  const state = input.get();
  if (state.sending) {
    return;
  }

  const session = state.chatSessions.find((item) => item.id === state.activeSessionId);
  if (!session) {
    return;
  }

  const messageIndex = session.messages.findIndex((message) => message.id === input.messageId);
  const targetMessage = session.messages[messageIndex];
  if (messageIndex < 0 || !targetMessage) {
    return;
  }

  const userMessage = targetMessage.role === "assistant" ? findPreviousUserMessage(session.messages, messageIndex) : targetMessage;
  if (!userMessage || userMessage.role !== "user") {
    input.set({ failure: { message: "未找到可重新生成的用户消息" } });
    return;
  }

  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }
  if ((userMessage.attachments?.length ?? 0) > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return;
  }

  const userMessageIndex = session.messages.findIndex((message) => message.id === userMessage.id);
  const existingMessages = session.messages.slice(0, userMessageIndex);

  await runChatRequest({
    state,
    session,
    userMessage,
    existingMessages,
    nextMessages: [...existingMessages, userMessage],
    shouldGenerateTitle: false,
    nextTitle: session.title,
    fallbackTitle: session.title,
    model,
    provider,
    get: input.get,
    set: input.set,
  });
}

function findPreviousUserMessage(messages: ChatMessage[], startIndex: number): ChatMessage | undefined {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return undefined;
}

async function runChatRequest(input: RunChatRequestInput): Promise<void> {
  input.set({ sending: true, failure: undefined });

  const effectiveChatPreferences = resolveEffectiveChatPreferences(input.state.chatPreferences, input.session.chatPreferenceOverrides);
  const modelConfig = createModelConfig(input.provider, input.model, effectiveChatPreferences);
  const now = Date.now();
  const nextSession: ChatSession = {
    ...input.session,
    title: input.nextTitle,
    titleGenerating: input.shouldGenerateTitle,
    updatedAt: now,
    messages: input.nextMessages,
  };

  try {
    await saveChatSession(nextSession);
    input.set((current) => ({
      activeSessionId: nextSession.id,
      chatSessions: upsertSession(current.chatSessions, nextSession),
    }));
    const titleGenerationPromise = input.shouldGenerateTitle
      ? generateTitleForSession({
        sessionId: nextSession.id,
        fallbackTitle: input.fallbackTitle,
        userContent: input.userMessage.content,
        pageContext: input.state.appendPageContextToSystemPrompt ? input.state.pageContext.text : "",
        get: input.get,
        set: input.set,
      })
      : Promise.resolve();
    void titleGenerationPromise;

    const request: ChatSendMessage = {
      type: "chat.send",
      model: modelConfig,
      messages: buildChatRequestMessages({
        model: modelConfig,
        pageContext: input.state.pageContext.text,
        existingMessages: input.existingMessages,
        userMessage: input.userMessage,
        systemPrompt: effectiveChatPreferences.systemPrompt,
        appendPageContextToSystemPrompt: input.state.appendPageContextToSystemPrompt,
      }),
      stream: input.state.streamMode,
    };

    if (input.state.streamMode) {
      const streamResult = await sendStreamingChatMessage({
        set: input.set,
        sessionId: nextSession.id,
        modelId: input.model.id,
        endpointType: input.provider.endpointType,
        systemPrompt: effectiveChatPreferences.systemPrompt,
        contextPrompt: input.state.pageContext.text,
        contextMode: input.state.contextMode,
        matchedRuleId: input.state.pageContext.matchedRuleId,
        request,
      });
      if (streamResult.completed) {
        return;
      }

      request.stream = false;
    }

    const response = await sendRuntimeMessage<
      { ok: true; content: string; thinking?: string } | { ok: false; message: string } | undefined
    >(request);

    if (!response) {
      input.set({ failure: { message: "模型请求失败，请重试" } });
      return;
    }

    if (!response.ok) {
      input.set({ failure: { message: response.message } });
      return;
    }

    const assistantCreatedAt = Date.now();
    const assistantMessage: ChatMessage = {
      id: `message-${assistantCreatedAt}-assistant`,
      role: "assistant",
      content: response.content,
      thinking: response.thinking,
      createdAt: assistantCreatedAt,
      modelId: input.model.id,
      endpointType: input.provider.endpointType,
      streamMode: input.state.streamMode,
      systemPrompt: effectiveChatPreferences.systemPrompt,
      contextPrompt: input.state.pageContext.text,
      contextMode: input.state.contextMode,
      matchedRuleId: input.state.pageContext.matchedRuleId,
    };
    const completedSession = await updateChatSession(nextSession.id, (latestSession) => ({
      ...latestSession,
      updatedAt: assistantMessage.createdAt,
      messages: [...latestSession.messages, assistantMessage],
    }));
    if (!completedSession) {
      return;
    }

    input.set((current) => {
      const currentSession = current.chatSessions.find((session) => session.id === completedSession.id);
      if (!currentSession) {
        return {};
      }

      return {
        chatSessions: upsertSession(current.chatSessions, {
          ...currentSession,
          updatedAt: assistantMessage.createdAt,
          messages: [...currentSession.messages, assistantMessage],
        }),
      };
    });
  } catch {
    input.set({
      failure: {
        message: "消息保存失败，请重试",
      },
    });
  } finally {
    input.set({ sending: false });
  }
}

async function generateTitleForSession(input: GenerateTitleForSessionInput): Promise<void> {
  try {
    const state = input.get();
    const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
    const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
    if (!titleModel || !titleProvider?.enabled) {
      await clearTitleGenerating(input);
      return;
    }

    const titleModelConfig = createModelConfig(titleProvider, titleModel);
    const titleMessages = createTitleGenerationMessages({
      userContent: input.userContent,
      pageContext: input.pageContext,
      assistantContent: input.assistantContent,
    }).map((message) => ({
      ...message,
      modelId: titleModel.id,
      endpointType: titleProvider.endpointType,
      systemPrompt: titleModel.systemPrompt,
    }));

    const title = await generateSessionTitle({
      fallbackTitle: input.fallbackTitle,
      messages: titleMessages,
      titleModel: titleModelConfig,
      requestTitle: async (model, messages) => {
        const response = await sendRuntimeMessage<{ ok: true; content: string } | { ok: false; message: string } | undefined>({
          type: "chat.send",
          model,
          messages,
          stream: false,
        });
        if (!response?.ok) {
          throw new Error(response?.message ?? "标题生成失败");
        }

        return response.content;
      },
    });

    await updateGeneratedTitle(input, title);
  } catch {
    await clearTitleGenerating(input);
  }
}

async function updateGeneratedTitle(input: GenerateTitleForSessionInput, title: string): Promise<void> {
  const updatedSession = await updateChatSession(input.sessionId, (latestSession) => {
    if (latestSession.title !== input.fallbackTitle) {
      return { ...latestSession, titleGenerating: false };
    }

    return {
      ...latestSession,
      title,
      titleGenerating: false,
    };
  });
  if (!updatedSession) {
    return;
  }

  input.set((current) => updateGeneratedTitleInState(current, input.sessionId, input.fallbackTitle, title));
}

async function clearTitleGenerating(input: GenerateTitleForSessionInput): Promise<void> {
  await updateGeneratedTitle(input, input.fallbackTitle);
}

function updateGeneratedTitleInState(
  state: AppState,
  sessionId: string,
  fallbackTitle: string,
  title: string,
): Partial<AppState> {
  const currentSession = state.chatSessions.find((session) => session.id === sessionId);
  if (!currentSession) {
    return {};
  }

  return {
    chatSessions: upsertSession(state.chatSessions, {
      ...currentSession,
      title: currentSession.title === fallbackTitle ? title : currentSession.title,
      titleGenerating: false,
    }),
  };
}

type ChatStreamPortMessage =
  | { type: "chunk"; content: string }
  | { type: "thinking"; content: string }
  | { type: "complete"; content: string; thinking?: string }
  | { type: "error"; message?: string };

interface StreamingChatResult {
  completed: boolean;
  assistantContent?: string;
}

interface StreamingChatInput {
  set: StoreSetter;
  sessionId: string;
  modelId: string;
  endpointType: EndpointType;
  systemPrompt: string;
  contextPrompt: string;
  contextMode: PageContextExtractMode;
  matchedRuleId?: string;
  request: ChatSendMessage;
}

async function sendStreamingChatMessage(input: StreamingChatInput): Promise<StreamingChatResult> {
  if (!globalThis.chrome?.runtime?.connect) {
    return { completed: false };
  }

  const assistantCreatedAt = Date.now();
  const assistantMessage: ChatMessage = {
    id: `message-${assistantCreatedAt}-assistant`,
    role: "assistant",
    content: "",
    createdAt: assistantCreatedAt,
    modelId: input.modelId,
    endpointType: input.endpointType,
    streamMode: true,
    systemPrompt: input.systemPrompt,
    contextPrompt: input.contextPrompt,
    contextMode: input.contextMode,
    matchedRuleId: input.matchedRuleId,
    streaming: true,
  };

  const initializedSession = await updateChatSession(input.sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: assistantMessage.createdAt,
    messages: [...latestSession.messages, assistantMessage],
  }));
  if (!initializedSession) {
    return { completed: true };
  }

  input.set((current) => {
    const currentSession = current.chatSessions.find((session) => session.id === initializedSession.id);
    if (!currentSession) {
      return {};
    }

    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...currentSession,
        updatedAt: assistantMessage.createdAt,
        messages: [...currentSession.messages, assistantMessage],
      }),
    };
  });

  return new Promise<StreamingChatResult>((resolve) => {
    const port = globalThis.chrome.runtime.connect({ name: "chat.stream" });
    let settled = false;
    let receivedStreamResponse = false;
    let writeQueue = Promise.resolve();

    const finish = (result: StreamingChatResult, options: { disconnect: boolean } = { disconnect: true }) => {
      if (settled) {
        return;
      }

      settled = true;
      if (options.disconnect) {
        port.disconnect();
      }
      resolve(result);
    };
    const enqueueWrite = (operation: () => Promise<void>) => {
      writeQueue = writeQueue.then(operation).catch(() => {
        input.set({ failure: { message: "消息保存失败，请重试" } });
      });
      return writeQueue;
    };

    port.onMessage.addListener((message: ChatStreamPortMessage) => {
      receivedStreamResponse = true;
      if (message.type === "chunk") {
        void enqueueWrite(() => appendAssistantChunk(input.sessionId, assistantMessage.id, message.content, input.set));
        return;
      }

      if (message.type === "thinking") {
        void enqueueWrite(() => appendAssistantThinkingChunk(input.sessionId, assistantMessage.id, message.content, input.set));
        return;
      }

      if (message.type === "complete") {
        void enqueueWrite(() => finalizeAssistantMessage(input.sessionId, assistantMessage.id, message.content, message.thinking, input.set)).then(
          () => finish({ completed: true, assistantContent: message.content }),
        );
        return;
      }

      input.set({ failure: { message: message.message ?? "模型请求失败，请重试" } });
      finish({ completed: true });
    });

    port.onDisconnect.addListener(() => {
      if (!receivedStreamResponse) {
        void removeAssistantMessage(input.sessionId, assistantMessage.id, input.set).then(() => {
          finish({ completed: false }, { disconnect: false });
        });
        return;
      }

      finish({ completed: true }, { disconnect: false });
    });

    port.postMessage({
      type: "chat.stream.start",
      payload: input.request,
    });
  });
}

async function removeAssistantMessage(sessionId: string, messageId: string, set: StoreSetter): Promise<void> {
  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    messages: latestSession.messages.filter((message) => message.id !== messageId),
  }));

  set((current) => {
    const session = current.chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return {};
    }

    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...session,
        messages: session.messages.filter((message) => message.id !== messageId),
      }),
    };
  });
}

async function appendAssistantThinkingChunk(sessionId: string, messageId: string, content: string, set: StoreSetter): Promise<void> {
  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    messages: latestSession.messages.map((message) =>
      message.id === messageId ? { ...message, thinking: `${message.thinking ?? ""}${content}` } : message,
    ),
  }));

  set((current) =>
    updateAssistantMessageInState(current, sessionId, messageId, (message) => ({
      ...message,
      thinking: `${message.thinking ?? ""}${content}`,
    })),
  );
}

async function appendAssistantChunk(sessionId: string, messageId: string, content: string, set: StoreSetter): Promise<void> {
  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    messages: latestSession.messages.map((message) =>
      message.id === messageId ? { ...message, content: `${message.content}${content}` } : message,
    ),
  }));

  set((current) =>
    updateAssistantMessageInState(current, sessionId, messageId, (message) => ({
      ...message,
      content: `${message.content}${content}`,
    })),
  );
}

async function finalizeAssistantMessage(
  sessionId: string,
  messageId: string,
  content: string,
  thinking: string | undefined,
  set: StoreSetter,
): Promise<void> {
  await updateChatSession(sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: Date.now(),
    messages: latestSession.messages.map((message) => (message.id === messageId ? { ...message, content, thinking, streaming: false } : message)),
  }));

  set((current) =>
    updateAssistantMessageInState(current, sessionId, messageId, (message) => ({
      ...message,
      content,
      thinking,
      streaming: false,
    })),
  );
}

function updateAssistantMessageInState(
  state: AppState,
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): Partial<AppState> {
  const session = state.chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    return {};
  }

  return {
    chatSessions: upsertSession(state.chatSessions, {
      ...session,
      messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
    }),
  };
}

function createAndStoreModel(
  providerId: string,
  get: StoreGetter,
  set: StoreSetter,
  overrides: Partial<Pick<ProviderModel, "displayName" | "modelId">> = {},
): ProviderModel {
  const now = Date.now();
  const index = get().models.filter((model) => model.providerId === providerId).length + 1;
  const model: ProviderModel = {
    id: `model-${now}-${index}`,
    providerId,
    displayName: overrides.displayName ?? `新模型 ${index}`,
    modelId: overrides.modelId ?? "gpt-4.1-mini",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  set((state) => ({
    models: [...state.models, model],
    selectedModelId: state.selectedModelId || model.id,
  }));
  void saveProviderModel(model);
  return model;
}

function setChannelOperation(set: StoreSetter, providerId: string, operation: ChannelOperationState) {
  set((state) => ({
    channelOperations: {
      ...state.channelOperations,
      [providerId]: operation,
    },
  }));
}

const modelConnectivityResetTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setModelConnectivity(set: StoreSetter, modelId: string, operation: ModelConnectivityState) {
  set((state) => ({
    modelConnectivity: {
      ...state.modelConnectivity,
      [modelId]: operation,
    },
  }));
}

function scheduleModelConnectivityReset(set: StoreSetter, modelId: string) {
  clearModelConnectivityResetTimer(modelId);

  const timer = setTimeout(() => {
    set((state) => {
      const operation = state.modelConnectivity[modelId];

      if (!operation?.success) {
        return state;
      }

      return {
        modelConnectivity: {
          ...state.modelConnectivity,
          [modelId]: {
            ...operation,
            success: false,
          },
        },
      };
    });
    modelConnectivityResetTimers.delete(modelId);
  }, 5000);

  modelConnectivityResetTimers.set(modelId, timer);
}

function clearModelConnectivityResetTimer(modelId: string) {
  const timer = modelConnectivityResetTimers.get(modelId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  modelConnectivityResetTimers.delete(modelId);
}

function clearAllModelConnectivityResetTimers() {
  modelConnectivityResetTimers.forEach((timer) => clearTimeout(timer));
  modelConnectivityResetTimers.clear();
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return {
      ok: false,
      message: "当前环境不支持插件后台请求",
    } as T;
  }

  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (response: T) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };

    try {
      // 真实 Chrome 扩展环境可能走 callback 形态；显式传 callback，避免把 sendMessage 的返回值 undefined 当作响应。
      const maybePromise = globalThis.chrome.runtime.sendMessage(message, (response: T) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError?.message;
        if (runtimeError) {
          finish({
            ok: false,
            message: runtimeError,
          } as T);
          return;
        }

        finish(response);
      }) as Promise<T> | undefined;

      if (maybePromise && typeof maybePromise.then === "function") {
        void maybePromise.then(finish).catch((error) => {
          finish({
            ok: false,
            message: error instanceof Error ? error.message : "插件后台请求失败",
          } as T);
        });
      }
    } catch (error) {
      finish({
        ok: false,
        message: error instanceof Error ? error.message : "插件后台请求失败",
      } as T);
    }
  });
}
