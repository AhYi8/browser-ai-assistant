import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  isReleaseVersionNewer,
  normalizeReleaseUpdateCache,
  parseGithubReleaseUrl,
} from "../../../src/shared/releaseUpdate";

describe("Release 更新信息", () => {
  it("兼容带 v 和不带 v 的三段版本号并按数值比较", () => {
    expect(compareReleaseVersions("v3.10.0", "3.9.9")).toBe(1);
    expect(compareReleaseVersions("3.6.1", "v3.6.1")).toBe(0);
    expect(compareReleaseVersions("v3.5.9", "3.6.0")).toBe(-1);
    expect(isReleaseVersionNewer("v4.0.0", "3.99.99")).toBe(true);
    expect(isReleaseVersionNewer("v3.6.0-beta.1", "3.5.0")).toBe(false);
    expect(compareReleaseVersions(" v3.6.1", "3.6.0")).toBeUndefined();
  });

  it("只接受当前仓库的 HTTPS 正式 Release 标签页", () => {
    expect(parseGithubReleaseUrl("https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2")).toEqual({
      latestVersion: "3.6.2",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2",
      tagName: "v3.6.2",
    });
    expect(parseGithubReleaseUrl("https://github.com/AhYi8/browser-ai-assistant/releases/tag/3.6.2")).toEqual({
      latestVersion: "3.6.2",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/3.6.2",
      tagName: "3.6.2",
    });
    expect(parseGithubReleaseUrl("http://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2")).toBeUndefined();
    expect(parseGithubReleaseUrl("https://github.com/other/browser-ai-assistant/releases/tag/v9.0.0")).toBeUndefined();
    expect(parseGithubReleaseUrl("https://example.com/AhYi8/browser-ai-assistant/releases/tag/v9.0.0")).toBeUndefined();
    expect(parseGithubReleaseUrl("https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2-beta.1")).toBeUndefined();
    expect(parseGithubReleaseUrl("https://github.com/AhYi8/browser-ai-assistant/releases/tag/%20v3.6.2%20")).toBeUndefined();
  });

  it("读取缓存时校验版本、URL 和检测时间的一致性", () => {
    expect(normalizeReleaseUpdateCache({
      checkedAt: 123,
      latestVersion: "3.6.2",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2",
      tagName: "v3.6.2",
    })).toEqual({
      checkedAt: 123,
      latestVersion: "3.6.2",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2",
      tagName: "v3.6.2",
    });
    expect(normalizeReleaseUpdateCache({
      checkedAt: 123,
      latestVersion: "9.0.0",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2",
      tagName: "v3.6.2",
    })).toBeUndefined();
    expect(normalizeReleaseUpdateCache({
      checkedAt: -1,
      latestVersion: "3.6.2",
      releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.2",
      tagName: "v3.6.2",
    })).toBeUndefined();
  });
});
