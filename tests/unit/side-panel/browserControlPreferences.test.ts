import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase, getAppSetting, saveAppSetting } from "../../../src/shared/storage/repositories";

describe("浏览器控制全局运行态", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("启动后默认关闭且不从聊天偏好恢复", async () => {
    await saveAppSetting({
      key: "chatPreferences",
      value: {
        systemPrompt: "全局提示",
        browserControlEnabled: true,
        temperature: 0.4,
        maxTokens: 2048,
      },
      updatedAt: 1,
    });

    await useAppStore.getState().loadChannelConfig();

    expect(useAppStore.getState().browserControlEnabled).toBe(false);
  });

  it("开启和关闭全局浏览器控制时同步通知 background", async () => {
    const sendMessage = vi.fn((message: { type: string; enabled?: boolean }, callback: (response: unknown) => void) => {
      callback({ ok: true, attached: message.enabled === true, message: "ok" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await useAppStore.getState().setBrowserControlEnabled(true);
    await useAppStore.getState().setBrowserControlEnabled(false);

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "browserControl.setEnabled", enabled: true }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: "browserControl.setEnabled", enabled: false }, expect.any(Function));
    expect(await getAppSetting("chatPreferences")).toBeUndefined();
  });

  it("运行时只读授权只走临时 runtime 消息且不持久化", async () => {
    const sendMessage = vi.fn((message: { type: string; enabled?: boolean }, callback: (response: unknown) => void) => {
      callback({ ok: true, attached: true, tabId: 7, message: "ok" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    useAppStore.setState({ browserControlEnabled: true });

    await useAppStore.getState().setRuntimeReadonlyEnabled(true);
    await useAppStore.getState().setRuntimeReadonlyEnabled(false);

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: "browserControl.setRuntimeReadonly",
      enabled: true,
      reason: "用户在侧边栏临时开启运行时只读分析。",
    }, expect.any(Function));
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: "browserControl.setRuntimeReadonly",
      enabled: false,
      reason: "用户在侧边栏临时开启运行时只读分析。",
    }, expect.any(Function));
    expect(await getAppSetting("chatPreferences")).toBeUndefined();
  });

  it("关闭或外部断开浏览器控制会清理运行时只读授权", async () => {
    const sendMessage = vi.fn((message: { type: string; enabled?: boolean }, callback: (response: unknown) => void) => {
      callback({ ok: true, attached: message.enabled === true, message: "ok" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    useAppStore.setState({ browserControlEnabled: true, runtimeReadonlyEnabled: true });

    await useAppStore.getState().setBrowserControlEnabled(false);
    expect(useAppStore.getState().runtimeReadonlyEnabled).toBe(false);

    useAppStore.setState({ browserControlEnabled: true, runtimeReadonlyEnabled: true });
    useAppStore.getState().markBrowserControlDetached();
    expect(useAppStore.getState().browserControlEnabled).toBe(false);
    expect(useAppStore.getState().runtimeReadonlyEnabled).toBe(false);
  });

  it("background 拒绝开启时回滚全局浏览器控制运行态", async () => {
    const sendMessage = vi.fn((_message: { type: string; enabled?: boolean }, callback: (response: unknown) => void) => {
      callback({ ok: false, message: "当前页面无法开启浏览器控制" });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    await useAppStore.getState().setBrowserControlEnabled(true);

    expect(useAppStore.getState().browserControlEnabled).toBe(false);
    expect(useAppStore.getState().failure?.message).toBe("当前页面无法开启浏览器控制");
  });
});
