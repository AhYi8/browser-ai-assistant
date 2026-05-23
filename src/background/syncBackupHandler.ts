import { backupNow, resolveProviderFromSettings, restoreNow } from "../shared/sync/backupService";
import { getSyncSecrets, getSyncSettings } from "../shared/sync/settings";
import type { SyncSettings } from "../shared/sync/types";

export const SYNC_ALARM_NAME = "browser-ai-assistant.sync-backup";

export type SyncBackupMessage =
  | { type: "sync.backupNow" }
  | { type: "sync.restoreNow" }
  | { type: "sync.configureAlarm"; settings?: SyncSettings };

export type SyncBackupResponse = { ok: true; message: string } | { ok: false; message: string };

export function getChromeSyncQuotaMessage(): string {
  return "备份失败：同步数据超过 Chrome Sync 配额，请减少本地历史记录或改用 WebDAV/S3";
}

export async function handleSyncBackupMessage(message: SyncBackupMessage): Promise<SyncBackupResponse> {
  try {
    if (message.type === "sync.configureAlarm") {
      await configureSyncAlarm(message.settings ?? (await getSyncSettings()));
      return { ok: true, message: "自动同步设置已更新" };
    }

    const settings = await getSyncSettings();
    const secrets = await getSyncSecrets();
    const provider = resolveProviderFromSettings(settings, secrets, chrome.storage.sync, fetch);

    if (message.type === "sync.restoreNow") {
      await restoreNow({ provider });
      return { ok: true, message: "恢复完成" };
    }

    await backupNow({ provider });
    return { ok: true, message: "备份完成" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "同步操作失败，请重试",
    };
  }
}

export async function configureSyncAlarm(settings: SyncSettings): Promise<void> {
  if (!settings.syncEnabled || !settings.autoSyncEnabled) {
    await chrome.alarms.clear(SYNC_ALARM_NAME);
    return;
  }

  await chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: settings.intervalMinutes,
  });
}

export async function restoreSyncAlarmFromSettings(): Promise<void> {
  await configureSyncAlarm(await getSyncSettings());
}

export async function handleSyncAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== SYNC_ALARM_NAME) {
    return;
  }

  const settings = await getSyncSettings();
  if (!settings.syncEnabled || !settings.autoSyncEnabled) {
    await chrome.alarms.clear(SYNC_ALARM_NAME);
    return;
  }

  await handleSyncBackupMessage({ type: "sync.backupNow" });
}
