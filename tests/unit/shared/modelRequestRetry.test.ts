import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_REQUEST_RETRY_COUNT, normalizeModelRequestRetryCount, withModelRequestRetry } from "../../../src/shared/models/modelRequestRetry";

describe("AI 请求失败重试", () => {
  it("网络异常会按配置重试并返回最终成功结果", async () => {
    const delay = vi.fn<(durationMs: number) => void>();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce("ok");

    const result = await withModelRequestRetry(operation, 5, { delay, random: () => 0 });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 1000);
    expect(delay).toHaveBeenNthCalledWith(2, 2000);
  });

  it("普通 4xx 响应不会重试", async () => {
    const delay = vi.fn<(durationMs: number) => void>();
    const response = new Response("bad request", { status: 400, statusText: "Bad Request" });
    const operation = vi.fn<() => Promise<Response>>().mockResolvedValue(response);

    const result = await withModelRequestRetry(operation, 5, { delay });

    expect(result).toBe(response);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("429 限流响应会按 Retry-After 等待后重试", async () => {
    const delay = vi.fn<(durationMs: number) => void>();
    const retryAfterResponse = new Response("rate limited", {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": "2" },
    });
    const successResponse = new Response("ok", { status: 200 });
    const operation = vi.fn<() => Promise<Response>>().mockResolvedValueOnce(retryAfterResponse).mockResolvedValueOnce(successResponse);

    const result = await withModelRequestRetry(operation, 5, { delay });

    expect(result).toBe(successResponse);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(2000);
  });

  it("耗尽重试次数后抛出最后一次错误", async () => {
    const delay = vi.fn<(durationMs: number) => void>();
    const finalError = new Error("still down");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(finalError);

    await expect(withModelRequestRetry(operation, 1, { delay, random: () => 0 })).rejects.toBe(finalError);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("耗尽可重试响应后返回最后一次响应", async () => {
    const delay = vi.fn<(durationMs: number) => void>();
    const firstResponse = new Response("server error", { status: 500 });
    const finalResponse = new Response("still server error", { status: 503 });
    const operation = vi.fn<() => Promise<Response>>().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(finalResponse);

    const result = await withModelRequestRetry(operation, 1, { delay, random: () => 0 });

    expect(result).toBe(finalResponse);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("归一化重试次数时会防御脏数据和越界值", () => {
    expect(normalizeModelRequestRetryCount(undefined)).toBe(DEFAULT_MODEL_REQUEST_RETRY_COUNT);
    expect(normalizeModelRequestRetryCount(Number.NaN)).toBe(DEFAULT_MODEL_REQUEST_RETRY_COUNT);
    expect(normalizeModelRequestRetryCount(-3)).toBe(0);
    expect(normalizeModelRequestRetryCount(30)).toBe(20);
    expect(normalizeModelRequestRetryCount("6")).toBe(6);
    expect(normalizeModelRequestRetryCount(2.4)).toBe(2);
    expect(normalizeModelRequestRetryCount("bad", 3)).toBe(3);
  });
});
