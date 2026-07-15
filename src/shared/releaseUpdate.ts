export const GITHUB_LATEST_RELEASE_URL = "https://github.com/AhYi8/browser-ai-assistant/releases/latest";
export const RELEASE_UPDATE_STORAGE_KEY = "browserAiAssistantReleaseUpdate";

export interface ReleaseUpdateCache {
  checkedAt: number;
  latestVersion: string;
  releaseUrl: string;
  tagName: string;
}

interface ParsedReleasePage {
  latestVersion: string;
  releaseUrl: string;
  tagName: string;
}

const RELEASE_PATH_PATTERN = /^\/AhYi8\/browser-ai-assistant\/releases\/tag\/([^/]+)\/?$/i;
const RELEASE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/i;

export function compareReleaseVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  if (!leftParts || !rightParts) {
    return undefined;
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }
  return 0;
}

export function isReleaseVersionNewer(latestVersion: string, currentVersion: string): boolean {
  return compareReleaseVersions(latestVersion, currentVersion) === 1;
}

export function parseGithubReleaseUrl(value: unknown): ParsedReleasePage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }

    const pathMatch = url.pathname.match(RELEASE_PATH_PATTERN);
    if (!pathMatch?.[1]) {
      return undefined;
    }

    const tagName = decodeURIComponent(pathMatch[1]);
    const versionParts = parseReleaseVersion(tagName);
    if (!versionParts) {
      return undefined;
    }

    return {
      latestVersion: versionParts.join("."),
      releaseUrl: `https://github.com/AhYi8/browser-ai-assistant/releases/tag/${tagName}`,
      tagName,
    };
  } catch {
    return undefined;
  }
}

export function normalizeReleaseUpdateCache(value: unknown): ReleaseUpdateCache | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const cache = value as Partial<ReleaseUpdateCache>;
  const release = parseGithubReleaseUrl(cache.releaseUrl);
  if (
    !release ||
    typeof cache.checkedAt !== "number" ||
    !Number.isSafeInteger(cache.checkedAt) ||
    cache.checkedAt < 0 ||
    cache.latestVersion !== release.latestVersion ||
    cache.tagName !== release.tagName
  ) {
    return undefined;
  }

  return {
    checkedAt: cache.checkedAt,
    latestVersion: release.latestVersion,
    releaseUrl: release.releaseUrl,
    tagName: release.tagName,
  };
}

function parseReleaseVersion(value: unknown): [number, number, number] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(RELEASE_VERSION_PATTERN);
  if (!match) {
    return undefined;
  }

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    return undefined;
  }
  return parts as [number, number, number];
}
