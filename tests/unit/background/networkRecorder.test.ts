import { describe, expect, it, vi } from "vitest";
import { BrowserNetworkRecorder } from "../../../src/background/browserControl/networkRecorder";

function createConnectionMock() {
  const listeners: Array<(method: string, params?: Record<string, unknown>) => void> = [];
  return {
    addEventListener: vi.fn((listener: (method: string, params?: Record<string, unknown>) => void) => listeners.push(listener)),
    removeEventListener: vi.fn((listener: (method: string, params?: Record<string, unknown>) => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    }),
    getResponseBody: vi.fn(async () => ({ body: "{\"ok\":true,\"token\":\"secret\"}", base64Encoded: false })),
    emit(method: string, params?: Record<string, unknown>) {
      for (const listener of [...listeners]) {
        listener(method, params);
      }
    },
  };
}

describe("debugger Network 采集器", () => {
  it("根据 CDP Network 事件记录请求并读取脱敏详情", async () => {
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);

    recorder.start(7);
    connection.emit("Network.requestWillBeSent", {
      requestId: "req-1",
      timestamp: 1,
      wallTime: 1_700_000_000,
      type: "XHR",
      request: {
        url: "https://api.example.com/login?token=secret&safe=1",
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        postData: "{\"password\":\"123456\",\"name\":\"张三\"}",
      },
    });
    connection.emit("Network.responseReceived", {
      requestId: "req-1",
      timestamp: 1.25,
      type: "XHR",
      response: {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        headers: { "Set-Cookie": "sid=secret", "Content-Type": "application/json" },
      },
    });
    connection.emit("Network.loadingFinished", { requestId: "req-1", timestamp: 1.5 });

    const snapshot = recorder.listRequests();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      id: "req-1",
      method: "POST",
      status: 200,
      resourceType: "XHR",
      durationMs: 500,
    });
    expect(snapshot[0].url).toBe("https://api.example.com/login?token=[已脱敏]&safe=1");
    expect(snapshot[0].requestHeaders).toEqual([
      { name: "Authorization", value: "[已脱敏]" },
      { name: "Content-Type", value: "application/json" },
    ]);

    const details = await recorder.getDetails(["req-1"]);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      id: "req-1",
      responseBody: "{\"ok\":true,\"token\":\"[已脱敏]\"}",
      responseBodyEncoding: "utf-8",
      redacted: true,
      truncated: false,
    });
    expect(details[0].responseHeaders).toEqual([
      { name: "Set-Cookie", value: "[已脱敏]" },
      { name: "Content-Type", value: "application/json" },
    ]);

    const rawDetails = await recorder.getDetails(["req-1"], { redacted: false });
    expect(rawDetails[0]).toMatchObject({
      url: "https://api.example.com/login?token=secret&safe=1",
      requestBody: "{\"password\":\"123456\",\"name\":\"张三\"}",
      responseBody: "{\"ok\":true,\"token\":\"secret\"}",
      redacted: false,
    });
    expect(rawDetails[0].requestHeaders).toEqual([
      { name: "Authorization", value: "Bearer secret" },
      { name: "Content-Type", value: "application/json" },
    ]);

    const rawList = recorder.listRequests({}, { redacted: false });
    expect(rawList[0]?.url).toBe("https://api.example.com/login?token=secret&safe=1");
    expect(rawList[0]?.requestHeaders).toEqual(expect.arrayContaining([{ name: "Authorization", value: "Bearer secret" }]));
  });

  it("支持清空、等待匹配请求和停止监听", async () => {
    vi.useFakeTimers();
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    const waitPromise = recorder.waitForRequests({ urlIncludes: "submit", timeoutMs: 1000 });
    connection.emit("Network.requestWillBeSent", {
      requestId: "req-submit",
      timestamp: 2,
      request: { url: "https://api.example.com/submit", method: "GET", headers: {} },
    });

    await expect(waitPromise).resolves.toMatchObject([{ id: "req-submit" }]);
    recorder.clear();
    expect(recorder.listRequests()).toEqual([]);

    recorder.stop();
    expect(connection.removeEventListener).toHaveBeenCalled();
    connection.emit("Network.requestWillBeSent", {
      requestId: "req-after-stop",
      timestamp: 3,
      request: { url: "https://api.example.com/after-stop", method: "GET", headers: {} },
    });
    expect(recorder.listRequests()).toEqual([]);
    vi.useRealTimers();
  });

  it("长时间采集时只保留最近的 Network 请求，避免缓存无限增长", () => {
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    for (let index = 0; index < 1005; index += 1) {
      connection.emit("Network.requestWillBeSent", {
        requestId: `req-${index}`,
        timestamp: index,
        request: { url: `https://api.example.com/items/${index}`, method: "GET", headers: {} },
      });
    }

    const requests = recorder.listRequests({ limit: 1000 });
    expect(requests).toHaveLength(1000);
    expect(requests[0].id).toBe("req-5");
    expect(requests.at(-1)?.id).toBe("req-1004");
  });

  it("默认列表只返回最近 200 条请求，避免工具省略 limit 时输出过大", () => {
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    for (let index = 0; index < 250; index += 1) {
      connection.emit("Network.requestWillBeSent", {
        requestId: `req-${index}`,
        timestamp: index,
        request: { url: `https://api.example.com/items/${index}`, method: "GET", headers: {} },
      });
    }

    const requests = recorder.listRequests();
    expect(requests).toHaveLength(200);
    expect(requests[0].id).toBe("req-50");
    expect(requests.at(-1)?.id).toBe("req-249");
  });

  it("缓存裁剪优先淘汰已完成请求，避免等待 status 的 pending 请求丢失后续响应", async () => {
    vi.useFakeTimers();
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    connection.emit("Network.requestWillBeSent", {
      requestId: "pending-api",
      timestamp: 1,
      type: "XHR",
      request: { url: "https://api.example.com/pending", method: "GET", headers: {} },
    });
    for (let index = 0; index < 1000; index += 1) {
      connection.emit("Network.requestWillBeSent", {
        requestId: `done-${index}`,
        timestamp: index + 2,
        request: { url: `https://cdn.example.com/${index}.js`, method: "GET", headers: {} },
      });
      connection.emit("Network.loadingFinished", { requestId: `done-${index}`, timestamp: index + 2.1 });
    }

    const waitPromise = recorder.waitForRequests({ urlIncludes: "pending", status: 200, timeoutMs: 1000 });
    connection.emit("Network.responseReceived", {
      requestId: "pending-api",
      timestamp: 1005,
      type: "XHR",
      response: { status: 200, statusText: "OK", mimeType: "application/json", headers: {} },
    });

    await expect(waitPromise).resolves.toMatchObject([{ id: "pending-api", status: 200 }]);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("支持等待 Network 空闲，并在仍有进行中请求时等到完成后再返回", async () => {
    vi.useFakeTimers();
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    connection.emit("Network.requestWillBeSent", {
      requestId: "req-pending",
      timestamp: 1,
      request: { url: "https://api.example.com/pending", method: "GET", headers: {} },
    });
    const idlePromise = recorder.waitForIdle({ idleMs: 100, timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(99);
    let resolved = false;
    idlePromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    connection.emit("Network.loadingFinished", { requestId: "req-pending", timestamp: 1.2 });
    await vi.advanceTimersByTimeAsync(100);

    await expect(idlePromise).resolves.toEqual({ ok: true, idleMs: 100 });
    vi.useRealTimers();
  });

  it("读取详情时跳过明显的二进制响应体，避免拉取大文件进入内存", async () => {
    const connection = createConnectionMock();
    const recorder = new BrowserNetworkRecorder(connection);
    recorder.start(7);

    connection.emit("Network.requestWillBeSent", {
      requestId: "image-1",
      timestamp: 1,
      request: { url: "https://cdn.example.com/banner.png", method: "GET", headers: {} },
    });
    connection.emit("Network.responseReceived", {
      requestId: "image-1",
      timestamp: 1.1,
      type: "Image",
      response: {
        status: 200,
        mimeType: "image/png",
        headers: { "Content-Type": "image/png" },
      },
    });

    const details = await recorder.getDetails(["image-1"]);

    expect(connection.getResponseBody).not.toHaveBeenCalled();
    expect(details[0]).toMatchObject({
      id: "image-1",
      mimeType: "image/png",
      resourceType: "Image",
      responseBody: undefined,
      truncated: false,
    });
  });
});
