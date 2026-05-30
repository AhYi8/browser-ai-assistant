import Dexie, { type EntityTable } from "dexie";
import { DATABASE_NAME, DATABASE_VERSION } from "../constants";
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

const VERSION_2_SCHEMA = {
  modelConfigs: "id, channelName, endpointType, updatedAt",
  modelProviders: "id, name, endpointType, updatedAt",
  providerModels: "id, providerId, displayName, updatedAt",
  extractionRules: "id, sortOrder, urlPattern, updatedAt",
  chatSessions: "id, folderId, archived, sortOrder, updatedAt",
  chatFolders: "id, sortOrder, updatedAt",
  appSettings: "key, updatedAt",
};

const VERSION_3_SCHEMA = {
  ...VERSION_2_SCHEMA,
  promptTemplates: "id, sortOrder, updatedAt",
};

const VERSION_4_SCHEMA = {
  ...VERSION_3_SCHEMA,
  automationFlows: "id, enabled, updatedAt, lastRunAt, lastRunStatus",
};

export class BrowserAssistantDatabase extends Dexie {
  modelConfigs!: EntityTable<ModelConfig, "id">;
  modelProviders!: EntityTable<ModelProvider, "id">;
  providerModels!: EntityTable<ProviderModel, "id">;
  extractionRules!: EntityTable<ExtractionRule, "id">;
  promptTemplates!: EntityTable<PromptTemplate, "id">;
  automationFlows!: EntityTable<AutomationFlow, "id">;
  chatSessions!: EntityTable<ChatSession, "id">;
  chatFolders!: EntityTable<ChatFolder, "id">;
  appSettings!: EntityTable<AppSetting, "key">;

  constructor() {
    super(DATABASE_NAME);

    this.version(2).stores(VERSION_2_SCHEMA);
    this.version(3).stores(VERSION_3_SCHEMA);
    this.version(DATABASE_VERSION).stores(VERSION_4_SCHEMA);
  }
}

export const db = new BrowserAssistantDatabase();
