import { saveAppSetting } from "../../shared/storage/repositories";
import {
  getSyncSecrets,
  getSyncSettings,
  saveSyncSettings,
  SYNC_ENCRYPTION_SECRET_KEY,
  SYNC_S3_SECRET_KEY,
  SYNC_WEBDAV_PASSWORD_KEY,
} from "../../shared/sync/settings";
import type { SyncRemoteBackupMeta, SyncSecrets, SyncSettings } from "../../shared/sync/types";
import type { WebSearchSettings } from "../../shared/types";
import { normalizeWebSearchSettings, saveWebSearchSettings } from "../../shared/webSearch/settings";
import type { StoreGetter, StoreSetter } from "./appStore";
import { sendRuntimeMessage } from "./runtimeMessage";

export async function loadSyncSettingsAction(input: { set: StoreSetter }): Promise<void> {
  const [syncSettings, syncSecrets] = await Promise.all([getSyncSettings(), getSyncSecrets()]);
  input.set({ syncSettings, syncSecrets });
}

export async function updateSyncSettingsAction(input: { updates: Partial<SyncSettings>; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const current = input.get().syncSettings;
  const syncSettings: SyncSettings = {
    ...current,
    ...input.updates,
    webdav: {
      ...current.webdav,
      ...input.updates.webdav,
    },
    s3: {
      ...current.s3,
      ...input.updates.s3,
    },
  };

  await saveSyncSettings(syncSettings);
  input.set({ syncSettings });

  if (input.updates.autoSyncEnabled !== undefined || input.updates.intervalMinutes !== undefined || input.updates.syncEnabled !== undefined) {
    await sendRuntimeMessage({ type: "sync.configureAlarm", settings: syncSettings });
  }
}

export async function updateSyncSecretAction(input: { key: keyof SyncSecrets; value: string; set: StoreSetter }): Promise<void> {
  const normalizedValue = input.value.trim();

  await saveAppSetting({
    key: getSyncSecretSettingKey(input.key),
    value: normalizedValue,
    updatedAt: Date.now(),
  });
  input.set((state) => ({
    syncSecrets: {
      ...state.syncSecrets,
      [input.key]: normalizedValue,
    },
  }));
}

export async function updateWebSearchSettingsAction(input: { updates: Partial<WebSearchSettings>; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const current = input.get().webSearchSettings;
  const nextSettings = normalizeWebSearchSettings({
    ...current,
    ...input.updates,
    tavily: {
      ...current.tavily,
      ...input.updates.tavily,
    },
    updatedAt: Date.now(),
  });

  await saveWebSearchSettings(nextSettings);
  input.set({ webSearchSettings: nextSettings });
}

export async function backupNowAction(input: { set: StoreSetter }): Promise<void> {
  input.set({ syncOperation: { loading: true } });
  const response = await sendRuntimeMessage<{ ok: boolean; message?: string }>({ type: "sync.backupNow" });
  input.set({
    syncOperation: response?.ok
      ? { loading: false, message: response.message ?? "备份完成" }
      : { loading: false, error: response?.message ?? "备份失败，请重试" },
  });
}

export async function loadRemoteBackupsAction(input: { set: StoreSetter }): Promise<void> {
  input.set({ syncOperation: { loading: true } });
  const response = await sendRuntimeMessage<{ ok: boolean; backups?: SyncRemoteBackupMeta[]; message?: string }>({ type: "sync.listRemoteBackups" });
  const message = response?.ok && !response.backups?.length
    ? "未找到远程备份"
    : response?.ok
      ? undefined
      : response?.message ?? "远程备份列表读取失败，请重试";
  input.set({
    remoteBackups: response?.ok ? response.backups ?? [] : [],
    syncOperation: response?.ok
      ? { loading: false, message }
      : { loading: false, error: message },
  });
}

export async function restoreNowAction(input: { backupId: string; get: StoreGetter; set: StoreSetter }): Promise<void> {
  input.set({ syncOperation: { loading: true } });
  const response = await sendRuntimeMessage<{ ok: boolean; message?: string }>({ type: "sync.restoreNow", backupId: input.backupId });

  if (response?.ok) {
    // 恢复已经在后台完成覆盖写入；这里并行刷新互不依赖的前端状态，避免串行等待拖慢恢复反馈。
    await Promise.all([
      input.get().loadChannelConfig(),
      input.get().loadChatData(),
      input.get().loadExtractionRules(),
      input.get().loadPromptTemplates(),
      input.get().loadSyncSettings(),
    ]);
    input.set({ syncOperation: { loading: false, message: response.message ?? "恢复完成" } });
    return;
  }

  input.set({ syncOperation: { loading: false, error: response?.message ?? "恢复失败，请重试" } });
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
