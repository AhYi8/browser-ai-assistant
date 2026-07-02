import { exportAllDataForSync, getAppSetting, replaceAllDataFromSync } from "../storage/repositories";
import { SYNC_SECRET_SETTING_KEYS } from "./settings";
import type { SyncDataSnapshot } from "./types";
import type { AppSetting } from "../types";
import { normalizeWebSearchSettings, WEB_SEARCH_SETTINGS_KEY } from "../webSearch/settings";
import { MCP_BEARER_TOKEN_SETTING_PREFIX } from "../mcp/settings";

export async function exportSyncSnapshot(): Promise<SyncDataSnapshot> {
  const snapshot = await exportAllDataForSync();
  const secretKeys = new Set<string>(SYNC_SECRET_SETTING_KEYS);

  return {
    ...snapshot,
    appSettings: snapshot.appSettings.filter((setting) => !secretKeys.has(setting.key)).map(sanitizeAppSettingForSync),
  };
}

export async function restoreSyncSnapshot(snapshot: SyncDataSnapshot): Promise<void> {
  assertValidSnapshot(snapshot);
  const localSecretSettings = await readLocalSecretSettings();
  const localMcpSecretSettings = await readLocalMcpSecretSettings();
  const localWebSearchSettings = await getAppSetting(WEB_SEARCH_SETTINGS_KEY);
  await replaceAllDataFromSync({
    ...snapshot,
    appSettings: mergeAppSettings(mergeWebSearchSettingsForRestore(snapshot.appSettings, localWebSearchSettings), [...localSecretSettings, ...localMcpSecretSettings]),
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

function sanitizeAppSettingForSync(setting: AppSetting): AppSetting {
  if (setting.key.startsWith(MCP_BEARER_TOKEN_SETTING_PREFIX)) {
    return {
      ...setting,
      value: "",
    };
  }

  if (setting.key !== WEB_SEARCH_SETTINGS_KEY) {
    return setting;
  }

  const webSearchSettings = normalizeUnknownWebSearchSettings(setting.value);
  return {
    ...setting,
    value: {
      ...webSearchSettings,
      tavily: {
        ...webSearchSettings.tavily,
        apiKeysText: "",
      },
    },
  };
}

async function readLocalMcpSecretSettings(): Promise<AppSetting[]> {
  const snapshot = await exportAllDataForSync();
  return snapshot.appSettings.filter((setting) => setting.key.startsWith(MCP_BEARER_TOKEN_SETTING_PREFIX));
}

function mergeWebSearchSettingsForRestore(remoteSettings: AppSetting[], localValue: unknown): AppSetting[] {
  const localWebSearchSettings = normalizeUnknownWebSearchSettings(localValue);
  return remoteSettings.map((setting) => {
    if (setting.key !== WEB_SEARCH_SETTINGS_KEY) {
      return setting;
    }

    const remoteWebSearchSettings = normalizeUnknownWebSearchSettings(setting.value);
    return {
      ...setting,
      value: {
        ...remoteWebSearchSettings,
        tavily: {
          ...remoteWebSearchSettings.tavily,
          apiKeysText: localWebSearchSettings.tavily.apiKeysText,
        },
      },
    };
  });
}

function normalizeUnknownWebSearchSettings(value: unknown) {
  return normalizeWebSearchSettings(value && typeof value === "object" ? (value as Parameters<typeof normalizeWebSearchSettings>[0]) : undefined);
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
}
