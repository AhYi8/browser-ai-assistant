import { useState } from "react";
import { useAppStore } from "../../state/appStore";
import { useComposedTextInput } from "../useComposedTextInput";

export function SyncSettings() {
  const syncSettings = useAppStore((state) => state.syncSettings);
  const syncSecrets = useAppStore((state) => state.syncSecrets);
  const remoteBackups = useAppStore((state) => state.remoteBackups);
  const syncOperation = useAppStore((state) => state.syncOperation);
  const updateSyncSettings = useAppStore((state) => state.updateSyncSettings);
  const updateSyncSecret = useAppStore((state) => state.updateSyncSecret);
  const loadRemoteBackups = useAppStore((state) => state.loadRemoteBackups);
  const backupNow = useAppStore((state) => state.backupNow);
  const restoreNow = useAppStore((state) => state.restoreNow);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const backupPrefixInput = useComposedTextInput(syncSettings.backupPrefix, (backupPrefix) => {
    void updateSyncSettings({ backupPrefix });
  });
  const encryptionSecretInput = useComposedTextInput(syncSecrets.encryptionSecret, (encryptionSecret) => {
    void updateSyncSecret("encryptionSecret", encryptionSecret);
  });
  const webDavEndpointUrlInput = useComposedTextInput(syncSettings.webdav.endpointUrl, (endpointUrl) => {
    void updateSyncSettings({ webdav: { ...syncSettings.webdav, endpointUrl } });
  });
  const webDavUsernameInput = useComposedTextInput(syncSettings.webdav.username, (username) => {
    void updateSyncSettings({ webdav: { ...syncSettings.webdav, username } });
  });
  const webDavPasswordInput = useComposedTextInput(syncSecrets.webDavPassword, (webDavPassword) => {
    void updateSyncSecret("webDavPassword", webDavPassword);
  });
  const webDavRemotePathInput = useComposedTextInput(syncSettings.webdav.remotePath, (remotePath) => {
    void updateSyncSettings({ webdav: { ...syncSettings.webdav, remotePath } });
  });
  const s3EndpointUrlInput = useComposedTextInput(syncSettings.s3.endpointUrl, (endpointUrl) => {
    void updateSyncSettings({ s3: { ...syncSettings.s3, endpointUrl } });
  });
  const s3AccessKeyIdInput = useComposedTextInput(syncSettings.s3.accessKeyId, (accessKeyId) => {
    void updateSyncSettings({ s3: { ...syncSettings.s3, accessKeyId } });
  });
  const s3SecretKeyInput = useComposedTextInput(syncSecrets.s3SecretKey, (s3SecretKey) => {
    void updateSyncSecret("s3SecretKey", s3SecretKey);
  });
  const s3BucketInput = useComposedTextInput(syncSettings.s3.bucket, (bucket) => {
    void updateSyncSettings({ s3: { ...syncSettings.s3, bucket } });
  });
  const s3RegionInput = useComposedTextInput(syncSettings.s3.region, (region) => {
    void updateSyncSettings({ s3: { ...syncSettings.s3, region } });
  });
  const s3ObjectKeyPrefixInput = useComposedTextInput(syncSettings.s3.objectKeyPrefix, (objectKeyPrefix) => {
    void updateSyncSettings({ s3: { ...syncSettings.s3, objectKeyPrefix } });
  });
  const handleRestore = () => {
    setRestoreDialogOpen(true);
    setSelectedBackupId("");
    void loadRemoteBackups();
  };
  const handleConfirmRestore = () => {
    if (!selectedBackupId) {
      return;
    }

    setRestoreDialogOpen(false);
    void restoreNow(selectedBackupId);
  };

  return (
    <section className="grid w-full gap-3" aria-label="同步设置">
      <h3 className="text-base font-semibold">同步设置</h3>
      <p className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2 text-sm text-[var(--color-body)]">
        备份当前插件域本地存储的全部内容，密钥和远程凭据除外
      </p>
      {!syncSettings.encryptionEnabled ? (
        <p className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-surface-soft)] p-2 text-sm text-[var(--color-body)]">
          加密关闭时，API Key、聊天记录和配置会以明文进入远程备份
        </p>
      ) : (
        <p className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-surface-soft)] p-2 text-sm text-[var(--color-body)]">
          忘记密钥将无法恢复已加密的同步数据
        </p>
      )}
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={syncSettings.syncEnabled}
          onChange={(event) => void updateSyncSettings({ syncEnabled: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">开启同步</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={syncSettings.autoSyncEnabled}
          onChange={(event) => void updateSyncSettings({ autoSyncEnabled: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">开启自动同步</span>
      </label>
      <label className="grid gap-1 text-sm">
        备份目标
        <select
          className="ui-input"
          aria-label="备份目标"
          value={syncSettings.provider}
          disabled={!syncSettings.syncEnabled}
          onChange={(event) => void updateSyncSettings({ provider: event.target.value as typeof syncSettings.provider })}
        >
          <option value="chrome_sync">Chrome Sync</option>
          <option value="webdav">WebDAV</option>
          <option value="s3">S3 兼容存储</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        备份前缀
        <input
          className="ui-input"
          aria-label="备份前缀"
          disabled={!syncSettings.syncEnabled}
          {...backupPrefixInput}
        />
      </label>
      <label className="grid gap-1 text-sm">
        最大备份数量
        <input
          className="ui-input"
          aria-label="最大备份数量"
          disabled={!syncSettings.syncEnabled}
          type="number"
          min={1}
          max={30}
          value={syncSettings.maxBackupCount}
          onChange={(event) => void updateSyncSettings({ maxBackupCount: Number(event.target.value) })}
        />
      </label>
      {syncSettings.autoSyncEnabled ? (
        <label className="grid gap-1 text-sm">
          定时同步间隔（分钟）
          <input
            className="ui-input"
            aria-label="定时同步间隔"
            type="number"
            min={1}
            value={syncSettings.intervalMinutes}
            onChange={(event) => void updateSyncSettings({ intervalMinutes: Number(event.target.value) })}
          />
        </label>
      ) : null}
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={syncSettings.encryptionEnabled}
          onChange={(event) => void updateSyncSettings({ encryptionEnabled: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">开启加密</span>
      </label>
      {syncSettings.encryptionEnabled ? (
        <label className="grid gap-1 text-sm">
          本地加密密钥
          <input
            className="ui-input"
            aria-label="本地加密密钥"
            type="password"
            {...encryptionSecretInput}
          />
        </label>
      ) : null}
      {syncSettings.provider === "webdav" ? (
        <div className="grid gap-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-3">
          <label className="grid gap-1 text-sm">
            WebDAV 地址
            <input
              className="ui-input"
              aria-label="WebDAV 地址"
              {...webDavEndpointUrlInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            WebDAV 用户名
            <input
              className="ui-input"
              aria-label="WebDAV 用户名"
              {...webDavUsernameInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            WebDAV 密码
            <input
              className="ui-input"
              aria-label="WebDAV 密码"
              type="password"
              {...webDavPasswordInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            WebDAV 远程路径
            <input
              className="ui-input"
              aria-label="WebDAV 远程路径"
              {...webDavRemotePathInput}
            />
          </label>
        </div>
      ) : null}
      {syncSettings.provider === "s3" ? (
        <div className="grid gap-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-3">
          <label className="grid gap-1 text-sm">
            S3 Endpoint
            <input
              className="ui-input"
              aria-label="S3 Endpoint"
              {...s3EndpointUrlInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            S3 Access Key
            <input
              className="ui-input"
              aria-label="S3 Access Key"
              {...s3AccessKeyIdInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            S3 Secret Key
            <input
              className="ui-input"
              aria-label="S3 Secret Key"
              type="password"
              {...s3SecretKeyInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            S3 Bucket
            <input
              className="ui-input"
              aria-label="S3 Bucket"
              {...s3BucketInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            S3 Region
            <input
              className="ui-input"
              aria-label="S3 Region"
              {...s3RegionInput}
            />
          </label>
          <label className="grid gap-1 text-sm">
            S3 对象前缀
            <input
              className="ui-input"
              aria-label="S3 对象前缀"
              {...s3ObjectKeyPrefixInput}
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className="ui-button-secondary" type="button" disabled={!syncSettings.syncEnabled || syncOperation.loading} onClick={() => void backupNow()}>
          手动备份
        </button>
        <button className="ui-button-secondary" type="button" disabled={!syncSettings.syncEnabled || syncOperation.loading} onClick={handleRestore}>
          手动恢复
        </button>
      </div>
      {restoreDialogOpen ? (
        <RestoreBackupDialog
          backups={remoteBackups}
          loading={syncOperation.loading}
          selectedBackupId={selectedBackupId}
          onSelectBackup={setSelectedBackupId}
          onCancel={() => setRestoreDialogOpen(false)}
          onConfirm={handleConfirmRestore}
        />
      ) : null}
    </section>
  );
}

interface RestoreBackupDialogProps {
  backups: ReturnType<typeof useAppStore.getState>["remoteBackups"];
  loading: boolean;
  selectedBackupId: string;
  onSelectBackup: (backupId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function RestoreBackupDialog({ backups, loading, selectedBackupId, onSelectBackup, onCancel, onConfirm }: RestoreBackupDialogProps) {
  return (
    <>
      <div className="dialog-overlay" aria-hidden="true" onClick={onCancel} />
      <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-label="选择远程备份恢复">
        <div className="context-dialog-header">
          <div className="min-w-0">
            <h4 className="context-dialog-title">选择远程备份恢复</h4>
            <p className="ui-muted mt-1 text-xs">恢复会覆盖本地业务数据，但会保留本地密钥和远程凭据</p>
          </div>
          <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭恢复弹窗" onClick={onCancel}>
            关闭
          </button>
        </div>
        <div className="grid max-h-72 gap-2 overflow-y-auto">
          {loading ? <p className="text-sm text-[var(--color-muted)]">正在读取远程备份</p> : null}
          {!loading && backups.length === 0 ? <p className="text-sm text-[var(--color-muted)]">未找到远程备份</p> : null}
          {backups.map((backup) => (
            <label
              key={backup.id}
              className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-3 text-sm"
            >
              <span className="sync-restore-backup-row flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <input
                  className="shrink-0"
                  type="radio"
                  name="sync-restore-backup"
                  checked={selectedBackupId === backup.id}
                  onChange={() => onSelectBackup(backup.id)}
                />
                <span className="min-w-0 max-w-full truncate font-medium">{backup.prefix}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">{formatBackupCreatedAt(backup.createdAt)}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">{backup.encrypted ? "已加密" : "未加密"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ui-button-primary" type="button" disabled={!selectedBackupId || loading} onClick={onConfirm}>
            确认覆盖本地数据并恢复
          </button>
          <button className="ui-button-secondary" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </>
  );
}

function formatBackupCreatedAt(createdAt: number): string {
  return new Date(createdAt).toLocaleString("zh-CN");
}
