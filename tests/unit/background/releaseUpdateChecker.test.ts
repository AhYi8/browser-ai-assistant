import { describe, expect, it, vi } from "vitest";
import { checkForLatestRelease } from "../../../src/background/releaseUpdateChecker";
import { GITHUB_LATEST_RELEASE_URL, RELEASE_UPDATE_STORAGE_KEY } from "../../../src/shared/releaseUpdate";

describe("正式 Release 更新检测", () => {
  it("跟随正式 Release 重定向并缓存已校验的更新信息", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.7.0",
    } as Response));
    const storageArea = createStorageArea();

    const result = await checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher,
      now: () => 456,
      storageArea,
    });

    expect(result.updateAvailable).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_URL, expect.objectContaining({
      cache: "no-store",
      credentials: "omit",
      method: "HEAD",
      redirect: "follow",
      signal: expect.anything(),
    }));
    expect(storageArea.set).toHaveBeenCalledWith({
      [RELEASE_UPDATE_STORAGE_KEY]: {
        checkedAt: 456,
        latestVersion: "3.7.0",
        releaseUrl: "https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.7.0",
        tagName: "v3.7.0",
      },
    });
  });

  it("远程版本相同或更低时刷新缓存但不标记为可更新", async () => {
    const storageArea = createStorageArea();

    await expect(checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher: createReleaseFetcher("https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.6.1"),
      storageArea,
    })).resolves.toMatchObject({ updateAvailable: false });

    await expect(checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher: createReleaseFetcher("https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.5.9"),
      storageArea,
    })).resolves.toMatchObject({ updateAvailable: false });
  });

  it("网络失败、非法标签或越界 URL 时不覆盖上次成功缓存", async () => {
    const storageArea = createStorageArea();

    await expect(checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher: vi.fn(async () => {
        throw new Error("网络不可用");
      }),
      storageArea,
    })).rejects.toThrow("获取最新正式 Release 失败");
    await expect(checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher: createReleaseFetcher("https://github.com/AhYi8/browser-ai-assistant/releases/tag/v3.7.0-beta.1"),
      storageArea,
    })).rejects.toThrow("Release 地址或版本格式无效");
    await expect(checkForLatestRelease({
      currentVersion: "3.6.1",
      fetcher: createReleaseFetcher("https://example.com/releases/tag/v9.0.0"),
      storageArea,
    })).rejects.toThrow("Release 地址或版本格式无效");

    expect(storageArea.set).not.toHaveBeenCalled();
  });

  it("请求超时后主动中止且不覆盖缓存", async () => {
    vi.useFakeTimers();
    try {
      const storageArea = createStorageArea();
      let requestSignal: AbortSignal | undefined;
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            const error = new Error("请求已中止");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }) as unknown as typeof fetch;

      const checkPromise = checkForLatestRelease({
        currentVersion: "3.6.1",
        fetcher,
        storageArea,
        timeoutMs: 25,
      });
      const rejection = expect(checkPromise).rejects.toThrow("获取最新正式 Release 失败");

      await vi.advanceTimersByTimeAsync(25);
      await rejection;

      expect(requestSignal?.aborted).toBe(true);
      expect(storageArea.set).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createStorageArea() {
  return {
    set: vi.fn().mockResolvedValue(undefined),
  } as unknown as chrome.storage.StorageArea & { set: ReturnType<typeof vi.fn> };
}

function createReleaseFetcher(url: string): typeof fetch {
  return vi.fn(async () => ({ ok: true, status: 200, url } as Response)) as unknown as typeof fetch;
}
