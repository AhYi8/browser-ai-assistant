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
  getChatFolders,
  getChatSessions,
  getExtractionRules,
  getModelProviders,
  getProviderModels,
  saveChatFolder,
  saveChatSession,
  moveExtractionRule,
  saveExtractionRule,
  saveModelProvider,
  saveProviderModel,
  updateChatSession,
} from "../../shared/storage/repositories";
import { DEFAULT_CONTEXT_MAX_LENGTH } from "../../shared/constants";
import { validateExtractionRuleDraft } from "../../shared/extractionRules/validation";
import { generateUrlPatternsWithModel } from "../../shared/extractionRules/urlPatternGeneration";
import type {
  ChatFolder,
  ChatMessage,
  ChatSession,
  EndpointType,
  ExtractionRule,
  ModelProvider,
  PageContextExtractMode,
  ProviderModel,
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
  activeSessionId: string;
  pendingDeleteSessionId?: string;
  streamMode: boolean;
  sending: boolean;
  contextMode: PageContextExtractMode;
  failure?: RequestFailure;
  addExampleModel: () => void;
  addProvider: () => ModelProvider;
  updateProvider: (providerId: string, updates: Partial<Pick<ModelProvider, "name" | "endpointType" | "endpointUrl" | "apiKey">>) => void;
  addModel: (providerId: string) => ProviderModel;
  addRemoteModel: (providerId: string, remoteModel: RemoteModelInfo) => ProviderModel;
  updateModel: (modelId: string, updates: Partial<Pick<ProviderModel, "displayName" | "modelId" | "temperature" | "maxTokens" | "systemPrompt">>) => void;
  setTitleModel: (modelId: string) => void;
  deleteProvider: (providerId: string) => void;
  deleteModel: (modelId: string) => void;
  loadChannelConfig: () => Promise<void>;
  loadChatData: () => Promise<void>;
  createChatSession: () => Promise<ChatSession>;
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
  setStreamMode: (streamMode: boolean) => void;
  setContextMode: (contextMode: PageContextExtractMode) => void;
  sendChatMessage: (content: string) => Promise<void>;
  simulateFailure: () => void;
  clearFailure: () => void;
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
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
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
  activeSessionId: "",
  streamMode: true,
  sending: false,
  contextMode: "text",
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
      endpointUrl: "https://api.openai.com/v1/chat/completions",
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
  deleteProvider: (providerId) =>
    set((state) => {
      const removedModelIds = new Set(state.models.filter((model) => model.providerId === providerId).map((model) => model.id));
      const models = state.models.filter((model) => model.providerId !== providerId);
      const selectedModelId = removedModelIds.has(state.selectedModelId) ? models[0]?.id ?? "" : state.selectedModelId;
      const { [providerId]: _remoteModels, ...remoteModels } = state.remoteModels;
      const { [providerId]: _operation, ...channelOperations } = state.channelOperations;
      const modelConnectivity = Object.fromEntries(
        Object.entries(state.modelConnectivity).filter(([modelId]) => !removedModelIds.has(modelId)),
      );

      removedModelIds.forEach(clearModelConnectivityResetTimer);

      void deleteModelProvider(providerId);

      return {
        providers: state.providers.filter((provider) => provider.id !== providerId),
        models,
        selectedModelId,
        remoteModels,
        channelOperations,
        modelConnectivity,
      };
    }),
  deleteModel: (modelId) =>
    set((state) => {
      const models = state.models.filter((model) => model.id !== modelId);
      const selectedModelId = state.selectedModelId === modelId ? models[0]?.id ?? "" : state.selectedModelId;
      const { [modelId]: _operation, ...modelConnectivity } = state.modelConnectivity;

      clearModelConnectivityResetTimer(modelId);

      void deleteProviderModel(modelId);

      return {
        models,
        selectedModelId,
        modelConnectivity,
      };
    }),
  loadChannelConfig: async () => {
    const [providers, models] = await Promise.all([getModelProviders(), getProviderModels()]);
    const selectedModelStillExists = models.some((model) => model.id === get().selectedModelId);

    set({
      providers,
      models,
      selectedModelId: selectedModelStillExists ? get().selectedModelId : (models[0]?.id ?? ""),
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
  createChatSession: async () => {
    const now = Date.now();
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
      maxLength: DEFAULT_CONTEXT_MAX_LENGTH,
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
  sendChatMessage: async (content) => {
    const trimmedContent = content.trim();
    if (!trimmedContent || get().sending) {
      return;
    }

    const state = get();
    const model = state.models.find((item) => item.id === state.selectedModelId);
    const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
    if (!model || !provider || !model.enabled || !provider.enabled) {
      set({ failure: { message: "请先配置可用模型后再发送" } });
      return;
    }

    set({ sending: true, failure: undefined });

    const modelConfig = createModelConfig(provider, model);
    const now = Date.now();
    const baseSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
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
      systemPrompt: model.systemPrompt,
      contextPrompt: state.pageContext.text,
      contextMode: state.contextMode,
      matchedRuleId: state.pageContext.matchedRuleId,
    };
    const nextSession: ChatSession = {
      ...session,
      title: session.messages.length === 0 ? createDefaultSessionTitle(trimmedContent) : session.title,
      titleGenerating: session.messages.length === 0 && hasAvailableTitleModel(state),
      updatedAt: now,
      messages: [...session.messages, userMessage],
    };
    const shouldGenerateTitle = Boolean(nextSession.titleGenerating);
    const fallbackTitle = nextSession.title;

    try {
      await saveChatSession(nextSession);
      set((current) => ({
        activeSessionId: nextSession.id,
        chatSessions: upsertSession(current.chatSessions, nextSession),
      }));
      const titleGenerationPromise = shouldGenerateTitle
        ? generateTitleForSession({
          sessionId: nextSession.id,
          fallbackTitle,
          userContent: trimmedContent,
          pageContext: state.pageContext.text,
          get,
          set,
        })
        : Promise.resolve();
      void titleGenerationPromise;

      const request: ChatSendMessage = {
        type: "chat.send",
        model: modelConfig,
        messages: buildChatRequestMessages({
          model: modelConfig,
          pageContext: state.pageContext.text,
          existingMessages: session.messages,
          userMessage,
        }),
        stream: state.streamMode,
      };

      if (state.streamMode) {
        const streamResult = await sendStreamingChatMessage({
          set,
          sessionId: nextSession.id,
          modelId: model.id,
          endpointType: provider.endpointType,
          systemPrompt: model.systemPrompt,
          contextPrompt: state.pageContext.text,
          contextMode: state.contextMode,
          matchedRuleId: state.pageContext.matchedRuleId,
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
        set({ failure: { message: "模型请求失败，请重试" } });
        return;
      }

      if (!response.ok) {
        set({ failure: { message: response.message } });
        return;
      }

      const assistantCreatedAt = Date.now();
      const assistantMessage: ChatMessage = {
        id: `message-${assistantCreatedAt}-assistant`,
        role: "assistant",
        content: response.content,
        thinking: response.thinking,
        createdAt: assistantCreatedAt,
        modelId: model.id,
        endpointType: provider.endpointType,
        streamMode: state.streamMode,
        systemPrompt: model.systemPrompt,
        contextPrompt: state.pageContext.text,
        contextMode: state.contextMode,
        matchedRuleId: state.pageContext.matchedRuleId,
      };
      const completedSession = await updateChatSession(nextSession.id, (latestSession) => ({
        ...latestSession,
        updatedAt: assistantMessage.createdAt,
        messages: [...latestSession.messages, assistantMessage],
      }));
      if (!completedSession) {
        return;
      }

      set((current) => {
        const currentSession = current.chatSessions.find((session) => session.id === completedSession.id);
        if (!currentSession) {
          return {};
        }

        const currentCompletedSession: ChatSession = {
          ...currentSession,
          updatedAt: assistantMessage.createdAt,
          messages: [...currentSession.messages, assistantMessage],
        };

        return {
          chatSessions: upsertSession(current.chatSessions, currentCompletedSession),
        };
      });

    } catch {
      set({
        failure: {
          message: "消息保存失败，请重试",
        },
      });
    } finally {
      set({ sending: false });
    }
  },
  simulateFailure: () => set({ failure: { message: "请求失败，请重试" } }),
  clearFailure: () => set({ failure: undefined }),
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
      activeSessionId: "",
      pendingDeleteSessionId: undefined,
      streamMode: true,
      sending: false,
      contextMode: "text",
      failure: undefined,
    });
  },
}));

let pageContextRefreshSequence = 0;

function createDefaultSessionTitle(content: string): string {
  return content.length > 20 ? `${content.slice(0, 20)}...` : content;
}

function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const nextSessions = sessions.filter((item) => item.id !== session.id);
  return [session, ...nextSessions].sort((left, right) => right.updatedAt - left.updatedAt);
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
