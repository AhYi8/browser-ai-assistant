import { describe, expect, it, vi } from "vitest";
import { RuntimeReadToolExecutor } from "../../../src/background/browserControl/runtimeReadToolExecutor";
import type { ModelToolCall } from "../../../src/shared/models/types";
import type { ToolAuthorizationContext } from "../../../src/shared/toolAuthorization";

function createToolCall(name: string, args: Record<string, unknown> = {}): ModelToolCall {
  return { id: `call-${name}`, name, arguments: args };
}

function createAuthorization(mode: ToolAuthorizationContext["mode"]): ToolAuthorizationContext {
  return { mode, tabId: 7, createdAt: 1, expiresAt: Date.now() + 1000, reason: "测试" };
}

describe("运行时只读工具执行器", () => {
  it("未授权和预留完全访问授权都会 fail closed", async () => {
    const connection = { evaluate: vi.fn() };
    const normalExecutor = new RuntimeReadToolExecutor(connection, () => createAuthorization("normal"));
    const fullAccessExecutor = new RuntimeReadToolExecutor(connection, () => createAuthorization("full_access_reserved"));

    await expect(normalExecutor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.__APP_CONFIG__"] }))).resolves.toMatchObject({
      isError: true,
      content: "运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。",
    });
    await expect(fullAccessExecutor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.__APP_CONFIG__"] }))).resolves.toMatchObject({
      isError: true,
      content: "完全访问授权仍处于后续阶段预留状态，当前版本已拒绝执行。",
    });
    expect(connection.evaluate).not.toHaveBeenCalled();
  });

  it("拒绝任意 JavaScript 表达式、危险路径和超长参数", async () => {
    const connection = { evaluate: vi.fn() };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    await expect(executor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.fetch('https://evil.example')"] }))).resolves.toMatchObject({
      isError: true,
      content: expect.stringContaining("不能传入 JavaScript 表达式"),
    });
    await expect(executor.execute(createToolCall("runtime_describe_function", { path: "window.localStorage.getItem" }))).resolves.toMatchObject({
      isError: true,
      content: "运行时路径包含高风险字段，已拒绝执行。",
    });
    await expect(executor.execute(createToolCall("runtime_search_modules", { keywords: ["x".repeat(81)] }))).resolves.toMatchObject({
      isError: true,
      content: "关键词不能为空且单个长度不能超过 80。",
    });
    expect(connection.evaluate).not.toHaveBeenCalled();
  });

  it("读取公开全局摘要时使用固定 Runtime.evaluate 模板并脱敏截断结果", async () => {
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: {
          value: [
            {
              path: "__APP_CONFIG__",
              exists: true,
              value: {
                entries: [
                  ["apiKey", { type: "string", value: "sk-secret-value" }],
                  ["safe", { type: "string", value: "ok" }],
                  ["long", { type: "string", value: "a".repeat(1000) }],
                ],
              },
            },
          ],
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    const result = await executor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.__APP_CONFIG__"], limit: 5, maxDepth: 4 }));

    expect(result.isError).toBeUndefined();
    expect(result.toolAttachments).toBeUndefined();
    expect(result.content).toContain("运行时全局摘要");
    expect(result.content).toContain("Redacted: true");
    expect(result.content).toContain("Truncated: true");
    expect(result.content).toContain("[REDACTED]");
    expect(connection.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      awaitPromise: false,
      returnByValue: true,
      expression: expect.stringContaining("__APP_CONFIG__"),
    }));
    const evaluateArgs = connection.evaluate.mock.lastCall?.[0] as { expression?: unknown } | undefined;
    expect(String(evaluateArgs?.expression)).not.toContain("fetch(");
  });

  it("固定读取模板会跳过 accessor，避免只读摘要触发页面 getter", async () => {
    let getterCalled = false;
    const connection = {
      evaluate: vi.fn(async (params: Record<string, unknown>) => {
        Object.defineProperty(globalThis, "__RUNTIME_READ_TEST__", {
          configurable: true,
          value: {},
        });
        Object.defineProperty((globalThis as typeof globalThis & { __RUNTIME_READ_TEST__: Record<string, unknown> }).__RUNTIME_READ_TEST__, "computed", {
          enumerable: true,
          get() {
            getterCalled = true;
            return "should-not-read";
          },
        });
        try {
          return { result: { value: (0, eval)(String(params.expression)) } };
        } finally {
          Reflect.deleteProperty(globalThis, "__RUNTIME_READ_TEST__");
        }
      }),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    const result = await executor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.__RUNTIME_READ_TEST__.computed"], maxDepth: 4 }));

    expect(getterCalled).toBe(false);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Accessor skipped");
    expect(result.content).not.toContain("should-not-read");
  });

  it("运行时字符串中的敏感值会整段或按值脱敏", async () => {
    const connection = {
      evaluate: vi.fn(async () => ({
        result: {
          value: {
            snippet: "Authorization: Bearer very-secret-token-value",
            api: "apiKey = \"sk-runtime-secret\"",
            jwt: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          },
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    const result = await executor.execute(createToolCall("runtime_search_modules", { keywords: ["token"] }));

    expect(result.content).toContain("Redacted: true");
    expect(result.content).toContain("[REDACTED]");
    expect(result.content).not.toContain("very-secret-token-value");
    expect(result.content).not.toContain("sk-runtime-secret");
    expect(result.content).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("函数摘要只返回截断片段", async () => {
    const source = `function sign(payload) { return payload + "${"x".repeat(1200)}"; }`;
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: {
          value: {
            exists: true,
            type: "function",
            name: "sign",
            length: 1,
            source,
            truncated: true,
          },
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    const result = await executor.execute(createToolCall("runtime_describe_function", { path: "window.app.sign", radius: 100, keywords: ["payload"] }));

    expect(result.content).toContain("运行时函数摘要");
    expect(result.content).toContain("Truncated: true");
    expect(result.content.length).toBeLessThan(13_000);
  });

  it("CDP 响应结构异常时按空摘要处理而不是抛出异常", async () => {
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: "bad-shape",
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization("runtime_readonly"));

    const result = await executor.execute(createToolCall("runtime_inspect_globals", { paths: ["window.__APP_CONFIG__"] }));

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("运行时全局摘要");
    expect(result.content).toContain("未读取到可用运行时摘要");
  });
});
