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

export type SyncProviderType = "chrome_sync" | "webdav" | "s3";

export interface WebDavSyncSettings {
  endpointUrl: string;
  username: string;
  remotePath: string;
}

export interface S3SyncSettings {
  endpointUrl: string;
  accessKeyId: string;
  bucket: string;
  region: string;
  objectKeyPrefix: string;
}

export interface SyncSettings {
  syncEnabled: boolean;
  autoSyncEnabled: boolean;
  provider: SyncProviderType;
  backupPrefix: string;
  encryptionEnabled: boolean;
  intervalMinutes: number;
  webdav: WebDavSyncSettings;
  s3: S3SyncSettings;
  lastBackupAt?: number;
  lastRestoreAt?: number;
  lastStatus?: "idle" | "success" | "error";
  lastMessage?: string;
}

export interface SyncSecrets {
  encryptionSecret: string;
  webDavPassword: string;
  s3SecretKey: string;
}

export interface SyncDataSnapshot {
  version: 1;
  modelConfigs: ModelConfig[];
  modelProviders: ModelProvider[];
  providerModels: ProviderModel[];
  extractionRules: ExtractionRule[];
  promptTemplates?: PromptTemplate[];
  automationFlows?: AutomationFlow[];
  chatSessions: ChatSession[];
  chatFolders: ChatFolder[];
  appSettings: AppSetting[];
}

export interface SyncRemoteBackup {
  version: 1;
  createdAt: number;
  prefix: string;
  provider: SyncProviderType;
  encrypted: boolean;
  payload: unknown;
}

export interface SyncRemoteProvider {
  write: (prefix: string, backup: SyncRemoteBackup) => Promise<void>;
  read: (prefix: string) => Promise<SyncRemoteBackup | undefined>;
}

export function assertValidSyncRemoteBackup(value: unknown): asserts value is SyncRemoteBackup {
  const maybeBackup = value as Partial<SyncRemoteBackup>;

  if (
    !maybeBackup ||
    maybeBackup.version !== 1 ||
    typeof maybeBackup.createdAt !== "number" ||
    typeof maybeBackup.prefix !== "string" ||
    !isSyncProviderType(maybeBackup.provider) ||
    typeof maybeBackup.encrypted !== "boolean" ||
    !("payload" in maybeBackup)
  ) {
    throw new Error("备份文件格式无效，未覆盖本地数据");
  }
}

function isSyncProviderType(value: unknown): value is SyncProviderType {
  return value === "chrome_sync" || value === "webdav" || value === "s3";
}
