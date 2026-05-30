import { exportAllDataForSync, getAppSetting, replaceAllDataFromSync } from "../storage/repositories";
import { SYNC_SECRET_SETTING_KEYS } from "./settings";
import type { SyncDataSnapshot } from "./types";
import type { AppSetting } from "../types";

export async function exportSyncSnapshot(): Promise<SyncDataSnapshot> {
  const snapshot = await exportAllDataForSync();
  const secretKeys = new Set<string>(SYNC_SECRET_SETTING_KEYS);

  return {
    ...snapshot,
    appSettings: snapshot.appSettings.filter((setting) => !secretKeys.has(setting.key)),
  };
}

export async function restoreSyncSnapshot(snapshot: SyncDataSnapshot): Promise<void> {
  assertValidSnapshot(snapshot);
  const localSecretSettings = await readLocalSecretSettings();
  await replaceAllDataFromSync({
    ...snapshot,
    appSettings: mergeAppSettings(snapshot.appSettings, localSecretSettings),
  });
}

async function readLocalSecretSettings(): Promise<AppSetting[]> {
  const settings: AppSetting[] = [];
  const values = await Promise.all(
    SYNC_SECRET_SETTING_KEYS.map(async (key) => {
      const value = await getAppSetting(key);
      return { key, value };
    }),
  );

  values.forEach(({ key, value }) => {
    if (value !== undefined) {
      settings.push({ key, value, updatedAt: Date.now() });
    }
  });

  return settings;
}

function mergeAppSettings(remoteSettings: AppSetting[], localSettings: AppSetting[]): AppSetting[] {
  const localKeys = new Set(localSettings.map((setting) => setting.key));
  return [...remoteSettings.filter((setting) => !localKeys.has(setting.key)), ...localSettings];
}

function assertValidSnapshot(value: SyncDataSnapshot): void {
  const maybeSnapshot = value as Partial<SyncDataSnapshot>;
  const arrayKeys: Array<keyof Omit<SyncDataSnapshot, "version">> = [
    "modelConfigs",
    "modelProviders",
    "providerModels",
    "extractionRules",
    "chatSessions",
    "chatFolders",
    "appSettings",
  ];

  if (maybeSnapshot.version !== 1) {
    throw new Error("备份文件格式无效，未覆盖本地数据");
  }

  if (arrayKeys.some((key) => !Array.isArray(maybeSnapshot[key]))) {
    throw new Error("备份文件格式无效，未覆盖本地数据");
  }

  if ("promptTemplates" in maybeSnapshot && !Array.isArray(maybeSnapshot.promptTemplates)) {
    throw new Error("备份文件格式无效，未覆盖本地数据");
  }
  if ("automationFlows" in maybeSnapshot && !Array.isArray(maybeSnapshot.automationFlows)) {
    throw new Error("备份文件格式无效，未覆盖本地数据");
  }
}
