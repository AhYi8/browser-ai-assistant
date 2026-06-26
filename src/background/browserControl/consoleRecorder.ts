export interface BrowserConsoleConnection {
  addEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void;
  removeEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void;
}

interface ConsoleMessageLocation {
  url?: string;
  line?: number;
  column?: number;
}

interface ConsoleMessageEntry {
  kind: "console" | "exception" | "log";
  level: string;
  source?: string;
  text: string;
  location?: ConsoleMessageLocation;
  timestamp?: number;
}

const MAX_CONSOLE_MESSAGES = 200;
const MAX_CONSOLE_TEXT_LENGTH = 500;
const MAX_FORMATTED_MESSAGES = 50;

export class BrowserConsoleRecorder {
  private enabledTabId: number | undefined;
  private readonly messages: ConsoleMessageEntry[] = [];
  private readonly handleEvent = (method: string, params?: Record<string, unknown>) => {
    this.handleConsoleEvent(method, params);
  };

  constructor(private readonly connection: BrowserConsoleConnection) {}

  start(tabId: number): void {
    this.stop();
    this.enabledTabId = tabId;
    this.connection.addEventListener(this.handleEvent);
  }

  stop(): void {
    if (this.enabledTabId === undefined) {
      return;
    }

    this.connection.removeEventListener(this.handleEvent);
    this.enabledTabId = undefined;
    this.clear();
  }

  clear(): void {
    this.messages.length = 0;
  }

  formatMessages(): string {
    if (this.messages.length === 0) {
      return "Console 消息摘要：\n- 暂未采集到 Console 日志、JS 异常或资源错误。";
    }

    const visibleMessages = this.messages.slice(-MAX_FORMATTED_MESSAGES);
    return [
      `Console 消息摘要：共 ${this.messages.length} 条，显示最近 ${visibleMessages.length} 条。`,
      ...visibleMessages.map((message, index) => `${index + 1}. ${formatConsoleMessage(message)}`),
    ].join("\n");
  }

  private handleConsoleEvent(method: string, params: Record<string, unknown> | undefined): void {
    if (!params) {
      return;
    }

    if (method === "Runtime.consoleAPICalled") {
      this.pushConsoleMessage(params);
      return;
    }

    if (method === "Runtime.exceptionThrown") {
      this.pushExceptionMessage(params);
      return;
    }

    if (method === "Log.entryAdded") {
      this.pushLogEntry(params);
    }
  }

  private pushConsoleMessage(params: Record<string, unknown>): void {
    const stackFrame = normalizeStackFrame(params.stackTrace);
    this.push({
      kind: "console",
      level: normalizeString(params.type) || "log",
      text: normalizeConsoleArgs(params.args),
      location: stackFrame,
      timestamp: normalizeNumber(params.timestamp),
    });
  }

  private pushExceptionMessage(params: Record<string, unknown>): void {
    const details = normalizeRecord(params.exceptionDetails);
    if (!details) {
      return;
    }

    const exception = normalizeRecord(details.exception);
    const description = normalizeString(exception?.description) || normalizeString(exception?.value) || normalizeString(details.text);
    this.push({
      kind: "exception",
      level: "exception",
      text: description || "未知异常",
      location: {
        url: normalizeString(details.url),
        line: normalizeNumber(details.lineNumber),
        column: normalizeNumber(details.columnNumber),
      },
      timestamp: normalizeNumber(params.timestamp),
    });
  }

  private pushLogEntry(params: Record<string, unknown>): void {
    const entry = normalizeRecord(params.entry);
    if (!entry) {
      return;
    }

    this.push({
      kind: "log",
      level: normalizeString(entry.level) || "info",
      source: normalizeString(entry.source),
      text: normalizeString(entry.text) || "空日志",
      location: {
        url: normalizeString(entry.url),
        line: normalizeNumber(entry.lineNumber),
      },
      timestamp: normalizeNumber(entry.timestamp),
    });
  }

  private push(message: ConsoleMessageEntry): void {
    this.messages.push({
      ...message,
      text: truncateConsoleText(redactConsoleText(message.text)),
      location: message.location
        ? {
            ...message.location,
            url: redactConsoleUrl(message.location.url ?? ""),
          }
        : undefined,
    });

    while (this.messages.length > MAX_CONSOLE_MESSAGES) {
      this.messages.shift();
    }
  }
}

function formatConsoleMessage(message: ConsoleMessageEntry): string {
  const level = message.kind === "log" && message.source ? `${message.source}:${message.level}` : message.level;
  const location = formatLocation(message.location);
  return `${location ? `${location} ` : ""}[${level}] ${message.text}`;
}

function formatLocation(location: ConsoleMessageLocation | undefined): string {
  if (!location?.url) {
    return "";
  }

  if (typeof location.line === "number" && Number.isFinite(location.line)) {
    const column = typeof location.column === "number" && Number.isFinite(location.column) ? `:${location.column}` : "";
    return `${location.url}:${location.line}${column}`;
  }

  return location.url;
}

function normalizeConsoleArgs(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.map((item) => {
    const source = normalizeRecord(item);
    if (!source) {
      return "";
    }
    const directValue = source.value;
    if (typeof directValue === "string" || typeof directValue === "number" || typeof directValue === "boolean") {
      return String(directValue);
    }
    return normalizeString(source.description) || normalizeString(source.className) || normalizeString(source.type);
  }).filter(Boolean).join(" ");
}

function normalizeStackFrame(value: unknown): ConsoleMessageLocation | undefined {
  const stackTrace = normalizeRecord(value);
  const frames = Array.isArray(stackTrace?.callFrames) ? stackTrace.callFrames : [];
  const firstFrame = normalizeRecord(frames[0]);
  if (!firstFrame) {
    return undefined;
  }

  const lineNumber = normalizeNumber(firstFrame.lineNumber);
  const columnNumber = normalizeNumber(firstFrame.columnNumber);
  return {
    url: normalizeString(firstFrame.url),
    line: typeof lineNumber === "number" ? lineNumber + 1 : undefined,
    column: typeof columnNumber === "number" ? columnNumber + 1 : undefined,
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function redactConsoleUrl(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveConsoleName(key)) {
        url.searchParams.set(key, "[已脱敏]");
      }
    }
    return url.toString().replace(/%5B%E5%B7%B2%E8%84%B1%E6%95%8F%5D/g, "[已脱敏]");
  } catch {
    return redactConsoleText(value);
  }
}

function redactConsoleText(value: string): string {
  return value.replace(/\b(token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|session|csrf|xsrf)\b\s*[:=]\s*["']?[^"'\s;,}]+/gi, "$1=[已脱敏]");
}

function isSensitiveConsoleName(value: string): boolean {
  return /(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|csrf|xsrf)/i.test(value);
}

function truncateConsoleText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_CONSOLE_TEXT_LENGTH ? `${normalized.slice(0, MAX_CONSOLE_TEXT_LENGTH)}...` : normalized;
}
