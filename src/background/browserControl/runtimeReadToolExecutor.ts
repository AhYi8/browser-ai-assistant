import {
  RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME,
  RUNTIME_INSPECT_GLOBALS_TOOL_NAME,
  RUNTIME_SEARCH_MODULES_TOOL_NAME,
} from "../../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";
import type { ToolAuthorizationContext } from "../../shared/toolAuthorization";
import { isUnsupportedReservedAuthorization } from "../../shared/toolAuthorization";

export interface RuntimeReadConnection {
  evaluate(params: Record<string, unknown>): Promise<unknown>;
}

type RuntimeReadToolName =
  | typeof RUNTIME_INSPECT_GLOBALS_TOOL_NAME
  | typeof RUNTIME_SEARCH_MODULES_TOOL_NAME
  | typeof RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME;

interface RuntimeReadSummary {
  redacted: boolean;
  truncated: boolean;
  value: unknown;
}

const RUNTIME_READ_DISABLED_MESSAGE = "运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。";
const RUNTIME_FULL_ACCESS_RESERVED_MESSAGE = "完全访问授权仍处于后续阶段预留状态，当前版本已拒绝执行。";
const RUNTIME_READ_FAILED_MESSAGE = "运行时只读分析失败，请确认当前页面仍可访问后重试。";
const DEFAULT_OBJECT_DEPTH = 2;
const DEFAULT_ENTRY_LIMIT = 12;
const DEFAULT_RESULT_BUDGET = 12_000;
const MAX_STRING_LENGTH = 800;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|csrf|xsrf)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(cookie|authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|session|csrf|xsrf)\b\s*[:=]\s*["']?[^"'\s;,}]{3,}/gi,
];
const DANGEROUS_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "eval",
  "function",
  "document",
  "cookie",
  "localstorage",
  "sessionstorage",
  "indexeddb",
  "fetch",
  "xmlhttprequest",
  "websocket",
]);

export class RuntimeReadToolExecutor {
  constructor(
    private readonly connection: RuntimeReadConnection,
    private readonly getAuthorizationContext: () => ToolAuthorizationContext,
  ) {}

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const authorization = this.getAuthorizationContext();
    if (isUnsupportedReservedAuthorization(authorization)) {
      return createRuntimeReadErrorResult(toolCall, RUNTIME_FULL_ACCESS_RESERVED_MESSAGE);
    }
    if (authorization.mode !== "runtime_readonly") {
      return createRuntimeReadErrorResult(toolCall, RUNTIME_READ_DISABLED_MESSAGE);
    }

    if (!isRuntimeReadToolName(toolCall.name)) {
      return createRuntimeReadErrorResult(toolCall, `未知的运行时只读工具：${toolCall.name}。`);
    }

    const validation = validateRuntimeReadArguments(toolCall);
    if (!validation.ok) {
      return createRuntimeReadErrorResult(toolCall, validation.message);
    }

    try {
      const content = await this.executeValidatedTool(toolCall.name, validation.args);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content,
      };
    } catch {
      return createRuntimeReadErrorResult(toolCall, RUNTIME_READ_FAILED_MESSAGE);
    }
  }

  private async executeValidatedTool(name: RuntimeReadToolName, args: NormalizedRuntimeReadArgs): Promise<string> {
    if (name === RUNTIME_INSPECT_GLOBALS_TOOL_NAME) {
      return this.inspectGlobals(args);
    }
    if (name === RUNTIME_SEARCH_MODULES_TOOL_NAME) {
      return this.searchModules(args);
    }

    return this.describeFunction(args);
  }

  private async inspectGlobals(args: NormalizedRuntimeReadArgs): Promise<string> {
    const paths = args.paths ?? [];
    const expression = createInspectGlobalsExpression(paths.map((path) => path.segments), args.maxDepth, args.limit);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, args.maxDepth, args.limit);
    return formatRuntimeToolContent("运行时全局摘要", summary);
  }

  private async searchModules(args: NormalizedRuntimeReadArgs): Promise<string> {
    const expression = createSearchModulesExpression(args.keywords ?? [], args.limit, args.radius);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, 3, args.limit);
    return formatRuntimeToolContent("运行时模块搜索摘要", summary);
  }

  private async describeFunction(args: NormalizedRuntimeReadArgs): Promise<string> {
    const path = args.path;
    if (!path) {
      return "函数路径不能为空。";
    }
    const expression = createDescribeFunctionExpression(path.segments, args.keywords ?? [], args.radius);
    const response = await this.connection.evaluate({
      expression,
      awaitPromise: false,
      returnByValue: true,
      timeout: 3000,
    });
    const value = extractRuntimeValue(response);
    const summary = summarizeRuntimeValue(value, 2, args.limit);
    return formatRuntimeToolContent("运行时函数摘要", summary);
  }
}

interface NormalizedPath {
  raw: string;
  segments: string[];
}

interface NormalizedRuntimeReadArgs {
  paths?: NormalizedPath[];
  path?: NormalizedPath;
  keywords?: string[];
  maxDepth: number;
  limit: number;
  radius: number;
}

function isRuntimeReadToolName(name: string): name is RuntimeReadToolName {
  return name === RUNTIME_INSPECT_GLOBALS_TOOL_NAME ||
    name === RUNTIME_SEARCH_MODULES_TOOL_NAME ||
    name === RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME;
}

function validateRuntimeReadArguments(toolCall: ModelToolCall): { ok: true; args: NormalizedRuntimeReadArgs } | { ok: false; message: string } {
  if (toolCall.name === RUNTIME_INSPECT_GLOBALS_TOOL_NAME) {
    const extraKeys = Object.keys(toolCall.arguments).filter((key) => !["paths", "maxDepth", "limit"].includes(key));
    if (extraKeys.length > 0) {
      return { ok: false, message: `runtime.inspect_globals 不接受参数：${extraKeys.join("、")}。` };
    }
    const paths = normalizePaths(toolCall.arguments.paths, 10);
    if (!paths.ok) {
      return { ok: false, message: paths.message };
    }
    return {
      ok: true,
      args: {
        paths: paths.paths,
        maxDepth: normalizeInteger(toolCall.arguments.maxDepth, DEFAULT_OBJECT_DEPTH, 1, 4),
        limit: normalizeInteger(toolCall.arguments.limit, DEFAULT_ENTRY_LIMIT, 1, 30),
        radius: 160,
      },
    };
  }

  if (toolCall.name === RUNTIME_SEARCH_MODULES_TOOL_NAME) {
    const extraKeys = Object.keys(toolCall.arguments).filter((key) => !["keywords", "limit", "radius"].includes(key));
    if (extraKeys.length > 0) {
      return { ok: false, message: `runtime.search_modules 不接受参数：${extraKeys.join("、")}。` };
    }
    const keywords = normalizeKeywords(toolCall.arguments.keywords, 10);
    if (!keywords.ok) {
      return { ok: false, message: keywords.message };
    }
    return {
      ok: true,
      args: {
        keywords: keywords.keywords,
        maxDepth: DEFAULT_OBJECT_DEPTH,
        limit: normalizeInteger(toolCall.arguments.limit, 10, 1, 20),
        radius: normalizeInteger(toolCall.arguments.radius, 160, 40, 500),
      },
    };
  }

  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !["path", "keywords", "radius"].includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `runtime.describe_function 不接受参数：${extraKeys.join("、")}。` };
  }
  const path = normalizePath(toolCall.arguments.path);
  if (!path.ok) {
    return { ok: false, message: path.message };
  }
  const keywords = toolCall.arguments.keywords === undefined
    ? { ok: true as const, keywords: [] }
    : normalizeKeywords(toolCall.arguments.keywords, 10);
  if (!keywords.ok) {
    return { ok: false, message: keywords.message };
  }
  return {
    ok: true,
    args: {
      path: path.path,
      keywords: keywords.keywords,
      maxDepth: DEFAULT_OBJECT_DEPTH,
      limit: DEFAULT_ENTRY_LIMIT,
      radius: normalizeInteger(toolCall.arguments.radius, 300, 80, 1000),
    },
  };
}

function normalizePaths(value: unknown, maxItems: number): { ok: true; paths: NormalizedPath[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    return { ok: false, message: `paths 必须包含 1 到 ${maxItems} 个路径。` };
  }

  const paths: NormalizedPath[] = [];
  for (const item of value) {
    const path = normalizePath(item);
    if (!path.ok) {
      return path;
    }
    paths.push(path.path);
  }
  return { ok: true, paths };
}

function normalizePath(value: unknown): { ok: true; path: NormalizedPath } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: "运行时路径必须是字符串。" };
  }
  const raw = value.trim();
  if (!raw || raw.length > 200) {
    return { ok: false, message: "运行时路径不能为空且长度不能超过 200。" };
  }
  if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(raw)) {
    return { ok: false, message: "运行时路径只允许安全的点号路径，不能传入 JavaScript 表达式。" };
  }
  // 用户常按浏览器控制台习惯书写 window/globalThis 前缀；执行固定模板时统一剥离，避免暴露任意表达式入口。
  const segments = raw.split(".").filter((segment, index) => !(index === 0 && (segment === "window" || segment === "globalThis")));
  if (!segments.length) {
    return { ok: false, message: "运行时路径不能只指向 window 或 globalThis。" };
  }
  if (segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return { ok: false, message: "运行时路径包含高风险字段，已拒绝执行。" };
  }
  return { ok: true, path: { raw, segments } };
}

function normalizeKeywords(value: unknown, maxItems: number): { ok: true; keywords: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    return { ok: false, message: `keywords 必须包含 1 到 ${maxItems} 个关键词。` };
  }
  const keywords = Array.from(new Set(value.map((item) => typeof item === "string" ? item.trim() : ""))).filter(Boolean);
  if (!keywords.length || keywords.some((keyword) => keyword.length > 80)) {
    return { ok: false, message: "关键词不能为空且单个长度不能超过 80。" };
  }
  return { ok: true, keywords };
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function createInspectGlobalsExpression(paths: string[][], maxDepth: number, limit: number): string {
  return `(() => {
    const paths = ${JSON.stringify(paths)};
    const maxDepth = ${JSON.stringify(maxDepth)};
    const limit = ${JSON.stringify(limit)};
    const safeKeys = (value) => {
      try {
        return Object.keys(value).slice(0, limit);
      } catch {
        return [];
      }
    };
    const safeDescriptor = (value, key) => {
      try {
        return Object.getOwnPropertyDescriptor(Object(value), key);
      } catch {
        return undefined;
      }
    };
    const safeReadDataProperty = (value, key) => {
      const descriptor = safeDescriptor(value, key);
      if (!descriptor) return { ok: false, skipped: false };
      if (!("value" in descriptor)) return { ok: false, skipped: true };
      return { ok: true, value: descriptor.value };
    };
    const safeFunctionSource = (value) => {
      try {
        return Function.prototype.toString.call(value).slice(0, 800);
      } catch {
        return "[Function source unavailable]";
      }
    };
    const safeFunctionMeta = (value) => {
      const name = safeReadDataProperty(value, "name");
      const length = safeReadDataProperty(value, "length");
      return {
        name: typeof name.value === "string" ? name.value : "",
        length: typeof length.value === "number" ? length.value : 0,
        source: safeFunctionSource(value)
      };
    };
    const readPath = (segments) => {
      let current = globalThis;
      for (const segment of segments) {
        if (current == null) return { exists: false };
        const next = safeReadDataProperty(current, segment);
        if (next.skipped) return { exists: true, value: { type: "accessor", skipped: true, reason: "Accessor skipped" } };
        if (!next.ok) return { exists: false };
        current = next.value;
      }
      return { exists: true, value: summarize(current, 0) };
    };
    const summarize = (value, depth) => {
      const type = typeof value;
      if (value == null || type === "number" || type === "boolean" || type === "bigint") return { type, value: String(value) };
      if (type === "string") return { type, value: value.slice(0, 800), truncated: value.length > 800 };
      if (type === "function") return { type, ...safeFunctionMeta(value) };
      if (depth >= maxDepth) return { type: Array.isArray(value) ? "array" : "object", truncated: true };
      const keys = safeKeys(value);
      const entries = keys.map((key) => {
        const child = safeReadDataProperty(value, key);
        if (child.skipped) return [key, { type: "accessor", skipped: true, reason: "Accessor skipped" }];
        if (!child.ok) return [key, { type: "unknown", skipped: true, reason: "Property unavailable" }];
        return [key, summarize(child.value, depth + 1)];
      });
      return { type: Array.isArray(value) ? "array" : "object", entries, truncated: keys.length >= limit };
    };
    return paths.map((segments) => ({ path: segments.join("."), ...readPath(segments) }));
  })()`;
}

function createSearchModulesExpression(keywords: string[], limit: number, radius: number): string {
  return `(() => {
    const keywords = ${JSON.stringify(keywords.map((keyword) => keyword.toLowerCase()))};
    const limit = ${JSON.stringify(limit)};
    const radius = ${JSON.stringify(radius)};
    const results = [];
    const safeKeys = (value, max) => {
      try {
        return Object.keys(value).slice(0, max);
      } catch {
        return [];
      }
    };
    const safeReadDataProperty = (value, key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
        if (!descriptor || !("value" in descriptor)) return { ok: false };
        return { ok: true, value: descriptor.value };
      } catch {
        return { ok: false };
      }
    };
    const safeToString = (value, fallback = "") => {
      try {
        return String(value);
      } catch {
        return fallback;
      }
    };
    const safeFunctionSource = (value) => {
      try {
        return Function.prototype.toString.call(value);
      } catch {
        return "";
      }
    };
    const pushMatch = (source, id, exportKey, text) => {
      if (results.length >= limit || typeof text !== "string") return;
      const lower = text.toLowerCase();
      const keyword = keywords.find((item) => lower.includes(item));
      if (!keyword) return;
      const index = lower.indexOf(keyword);
      results.push({
        source,
        id: String(id),
        exportKey: exportKey || "",
        keyword,
        snippet: text.slice(Math.max(0, index - radius), Math.min(text.length, index + keyword.length + radius)),
        truncated: text.length > radius * 2 + keyword.length
      });
    };
    const inspectExports = (source, id, exportsValue) => {
      if (!exportsValue || results.length >= limit) return;
      if (typeof exportsValue === "function") pushMatch(source, id, "default", safeFunctionSource(exportsValue));
      if (typeof exportsValue !== "object" && typeof exportsValue !== "function") return;
      for (const key of safeKeys(exportsValue, 50)) {
        const exported = safeReadDataProperty(exportsValue, key);
        if (!exported.ok) continue;
        const value = exported.value;
        const text = typeof value === "function" ? safeFunctionSource(value) : key + ":" + safeToString(value).slice(0, 500);
        pushMatch(source, id, key, text);
        if (results.length >= limit) return;
      }
    };
    const webpackRequire = safeReadDataProperty(globalThis, "__webpack_require__").value;
    const webpackCache = safeReadDataProperty(webpackRequire, "c").value;
    if (webpackRequire && webpackCache) {
      for (const id of safeKeys(webpackCache, 2000)) {
        const moduleValue = safeReadDataProperty(webpackCache, id).value;
        inspectExports("__webpack_require__.c", id, moduleValue && safeReadDataProperty(moduleValue, "exports").value);
        if (results.length >= limit) break;
      }
    }
    for (const key of safeKeys(globalThis, 2000).filter((item) => /webpack/i.test(item)).slice(0, 20)) {
      const chunk = safeReadDataProperty(globalThis, key).value;
      if (!Array.isArray(chunk)) continue;
      for (const item of chunk.slice(0, 100)) {
        const modules = Array.isArray(item) ? item[1] : undefined;
        if (!modules || typeof modules !== "object") continue;
        for (const id of safeKeys(modules, 500)) {
          const moduleFactory = safeReadDataProperty(modules, id);
          if (moduleFactory.ok) {
            pushMatch(key, id, "", safeFunctionSource(moduleFactory.value));
          }
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }
    return { results, truncated: results.length >= limit };
  })()`;
}

function createDescribeFunctionExpression(path: string[], keywords: string[], radius: number): string {
  return `(() => {
    const path = ${JSON.stringify(path)};
    const keywords = ${JSON.stringify(keywords.map((keyword) => keyword.toLowerCase()))};
    const radius = ${JSON.stringify(radius)};
    const safeReadDataProperty = (value, key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
        if (!descriptor) return { ok: false, skipped: false };
        if (!("value" in descriptor)) return { ok: false, skipped: true };
        return { ok: true, value: descriptor.value };
      } catch {
        return { ok: false, skipped: false };
      }
    };
    let current = globalThis;
    for (const segment of path) {
      if (current == null) return { exists: false, message: "路径不存在" };
      const next = safeReadDataProperty(current, segment);
      if (next.skipped) return { exists: true, type: "accessor", message: "目标是 accessor，已跳过读取" };
      if (!next.ok) return { exists: false, message: "路径不存在" };
      current = next.value;
    }
    if (typeof current !== "function") return { exists: true, type: typeof current, message: "目标不是函数" };
    let source = "";
    try {
      source = Function.prototype.toString.call(current);
    } catch {
      return { exists: true, type: "function", message: "函数源码不可读取" };
    }
    const lower = source.toLowerCase();
    const keyword = keywords.find((item) => lower.includes(item));
    const center = keyword ? lower.indexOf(keyword) : 0;
    const start = Math.max(0, center - radius);
    const end = Math.min(source.length, center + (keyword ? keyword.length : 0) + radius);
    const name = safeReadDataProperty(current, "name");
    const length = safeReadDataProperty(current, "length");
    return {
      exists: true,
      type: "function",
      name: typeof name.value === "string" ? name.value : "",
      length: typeof length.value === "number" ? length.value : 0,
      keyword: keyword || "",
      source: source.slice(start, end),
      truncated: source.length > end - start
    };
  })()`;
}

function extractRuntimeValue(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const result = (response as { result?: { value?: unknown } }).result;
  if (!result || typeof result !== "object") {
    return undefined;
  }
  return result?.value;
}

function summarizeRuntimeValue(value: unknown, maxDepth: number, limit: number): RuntimeReadSummary {
  let redacted = false;
  let truncated = false;
  const seen = new WeakSet<object>();
  const summarize = (source: unknown, key = "", depth = 0): unknown => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted = true;
      return "[REDACTED]";
    }
    if (source === null || source === undefined || typeof source === "number" || typeof source === "boolean") {
      return source;
    }
    if (typeof source === "bigint") {
      return source.toString();
    }
    if (typeof source === "string") {
      const text = redactRuntimeString(source);
      if (text !== source) {
        redacted = true;
      }
      if (text.length > MAX_STRING_LENGTH) {
        truncated = true;
        return `${text.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
      }
      return text;
    }
    if (typeof source !== "object") {
      return String(source);
    }
    if (Array.isArray(source) && source.length === 2 && typeof source[0] === "string") {
      return [source[0], summarize(source[1], source[0], depth + 1)];
    }
    if (seen.has(source)) {
      truncated = true;
      return "[Circular]";
    }
    if (depth >= maxDepth) {
      truncated = true;
      return Array.isArray(source) ? "[Array]" : "[Object]";
    }
    seen.add(source);
    const entries = Array.isArray(source) ? source.slice(0, limit).map((item, index) => [String(index), item]) : Object.entries(source).slice(0, limit);
    if ((Array.isArray(source) ? source.length : Object.keys(source).length) > limit) {
      truncated = true;
    }
    return Object.fromEntries(entries.map(([entryKey, entryValue]) => [entryKey, summarize(entryValue, entryKey, depth + 1)]));
  };

  const summarized = summarize(value);
  const json = JSON.stringify(summarized, null, 2);
  if (json === undefined) {
    return { redacted, truncated, value: undefined };
  }
  if (json.length <= DEFAULT_RESULT_BUDGET) {
    return { redacted, truncated, value: summarized };
  }
  truncated = true;
  return {
    redacted,
    truncated,
    value: `${json.slice(0, DEFAULT_RESULT_BUDGET)}\n...[TRUNCATED]`,
  };
}

function redactRuntimeString(source: string): string {
  if (SENSITIVE_KEY_PATTERN.test(source)) {
    return "[REDACTED]";
  }

  let text = source;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

function formatRuntimeToolContent(title: string, summary: RuntimeReadSummary): string {
  const valueText = summary.value === undefined
    ? ""
    : typeof summary.value === "string"
      ? summary.value
      : JSON.stringify(summary.value, null, 2);
  return [
    title,
    `Redacted: ${summary.redacted ? "true" : "false"}`,
    `Truncated: ${summary.truncated ? "true" : "false"}`,
    "",
    valueText || "未读取到可用运行时摘要。",
  ].join("\n");
}

function createRuntimeReadErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}
