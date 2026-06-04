import { create, type StoreApi } from "zustand";
import { buildChatRequestMessages } from "../../shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../shared/chat/modelConfig";
import { createPageContextPrompt } from "../../shared/chat/pageContextPrompt";
import type { RemoteModelInfo } from "../../shared/models/modelCatalog";
import { createTitleGenerationMessages, generateSessionTitle } from "../../shared/models/titleGeneration";
import {
  deleteChatSession,
  deleteExtractionRule,
  deleteModelProvider,
  deleteProviderModel,
  deletePromptTemplate,
  getAppSetting,
  getChatFolders,
  getChatSessions,
  getExtractionRules,
  getModelProviders,
  getPromptTemplates,
  getProviderModels,
  reorderPromptTemplates,
  saveAppSetting,
  saveChatFolder,
  saveChatSession,
  moveExtractionRule,
  saveExtractionRule,
  saveModelProvider,
  savePromptTemplate,
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
import type { SyncRemoteBackupMeta } from "../../shared/sync/types";
import type {
  ChatFolder,
  ChatImageAttachment,
  ChatMessage,
  ChatPromptInvocation,
  ChatPreferenceValues,
  ChatSession,
  ChatSessionPreferenceOverrides,
  EndpointType,
  ExtractionRule,
  ModelProvider,
  PageContextExtractMode,
  PromptTemplate,
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
  title?: string;
  text: string;
  extractMode: PageContextExtractMode;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
  formatted?: boolean;
  error?: string;
}

type ExtractPageContextSuccessResponse = {
  ok: true;
  url?: string;
  title?: string;
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
};

type ExtractPageContextFailureResponse = { ok: false; message?: string };

export interface ContextTabCandidate {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
  selected: boolean;
  loading?: boolean;
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
  promptTemplates: PromptTemplate[];
  chatSessions: ChatSession[];
  chatFolders: ChatFolder[];
  pageContext: PageContextState;
  contextTabs: ContextTabCandidate[];
  contextTabsLoading: boolean;
  contextTabsError?: string;
  remoteModels: Record<string, RemoteModelInfo[]>;
  channelOperations: Record<string, ChannelOperationState>;
  modelConnectivity: Record<string, ModelConnectivityState>;
  selectedModelId: string;
  defaultChatModelId: string;
  chatPreferences: ChatPreferenceValues;
  activeSessionId: string;
  privateModeActive: boolean;
  privateChatSession?: ChatSession;
  pendingDeleteSessionId?: string;
  composerHasDraft: boolean;
  appendPageContextToSystemPrompt: boolean;
  streamMode: boolean;
  sending: boolean;
  contextMode: PageContextExtractMode;
  syncSettings: SyncSettings;
  syncSecrets: SyncSecrets;
  remoteBackups: SyncRemoteBackupMeta[];
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
  enterPrivateMode: () => Promise<void>;
  savePrivateChatSession: () => Promise<void>;
  selectChatSession: (sessionId: string, options?: { discardPrivateSession?: boolean }) => void;
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
  loadPromptTemplates: () => Promise<void>;
  savePromptTemplateDraft: (promptId: string | undefined, draft: Pick<PromptTemplate, "title" | "content">) => Promise<{ ok: true; prompt: PromptTemplate } | { ok: false; message: string }>;
  deletePrompt: (promptId: string) => Promise<void>;
  reorderPromptTemplates: (orderedIds: string[]) => Promise<void>;
  refreshPageContext: () => Promise<void>;
  loadContextTabs: () => Promise<void>;
  toggleContextTabSelection: (tabId: number) => void;
  generateUrlPatterns: (modelId?: string) => Promise<{ ok: true; patterns: string[] } | { ok: false; message: string }>;
  fetchRemoteModels: (providerId: string) => Promise<void>;
  testModel: (providerId: string, modelId: string) => Promise<void>;
  selectModel: (modelId: string) => Promise<void>;
  setComposerHasDraft: (hasDraft: boolean) => void;
  setAppendPageContextToSystemPrompt: (enabled: boolean) => void;
  setStreamMode: (streamMode: boolean) => void;
  setContextMode: (contextMode: PageContextExtractMode) => void;
  loadSyncSettings: () => Promise<void>;
  updateSyncSettings: (updates: Partial<SyncSettings>) => Promise<void>;
  updateSyncSecret: (key: keyof SyncSecrets, value: string) => Promise<void>;
  loadRemoteBackups: () => Promise<void>;
  backupNow: () => Promise<void>;
  restoreNow: (backupId: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatImageAttachment[], promptInvocations?: ChatPromptInvocation[]) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  editAndRegenerateUserMessage: (messageId: string, content: string, promptInvocations?: ChatPromptInvocation[]) => Promise<void>;
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
  injectPageContextByDefault: true,
  extractHtmlByDefault: false,
};

export const useAppStore = create<AppState>()((set, get) => ({
  providers: [],
  models: [],
  extractionRules: [],
  promptTemplates: [],
  chatSessions: [],
  chatFolders: [],
  pageContext: {
    loading: false,
    text: "",
    extractMode: "text",
    truncated: false,
    usedFallback: true,
  },
  contextTabs: [],
  contextTabsLoading: false,
  contextTabsError: undefined,
  remoteModels: {},
  channelOperations: {},
  modelConnectivity: {},
  selectedModelId: "",
  defaultChatModelId: "",
  chatPreferences: DEFAULT_CHAT_PREFERENCES,
  activeSessionId: "",
  privateModeActive: false,
  privateChatSession: undefined,
  composerHasDraft: false,
  appendPageContextToSystemPrompt: true,
  streamMode: true,
  sending: false,
  contextMode: "text",
  syncSettings: DEFAULT_SYNC_SETTINGS,
  syncSecrets: DEFAULT_SYNC_SECRETS,
  remoteBackups: [],
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

    const activeSession = get().privateModeActive
      ? get().privateChatSession
      : get().chatSessions.find((session) => session.id === get().activeSessionId);
    const shouldApplyContextDefaultToCurrentChat =
      updates.injectPageContextByDefault !== undefined && (!activeSession || activeSession.messages.length === 0);
    const shouldApplyExtractDefaultToCurrentChat =
      updates.extractHtmlByDefault !== undefined && (!activeSession || activeSession.messages.length === 0);
    const defaultContextMode = resolveDefaultContextMode(preferences);

    set({
      chatPreferences: preferences,
      // 全局默认值只初始化空白新对话，避免改动已有消息对话中用户手动切换过的注入状态。
      ...(shouldApplyContextDefaultToCurrentChat ? { appendPageContextToSystemPrompt: preferences.injectPageContextByDefault } : {}),
      ...(shouldApplyExtractDefaultToCurrentChat
        ? {
            contextMode: defaultContextMode,
            pageContext: {
              ...get().pageContext,
              extractMode: defaultContextMode,
            },
          }
        : {}),
    });
    if (shouldApplyExtractDefaultToCurrentChat) {
      void get().refreshPageContext();
    }
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
        selectedModelId: state.selectedModelId,
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
  deleteProvider: (providerId) => {
    let sessionToPersist: ChatSession | undefined;
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

      const modelSyncResult = syncActiveSessionSelectedModelAfterModelRemoval(
        state.chatSessions,
        state.activeSessionId,
        removedModelIds,
        selectedModelId,
      );
      sessionToPersist = modelSyncResult.session;

      return {
        providers: state.providers.filter((provider) => provider.id !== providerId),
        models,
        chatSessions: modelSyncResult.chatSessions,
        selectedModelId,
        defaultChatModelId,
        remoteModels,
        channelOperations,
        modelConnectivity,
      };
    });
    if (sessionToPersist) {
      void persistSessionSelectedModel(sessionToPersist);
    }
  },
  deleteModel: (modelId) => {
    let sessionToPersist: ChatSession | undefined;
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

      const modelSyncResult = syncActiveSessionSelectedModelAfterModelRemoval(
        state.chatSessions,
        state.activeSessionId,
        new Set([modelId]),
        selectedModelId,
      );
      sessionToPersist = modelSyncResult.session;

      return {
        models,
        chatSessions: modelSyncResult.chatSessions,
        selectedModelId,
        defaultChatModelId,
        modelConnectivity,
      };
    });
    if (sessionToPersist) {
      void persistSessionSelectedModel(sessionToPersist);
    }
  },
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
    const activeSession = get().chatSessions.find((session) => session.id === get().activeSessionId);
    const activeSessionModelId = activeSession?.selectedModelId
      ? resolveAvailableModelId(activeSession.selectedModelId, models, providers)
      : "";
    const chatPreferences = normalizeChatPreferences(savedChatPreferences);

    set({
      providers,
      models,
      defaultChatModelId,
      chatPreferences,
      appendPageContextToSystemPrompt: chatPreferences.injectPageContextByDefault,
      contextMode: resolveDefaultContextMode(chatPreferences),
      pageContext: {
        ...get().pageContext,
        extractMode: resolveDefaultContextMode(chatPreferences),
      },
      selectedModelId:
        activeSessionModelId || (selectedModelStillExists ? currentSelectedModelId : (defaultChatModelId || resolveAvailableModelId("", models, providers))),
    });
  },
  loadChatData: async () => {
    const [chatSessions, chatFolders] = await Promise.all([getChatSessions(), getChatFolders()]);
    set((state) => ({
      chatSessions,
      chatFolders,
      ...resolveActiveChatSessionSelection(state, chatSessions),
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
      selectedModelId,
      messages: [],
    };

    await saveChatSession(session);
    const defaultContextMode = resolveDefaultContextMode(currentState.chatPreferences);
    set((state) => ({
      chatSessions: [session, ...state.chatSessions],
      activeSessionId: session.id,
      selectedModelId,
      privateModeActive: false,
      privateChatSession: undefined,
      pendingDeleteSessionId: undefined,
      appendPageContextToSystemPrompt: currentState.chatPreferences.injectPageContextByDefault,
      contextMode: defaultContextMode,
      pageContext: {
        ...state.pageContext,
        extractMode: defaultContextMode,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
    }));
    if (currentState.chatPreferences.extractHtmlByDefault) {
      void get().refreshPageContext();
    }
    return session;
  },
  enterPrivateMode: async () => {
    const state = get();
    if (state.privateModeActive) {
      return;
    }

    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    if (activeSession && activeSession.messages.length > 0) {
      return;
    }

    if (activeSession) {
      await deleteChatSession(activeSession.id);
    }

    const now = Date.now();
    const selectedModelId = resolveAvailableModelId(
      activeSession?.selectedModelId || state.selectedModelId || state.defaultChatModelId,
      state.models,
      state.providers,
    );
    const privateChatSession: ChatSession = {
      id: `private-session-${now}`,
      title: "新对话",
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      selectedModelId,
      messages: [],
    };
    const defaultContextMode = resolveDefaultContextMode(state.chatPreferences);

    set((current) => ({
      privateModeActive: true,
      privateChatSession,
      activeSessionId: "",
      selectedModelId,
      pendingDeleteSessionId: undefined,
      chatSessions: activeSession ? current.chatSessions.filter((session) => session.id !== activeSession.id) : current.chatSessions,
      appendPageContextToSystemPrompt: state.chatPreferences.injectPageContextByDefault,
      contextMode: defaultContextMode,
      pageContext: {
        ...current.pageContext,
        extractMode: defaultContextMode,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
    }));
    if (state.chatPreferences.extractHtmlByDefault) {
      void get().refreshPageContext();
    }
  },
  savePrivateChatSession: async () => {
    const state = get();
    const privateChatSession = state.privateChatSession;
    if (!state.privateModeActive || !privateChatSession || privateChatSession.messages.length === 0) {
      set({ privateModeActive: false, privateChatSession: undefined });
      return;
    }

    const sessionToSave: ChatSession = {
      ...privateChatSession,
      id: privateChatSession.id.replace(/^private-session-/, "session-"),
      updatedAt: Date.now(),
    };

    await saveChatSession(sessionToSave);
    set((current) => ({
      privateModeActive: false,
      privateChatSession: undefined,
      activeSessionId: sessionToSave.id,
      selectedModelId: resolveSessionModelId(sessionToSave, current),
      chatSessions: upsertSession(current.chatSessions, sessionToSave),
    }));
    await generateTitleFromSavedPrivateSession({
      session: sessionToSave,
      get,
      set,
    });
  },
  selectChatSession: (sessionId, options) => {
    set((state) => {
      const session = state.chatSessions.find((item) => item.id === sessionId);
      if (!session) {
        return { pendingDeleteSessionId: undefined };
      }
      if (state.privateModeActive && state.privateChatSession && state.privateChatSession.messages.length > 0 && !options?.discardPrivateSession) {
        return { pendingDeleteSessionId: undefined };
      }

      return {
        activeSessionId: sessionId,
        privateModeActive: false,
        privateChatSession: undefined,
        pendingDeleteSessionId: undefined,
        selectedModelId: resolveSessionModelId(session, state),
        ...(session.messages.length === 0
          ? {
              contextTabs: [],
              contextTabsLoading: false,
              contextTabsError: undefined,
            }
          : {}),
      };
    });
  },
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
      const selection = resolveActiveChatSessionSelection(state, chatSessions);
      const activeSession = chatSessions.find((session) => session.id === selection.activeSessionId);
      return {
        chatSessions,
        ...selection,
        pendingDeleteSessionId: undefined,
        ...(!activeSession || activeSession.messages.length === 0
          ? {
              contextTabs: [],
              contextTabsLoading: false,
              contextTabsError: undefined,
            }
          : {}),
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
  loadPromptTemplates: async () => {
    const promptTemplates = await getPromptTemplates();
    set({ promptTemplates });
  },
  savePromptTemplateDraft: async (promptId, draft) => {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title) {
      return { ok: false, message: "提示词标题不能为空" };
    }
    if (!content) {
      return { ok: false, message: "Prompt 内容不能为空" };
    }

    const now = Date.now();
    const existingPrompt = promptId ? get().promptTemplates.find((prompt) => prompt.id === promptId) : undefined;
    const prompt: PromptTemplate = {
      id: existingPrompt?.id ?? `prompt-${now}`,
      title,
      content,
      sortOrder: existingPrompt?.sortOrder ?? Math.max(0, ...get().promptTemplates.map((item) => item.sortOrder)) + 10,
      createdAt: existingPrompt?.createdAt ?? now,
      updatedAt: now,
    };

    await savePromptTemplate(prompt);
    await get().loadPromptTemplates();
    return { ok: true, prompt };
  },
  deletePrompt: async (promptId) => {
    await deletePromptTemplate(promptId);
    await get().loadPromptTemplates();
  },
  reorderPromptTemplates: async (orderedIds) => {
    await reorderPromptTemplates(orderedIds);
    await get().loadPromptTemplates();
  },
  loadContextTabs: async () => {
    set({ contextTabsLoading: true, contextTabsError: undefined });
    const response = await sendRuntimeMessage<
      | {
          ok: true;
          tabs: Array<{ tabId: number; title: string; url: string; active: boolean }>;
        }
      | { ok: false; message?: string }
    >({ type: "pageContext.listTabs" });

    if (!response?.ok || !("tabs" in response) || !Array.isArray(response.tabs)) {
      const message = response && "message" in response ? response.message : undefined;
      set({
        contextTabsLoading: false,
        contextTabsError: message ?? "获取标签页列表失败",
      });
      return;
    }

    set((state) => {
      const previousSelectedIds = new Set(state.contextTabs.filter((tab) => tab.selected).map((tab) => tab.tabId));
      const hasPreviousSelection = previousSelectedIds.size > 0;
      const nextTabs = response.tabs.map((tab) => ({
        ...tab,
        selected: hasPreviousSelection ? previousSelectedIds.has(tab.tabId) : tab.active,
      }));
      const hasSelection = nextTabs.some((tab) => tab.selected);

      return {
        contextTabs: hasSelection ? nextTabs : nextTabs.map((tab, index) => ({ ...tab, selected: index === 0 })),
        contextTabsLoading: false,
        contextTabsError: undefined,
      };
    });
  },
  toggleContextTabSelection: (tabId) => {
    set((state) => ({
      contextTabs: state.contextTabs.map((tab) => (tab.tabId === tabId ? { ...tab, selected: !tab.selected, error: undefined } : tab)),
    }));
    void get().refreshPageContext();
  },
  refreshPageContext: async () => {
    const requestedContextMode = get().contextMode;
    const requestId = ++pageContextRefreshSequence;
    const selectedTabs = get().contextTabs.filter((tab) => tab.selected);
    set((state) => ({
      pageContext: {
        ...state.pageContext,
        extractMode: requestedContextMode,
        loading: true,
        error: undefined,
      },
      contextTabs: state.contextTabs.map((tab) => (tab.selected ? { ...tab, loading: true, error: undefined } : { ...tab, loading: false })),
    }));

    const extractContext = (tabId?: number) =>
      sendRuntimeMessage<ExtractPageContextSuccessResponse | ExtractPageContextFailureResponse | undefined>({
        type: "pageContext.extract",
        tabId,
        rules: get().extractionRules,
        maxLength: undefined,
        extractMode: requestedContextMode,
      });

    const responses = selectedTabs.length > 0
      ? await Promise.all(selectedTabs.map(async (tab) => ({ tab, response: await extractContext(tab.tabId) })))
      : [{ tab: undefined, response: await extractContext() }];

    if (requestId !== pageContextRefreshSequence) {
      return;
    }

    const successfulResponses = responses.filter((item): item is { tab?: ContextTabCandidate; response: ExtractPageContextSuccessResponse } =>
      Boolean(item.response?.ok),
    );
    const failedResponses = responses.filter((item) => !item.response?.ok);

    if (successfulResponses.length === 0) {
      const firstFailedResponse = failedResponses[0]?.response;
      set((state) => ({
        pageContext: {
          ...state.pageContext,
          text: "",
          truncated: false,
          usedFallback: true,
          loading: false,
          error: firstFailedResponse && "message" in firstFailedResponse ? firstFailedResponse.message ?? "提取当前页面失败" : "提取当前页面失败",
        },
        contextTabs: mergeContextTabErrors(state.contextTabs, failedResponses),
      }));
      return;
    }

    const shouldUseFormattedContext = selectedTabs.length > 1 || successfulResponses.length > 1;
    const mergedText = shouldUseFormattedContext
      ? successfulResponses.map(({ response }) => createPageContextPrompt(response)).filter(Boolean).join("\n\n---\n\n")
      : successfulResponses[0]?.response.text ?? "";
    const firstSuccess = successfulResponses[0]?.response;
    set((state) => ({
        pageContext: {
          loading: false,
          url: successfulResponses.length === 1 ? firstSuccess.url : undefined,
          title: successfulResponses.length === 1 ? firstSuccess.title : `${successfulResponses.length} 个标签页`,
          text: mergedText,
          formatted: shouldUseFormattedContext,
          extractMode: requestedContextMode,
          truncated: successfulResponses.some(({ response }) => response.truncated),
          usedFallback: successfulResponses.some(({ response }) => response.usedFallback),
          matchedRuleId: successfulResponses.length === 1 ? firstSuccess.matchedRuleId : undefined,
          error: failedResponses.length > 0 ? "部分标签页提取失败，已跳过失败项" : undefined,
        },
        contextTabs: mergeContextTabErrors(state.contextTabs, failedResponses).map((tab) =>
          successfulResponses.some((item) => item.tab?.tabId === tab.tabId) ? { ...tab, loading: false, error: undefined } : tab,
        ),
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
  selectModel: async (modelId) => {
    const state = get();
    const normalizedModelId = modelId.trim();
    const selectedModelId = normalizedModelId
      ? resolveAvailableModelId(normalizedModelId, state.models, state.providers)
      : "";
    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);

    if (!activeSession) {
      set({ selectedModelId });
      return;
    }

    const updatedSession = await updateChatSession(activeSession.id, (latestSession) => ({
      ...latestSession,
      selectedModelId,
      updatedAt: Date.now(),
    }));

    set((current) => ({
      selectedModelId,
      chatSessions: updatedSession ? upsertSession(current.chatSessions, updatedSession) : current.chatSessions,
    }));
  },
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
  loadRemoteBackups: async () => {
    set({ syncOperation: { loading: true } });
    const response = await sendRuntimeMessage<{ ok: boolean; backups?: SyncRemoteBackupMeta[]; message?: string }>({ type: "sync.listRemoteBackups" });
    set({
      remoteBackups: response?.ok ? response.backups ?? [] : [],
      syncOperation: response?.ok
        ? { loading: false, message: response.backups?.length ? undefined : "未找到远程备份" }
        : { loading: false, error: response?.message ?? "远程备份列表读取失败，请重试" },
    });
  },
  restoreNow: async (backupId) => {
    set({ syncOperation: { loading: true } });
    const response = await sendRuntimeMessage<{ ok: boolean; message?: string }>({ type: "sync.restoreNow", backupId });

    if (response?.ok) {
      // 恢复已经在后台完成覆盖写入；这里并行刷新互不依赖的前端状态，避免串行等待拖慢恢复反馈。
      await Promise.all([get().loadChannelConfig(), get().loadChatData(), get().loadExtractionRules(), get().loadPromptTemplates(), get().loadSyncSettings()]);
      set({ syncOperation: { loading: false, message: response.message ?? "恢复完成" } });
      return;
    }

    set({ syncOperation: { loading: false, error: response?.message ?? "恢复失败，请重试" } });
  },
  sendChatMessage: (content, attachments = [], promptInvocations = []) => sendChatMessageWithState({ content, attachments, promptInvocations, get, set }),
  regenerateMessage: (messageId) => regenerateChatMessage({ messageId, get, set }),
  editAndRegenerateUserMessage: (messageId, content, promptInvocations) => editAndRegenerateUserMessage({ messageId, content, promptInvocations, get, set }),
  reset: () => {
    clearAllModelConnectivityResetTimers();
    pageContextRefreshSequence += 1;

    set({
      providers: [],
      models: [],
      extractionRules: [],
      promptTemplates: [],
      chatSessions: [],
      chatFolders: [],
      pageContext: {
        loading: false,
        text: "",
        extractMode: "text",
        truncated: false,
        usedFallback: true,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
      remoteModels: {},
      channelOperations: {},
      modelConnectivity: {},
      selectedModelId: "",
      defaultChatModelId: "",
      chatPreferences: DEFAULT_CHAT_PREFERENCES,
      activeSessionId: "",
      privateModeActive: false,
      privateChatSession: undefined,
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
      remoteBackups: [],
      failure: undefined,
    });
  },
}));

let pageContextRefreshSequence = 0;

function mergeContextTabErrors(
  tabs: ContextTabCandidate[],
  failedResponses: Array<{ tab?: ContextTabCandidate; response?: ExtractPageContextSuccessResponse | ExtractPageContextFailureResponse }>,
): ContextTabCandidate[] {
  const errorByTabId = new Map<number, string>();
  for (const item of failedResponses) {
    if (item.tab) {
      errorByTabId.set(item.tab.tabId, item.response && "message" in item.response ? item.response.message ?? "提取失败" : "提取失败");
    }
  }

  return tabs.map((tab) => ({
    ...tab,
    loading: false,
    error: errorByTabId.get(tab.tabId),
  }));
}

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

function resolveSessionModelId(session: ChatSession, state: AppState): string {
  const sessionModelId = session.selectedModelId
    ? resolveAvailableModelId(session.selectedModelId, state.models, state.providers)
    : "";
  return sessionModelId || resolveAvailableModelId(state.defaultChatModelId, state.models, state.providers);
}

function resolveActiveChatSessionSelection(
  state: AppState,
  chatSessions: ChatSession[],
): Pick<AppState, "activeSessionId" | "selectedModelId"> {
  const activeSession =
    (state.activeSessionId && chatSessions.find((session) => session.id === state.activeSessionId)) || chatSessions[0];
  if (!activeSession) {
    return {
      activeSessionId: "",
      selectedModelId: resolveAvailableModelId(state.defaultChatModelId || state.selectedModelId, state.models, state.providers),
    };
  }

  return {
    activeSessionId: activeSession.id,
    selectedModelId: resolveSessionModelId(activeSession, state),
  };
}

function syncActiveSessionSelectedModelAfterModelRemoval(
  chatSessions: ChatSession[],
  activeSessionId: string,
  removedModelIds: Set<string>,
  selectedModelId: string,
): { chatSessions: ChatSession[]; session?: ChatSession } {
  const activeSession = chatSessions.find((session) => session.id === activeSessionId);
  if (!activeSession?.selectedModelId || !removedModelIds.has(activeSession.selectedModelId)) {
    return { chatSessions };
  }

  const nextSession: ChatSession = {
    ...activeSession,
    selectedModelId,
    updatedAt: Date.now(),
  };
  return {
    chatSessions: upsertSession(chatSessions, nextSession),
    session: nextSession,
  };
}

async function persistSessionSelectedModel(session: ChatSession): Promise<void> {
  await updateChatSession(session.id, (latestSession) => ({
    ...latestSession,
    selectedModelId: session.selectedModelId,
    updatedAt: session.updatedAt,
  }));
}

function createDefaultSessionTitle(content: string): string {
  return content.length > 20 ? `${content.slice(0, 20)}...` : content;
}

function createVisibleUserTitleContent(content: string, promptInvocations: ChatPromptInvocation[]): string {
  const trimmedContent = content.trim();
  if (trimmedContent) {
    return trimmedContent;
  }

  return promptInvocations.map((prompt) => prompt.title).join("、") || "新对话";
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
    historyDrawerDefaultOpen: normalizeBoolean(value?.historyDrawerDefaultOpen, DEFAULT_CHAT_PREFERENCES.historyDrawerDefaultOpen),
    injectPageContextByDefault: normalizeBoolean(value?.injectPageContextByDefault, DEFAULT_CHAT_PREFERENCES.injectPageContextByDefault),
    extractHtmlByDefault: normalizeBoolean(value?.extractHtmlByDefault, DEFAULT_CHAT_PREFERENCES.extractHtmlByDefault),
  };
}

function resolveDefaultContextMode(preferences: ChatPreferenceValues): PageContextExtractMode {
  return preferences.extractHtmlByDefault ? "all" : "text";
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

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
  promptInvocations?: ChatPromptInvocation[];
  get: StoreGetter;
  set: StoreSetter;
}

interface RegenerateChatMessageInput {
  messageId: string;
  get: StoreGetter;
  set: StoreSetter;
}

interface EditAndRegenerateUserMessageInput {
  messageId: string;
  content: string;
  promptInvocations?: ChatPromptInvocation[];
  get: StoreGetter;
  set: StoreSetter;
}

interface RunChatRequestInput {
  state: AppState;
  privateMode?: boolean;
  pageContextPrompt: string;
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
  const promptInvocations = input.promptInvocations ?? [];
  if ((!trimmedContent && imageAttachments.length === 0 && promptInvocations.length === 0) || input.get().sending) {
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
  const baseSession = state.privateModeActive
    ? state.privateChatSession
    : state.chatSessions.find((session) => session.id === state.activeSessionId);
  const effectiveChatPreferences = resolveEffectiveChatPreferences(state.chatPreferences, baseSession?.chatPreferenceOverrides);
  const session =
    baseSession ??
    {
      id: `session-${now}`,
      title: createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)),
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      selectedModelId: model.id,
      messages: [],
    };
  const shouldInjectPageContext = session.messages.length === 0 && state.appendPageContextToSystemPrompt;
  const requestPageContextPrompt = shouldInjectPageContext
    ? state.pageContext.formatted
      ? state.pageContext.text
      : createPageContextPrompt(state.pageContext)
    : "";
  const userMessage: ChatMessage = {
    id: `message-${now}-user`,
    role: "user",
    content: trimmedContent,
    createdAt: now,
    modelId: model.id,
    endpointType: provider.endpointType,
    streamMode: state.streamMode,
    systemPrompt: effectiveChatPreferences.systemPrompt,
    contextPrompt: requestPageContextPrompt,
    contextMode: state.contextMode,
    matchedRuleId: state.pageContext.matchedRuleId,
    attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
    promptInvocations: promptInvocations.length > 0 ? promptInvocations : undefined,
  };

  await runChatRequest({
    state,
    privateMode: state.privateModeActive,
    pageContextPrompt: requestPageContextPrompt,
    session,
    userMessage,
    existingMessages: session.messages,
    nextMessages: [...session.messages, userMessage],
    shouldGenerateTitle: session.messages.length === 0 && hasAvailableTitleModel(state),
    nextTitle: session.messages.length === 0 ? createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)) : session.title,
    fallbackTitle: session.messages.length === 0 ? createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)) : session.title,
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

  const session = state.privateModeActive
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === state.activeSessionId);
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
    privateMode: state.privateModeActive,
    pageContextPrompt: "",
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

async function editAndRegenerateUserMessage(input: EditAndRegenerateUserMessageInput): Promise<void> {
  const trimmedContent = input.content.trim();
  const state = input.get();
  const promptInvocations = input.promptInvocations;
  if ((!trimmedContent && (!promptInvocations || promptInvocations.length === 0)) || state.sending) {
    return;
  }

  const session = state.privateModeActive
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === state.activeSessionId);
  if (!session) {
    return;
  }

  const userMessageIndex = session.messages.findIndex((message) => message.id === input.messageId);
  const originalUserMessage = session.messages[userMessageIndex];
  if (!originalUserMessage || originalUserMessage.role !== "user") {
    input.set({ failure: { message: "未找到可编辑的用户消息" } });
    return;
  }

  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }
  if ((originalUserMessage.attachments?.length ?? 0) > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return;
  }

  const editedUserMessage: ChatMessage = {
    ...originalUserMessage,
    content: trimmedContent,
    promptInvocations: promptInvocations ?? originalUserMessage.promptInvocations,
  };
  const existingMessages = session.messages.slice(0, userMessageIndex);

  await runChatRequest({
    state,
    privateMode: state.privateModeActive,
    pageContextPrompt: "",
    session,
    userMessage: editedUserMessage,
    existingMessages,
    nextMessages: [...existingMessages, editedUserMessage],
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
    selectedModelId: input.model.id,
    messages: input.nextMessages,
  };

  try {
    if (input.privateMode) {
      input.set({ privateChatSession: nextSession });
    } else {
      await saveChatSession(nextSession);
      input.set((current) => ({
        activeSessionId: nextSession.id,
        chatSessions: upsertSession(current.chatSessions, nextSession),
      }));
    }
    const titleGenerationPromise = !input.privateMode && input.shouldGenerateTitle
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
        pageContext: input.pageContextPrompt,
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
        contextPrompt: input.pageContextPrompt,
        contextMode: input.state.contextMode,
        matchedRuleId: input.state.pageContext.matchedRuleId,
        privateMode: input.privateMode,
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
      contextPrompt: input.pageContextPrompt,
      contextMode: input.state.contextMode,
      matchedRuleId: input.state.pageContext.matchedRuleId,
    };
    if (input.privateMode) {
      input.set((current) => {
        const currentSession = current.privateChatSession;
        if (!current.privateModeActive || !currentSession || currentSession.id !== nextSession.id) {
          return {};
        }

        return {
          privateChatSession: {
            ...currentSession,
            updatedAt: assistantMessage.createdAt,
            messages: [...currentSession.messages, assistantMessage],
          },
        };
      });
      return;
    }

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

async function generateTitleFromSavedPrivateSession(input: { session: ChatSession; get: StoreGetter; set: StoreSetter }): Promise<void> {
  try {
    const state = input.get();
    const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
    const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
    if (!titleModel || !titleProvider?.enabled) {
      return;
    }

    const titleModelConfig = createModelConfig(titleProvider, titleModel);
    const titleMessages = createTitleGenerationMessages({
      userContent: formatSessionMessagesForTitle(input.session.messages),
      pageContext: state.appendPageContextToSystemPrompt ? state.pageContext.text : "",
    }).map((message) => ({
      ...message,
      modelId: titleModel.id,
      endpointType: titleProvider.endpointType,
      systemPrompt: titleModel.systemPrompt,
    }));
    const title = await generateSessionTitle({
      fallbackTitle: input.session.title,
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

    await updateSavedPrivateSessionTitle({
      sessionId: input.session.id,
      title,
      set: input.set,
    });
  } catch {
    // 隐私会话已完成保存；标题生成失败时保留原标题，避免影响用户显式保存结果。
  }
}

function formatSessionMessagesForTitle(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.trim()}`)
    .join("\n\n");
}

async function updateSavedPrivateSessionTitle(input: { sessionId: string; title: string; set: StoreSetter }): Promise<void> {
  const updatedSession = await updateChatSession(input.sessionId, (latestSession) => ({
    ...latestSession,
    title: input.title,
    titleGenerating: false,
  }));
  if (!updatedSession) {
    return;
  }

  input.set((current) => ({
    chatSessions: upsertSession(current.chatSessions, updatedSession),
  }));
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
  privateMode?: boolean;
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

  if (input.privateMode) {
    input.set((current) => {
      const currentSession = current.privateChatSession;
      if (!current.privateModeActive || !currentSession || currentSession.id !== input.sessionId) {
        return {};
      }

      return {
        privateChatSession: {
          ...currentSession,
          updatedAt: assistantMessage.createdAt,
          messages: [...currentSession.messages, assistantMessage],
        },
      };
    });
  } else {
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
  }

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
        void enqueueWrite(() => appendAssistantChunk(input.sessionId, assistantMessage.id, message.content, input.set, input.privateMode));
        return;
      }

      if (message.type === "thinking") {
        void enqueueWrite(() => appendAssistantThinkingChunk(input.sessionId, assistantMessage.id, message.content, input.set, input.privateMode));
        return;
      }

      if (message.type === "complete") {
        void enqueueWrite(() => finalizeAssistantMessage(input.sessionId, assistantMessage.id, message.content, message.thinking, input.set, input.privateMode)).then(
          () => finish({ completed: true, assistantContent: message.content }),
        );
        return;
      }

      input.set({ failure: { message: message.message ?? "模型请求失败，请重试" } });
      finish({ completed: true });
    });

    port.onDisconnect.addListener(() => {
      if (!receivedStreamResponse) {
        void removeAssistantMessage(input.sessionId, assistantMessage.id, input.set, input.privateMode).then(() => {
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

async function removeAssistantMessage(sessionId: string, messageId: string, set: StoreSetter, privateMode = false): Promise<void> {
  if (privateMode) {
    set((current) => {
      const session = current.privateChatSession;
      if (!current.privateModeActive || !session || session.id !== sessionId) {
        return {};
      }

      return {
        privateChatSession: {
          ...session,
          messages: session.messages.filter((message) => message.id !== messageId),
        },
      };
    });
    return;
  }

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

async function appendAssistantThinkingChunk(sessionId: string, messageId: string, content: string, set: StoreSetter, privateMode = false): Promise<void> {
  if (privateMode) {
    set((current) =>
      updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...message,
        thinking: `${message.thinking ?? ""}${content}`,
      })),
    );
    return;
  }

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

async function appendAssistantChunk(sessionId: string, messageId: string, content: string, set: StoreSetter, privateMode = false): Promise<void> {
  if (privateMode) {
    set((current) =>
      updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...message,
        content: `${message.content}${content}`,
      })),
    );
    return;
  }

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
  privateMode = false,
): Promise<void> {
  if (privateMode) {
    set((current) =>
      updatePrivateAssistantMessageInState(current, sessionId, messageId, (message) => ({
        ...message,
        content,
        thinking,
        streaming: false,
      })),
    );
    return;
  }

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

function updatePrivateAssistantMessageInState(
  state: AppState,
  sessionId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): Partial<AppState> {
  const session = state.privateChatSession;
  if (!state.privateModeActive || !session || session.id !== sessionId) {
    return {};
  }

  return {
    privateChatSession: {
      ...session,
      messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
    },
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
