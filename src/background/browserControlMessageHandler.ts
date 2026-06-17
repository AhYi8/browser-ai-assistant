import {
  BROWSER_CONTROL_DETACHED_MESSAGE_TYPE,
  BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE,
  getBrowserControlTabUrl,
  isBrowserControlRestrictedUrl,
  type BrowserControlMessage,
  type BrowserControlResponse,
} from "../shared/browserControl";
import type { ModelToolCall, ModelToolResult } from "../shared/models/types";
import type { ToolAuthorizationContext } from "../shared/toolAuthorization";
import { NORMAL_TOOL_AUTHORIZATION_CONTEXT, isRuntimeReadonlyAuthorized } from "../shared/toolAuthorization";
import {
  BrowserControlActionExecutor,
  createBrowserActionDisabledResult,
  createBrowserActionErrorResult,
  isBrowserControlActionName,
} from "./browserControl/actions";
import { BrowserNetworkRecorder } from "./browserControl/networkRecorder";
import { BrowserNetworkToolExecutor } from "./browserControl/networkToolExecutor";
import { JsSourceToolExecutor } from "./browserControl/jsSourceToolExecutor";
import { SourceMapToolExecutor } from "./browserControl/sourceMapToolExecutor";
import { RuntimeReadToolExecutor } from "./browserControl/runtimeReadToolExecutor";

type Debuggee = chrome.debugger.Debuggee;
type ChromeApi = typeof chrome;
type DebuggerDetachReason = `${chrome.debugger.DetachReason}`;
type BrowserControlDetachedReason = "canceled_by_user" | "target_closed" | "tab_removed" | "disabled_by_user" | "unknown";
type BrowserControlTabInfo = { title: string; url: string };
type BrowserControlPageToolName = "navigate_page" | "new_page" | "list_pages" | "select_page" | "close_page";
type BrowserControlDialogType = "alert" | "confirm" | "prompt" | "beforeunload" | string;

interface BrowserControlDialogState {
  type: BrowserControlDialogType;
  message: string;
  defaultPrompt: string;
  openedAt: number;
}

interface BrowserControlDialogCloseState extends BrowserControlDialogState {
  result: boolean;
  userInput?: string;
}

interface SnapshotFormatBudget {
  lines: string[];
  visitedNodeIds: Set<string>;
  nodeCount: number;
  characterCount: number;
  truncated: boolean;
}

interface AccessibilityProperty {
  name?: string;
  value?: {
    value?: unknown;
  };
}

interface AccessibilityNode {
  nodeId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: {
    value?: unknown;
  };
  name?: {
    value?: unknown;
  };
  value?: {
    value?: unknown;
  };
  properties?: AccessibilityProperty[];
  childIds?: string[];
}

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const SNAPSHOT_MAX_LENGTH = 20_000;
const SNAPSHOT_MAX_DEPTH = 50;
const SNAPSHOT_MAX_NODE_COUNT = 1_000;
const SNAPSHOT_EMPTY_TEXT = "未读取到可访问节点。";
const SNAPSHOT_TRUNCATED_TEXT = "快照内容过长，已停止继续展开。";
const BROWSER_SNAPSHOT_DISABLED_MESSAGE = "浏览器控制未开启，无法读取页面快照。请先在顶部浏览器控制按钮中显式开启。";
const BROWSER_SNAPSHOT_FAILED_MESSAGE = "读取页面快照失败，请确认当前页面仍可访问后重试。";
const DIALOG_WAIT_TIMEOUT_MS = 60_000;
const SKIPPED_AX_ROLES = new Set(["none", "generic", "section", "paragraph", "StaticText", "InlineTextBox"]);
const ALLOWED_BROWSER_CONTROL_CDP_METHODS = new Set([
  "Runtime.enable",
  "Page.enable",
  "DOM.enable",
  "Accessibility.enable",
  "Network.enable",
  "Network.getResponseBody",
  "Accessibility.getFullAXTree",
  "DOM.resolveNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.getBoxModel",
  "Runtime.callFunctionOn",
  "Runtime.evaluate",
  "Page.navigate",
  "Page.reload",
  "Page.getNavigationHistory",
  "Page.navigateToHistoryEntry",
  "Page.getFrameTree",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
]);

function getChromeApi(): ChromeApi | undefined {
  return globalThis.chrome;
}

export class BrowserDebuggerConnection {
  private currentTabId: number | undefined;
  private attached = false;
  private detachListenersInstalled = false;
  private eventListenersInstalled = false;
  private readonly eventListeners = new Set<(method: string, params?: Record<string, unknown>) => void>();
  private currentDialog: BrowserControlDialogState | undefined;
  private lastClosedDialog: BrowserControlDialogCloseState | undefined;
  private dialogWaiter: ((dialog: BrowserControlDialogCloseState) => void) | undefined;

  constructor(private readonly chromeApi: ChromeApi | undefined = getChromeApi()) {}

  get attachedTabId(): number | undefined {
    return this.attached ? this.currentTabId : undefined;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  getDialogHint(): string {
    const dialog = this.lastClosedDialog ?? this.currentDialog;
    if (!dialog) {
      return "";
    }

    const closed = isClosedDialog(dialog)
      ? `\n用户处理结果：${formatDialogCloseResult(dialog)}`
      : "\n用户处理结果：等待用户手动处理。";
    return `检测到网页弹窗：${dialog.type}「${dialog.message || "无内容"}」${closed}`;
  }

  addEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.eventListeners.add(listener);
  }

  removeEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.eventListeners.delete(listener);
  }

  async waitForOpenDialogToClose(timeoutMs = DIALOG_WAIT_TIMEOUT_MS): Promise<string> {
    if (this.lastClosedDialog) {
      const hint = `检测到网页弹窗：${this.lastClosedDialog.type}「${this.lastClosedDialog.message || "无内容"}」\n用户处理结果：${formatDialogCloseResult(this.lastClosedDialog)}`;
      this.lastClosedDialog = undefined;
      return hint;
    }

    if (!this.currentDialog) {
      return "";
    }

    const closedDialog = await new Promise<BrowserControlDialogCloseState | undefined>((resolve) => {
      const timer = setTimeout(() => {
        if (this.dialogWaiter === finish) {
          this.dialogWaiter = undefined;
        }
        resolve(undefined);
      }, timeoutMs);
      const finish = (dialog: BrowserControlDialogCloseState) => {
        clearTimeout(timer);
        if (this.dialogWaiter === finish) {
          this.dialogWaiter = undefined;
        }
        resolve(dialog);
      };
      this.dialogWaiter = finish;
    });

    if (!closedDialog) {
      throw new Error("网页弹窗等待超时，请先在页面中手动处理弹窗后再继续。");
    }

    return `检测到网页弹窗：${closedDialog.type}「${closedDialog.message || "无内容"}」\n用户处理结果：${formatDialogCloseResult(closedDialog)}`;
  }

  installDetachListener(onDetach: (tabId: number, reason: DebuggerDetachReason) => void): void {
    if (this.detachListenersInstalled || !this.chromeApi?.debugger?.onDetach?.addListener) {
      return;
    }

    this.detachListenersInstalled = true;
    this.chromeApi.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId !== this.currentTabId) {
        return;
      }

      const detachedTabId = this.currentTabId;
      this.attached = false;
      this.currentTabId = undefined;
      if (detachedTabId) {
        onDetach(detachedTabId, reason);
      }
    });
  }

  installEventListener(): void {
    if (this.eventListenersInstalled || !this.chromeApi?.debugger?.onEvent?.addListener) {
      return;
    }

    this.eventListenersInstalled = true;
    this.chromeApi.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== this.currentTabId) {
        return;
      }

      const normalizedParams = params && typeof params === "object" ? params as Record<string, unknown> : undefined;
      if (method === "Page.javascriptDialogOpening") {
        this.currentDialog = {
          type: typeof normalizedParams?.type === "string" ? normalizedParams.type : "dialog",
          message: typeof normalizedParams?.message === "string" ? normalizedParams.message : "",
          defaultPrompt: typeof normalizedParams?.defaultPrompt === "string" ? normalizedParams.defaultPrompt : "",
          openedAt: Date.now(),
        };
      }
      if (method === "Page.javascriptDialogClosed" && this.currentDialog) {
        this.lastClosedDialog = {
          ...this.currentDialog,
          result: normalizedParams?.result === true,
          userInput: typeof normalizedParams?.userInput === "string" ? normalizedParams.userInput : undefined,
        };
        this.currentDialog = undefined;
        this.dialogWaiter?.(this.lastClosedDialog);
      }

      for (const listener of this.eventListeners) {
        listener(method, normalizedParams);
      }
    });
  }

  async attach(tabId: number, shouldContinue: () => boolean = () => true): Promise<BrowserControlResponse> {
    if (this.attached && this.currentTabId === tabId) {
      return { ok: true, attached: true, tabId, message: "浏览器控制已连接当前标签页。" };
    }

    if (this.attached) {
      await this.detach();
    }

    const chromeApi = this.chromeApi;
    if (!chromeApi?.debugger?.attach) {
      return { ok: false, message: "当前浏览器不支持调试器接口，无法开启浏览器控制。" };
    }

    const debuggee: Debuggee = { tabId };
    const attached = await new Promise<BrowserControlResponse>((resolve) => {
      chromeApi.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION, () => {
        const lastError = chromeApi.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, message: normalizeDebuggerError(lastError.message) });
          return;
        }

        this.attached = true;
        this.currentTabId = tabId;
        this.currentDialog = undefined;
        this.lastClosedDialog = undefined;
        resolve({ ok: true, attached: true, tabId, message: "浏览器控制已开启，Chrome 会显示正在调试提示。" });
      });
    });

    if (!attached.ok) {
      return attached;
    }

    if (!shouldContinue()) {
      await this.detach(tabId);
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    const domainResult = await this.enableRequiredDomains();
    if (!domainResult.ok) {
      await this.detach();
      return domainResult;
    }

    if (!shouldContinue()) {
      await this.detach(tabId);
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    return attached;
  }

  async detach(tabId = this.currentTabId): Promise<void> {
    const chromeApi = this.chromeApi;
    if (!this.attached || !tabId || !chromeApi?.debugger?.detach) {
      this.attached = false;
      this.currentTabId = undefined;
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        chromeApi.debugger.detach({ tabId }, () => {
          const lastError = chromeApi.runtime.lastError;
          // 关闭或外部断开时读取 lastError，避免 Chrome 抛出未消费的 runtime 错误。
          void lastError?.message;
          resolve();
        });
      });
    } finally {
      // tab 已关闭或用户取消调试时，Chrome 可能拒绝 detach；本地状态仍必须立即清理，避免留下假连接。
      this.attached = false;
      this.currentTabId = undefined;
      this.currentDialog = undefined;
      this.lastClosedDialog = undefined;
      this.dialogWaiter = undefined;
    }
  }

  private async enableRequiredDomains(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await this.sendCommand("Runtime.enable");
      await this.sendCommand("Page.enable");
      await this.sendCommand("DOM.enable");
      await this.sendCommand("Accessibility.enable");
      await this.sendCommand("Network.enable");
      return { ok: true };
    } catch {
      return { ok: false, message: "浏览器调试会话初始化失败，请关闭浏览器控制后重试。" };
    }
  }

  async getFullAccessibilityTree(): Promise<unknown> {
    return this.sendCommand("Accessibility.getFullAXTree");
  }

  async resolveNodeByBackendId(backendNodeId: number): Promise<unknown> {
    return this.sendCommand("DOM.resolveNode", { backendNodeId });
  }

  async scrollIntoViewIfNeeded(objectId: string): Promise<unknown> {
    return this.sendCommand("DOM.scrollIntoViewIfNeeded", { objectId });
  }

  async getBoxModel(backendNodeId: number): Promise<unknown> {
    return this.sendCommand("DOM.getBoxModel", { backendNodeId });
  }

  async callFunctionOn(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Runtime.callFunctionOn", params);
  }

  async evaluate(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Runtime.evaluate", params);
  }

  async dispatchMouseEvent(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Input.dispatchMouseEvent", params);
  }

  async dispatchKeyEvent(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Input.dispatchKeyEvent", params);
  }

  async insertText(text: string): Promise<unknown> {
    return this.sendCommand("Input.insertText", { text });
  }

  async navigate(url: string): Promise<unknown> {
    return this.sendCommand("Page.navigate", { url });
  }

  async reload(): Promise<unknown> {
    return this.sendCommand("Page.reload");
  }

  async getNavigationHistory(): Promise<unknown> {
    return this.sendCommand("Page.getNavigationHistory");
  }

  async navigateToHistoryEntry(entryId: number): Promise<unknown> {
    return this.sendCommand("Page.navigateToHistoryEntry", { entryId });
  }

  async getFrameTree(): Promise<unknown> {
    return this.sendCommand("Page.getFrameTree");
  }

  async getResponseBody(requestId: string): Promise<{ body?: string; base64Encoded?: boolean }> {
    return this.sendCommand("Network.getResponseBody", { requestId }) as Promise<{ body?: string; base64Encoded?: boolean }>;
  }

  private async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!ALLOWED_BROWSER_CONTROL_CDP_METHODS.has(method)) {
      throw new Error("浏览器控制不允许调用该 CDP 方法。");
    }

    const chromeApi = this.chromeApi;
    const currentTabId = this.currentTabId;
    if (!this.attached || !currentTabId || !chromeApi?.debugger?.sendCommand) {
      throw new Error("debugger 未连接");
    }

    return new Promise((resolve, reject) => {
      chromeApi.debugger.sendCommand({ tabId: currentTabId }, method, params, (result) => {
        const lastError = chromeApi.runtime.lastError;
        if (lastError) {
          reject(new Error("浏览器调试命令执行失败，请确认当前页面仍可访问后重试。"));
          return;
        }

        resolve(result);
      });
    });
  }
}

export class BrowserControlSnapshotManager {
  private snapshotVersion = 0;
  private lastPageIdentity = "";
  private readonly uidToBackendNodeId = new Map<string, number>();
  private readonly uidToAxNode = new Map<string, AccessibilityNode>();
  private readonly backendNodeIdToUid = new Map<number, string>();

  constructor(
    private readonly connection: BrowserDebuggerConnection,
    private readonly getTabInfo: () => Promise<BrowserControlTabInfo>,
  ) {}

  getBackendNodeId(uid: string): number {
    const backendNodeId = this.uidToBackendNodeId.get(uid);
    if (backendNodeId) {
      return backendNodeId;
    }

    const snapshotVersion = Number.parseInt(uid.split("_")[0] ?? "", 10);
    if (Number.isFinite(snapshotVersion) && snapshotVersion > 0 && snapshotVersion !== this.snapshotVersion) {
      throw new Error(`UID ${uid} 来自旧快照，当前页面快照版本是 ${this.snapshotVersion}。`);
    }

    throw new Error(`UID ${uid} 在当前页面快照中不存在。`);
  }

  getAXNode(uid: string): AccessibilityNode | undefined {
    return this.uidToAxNode.get(uid);
  }

  clearSnapshotCache(): void {
    this.snapshotVersion += 1;
    this.lastPageIdentity = "";
    this.uidToBackendNodeId.clear();
    this.uidToAxNode.clear();
    this.backendNodeIdToUid.clear();
  }

  async takeSnapshot(): Promise<string> {
    const response = await this.connection.getFullAccessibilityTree();
    const nodes = normalizeAccessibilityNodes(response);
    const tabInfo = await this.getTabInfo();
    this.resetUidCacheIfPageChanged(createPageIdentity(tabInfo));
    const body = this.formatSnapshot(nodes);
    const content = [
      "# 浏览器页面快照",
      `页面标题：${tabInfo.title || "无标题"}`,
      `页面 URL：${tabInfo.url || "未知"}`,
      "",
      body || SNAPSHOT_EMPTY_TEXT,
    ].join("\n");

    return truncateSnapshot(content);
  }

  private formatSnapshot(nodes: AccessibilityNode[]): string {
    this.snapshotVersion += 1;
    this.uidToBackendNodeId.clear();
    this.uidToAxNode.clear();

    if (!nodes.length) {
      this.backendNodeIdToUid.clear();
      return SNAPSHOT_EMPTY_TEXT;
    }

    const nodeById = new Map<string, AccessibilityNode>();
    for (const node of nodes) {
      if (node.nodeId) {
        nodeById.set(node.nodeId, node);
      }
    }

    const root = nodes.find((node) => getAxValue(node.role) === "RootWebArea") ?? nodes[0];
    const seenBackendNodeIds = new Set<number>();
    const budget: SnapshotFormatBudget = {
      lines: [],
      visitedNodeIds: new Set(),
      nodeCount: 0,
      characterCount: 0,
      truncated: false,
    };
    this.formatNode(root, nodeById, 0, seenBackendNodeIds, { value: 0 }, budget);

    for (const backendNodeId of Array.from(this.backendNodeIdToUid.keys())) {
      if (!seenBackendNodeIds.has(backendNodeId)) {
        this.backendNodeIdToUid.delete(backendNodeId);
      }
    }

    return budget.lines.join("\n") || SNAPSHOT_EMPTY_TEXT;
  }

  private formatNode(
    node: AccessibilityNode | undefined,
    nodeById: Map<string, AccessibilityNode>,
    depth: number,
    seenBackendNodeIds: Set<number>,
    uidCounter: { value: number },
    budget: SnapshotFormatBudget,
  ): void {
    if (!node || budget.truncated) {
      return;
    }

    if (node.nodeId && budget.visitedNodeIds.has(node.nodeId)) {
      return;
    }
    if (node.nodeId) {
      budget.visitedNodeIds.add(node.nodeId);
    }

    if (depth >= SNAPSHOT_MAX_DEPTH) {
      this.appendSnapshotLine(`${"  ".repeat(SNAPSHOT_MAX_DEPTH)}- 节点层级过深，已停止继续展开。`, budget);
      return;
    }

    const interesting = isInterestingAxNode(node);

    if (interesting) {
      const parts = this.createNodeParts(node, seenBackendNodeIds, uidCounter);
      if (parts.length) {
        this.appendSnapshotLine(`${"  ".repeat(depth)}- ${parts.join(" ")}`, budget);
      }
    }

    for (const childId of node.childIds ?? []) {
      this.formatNode(nodeById.get(childId), nodeById, depth + (interesting ? 1 : 0), seenBackendNodeIds, uidCounter, budget);
      if (budget.truncated) {
        return;
      }
    }
  }

  private createNodeParts(node: AccessibilityNode, seenBackendNodeIds: Set<number>, uidCounter: { value: number }): string[] {
    const parts: string[] = [];
    if (typeof node.backendDOMNodeId === "number") {
      const uid = this.resolveUid(node.backendDOMNodeId, uidCounter);
      this.uidToBackendNodeId.set(uid, node.backendDOMNodeId);
      this.uidToAxNode.set(uid, node);
      seenBackendNodeIds.add(node.backendDOMNodeId);
      parts.push(`uid=${uid}`);
    }

    const role = getAxValue(node.role);
    const name = getAxValue(node.name);
    const value = getAxValue(node.value);
    if (role) {
      parts.push(role);
    }
    if (name) {
      parts.push(JSON.stringify(name));
    }
    if (value && value !== name) {
      parts.push(`value=${JSON.stringify(value)}`);
    }

    for (const property of node.properties ?? []) {
      if (!property.name || !["checked", "disabled", "expanded", "selected", "focused", "required"].includes(property.name)) {
        continue;
      }
      const propertyValue = getAxValue(property.value);
      if (propertyValue !== "") {
        parts.push(`${property.name}=${JSON.stringify(propertyValue)}`);
      }
    }

    return parts;
  }

  private resolveUid(backendNodeId: number, uidCounter: { value: number }): string {
    const existingUid = this.backendNodeIdToUid.get(backendNodeId);
    if (existingUid) {
      return existingUid;
    }

    uidCounter.value += 1;
    const uid = `${this.snapshotVersion}_${uidCounter.value}`;
    this.backendNodeIdToUid.set(backendNodeId, uid);
    return uid;
  }

  private appendSnapshotLine(line: string, budget: SnapshotFormatBudget): void {
    if (budget.nodeCount >= SNAPSHOT_MAX_NODE_COUNT || budget.characterCount + line.length > SNAPSHOT_MAX_LENGTH) {
      if (!budget.truncated) {
        budget.lines.push(`${"  ".repeat(Math.min(SNAPSHOT_MAX_DEPTH, 1))}- ${SNAPSHOT_TRUNCATED_TEXT}`);
        budget.truncated = true;
      }
      return;
    }

    budget.lines.push(line);
    budget.nodeCount += 1;
    budget.characterCount += line.length + 1;
  }

  private resetUidCacheIfPageChanged(pageIdentity: string): void {
    if (this.lastPageIdentity && this.lastPageIdentity !== pageIdentity) {
      this.backendNodeIdToUid.clear();
    }

    this.lastPageIdentity = pageIdentity;
  }
}

export class BrowserControlManager {
  private targetTabId: number | undefined;
  private readonly controlledTabIds = new Set<number>();
  private suppressNextDetachTabId: number | undefined;
  private desiredEnabled = false;
  private operationVersion = 0;
  private readonly snapshotManager: BrowserControlSnapshotManager;
  private readonly actionExecutor: BrowserControlActionExecutor;
  private readonly networkRecorder: BrowserNetworkRecorder;
  private readonly networkToolExecutor: BrowserNetworkToolExecutor;
  private readonly jsSourceToolExecutor: JsSourceToolExecutor;
  private readonly sourceMapToolExecutor: SourceMapToolExecutor;
  private readonly runtimeReadToolExecutor: RuntimeReadToolExecutor;
  private toolAuthorizationContext: ToolAuthorizationContext = NORMAL_TOOL_AUTHORIZATION_CONTEXT;

  constructor(
    private readonly connection = new BrowserDebuggerConnection(),
    private readonly chromeApi: ChromeApi | undefined = getChromeApi(),
    private readonly onDetach?: (tabId: number, reason: BrowserControlDetachedReason) => void,
  ) {
    this.snapshotManager = new BrowserControlSnapshotManager(this.connection, () => this.getTargetTabInfo());
    this.actionExecutor = new BrowserControlActionExecutor(this.connection, this.snapshotManager);
    this.networkRecorder = new BrowserNetworkRecorder(this.connection);
    this.jsSourceToolExecutor = new JsSourceToolExecutor({
      recorder: this.networkRecorder,
      getCurrentPageUrl: async () => (await this.getTargetTabInfo()).url,
    });
    this.sourceMapToolExecutor = new SourceMapToolExecutor({
      recorder: this.networkRecorder,
      jsSourceIndex: this.jsSourceToolExecutor.getIndex(),
      getCurrentPageUrl: async () => (await this.getTargetTabInfo()).url,
    });
    this.runtimeReadToolExecutor = new RuntimeReadToolExecutor(this.connection, () => this.getRuntimeToolAuthorizationContext());
    this.networkToolExecutor = new BrowserNetworkToolExecutor(this.networkRecorder, () => {
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearRuntimeReadonlyAuthorization();
    });
    this.connection.installDetachListener((tabId, reason) => {
      if (this.suppressNextDetachTabId === tabId) {
        this.suppressNextDetachTabId = undefined;
        return;
      }

      this.targetTabId = undefined;
      this.desiredEnabled = false;
      this.controlledTabIds.clear();
      this.snapshotManager.clearSnapshotCache();
      this.stopNetworkAnalysis();
      this.clearRuntimeReadonlyAuthorization();
      this.notifyDetached(tabId, normalizeDetachReason(reason));
    });
    this.connection.installEventListener();
  }

  handleTabRemoved(tabId: number): void {
    if (tabId !== this.targetTabId && tabId !== this.connection.attachedTabId) {
      return;
    }

    this.targetTabId = undefined;
    this.controlledTabIds.delete(tabId);
    this.snapshotManager.clearSnapshotCache();
    this.stopNetworkAnalysis();
    this.clearRuntimeReadonlyAuthorization();
    this.notifyDetached(tabId, "tab_removed");
    void this.connection.detach(tabId).catch(() => {
      // 标签页关闭期间 detach 只是尽力清理；异常不能冒泡成未处理 Promise。
    });
  }

  async setEnabled(enabled: boolean, tabId?: number): Promise<BrowserControlResponse> {
    this.desiredEnabled = enabled;
    const operationVersion = ++this.operationVersion;

    if (!enabled) {
      const detachedTabId = tabId ?? this.connection.attachedTabId;
      await this.connection.detach();
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      this.snapshotManager.clearSnapshotCache();
      this.stopNetworkAnalysis();
      this.clearRuntimeReadonlyAuthorization();
      this.notifyDetached(detachedTabId, "disabled_by_user");
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    const tabResult = await this.resolveTargetTab(tabId);
    if (!this.isCurrentEnableOperation(operationVersion)) {
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    if (!tabResult.ok) {
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      return tabResult;
    }

    this.targetTabId = tabResult.tab.id;
    await this.initializeControlledTabs(tabResult.tab);
    const attachResult = await this.connection.attach(tabResult.tab.id, () => this.isCurrentEnableOperation(operationVersion));
    if (!this.isCurrentEnableOperation(operationVersion)) {
      await this.connection.detach(tabResult.tab.id);
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    if (!attachResult.ok) {
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      this.stopNetworkAnalysis();
      this.clearRuntimeReadonlyAuthorization();
    } else if (this.connection.attachedTabId) {
      this.startNetworkAnalysis(this.connection.attachedTabId);
    }

    return attachResult;
  }

  canExposeTakeSnapshotTool(): boolean {
    return this.desiredEnabled && this.connection.isAttached && Boolean(this.connection.attachedTabId);
  }

  canExposeBrowserTool(): boolean {
    return this.canExposeTakeSnapshotTool();
  }

  canExposeNetworkTool(): boolean {
    return this.canExposeBrowserTool() && this.networkRecorder.isEnabled;
  }

  canExposeRuntimeReadTool(): boolean {
    if (!this.canExposeNetworkTool()) {
      this.clearRuntimeReadonlyAuthorization();
      return false;
    }

    return this.getRuntimeToolAuthorizationContext().mode === "runtime_readonly";
  }

  setRuntimeReadonlyEnabled(enabled: boolean, reason = "用户临时开启运行时只读分析。"): BrowserControlResponse {
    if (!enabled) {
      this.clearRuntimeReadonlyAuthorization();
      return { ok: true, attached: this.connection.isAttached, tabId: this.connection.attachedTabId, message: "运行时只读分析已关闭。" };
    }

    if (!this.canExposeNetworkTool() || typeof this.connection.attachedTabId !== "number") {
      this.clearRuntimeReadonlyAuthorization();
      return { ok: false, message: "浏览器控制或 Network 采集未开启，无法开启运行时只读分析。" };
    }

    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;
    this.toolAuthorizationContext = {
      mode: "runtime_readonly",
      tabId: this.connection.attachedTabId,
      createdAt: now,
      expiresAt,
      reason,
    };
    this.notifyRuntimeReadonlyChanged(true, this.connection.attachedTabId, expiresAt);
    return { ok: true, attached: true, tabId: this.connection.attachedTabId, expiresAt, message: "运行时只读分析已临时开启。" };
  }

  async executeNetworkTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    return this.networkToolExecutor.execute(toolCall);
  }

  async executeJsSourceTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    return this.jsSourceToolExecutor.execute(toolCall);
  }

  async executeSourceMapTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    await this.jsSourceToolExecutor.refreshResourcesForAnalysis();
    return this.sourceMapToolExecutor.execute(toolCall);
  }

  async executeRuntimeReadTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!this.canExposeRuntimeReadTool()) {
      return createBrowserToolErrorResult(toolCall, "运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。");
    }

    return this.runtimeReadToolExecutor.execute(toolCall);
  }

  async takeSnapshot(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const extraKeys = Object.keys(toolCall.arguments);
    if (extraKeys.length > 0) {
      return createBrowserToolErrorResult(toolCall, "浏览器页面快照工具不接受任何参数。");
    }

    if (!this.canExposeTakeSnapshotTool()) {
      return createBrowserToolErrorResult(toolCall, BROWSER_SNAPSHOT_DISABLED_MESSAGE);
    }

    try {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: await this.snapshotManager.takeSnapshot(),
      };
    } catch {
      return createBrowserToolErrorResult(toolCall, BROWSER_SNAPSHOT_FAILED_MESSAGE);
    }
  }

  async executeBrowserTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (isBrowserControlPageToolName(toolCall.name)) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.executePageTool(toolCall);
    }

    if (!isBrowserControlActionName(toolCall.name)) {
      return createBrowserActionErrorResult(toolCall, `未知的浏览器操作工具：${toolCall.name}。`);
    }

    if (!this.canExposeBrowserTool()) {
      return createBrowserActionDisabledResult(toolCall);
    }

    const result = await this.actionExecutor.execute(toolCall);
    if (result.isError) {
      return result;
    }

    try {
      const content = await this.waitAfterPageChange(result.content);
      return {
        ...result,
        content: toolCall.arguments.includeSnapshot === true ? await this.appendSnapshot(content) : content,
      };
    } catch (error) {
      return createBrowserActionErrorResult(toolCall, normalizePageToolError(error));
    }
  }

  private async executePageTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validatePageToolArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    try {
      let content = "";
      if (toolCall.name === "navigate_page") {
        content = await this.navigatePage(toolCall.arguments);
      } else if (toolCall.name === "new_page") {
        content = await this.newPage(toolCall.arguments);
      } else if (toolCall.name === "list_pages") {
        content = await this.listPages();
      } else if (toolCall.name === "select_page") {
        content = await this.selectPage(Number(toolCall.arguments.index), toolCall.arguments.includeSnapshot === true);
      } else {
        content = await this.closePage(Number(toolCall.arguments.index));
      }

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content,
      };
    } catch (error) {
      return createBrowserToolErrorResult(toolCall, normalizePageToolError(error));
    }
  }

  private async navigatePage(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action);
    let content = "";
    if (action === "goto") {
      const urlResult = normalizeNavigableUrl(args.url);
      if (!urlResult.ok) {
        throw new Error(urlResult.message);
      }
      await this.connection.navigate(urlResult.url);
      this.snapshotManager.clearSnapshotCache();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearRuntimeReadonlyAuthorization();
      content = `已导航到 ${urlResult.url}。`;
    } else if (action === "reload") {
      await this.connection.reload();
      this.snapshotManager.clearSnapshotCache();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearRuntimeReadonlyAuthorization();
      content = "已刷新当前页面。";
    } else {
      const history = normalizeNavigationHistory(await this.connection.getNavigationHistory());
      const nextIndex = action === "back" ? history.currentIndex - 1 : history.currentIndex + 1;
      const target = history.entries[nextIndex];
      if (!target) {
        throw new Error(action === "back" ? "当前页面没有可后退的历史记录。" : "当前页面没有可前进的历史记录。");
      }
      await this.connection.navigateToHistoryEntry(target.id);
      this.snapshotManager.clearSnapshotCache();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearRuntimeReadonlyAuthorization();
      content = action === "back" ? "已后退到上一页。" : "已前进到下一页。";
    }

    content = await this.waitAfterPageChange(content);
    return args.includeSnapshot === true ? this.appendSnapshot(content) : content;
  }

  private async newPage(args: Record<string, unknown>): Promise<string> {
    const urlResult = normalizeNavigableUrl(args.url);
    if (!urlResult.ok) {
      throw new Error(urlResult.message);
    }

    const currentTab = await this.getCurrentControlledTab();
    const active = args.background !== true;
    const createdTab = await this.chromeApi?.tabs.create?.({
      url: urlResult.url,
      active,
      ...(typeof currentTab?.windowId === "number" ? { windowId: currentTab.windowId } : {}),
    });
    if (!createdTab?.id) {
      throw new Error("新建页面失败，请确认浏览器仍可创建标签页。");
    }

    this.controlledTabIds.add(createdTab.id);
    if (!active) {
      return `已在后台新建页面：${urlResult.url}。如需切换，请先调用 list_pages 获取页面 index。`;
    }

    await this.switchToTab(createdTab.id);
    let content = `已新建并切换到新页面：${urlResult.url}。`;
    content = await this.waitAfterPageChange(content);
    return args.includeSnapshot === true ? this.appendSnapshot(content) : content;
  }

  private async listPages(): Promise<string> {
    const pages = await this.getControlledPages();
    if (!pages.length) {
      return "当前浏览器控制后台受控列表内没有可控页面。";
    }

    const activeTabId = this.connection.attachedTabId ?? this.targetTabId;
    return [
      "当前浏览器控制任务页面：",
      ...pages.map((page, index) => {
        const marker = page.id === activeTabId ? "当前 " : "";
        return `${index + 1}. ${marker}${page.title || "无标题"} - ${getBrowserControlTabUrl(page)}`;
      }),
    ].join("\n");
  }

  private async selectPage(index: number, includeSnapshot: boolean): Promise<string> {
    const page = await this.getControlledPageByIndex(index);
    await this.switchToTab(page.id);
    let content = `已切换到页面 ${index}：${page.title || "无标题"}。`;
    content = await this.waitAfterPageChange(content);
    return includeSnapshot ? this.appendSnapshot(content) : content;
  }

  private async closePage(index: number): Promise<string> {
    const page = await this.getControlledPageByIndex(index);
    const closedCurrent = page.id === this.connection.attachedTabId || page.id === this.targetTabId;
    const remainingPages = (await this.getControlledPages()).filter((item) => item.id !== page.id);
    if (closedCurrent) {
      this.suppressNextDetachTabId = page.id;
    }

    await this.chromeApi?.tabs.remove?.(page.id);
    this.controlledTabIds.delete(page.id);
    if (!closedCurrent) {
      return `已关闭页面 ${index}：${page.title || "无标题"}。`;
    }

    if (!remainingPages.length) {
      const detachedTabId = this.connection.attachedTabId;
      await this.connection.detach();
      this.targetTabId = undefined;
      this.controlledTabIds.clear();
      this.snapshotManager.clearSnapshotCache();
      this.stopNetworkAnalysis();
      this.clearRuntimeReadonlyAuthorization();
      this.notifyDetached(detachedTabId, "tab_removed");
      return `已关闭当前受控页面 ${index}，浏览器控制后台受控列表内没有其他可控页面。`;
    }

    await this.switchToTab(remainingPages[0].id);
    return `已关闭当前受控页面 ${index}，并切换到页面 1：${remainingPages[0].title || "无标题"}。`;
  }

  private async switchToTab(tabId: number): Promise<void> {
    await this.chromeApi?.tabs.update?.(tabId, { active: true });
    this.snapshotManager.clearSnapshotCache();
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.clearRuntimeReadonlyAuthorization();
    this.targetTabId = tabId;
    this.controlledTabIds.add(tabId);
    const attachResult = await this.connection.attach(tabId);
    if (!attachResult.ok) {
      this.targetTabId = undefined;
      this.stopNetworkAnalysis();
      this.clearRuntimeReadonlyAuthorization();
      throw new Error(attachResult.message);
    }
    this.startNetworkAnalysis(tabId);
  }

  private startNetworkAnalysis(tabId: number): void {
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.clearRuntimeReadonlyAuthorization();
    this.networkRecorder.start(tabId);
  }

  private stopNetworkAnalysis(): void {
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.clearRuntimeReadonlyAuthorization();
    this.networkRecorder.stop();
  }

  private getRuntimeToolAuthorizationContext(): ToolAuthorizationContext {
    if (isRuntimeReadonlyAuthorized(this.toolAuthorizationContext, this.connection.attachedTabId)) {
      return this.toolAuthorizationContext;
    }

    this.clearRuntimeReadonlyAuthorization();
    return NORMAL_TOOL_AUTHORIZATION_CONTEXT;
  }

  private clearRuntimeReadonlyAuthorization(): void {
    const previous = this.toolAuthorizationContext;
    this.toolAuthorizationContext = NORMAL_TOOL_AUTHORIZATION_CONTEXT;
    if (previous.mode === "runtime_readonly") {
      this.notifyRuntimeReadonlyChanged(false, previous.tabId);
    }
  }

  private async waitAfterPageChange(content: string): Promise<string> {
    const dialogHint = await this.connection.waitForOpenDialogToClose();
    const normalized = dialogHint ? `${content}\n${dialogHint}` : content;
    await waitForStableDom(this.connection);
    return normalized;
  }

  private async appendSnapshot(content: string): Promise<string> {
    return `${content}\n\n## 最新页面快照\n${await this.snapshotManager.takeSnapshot()}`;
  }

  private async initializeControlledTabs(targetTab: chrome.tabs.Tab & { id: number }): Promise<void> {
    this.controlledTabIds.clear();
    const tabs = await (this.chromeApi?.tabs.query({
      currentWindow: true,
      ...(typeof targetTab.windowId === "number" ? { windowId: targetTab.windowId } : {}),
    }) ?? Promise.resolve([]));

    for (const tab of tabs) {
      if (typeof tab.id === "number" && !isBrowserControlRestrictedUrl(getBrowserControlTabUrl(tab))) {
        this.controlledTabIds.add(tab.id);
      }
    }

    // 当前目标页是用户显式开启控制的入口，即使 query 在测试环境或浏览器瞬态下没有返回，也必须纳入后台受控列表。
    this.controlledTabIds.add(targetTab.id);
  }

  private async getControlledPages(): Promise<Array<chrome.tabs.Tab & { id: number }>> {
    const pages = await Promise.all(Array.from(this.controlledTabIds).map(async (tabId) => {
      try {
        return await this.chromeApi?.tabs.get(tabId);
      } catch {
        this.controlledTabIds.delete(tabId);
        return undefined;
      }
    }));
    return pages.filter((tab): tab is chrome.tabs.Tab & { id: number } =>
      Boolean(tab?.id) &&
      !isBrowserControlRestrictedUrl(getBrowserControlTabUrl(tab)),
    );
  }

  private async getControlledPageByIndex(index: number): Promise<chrome.tabs.Tab & { id: number }> {
    const pages = await this.getControlledPages();
    const page = pages[index - 1];
    if (!page) {
      throw new Error("页面 index 不在当前浏览器控制任务范围内。");
    }

    return page;
  }

  private async getCurrentControlledTab(): Promise<(chrome.tabs.Tab & { id: number }) | undefined> {
    const tabId = this.connection.attachedTabId ?? this.targetTabId;
    if (!tabId) {
      return undefined;
    }

    const tab = await this.chromeApi?.tabs.get(tabId);
    return tab?.id ? tab as chrome.tabs.Tab & { id: number } : undefined;
  }

  private async resolveTargetTab(tabId?: number): Promise<{ ok: true; tab: chrome.tabs.Tab & { id: number } } | { ok: false; message: string }> {
    try {
      const tab = typeof tabId === "number" && tabId > 0
        ? await this.chromeApi?.tabs.get(tabId)
        : await this.getActiveTab();

      if (!tab?.id) {
        return { ok: false, message: "未找到可控制的当前标签页，请先打开普通网页。" };
      }

      const url = getBrowserControlTabUrl(tab);
      if (!url) {
        return { ok: false, message: "当前标签页没有可控制的页面地址，请先打开普通网页。" };
      }

      if (isBrowserControlRestrictedUrl(url)) {
        return { ok: false, message: "当前页面属于浏览器或扩展受限页面，无法开启浏览器控制。请切换到普通网页后重试。" };
      }

      return { ok: true, tab: tab as chrome.tabs.Tab & { id: number } };
    } catch {
      return { ok: false, message: "读取当前标签页失败，请确认页面仍然打开后重试。" };
    }
  }

  private async getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await (this.chromeApi?.tabs.query({ active: true, currentWindow: true }) ?? Promise.resolve([]));
    return tab;
  }

  private async getTargetTabInfo(): Promise<BrowserControlTabInfo> {
    const tabId = this.connection.attachedTabId ?? this.targetTabId;
    if (!tabId) {
      return { title: "", url: "" };
    }

    const tab = await this.chromeApi?.tabs.get(tabId);
    return {
      title: typeof tab?.title === "string" ? tab.title : "",
      url: getBrowserControlTabUrl(tab),
    };
  }

  private isCurrentEnableOperation(operationVersion: number): boolean {
    return this.desiredEnabled && this.operationVersion === operationVersion;
  }

  private notifyDetached(tabId: number | undefined, reason: BrowserControlDetachedReason): void {
    if (typeof tabId === "number") {
      this.onDetach?.(tabId, reason);
    }

    // Side Panel 的浏览器控制按钮是全局运行态；用户点击 Chrome 顶部“取消”不会经过前端，所以必须广播状态失效事件。
    this.chromeApi?.runtime?.sendMessage?.({
      type: BROWSER_CONTROL_DETACHED_MESSAGE_TYPE,
      tabId,
      reason,
    }, () => {
      const lastError = this.chromeApi?.runtime?.lastError;
      // Side Panel 未打开时广播可能没有接收者，读取 lastError 避免 MV3 runtime 噪声。
      void lastError?.message;
    });
  }

  private notifyRuntimeReadonlyChanged(enabled: boolean, tabId: number | undefined, expiresAt?: number): void {
    this.chromeApi?.runtime?.sendMessage?.({
      type: BROWSER_CONTROL_RUNTIME_READONLY_CHANGED_MESSAGE_TYPE,
      enabled,
      tabId,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }, () => {
      const lastError = this.chromeApi?.runtime?.lastError;
      // Side Panel 未打开时广播可能没有接收者；读取 lastError 避免 MV3 runtime 噪声。
      void lastError?.message;
    });
  }
}

function createBrowserToolErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function isBrowserControlPageToolName(name: string): name is BrowserControlPageToolName {
  return name === "navigate_page" || name === "new_page" || name === "list_pages" || name === "select_page" || name === "close_page";
}

function validatePageToolArguments(toolCall: ModelToolCall): { ok: true } | { ok: false; message: string } {
  const args = toolCall.arguments;
  const allowedKeysByName: Record<BrowserControlPageToolName, string[]> = {
    navigate_page: ["action", "url", "includeSnapshot"],
    new_page: ["url", "background", "includeSnapshot"],
    list_pages: [],
    select_page: ["index", "includeSnapshot"],
    close_page: ["index"],
  };
  const allowedKeys = allowedKeysByName[toolCall.name as BrowserControlPageToolName] ?? [];
  const extraKeys = Object.keys(args).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器页面工具 ${toolCall.name} 不接受参数：${extraKeys.join("、")}。` };
  }

  if (toolCall.name === "navigate_page") {
    const action = args.action;
    if (action !== "goto" && action !== "back" && action !== "forward" && action !== "reload") {
      return { ok: false, message: "navigate_page 的 action 必须是 goto、back、forward 或 reload。" };
    }
    if (action === "goto" && (typeof args.url !== "string" || !args.url.trim())) {
      return { ok: false, message: "navigate_page 的 goto 动作需要非空 URL。" };
    }
    if (action !== "goto" && args.url !== undefined) {
      return { ok: false, message: "navigate_page 只有 goto 动作可以携带 URL。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, message: "includeSnapshot 必须是布尔值。" };
    }
  }

  if (toolCall.name === "new_page") {
    if (typeof args.url !== "string" || !args.url.trim()) {
      return { ok: false, message: "new_page 需要非空 URL。" };
    }
    if (args.background !== undefined && typeof args.background !== "boolean") {
      return { ok: false, message: "background 必须是布尔值。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, message: "includeSnapshot 必须是布尔值。" };
    }
    if (args.background === true && args.includeSnapshot === true) {
      return { ok: false, message: "new_page 在后台打开页面时不能同时请求 includeSnapshot。" };
    }
  }

  if ((toolCall.name === "select_page" || toolCall.name === "close_page") &&
    (typeof args.index !== "number" || !Number.isInteger(args.index) || args.index < 1)) {
    return { ok: false, message: "页面 index 必须是从 1 开始的整数。" };
  }
  if (toolCall.name === "select_page" && args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
    return { ok: false, message: "includeSnapshot 必须是布尔值。" };
  }

  return { ok: true };
}

function normalizeNavigableUrl(value: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: "导航 URL 必须是字符串。" };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, message: "导航 URL 格式无效，已拒绝执行。" };
  }

  const normalized = url.toString();
  if (isBrowserControlRestrictedUrl(normalized)) {
    return { ok: false, message: "导航 URL 属于浏览器或扩展受限页面，已拒绝执行。" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "导航 URL 只允许 http 或 https 普通网页。" };
  }

  return { ok: true, url: normalized };
}

function normalizeNavigationHistory(response: unknown): { currentIndex: number; entries: Array<{ id: number; url: string }> } {
  if (!response || typeof response !== "object") {
    return { currentIndex: -1, entries: [] };
  }

  const source = response as { currentIndex?: unknown; entries?: unknown };
  const entries = Array.isArray(source.entries)
    ? source.entries
        .map((entry) => entry && typeof entry === "object" ? entry as { id?: unknown; url?: unknown } : undefined)
        .filter((entry): entry is { id: number; url: string } => typeof entry?.id === "number" && typeof entry.url === "string")
    : [];
  return {
    currentIndex: typeof source.currentIndex === "number" ? source.currentIndex : -1,
    entries,
  };
}

async function waitForStableDom(connection: BrowserDebuggerConnection): Promise<void> {
  try {
    await connection.evaluate({
      expression: `
        (async () => {
          const start = Date.now();
          while (typeof document === "undefined" || !document.body) {
            if (Date.now() - start > 3000) return false;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return await new Promise((resolve) => {
            let timer = null;
            const done = () => {
              observer.disconnect();
              resolve(true);
            };
            const observer = new MutationObserver(() => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(done, 100);
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            timer = setTimeout(done, 100);
            setTimeout(() => {
              observer.disconnect();
              resolve(false);
            }, 3000);
          });
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });
  } catch {
    // 页面跳转或关闭时 Runtime 上下文可能瞬间失效；动作结果已经返回，稳定等待只做尽力补偿。
  }
}

function normalizePageToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message) {
    return message;
  }

  return "浏览器页面工具执行失败，请确认当前页面仍可访问后重试。";
}

function formatDialogCloseResult(dialog: BrowserControlDialogCloseState): string {
  if (dialog.type === "prompt" && dialog.result) {
    return `用户已确认并输入：${dialog.userInput ?? ""}`;
  }

  return dialog.result ? "用户已确认" : "用户已取消";
}

function isClosedDialog(dialog: BrowserControlDialogState | BrowserControlDialogCloseState): dialog is BrowserControlDialogCloseState {
  return "result" in dialog && typeof dialog.result === "boolean";
}

function normalizeAccessibilityNodes(response: unknown): AccessibilityNode[] {
  if (!response || typeof response !== "object" || !("nodes" in response) || !Array.isArray(response.nodes)) {
    return [];
  }

  return response.nodes.filter((node): node is AccessibilityNode => Boolean(node && typeof node === "object"));
}

function isInterestingAxNode(node: AccessibilityNode): boolean {
  const role = getAxValue(node.role);
  const name = getAxValue(node.name);
  const value = getAxValue(node.value);
  if (node.ignored && !name && !value) {
    return false;
  }

  if (typeof node.backendDOMNodeId === "number") {
    return true;
  }

  if (!role && !name && !value) {
    return false;
  }

  return !SKIPPED_AX_ROLES.has(role);
}

function getAxValue(source: { value?: unknown } | undefined): string {
  if (source?.value === undefined || source.value === null) {
    return "";
  }

  return String(source.value).trim();
}

function createPageIdentity(tabInfo: BrowserControlTabInfo): string {
  return `${tabInfo.url}\n${tabInfo.title}`;
}

function truncateSnapshot(content: string): string {
  if (content.length <= SNAPSHOT_MAX_LENGTH) {
    return content;
  }

  return `${content.slice(0, SNAPSHOT_MAX_LENGTH)}\n\n[快照内容过长，已截断。请基于已显示结构继续分析，必要时让用户缩小页面范围。]`;
}

export const browserControlManager = new BrowserControlManager();

export type { BrowserControlMessage, BrowserControlResponse };

export async function handleBrowserControlMessage(
  message: BrowserControlMessage,
  sender?: chrome.runtime.MessageSender,
  manager = browserControlManager,
): Promise<BrowserControlResponse> {
  if (message.type === BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE) {
    return manager.setRuntimeReadonlyEnabled(message.enabled, message.reason);
  }

  if (message.type === BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE) {
    const tabId = message.tabId ?? sender?.tab?.id;
    return manager.setEnabled(message.enabled, tabId);
  }

  return { ok: false, message: "未知的浏览器控制请求。" };
}

export function handleBrowserControlTabRemoved(tabId: number, manager = browserControlManager): void {
  manager.handleTabRemoved(tabId);
}

function normalizeDebuggerError(message = ""): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("restricted") || normalized.includes("cannot access") || normalized.includes("webui")) {
    return "当前页面属于浏览器受限页面，无法开启浏览器控制。请切换到普通网页后重试。";
  }

  if (normalized.includes("another debugger") || normalized.includes("already attached")) {
    return "当前标签页已被其他调试器占用，请关闭其他调试会话后重试。";
  }

  return "Chrome 拒绝开启调试会话，请确认当前页面可被扩展控制后重试。";
}

function normalizeDetachReason(reason: DebuggerDetachReason | undefined): BrowserControlDetachedReason {
  if (reason === "canceled_by_user" || reason === "target_closed") {
    return reason;
  }

  return "unknown";
}
