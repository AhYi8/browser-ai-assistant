import { useEffect, useState } from "react";
import {
  isReleaseVersionNewer,
  normalizeReleaseUpdateCache,
  RELEASE_UPDATE_STORAGE_KEY,
  type ReleaseUpdateCache,
} from "../../shared/releaseUpdate";

export function UpdateAvailableButton() {
  const [releaseUpdate, setReleaseUpdate] = useState<ReleaseUpdateCache>();
  const currentVersion = getCurrentExtensionVersion();

  useEffect(() => {
    const storageArea = globalThis.chrome?.storage?.local;
    const storageChanges = globalThis.chrome?.storage?.onChanged;
    if (!storageArea?.get) {
      return;
    }

    let disposed = false;
    let receivedReleaseUpdateChange = false;
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[RELEASE_UPDATE_STORAGE_KEY]) {
        return;
      }

      // 初次读取与后台启动检测可能并发，存储变更事件必须优先，避免较旧读取结果覆盖新版本状态。
      receivedReleaseUpdateChange = true;
      setReleaseUpdate(normalizeReleaseUpdateCache(changes[RELEASE_UPDATE_STORAGE_KEY].newValue));
    };

    storageChanges?.addListener?.(handleStorageChange);
    void storageArea.get(RELEASE_UPDATE_STORAGE_KEY).then((values) => {
      if (!disposed && !receivedReleaseUpdateChange) {
        setReleaseUpdate(normalizeReleaseUpdateCache(values[RELEASE_UPDATE_STORAGE_KEY]));
      }
    }).catch(() => {
      // 更新提示不是主流程，读取失败时静默隐藏，不阻断侧边栏使用。
    });

    return () => {
      disposed = true;
      storageChanges?.removeListener?.(handleStorageChange);
    };
  }, []);

  if (!releaseUpdate || !currentVersion || !isReleaseVersionNewer(releaseUpdate.latestVersion, currentVersion)) {
    return null;
  }

  const label = `发现新版本 ${releaseUpdate.tagName}，点击前往下载`;
  const openReleasePage = () => {
    const tabs = globalThis.chrome?.tabs;
    if (!tabs?.create) {
      return;
    }

    void Promise.resolve()
      .then(() => tabs.create({ active: true, url: releaseUpdate.releaseUrl }))
      .catch(() => {
        console.error("打开 GitHub Release 页面失败");
      });
  };

  return (
    <button
      className="ui-button-secondary app-header-icon-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={openReleasePage}
    >
      <svg className="app-header-icon app-update-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16V8" />
        <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
      </svg>
    </button>
  );
}

function getCurrentExtensionVersion(): string | undefined {
  try {
    return globalThis.chrome?.runtime?.getManifest?.().version;
  } catch {
    return undefined;
  }
}
