import {
  compareReleaseVersions,
  GITHUB_LATEST_RELEASE_URL,
  parseGithubReleaseUrl,
  RELEASE_UPDATE_STORAGE_KEY,
  type ReleaseUpdateCache,
} from "../shared/releaseUpdate";

interface ReleaseUpdateCheckOptions {
  currentVersion?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  storageArea?: chrome.storage.StorageArea;
  timeoutMs?: number;
}

interface ReleaseUpdateCheckResult {
  cache: ReleaseUpdateCache;
  updateAvailable: boolean;
}

const DEFAULT_RELEASE_UPDATE_TIMEOUT_MS = 10_000;

export async function checkForLatestRelease(options: ReleaseUpdateCheckOptions = {}): Promise<ReleaseUpdateCheckResult> {
  const currentVersion = options.currentVersion ?? chrome.runtime.getManifest().version;
  const fetcher = options.fetcher ?? fetch;
  const storageArea = options.storageArea ?? chrome.storage.local;
  const controller = new AbortController();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetcher(GITHUB_LATEST_RELEASE_URL, {
      cache: "no-store",
      credentials: "omit",
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch {
    throw new Error("获取最新正式 Release 失败");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error("获取最新正式 Release 失败");
  }

  const release = parseGithubReleaseUrl(response.url);
  const versionComparison = release ? compareReleaseVersions(release.latestVersion, currentVersion) : undefined;
  if (!release || versionComparison === undefined) {
    throw new Error("Release 地址或版本格式无效");
  }

  const cache: ReleaseUpdateCache = {
    ...release,
    checkedAt: (options.now ?? Date.now)(),
  };
  await storageArea.set({ [RELEASE_UPDATE_STORAGE_KEY]: cache });

  return {
    cache,
    updateAvailable: versionComparison === 1,
  };
}

function normalizeTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.round(value))
    : DEFAULT_RELEASE_UPDATE_TIMEOUT_MS;
}
