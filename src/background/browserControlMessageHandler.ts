import {
  BROWSER_CONTROL_AUTOMATION_MODE_CHANGED_MESSAGE_TYPE,
  BROWSER_CONTROL_BOUNDARY_CHOICE_RESPOND_MESSAGE_TYPE,
  BROWSER_CONTROL_DETACHED_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_AUTOMATION_MODE_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE,
  getBrowserControlTabUrl,
  isBrowserControlRestrictedUrl,
  type BrowserControlBoundaryChoiceRequestMessage,
  type BrowserControlMessage,
  type BrowserControlResponse,
} from "../shared/browserControl";
import type { ModelToolCall, ModelToolResult } from "../shared/models/types";
import type { BoundaryGrantContext, BrowserAutomationMode, ToolAuthorizationContext } from "../shared/toolAuthorization";
import { NORMAL_TOOL_AUTHORIZATION_CONTEXT, createBoundaryGrantScopeKey, getOriginFromUrl, isControlledEnhancedAuthorized, isFullAccessAuthorized, isRuntimeReadonlyAuthorized } from "../shared/toolAuthorization";
import {
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME,
  BROWSER_ANALYZE_FORM_TOOL_NAME,
  BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME,
  BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME,
  BROWSER_INSPECT_ELEMENT_TOOL_NAME,
  BROWSER_FIND_ELEMENTS_TOOL_NAME,
  BROWSER_GET_PAGE_STATE_TOOL_NAME,
  BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  REPLAY_SEND_REQUEST_TOOL_ID,
  REPLAY_SEND_REQUEST_TOOL_NAME,
  RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME,
  RUNTIME_INSPECT_GLOBALS_TOOL_NAME,
  RUNTIME_SEARCH_MODULES_TOOL_NAME,
} from "../shared/models/toolRegistry";
import { isPngDataUrl } from "../shared/tabCapture";
import {
  BrowserControlActionExecutor,
  createBrowserActionDisabledResult,
  createBrowserActionErrorResult,
  isBrowserControlActionName,
} from "./browserControl/actions";
import type { NetworkRequestMeta } from "../shared/types";
import type { ExtractionRule, PageContextExtractMode } from "../shared/types";
import { validateExtractionSelector } from "../shared/extractionRules/validation";
import { applyAutomationBoundaryConfirmation } from "./browserControl/automationBoundaryDetector";
import { BrowserNetworkRecorder } from "./browserControl/networkRecorder";
import { BrowserNetworkToolExecutor } from "./browserControl/networkToolExecutor";
import { JsSourceToolExecutor } from "./browserControl/jsSourceToolExecutor";
import { SourceMapToolExecutor } from "./browserControl/sourceMapToolExecutor";
import { RuntimeReadToolExecutor } from "./browserControl/runtimeReadToolExecutor";
import { BoundaryChoiceToolExecutor } from "./browserControl/boundaryChoiceToolExecutor";
import { ReplayToolExecutor } from "./browserControl/replayToolExecutor";
import { FullAccessToolExecutor } from "./browserControl/fullAccessToolExecutor";
import { BrowserConsoleRecorder } from "./browserControl/consoleRecorder";
import { handlePageContextMessage, type PageContextExtractResponse } from "./pageContextMessageHandler";

type Debuggee = chrome.debugger.Debuggee;
type ChromeApi = typeof chrome;
type DebuggerDetachReason = `${chrome.debugger.DetachReason}`;
type BrowserControlDetachedReason = "canceled_by_user" | "target_closed" | "tab_removed" | "disabled_by_user" | "unknown";
type BrowserControlTabInfo = { title: string; url: string };
interface BrowserPageRuntimeState {
  url: string;
  title: string;
  readyState: string;
  viewport?: { width?: number; height?: number; deviceScaleFactor?: number };
  scroll?: { x?: number; y?: number; maxX?: number; maxY?: number };
  focusedElement?: { tagName?: string; id?: string; name?: string; type?: string; text?: string };
}
interface BrowserElementInspection {
  tagName: string;
  id: string;
  className: string;
  text: string;
  attributes: Record<string, string>;
  rect?: { x?: number; y?: number; width?: number; height?: number };
  style?: { display?: string; visibility?: string; opacity?: string; pointerEvents?: string; cursor?: string };
  state?: { visible?: boolean; disabled?: boolean; editable?: boolean };
}
type BrowserInteractionExpectedAction = "click" | "fill" | "view";
interface BrowserInteractionBlockerAnalysis {
  tagName: string;
  text: string;
  rect?: { x?: number; y?: number; width?: number; height?: number };
  style?: { display?: string; visibility?: string; opacity?: string; pointerEvents?: string; cursor?: string };
  state?: {
    visible?: boolean;
    disabled?: boolean;
    editable?: boolean;
    connected?: boolean;
    inViewport?: boolean;
    occluded?: boolean;
    coveredBy?: string;
  };
  form?: { disabledFieldset?: boolean; invalidFields?: number };
}
interface BrowserFormAnalysisField {
  index: number;
  tagName: string;
  type: string;
  name: string;
  label: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  invalid: boolean;
  hasValue: boolean;
}
interface BrowserFormAnalysisSubmitButton {
  text: string;
  disabled: boolean;
  type: string;
}
interface BrowserFormAnalysisItem {
  index: number;
  id: string;
  name: string;
  action: string;
  method: string;
  fieldCount: number;
  invalidFieldCount: number;
  disabledFieldCount: number;
  requiredFieldCount: number;
  submitButtons: BrowserFormAnalysisSubmitButton[];
  errors: string[];
  fields: BrowserFormAnalysisField[];
}
interface BrowserFormAnalysis {
  forms: BrowserFormAnalysisItem[];
}
interface BrowserPerformanceNavigationSummary {
  type: string;
  startTime: number;
  responseEnd: number;
  domContentLoaded: number;
  load: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}
interface BrowserPerformanceResourceTypeSummary {
  type: string;
  count: number;
  duration: number;
  transferSize: number;
}
interface BrowserPerformanceSlowResource {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
}
interface BrowserPerformanceSummary {
  navigation?: BrowserPerformanceNavigationSummary;
  resources: {
    totalCount: number;
    byType: BrowserPerformanceResourceTypeSummary[];
    slowest: BrowserPerformanceSlowResource[];
  };
  longTasks: {
    count: number;
    maxDuration: number;
    totalDuration: number;
  };
}
interface BrowserSnapshotElementCandidate {
  uid: string;
  backendNodeId: number;
  axNode?: AccessibilityNode;
}
type BrowserScreenshotTarget = "viewport" | "element";
type BrowserExtractContentMode = "text" | "html";
type BrowserExtractContentSource = "auto_rule" | "document" | "selector";
type BrowserExtractContentSelectorType = "css" | "xpath";
interface BrowserExtractContentArguments {
  mode: BrowserExtractContentMode;
  source: BrowserExtractContentSource;
  selectorType?: BrowserExtractContentSelectorType;
  selector?: string;
  maxLength: number;
}
interface BrowserScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
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
const PAGE_STATE_FAILED_MESSAGE = "读取页面状态失败，请确认当前页面仍可访问后重试。";
const PAGE_STATE_MAX_TEXT_LENGTH = 120;
const ELEMENT_INSPECTION_MAX_TEXT_LENGTH = 500;
const BROWSER_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const DIALOG_WAIT_TIMEOUT_MS = 60_000;
const SKIPPED_AX_ROLES = new Set(["none", "generic", "section", "paragraph", "StaticText", "InlineTextBox"]);
const ALLOWED_BROWSER_CONTROL_CDP_METHODS = new Set([
  "Runtime.enable",
  "Page.enable",
  "DOM.enable",
  "Accessibility.enable",
  "Network.enable",
  "Log.enable",
  "Network.getResponseBody",
  "Accessibility.getFullAXTree",
  "DOM.resolveNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.getBoxModel",
  "Page.captureScreenshot",
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
      await this.sendCommand("Log.enable");
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

  async captureScreenshot(params: Record<string, unknown>): Promise<unknown> {
    return this.sendCommand("Page.captureScreenshot", params);
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

  listElementCandidates(): BrowserSnapshotElementCandidate[] {
    return Array.from(this.uidToBackendNodeId.entries()).map(([uid, backendNodeId]) => ({
      uid,
      backendNodeId,
      axNode: this.uidToAxNode.get(uid),
    }));
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
  private currentOrigin: string | undefined;
  private readonly controlledTabIds = new Set<number>();
  private suppressNextDetachTabId: number | undefined;
  private desiredEnabled = false;
  private operationVersion = 0;
  private readonly snapshotManager: BrowserControlSnapshotManager;
  private readonly actionExecutor: BrowserControlActionExecutor;
  private readonly networkRecorder: BrowserNetworkRecorder;
  private readonly networkToolExecutor: BrowserNetworkToolExecutor;
  private readonly consoleRecorder: BrowserConsoleRecorder;
  private readonly jsSourceToolExecutor: JsSourceToolExecutor;
  private readonly sourceMapToolExecutor: SourceMapToolExecutor;
  private readonly runtimeReadToolExecutor: RuntimeReadToolExecutor;
  private readonly boundaryChoiceToolExecutor: BoundaryChoiceToolExecutor;
  private readonly replayToolExecutor: ReplayToolExecutor;
  private readonly fullAccessToolExecutor: FullAccessToolExecutor;
  private toolAuthorizationContext: ToolAuthorizationContext = NORMAL_TOOL_AUTHORIZATION_CONTEXT;
  private browserAutomationMode: BrowserAutomationMode = "normal_restricted";
  private activeBoundaryGrantScopeKey: string | undefined;

  constructor(
    private readonly connection = new BrowserDebuggerConnection(),
    private readonly chromeApi: ChromeApi | undefined = getChromeApi(),
    private readonly onDetach?: (tabId: number, reason: BrowserControlDetachedReason) => void,
  ) {
    this.networkRecorder = new BrowserNetworkRecorder(this.connection);
    this.snapshotManager = new BrowserControlSnapshotManager(this.connection, () => this.getTargetTabInfo());
    this.actionExecutor = new BrowserControlActionExecutor(this.connection, this.snapshotManager, {
      waitForNetworkIdle: (options) => this.networkRecorder.waitForIdle({ timeoutMs: options.timeoutMs }),
    });
    this.consoleRecorder = new BrowserConsoleRecorder(this.connection);
    this.jsSourceToolExecutor = new JsSourceToolExecutor({
      recorder: this.networkRecorder,
      getCurrentPageUrl: async () => (await this.getTargetTabInfo()).url,
      getBoundaryGrant: () => this.getAutomationBoundaryGrantContext(),
    });
    this.sourceMapToolExecutor = new SourceMapToolExecutor({
      recorder: this.networkRecorder,
      jsSourceIndex: this.jsSourceToolExecutor.getIndex(),
      getCurrentPageUrl: async () => (await this.getTargetTabInfo()).url,
      getBoundaryGrant: () => this.getAutomationBoundaryGrantContext(),
    });
    this.runtimeReadToolExecutor = new RuntimeReadToolExecutor(this.connection, () => this.getRuntimeToolAuthorizationContext());
    this.boundaryChoiceToolExecutor = new BoundaryChoiceToolExecutor(
      (message) => this.notifyBoundaryChoiceRequest(message),
      () => this.getEnhancedToolContext(),
    );
    this.replayToolExecutor = new ReplayToolExecutor(
      this.networkRecorder,
      fetch,
      () => this.getReplayToolContext(),
    );
    this.fullAccessToolExecutor = new FullAccessToolExecutor(
      this.connection,
      this.networkRecorder,
      () => this.getFullAccessToolContext(),
      () => this.clearAutomationModeState(),
    );
    this.networkToolExecutor = new BrowserNetworkToolExecutor(this.networkRecorder, () => {
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearAutomationTransientState();
    }, () => this.getAutomationBoundaryGrantContext(), () => this.canExposeFullAccessTool());
    this.connection.installDetachListener((tabId, reason) => {
      if (this.suppressNextDetachTabId === tabId) {
        this.suppressNextDetachTabId = undefined;
        return;
      }

      this.targetTabId = undefined;
      this.currentOrigin = undefined;
      this.desiredEnabled = false;
      this.controlledTabIds.clear();
      this.snapshotManager.clearSnapshotCache();
      this.consoleRecorder.stop();
      this.stopNetworkAnalysis();
      this.clearAutomationModeState();
      this.notifyDetached(tabId, normalizeDetachReason(reason));
    });
    this.connection.installEventListener();
  }

  handleTabRemoved(tabId: number): void {
    if (tabId !== this.targetTabId && tabId !== this.connection.attachedTabId) {
      return;
    }

    this.targetTabId = undefined;
    this.currentOrigin = undefined;
    this.controlledTabIds.delete(tabId);
    this.snapshotManager.clearSnapshotCache();
    this.consoleRecorder.stop();
    this.stopNetworkAnalysis();
    this.clearAutomationModeState();
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
      this.currentOrigin = undefined;
      this.controlledTabIds.clear();
      this.snapshotManager.clearSnapshotCache();
      this.consoleRecorder.stop();
      this.stopNetworkAnalysis();
      this.clearAutomationModeState();
      this.notifyDetached(detachedTabId, "disabled_by_user");
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    const tabResult = await this.resolveTargetTab(tabId);
    if (!this.isCurrentEnableOperation(operationVersion)) {
      this.targetTabId = undefined;
      this.currentOrigin = undefined;
      this.controlledTabIds.clear();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    if (!tabResult.ok) {
      this.targetTabId = undefined;
      this.currentOrigin = undefined;
      this.controlledTabIds.clear();
      return tabResult;
    }

    this.targetTabId = tabResult.tab.id;
    this.currentOrigin = getOriginFromUrl(getBrowserControlTabUrl(tabResult.tab));
    await this.initializeControlledTabs(tabResult.tab);
    const attachResult = await this.connection.attach(tabResult.tab.id, () => this.isCurrentEnableOperation(operationVersion));
    if (!this.isCurrentEnableOperation(operationVersion)) {
      await this.connection.detach(tabResult.tab.id);
      this.targetTabId = undefined;
      this.currentOrigin = undefined;
      this.controlledTabIds.clear();
      return { ok: true, attached: false, message: "浏览器控制已关闭。" };
    }

    if (!attachResult.ok) {
      this.targetTabId = undefined;
      this.currentOrigin = undefined;
      this.controlledTabIds.clear();
      this.stopNetworkAnalysis();
      this.clearAutomationModeState();
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

  async extractContent(toolCall: ModelToolCall, extractionRules: ExtractionRule[] = []): Promise<ModelToolResult> {
    if (!this.canExposeBrowserTool()) {
      return createBrowserActionDisabledResult(toolCall);
    }

    const validation = validateExtractContentArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    const tabId = this.connection.attachedTabId;
    if (typeof tabId !== "number") {
      return createBrowserToolErrorResult(toolCall, "当前没有受控标签页，无法提取页面内容。");
    }

    const rules = createExtractContentRules(validation.args, extractionRules);
    const response = await handlePageContextMessage({
      type: "pageContext.extract",
      tabId,
      rules,
      maxLength: validation.args.maxLength,
      extractMode: validation.args.mode === "html" ? "all" : "text",
      selectorType: validation.args.source === "selector" ? validation.args.selectorType : undefined,
      allowFallback: validation.args.source !== "selector",
    }, this.chromeApi ?? getChromeApi());

    if (!response.ok) {
      return createBrowserToolErrorResult(toolCall, response.message);
    }

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatExtractContentResult(response, validation.args),
    };
  }

  canExposeNetworkTool(): boolean {
    return this.canExposeBrowserTool() && this.networkRecorder.isEnabled;
  }

  canExposeRuntimeReadTool(): boolean {
    if (!this.canExposeNetworkTool()) {
      return false;
    }

    return this.browserAutomationMode === "normal_restricted" || this.getRuntimeToolAuthorizationContext().mode === "controlled_enhanced";
  }

  setRuntimeReadonlyEnabled(_enabled: boolean, reason = "用户临时开启运行时只读分析。"): BrowserControlResponse {
    return this.setAutomationMode("normal_restricted", reason);
  }

  setAutomationMode(mode: BrowserAutomationMode, reason = "用户切换浏览器自动化模式。"): BrowserControlResponse {
    if (!this.canExposeNetworkTool() || typeof this.connection.attachedTabId !== "number") {
      this.clearAutomationModeState();
      return { ok: false, message: "浏览器控制或 Network 采集未开启，无法切换浏览器自动化模式。" };
    }

    if (mode === "normal_restricted") {
      this.clearAutomationModeState();
      return { ok: true, attached: true, tabId: this.connection.attachedTabId, message: "已切换到普通模式（受限）。" };
    }

    this.browserAutomationMode = mode;
    this.refreshAutomationModeAuthorizationContext(reason);
    this.clearAutomationTransientState();
    this.notifyAutomationModeChanged(mode, this.connection.attachedTabId);
    return {
      ok: true,
      attached: true,
      tabId: this.connection.attachedTabId,
      message: mode === "controlled_enhanced" ? "受控增强模式已临时开启。" : "完全访问模式已开启，当前会话将按最高权限执行。",
    };
  }

  async executeNetworkTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (this.canExposeFullAccessTool() && isNetworkDetailLikeToolCall(toolCall)) {
      return this.networkToolExecutor.execute(toolCall);
    }

    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    const hadGrantBefore = this.canRevealSensitiveNetworkResult(scopeKey);
    const initialResult = await this.withBoundaryGrantScope(scopeKey, () => this.networkToolExecutor.execute(toolCall));
    if (hadGrantBefore && isNetworkDetailLikeToolCall(toolCall)) {
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return initialResult;
    }
    const boundaryResult = await this.applyAutomationBoundaryConfirmation(toolCall, initialResult);
    if (!hadGrantBefore && isNetworkDetailLikeToolCall(toolCall) && this.canRevealSensitiveNetworkResult(scopeKey)) {
      const revealedResult = await this.withBoundaryGrantScope(scopeKey, () => this.networkToolExecutor.execute(toolCall));
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return revealedResult;
    }
    return boundaryResult;
  }

  async executeJsSourceTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    const hadGrantBefore = this.canExpandJsOrSourceMapContext(scopeKey);
    const initialResult = await this.withBoundaryGrantScope(scopeKey, () => this.jsSourceToolExecutor.execute(toolCall));
    if (hadGrantBefore) {
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return initialResult;
    }
    const boundaryResult = await this.applyAutomationBoundaryConfirmation(toolCall, initialResult);
    if (!hadGrantBefore && this.canExpandJsOrSourceMapContext(scopeKey)) {
      const expandedResult = await this.withBoundaryGrantScope(scopeKey, () => this.jsSourceToolExecutor.execute(toolCall));
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return expandedResult;
    }
    return boundaryResult;
  }

  async executeSourceMapTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    await this.jsSourceToolExecutor.refreshResourcesForAnalysis();
    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    const hadGrantBefore = this.canExpandJsOrSourceMapContext(scopeKey);
    const initialResult = await this.withBoundaryGrantScope(scopeKey, () => this.sourceMapToolExecutor.execute(toolCall));
    if (hadGrantBefore) {
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return initialResult;
    }
    const boundaryResult = await this.applyAutomationBoundaryConfirmation(toolCall, initialResult);
    if (!hadGrantBefore && this.canExpandJsOrSourceMapContext(scopeKey)) {
      const expandedResult = await this.withBoundaryGrantScope(scopeKey, () => this.sourceMapToolExecutor.execute(toolCall));
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return expandedResult;
    }
    return boundaryResult;
  }

  async executeRuntimeReadTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!this.canExposeRuntimeReadTool()) {
      return createBrowserToolErrorResult(toolCall, "当前浏览器自动化模式不允许执行 runtime.* 工具。");
    }

    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    const hadGrantBefore = this.canExpandRuntimeSummary(scopeKey);
    const initialResult = await this.runtimeReadToolExecutor.execute(hadGrantBefore ? createExpandedRuntimeToolCall(toolCall) : toolCall);
    if (hadGrantBefore) {
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return initialResult;
    }
    const boundaryResult = await this.applyAutomationBoundaryConfirmation(toolCall, initialResult);
    if (!hadGrantBefore && this.canExpandRuntimeSummary(scopeKey)) {
      const expandedResult = await this.runtimeReadToolExecutor.execute(createExpandedRuntimeToolCall(toolCall));
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return expandedResult;
    }
    return boundaryResult;
  }

  canExposeBoundaryChoiceTool(): boolean {
    return this.canExposeNetworkTool() && this.boundaryChoiceToolExecutor.canExpose();
  }

  executeBoundaryChoiceTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    return this.boundaryChoiceToolExecutor.execute(toolCall);
  }

  canExposeReplayTool(): boolean {
    return this.canExposeNetworkTool() && this.replayToolExecutor.canExpose();
  }

  async executeReplayTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    const hadGrantBefore = this.hasReplaySendGrant(scopeKey);
    const initialResult = await this.withBoundaryGrantScope(scopeKey, () => this.replayToolExecutor.execute(toolCall));
    if (hadGrantBefore && isReplaySendToolCall(toolCall)) {
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return initialResult;
    }
    const boundaryResult = await this.applyAutomationBoundaryConfirmation(toolCall, initialResult);
    if (!hadGrantBefore && isReplaySendToolCall(toolCall) && this.hasReplaySendGrant(scopeKey)) {
      const replayResult = await this.withBoundaryGrantScope(scopeKey, () => this.replayToolExecutor.execute(toolCall));
      this.boundaryChoiceToolExecutor.clearGrantContext();
      return replayResult;
    }
    return boundaryResult;
  }

  canExposeFullAccessTool(): boolean {
    return this.canExposeNetworkTool() && this.fullAccessToolExecutor.canExpose();
  }

  executeFullAccessTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    return this.fullAccessToolExecutor.execute(toolCall);
  }

  respondBoundaryChoice(requestId: string, response: { selectedChoiceIds: string[]; otherText?: string }): boolean {
    return this.boundaryChoiceToolExecutor.respond(requestId, response);
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
    if (toolCall.name === BROWSER_GET_PAGE_STATE_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.getPageState(toolCall);
    }

    if (toolCall.name === BROWSER_GET_CONSOLE_MESSAGES_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.getConsoleMessages(toolCall);
    }

    if (toolCall.name === BROWSER_INSPECT_ELEMENT_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.inspectElement(toolCall);
    }

    if (toolCall.name === BROWSER_FIND_ELEMENTS_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.findElements(toolCall);
    }

    if (toolCall.name === BROWSER_SCREENSHOT_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.screenshot(toolCall);
    }

    if (toolCall.name === BROWSER_ANALYZE_INTERACTION_BLOCKER_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.analyzeInteractionBlocker(toolCall);
    }

    if (toolCall.name === BROWSER_ANALYZE_FORM_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.analyzeForm(toolCall);
    }

    if (toolCall.name === BROWSER_GET_PERFORMANCE_SUMMARY_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.getPerformanceSummary(toolCall);
    }

    if (toolCall.name === BROWSER_COLLECT_DIAGNOSTICS_TOOL_NAME) {
      if (!this.canExposeBrowserTool()) {
        return createBrowserActionDisabledResult(toolCall);
      }

      return this.collectDiagnostics(toolCall);
    }

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

  private async getPageState(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const extraKeys = Object.keys(toolCall.arguments);
    if (extraKeys.length > 0) {
      return createBrowserToolErrorResult(toolCall, "浏览器页面状态工具不接受任何参数。");
    }

    try {
      const [tabInfo, pageRuntimeState] = await Promise.all([
        this.getTargetTabInfo(),
        this.readPageRuntimeState(),
      ]);

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: formatPageState({
          url: pageRuntimeState.url || tabInfo.url,
          title: pageRuntimeState.title || tabInfo.title,
          readyState: pageRuntimeState.readyState,
          viewport: pageRuntimeState.viewport,
          scroll: pageRuntimeState.scroll,
          focusedElement: pageRuntimeState.focusedElement,
        }),
      };
    } catch {
      return createBrowserToolErrorResult(toolCall, PAGE_STATE_FAILED_MESSAGE);
    }
  }

  private getConsoleMessages(toolCall: ModelToolCall): ModelToolResult {
    const extraKeys = Object.keys(toolCall.arguments);
    if (extraKeys.length > 0) {
      return createBrowserToolErrorResult(toolCall, "浏览器 Console 消息工具不接受任何参数。");
    }

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: this.consoleRecorder.formatMessages(),
    };
  }

  private async inspectElement(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validateInspectElementArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    const uid = String(toolCall.arguments.uid);
    try {
      const backendNodeId = this.snapshotManager.getBackendNodeId(uid);
      const axNode = this.snapshotManager.getAXNode(uid);
      const resolved = await this.connection.resolveNodeByBackendId(backendNodeId);
      const objectId = getResolvedObjectId(resolved);
      if (!objectId) {
        return createBrowserToolErrorResult(toolCall, `元素 ${uid} 已从页面中移除。请重新调用 take_snapshot 获取最新页面状态后再继续。`);
      }

      const inspection = normalizeElementInspection(await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createInspectElementFunctionDeclaration(),
        returnByValue: true,
      }));

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: formatElementInspection(uid, axNode, inspection),
      };
    } catch (error) {
      return createBrowserToolErrorResult(toolCall, normalizeInspectElementError(error));
    }
  }

  private async findElements(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validateFindElementsArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    const candidates = this.snapshotManager.listElementCandidates();
    if (!candidates.length) {
      return createBrowserToolErrorResult(toolCall, "当前没有可搜索的页面快照，请先调用 take_snapshot。");
    }

    const query = String(toolCall.arguments.query).trim();
    const strategy = normalizeFindElementStrategy(toolCall.arguments.strategy);
    const limit = normalizeFindElementLimit(toolCall.arguments.limit);
    const matches = strategy === "css"
      ? await this.findElementsByCss(candidates, query, limit)
      : findElementsBySnapshot(candidates, strategy, query, limit);

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatFindElementsResult(matches),
    };
  }

  private async findElementsByCss(candidates: BrowserSnapshotElementCandidate[], selector: string, limit: number): Promise<BrowserSnapshotElementCandidate[]> {
    const matches: BrowserSnapshotElementCandidate[] = [];
    for (const candidate of candidates) {
      if (matches.length >= limit) {
        break;
      }

      try {
        const resolved = await this.connection.resolveNodeByBackendId(candidate.backendNodeId);
        const objectId = getResolvedObjectId(resolved);
        if (!objectId) {
          continue;
        }
        const response = await this.connection.callFunctionOn({
          objectId,
          functionDeclaration: `function(selector) {
            return typeof this.matches === "function" ? this.matches(selector) : false;
          }`,
          arguments: [{ value: selector }],
          returnByValue: true,
        });
        if (getRuntimeResultValue(response) === true) {
          matches.push(candidate);
        }
      } catch {
        // 单个候选节点已失效或 CSS matches 失败时跳过，避免一个节点破坏整轮查找。
      }
    }
    return matches;
  }

  private async screenshot(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validateScreenshotArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    try {
      const target = validation.target;
      const uid = validation.uid;
      const clip = target === "element" && uid ? await this.createScreenshotClip(uid) : undefined;
      const response = await this.connection.captureScreenshot({
        format: "png",
        fromSurface: true,
        ...(clip ? { captureBeyondViewport: true } : {}),
        ...(clip ? { clip } : {}),
      });
      const attachment = createBrowserScreenshotAttachment(toolCall, target, response, uid, clip);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: target === "element" && uid
          ? `已截取元素 ${uid} 截图，图片已作为工具附件返回。`
          : "已截取当前视口截图，图片已作为工具附件返回。",
        toolAttachments: [attachment],
      };
    } catch (error) {
      return createBrowserToolErrorResult(toolCall, normalizeScreenshotError(error));
    }
  }

  private async analyzeInteractionBlocker(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validateInteractionBlockerArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    try {
      const uid = validation.uid;
      const backendNodeId = this.snapshotManager.getBackendNodeId(uid);
      const axNode = this.snapshotManager.getAXNode(uid);
      const resolved = await this.connection.resolveNodeByBackendId(backendNodeId);
      const objectId = getResolvedObjectId(resolved);
      if (!objectId) {
        return createBrowserToolErrorResult(toolCall, `元素 ${uid} 已从页面中移除。请重新调用 take_snapshot 获取最新页面状态后再继续。`);
      }

      const analysis = normalizeInteractionBlockerAnalysis(await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createInteractionBlockerFunctionDeclaration(),
        returnByValue: true,
      }));

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: formatInteractionBlockerAnalysis(uid, validation.expectedAction, axNode, analysis),
      };
    } catch (error) {
      return createBrowserToolErrorResult(toolCall, normalizeInteractionBlockerError(error));
    }
  }

  private async analyzeForm(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const validation = validateAnalyzeFormArguments(toolCall);
    if (!validation.ok) {
      return createBrowserToolErrorResult(toolCall, validation.message);
    }

    try {
      if (validation.uid) {
        const backendNodeId = this.snapshotManager.getBackendNodeId(validation.uid);
        const resolved = await this.connection.resolveNodeByBackendId(backendNodeId);
        const objectId = getResolvedObjectId(resolved);
        if (!objectId) {
          return createBrowserToolErrorResult(toolCall, `元素 ${validation.uid} 已从页面中移除。请重新调用 take_snapshot 获取最新页面状态后再继续。`);
        }
        const response = await this.connection.callFunctionOn({
          objectId,
          functionDeclaration: createAnalyzeFormFunctionDeclaration(),
          arguments: [{ value: validation.includeFieldDetails }],
          returnByValue: true,
        });
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: formatFormAnalysis(normalizeFormAnalysis(response), validation.includeFieldDetails),
        };
      }

      const response = await this.connection.evaluate({
        expression: createAnalyzeFormExpression(validation.includeFieldDetails),
        returnByValue: true,
        awaitPromise: false,
      });
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: formatFormAnalysis(normalizeFormAnalysis(response), validation.includeFieldDetails),
      };
    } catch (error) {
      return createBrowserToolErrorResult(toolCall, normalizeAnalyzeFormError(error));
    }
  }

  private async getPerformanceSummary(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const extraKeys = Object.keys(toolCall.arguments);
    if (extraKeys.length > 0) {
      return createBrowserToolErrorResult(toolCall, "浏览器性能摘要工具不接受任何参数。");
    }

    try {
      const response = await this.connection.evaluate({
        expression: createPerformanceSummaryExpression(),
        returnByValue: true,
        awaitPromise: false,
      });
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: formatPerformanceSummary(normalizePerformanceSummary(response)),
      };
    } catch {
      return createBrowserToolErrorResult(toolCall, "读取性能摘要失败，请确认当前页面仍可访问后重试。");
    }
  }

  private async collectDiagnostics(toolCall: ModelToolCall): Promise<ModelToolResult> {
    const extraKeys = Object.keys(toolCall.arguments);
    if (extraKeys.length > 0) {
      return createBrowserToolErrorResult(toolCall, "浏览器聚合诊断工具不接受任何参数。");
    }

    const [pageState, performanceSummary] = await Promise.all([
      this.collectPageStateSection(),
      this.collectPerformanceSection(),
    ]);

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: [
        "聚合诊断：",
        "## 页面状态",
        pageState,
        "## Console",
        this.consoleRecorder.formatMessages(),
        "## 性能",
        performanceSummary,
        "## Network",
        formatDiagnosticsNetworkSummary(this.networkRecorder.listRequests({ limit: 20 }, { redacted: true })),
      ].join("\n"),
    };
  }

  private async collectPageStateSection(): Promise<string> {
    try {
      const [tabInfo, pageRuntimeState] = await Promise.all([
        this.getTargetTabInfo(),
        this.readPageRuntimeState(),
      ]);
      return formatPageState({
        url: pageRuntimeState.url || tabInfo.url,
        title: pageRuntimeState.title || tabInfo.title,
        readyState: pageRuntimeState.readyState,
        viewport: pageRuntimeState.viewport,
        scroll: pageRuntimeState.scroll,
        focusedElement: pageRuntimeState.focusedElement,
      });
    } catch {
      return "页面状态读取失败，请确认当前页面仍可访问后重试。";
    }
  }

  private async collectPerformanceSection(): Promise<string> {
    try {
      const response = await this.connection.evaluate({
        expression: createPerformanceSummaryExpression(),
        returnByValue: true,
        awaitPromise: false,
      });
      return formatPerformanceSummary(normalizePerformanceSummary(response));
    } catch {
      return "性能摘要读取失败，请确认当前页面仍可访问后重试。";
    }
  }

  private async createScreenshotClip(uid: string): Promise<BrowserScreenshotClip> {
    const backendNodeId = this.snapshotManager.getBackendNodeId(uid);
    const resolved = await this.connection.resolveNodeByBackendId(backendNodeId);
    const objectId = getResolvedObjectId(resolved);
    if (!objectId) {
      throw new Error(`元素 ${uid} 已从页面中移除。`);
    }

    await this.connection.scrollIntoViewIfNeeded(objectId);
    const boxModel = await this.connection.getBoxModel(backendNodeId);
    return normalizeScreenshotClip(boxModel);
  }

  private async readPageRuntimeState(): Promise<BrowserPageRuntimeState> {
    const response = await this.connection.evaluate({
      expression: createPageStateExpression(),
      returnByValue: true,
      awaitPromise: false,
    });

    return normalizePageRuntimeState(response);
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
      this.consoleRecorder.clear();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearAutomationTransientState();
      this.currentOrigin = getOriginFromUrl(urlResult.url);
      this.refreshAutomationModeAuthorizationContext("页面导航后延续用户选择的浏览器自动化模式。");
      content = `已导航到 ${urlResult.url}。`;
    } else if (action === "reload") {
      await this.connection.reload();
      this.snapshotManager.clearSnapshotCache();
      this.consoleRecorder.clear();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearAutomationTransientState();
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
      this.consoleRecorder.clear();
      this.jsSourceToolExecutor.clear();
      this.sourceMapToolExecutor.clear();
      this.clearAutomationTransientState();
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
      this.clearAutomationModeState();
      this.notifyDetached(detachedTabId, "tab_removed");
      return `已关闭当前受控页面 ${index}，浏览器控制后台受控列表内没有其他可控页面。`;
    }

    await this.switchToTab(remainingPages[0].id);
    return `已关闭当前受控页面 ${index}，并切换到页面 1：${remainingPages[0].title || "无标题"}。`;
  }

  private async switchToTab(tabId: number): Promise<void> {
    await this.chromeApi?.tabs.update?.(tabId, { active: true });
    this.snapshotManager.clearSnapshotCache();
    this.consoleRecorder.clear();
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.targetTabId = tabId;
    this.controlledTabIds.add(tabId);
    const tab = await this.chromeApi?.tabs.get?.(tabId);
    this.currentOrigin = getOriginFromUrl(getBrowserControlTabUrl(tab));
    this.clearAutomationTransientState();
    this.refreshAutomationModeAuthorizationContext("切换受控页面后延续用户选择的浏览器自动化模式。");
    const attachResult = await this.connection.attach(tabId);
    if (!attachResult.ok) {
      this.targetTabId = undefined;
      this.stopNetworkAnalysis();
      this.clearAutomationModeState();
      throw new Error(attachResult.message);
    }
    this.startNetworkAnalysis(tabId);
  }

  private startNetworkAnalysis(tabId: number): void {
    this.consoleRecorder.start(tabId);
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.clearAutomationTransientState();
    this.refreshAutomationModeAuthorizationContext("Network 采集重启后延续用户选择的浏览器自动化模式。");
    this.networkRecorder.start(tabId);
  }

  private stopNetworkAnalysis(): void {
    this.consoleRecorder.stop();
    this.jsSourceToolExecutor.clear();
    this.sourceMapToolExecutor.clear();
    this.clearAutomationTransientState();
    this.networkRecorder.stop();
  }

  private getRuntimeToolAuthorizationContext(): ToolAuthorizationContext {
    if (this.canExposeNetworkTool() && this.browserAutomationMode === "normal_restricted" && typeof this.connection.attachedTabId === "number") {
      return {
        mode: "runtime_readonly",
        tabId: this.connection.attachedTabId,
        origin: this.getCurrentOrigin(),
        createdAt: Date.now(),
        reason: "普通模式默认启用运行时只读分析。",
      };
    }

    if (isRuntimeReadonlyAuthorized(this.toolAuthorizationContext, this.connection.attachedTabId)) {
      return this.toolAuthorizationContext;
    }

    return NORMAL_TOOL_AUTHORIZATION_CONTEXT;
  }

  private refreshAutomationModeAuthorizationContext(reason: string): void {
    if (this.browserAutomationMode === "normal_restricted" || typeof this.connection.attachedTabId !== "number") {
      this.toolAuthorizationContext = NORMAL_TOOL_AUTHORIZATION_CONTEXT;
      return;
    }

    this.toolAuthorizationContext = {
      mode: this.browserAutomationMode === "controlled_enhanced" ? "controlled_enhanced" : "full_access",
      tabId: this.connection.attachedTabId,
      origin: this.getCurrentOrigin(),
      createdAt: Date.now(),
      reason,
    };
  }

  private clearAutomationTransientState(): void {
    this.boundaryChoiceToolExecutor.clearGrantContext();
    this.replayToolExecutor.clear();
  }

  private clearAutomationModeState(): void {
    const previous = this.toolAuthorizationContext;
    this.toolAuthorizationContext = NORMAL_TOOL_AUTHORIZATION_CONTEXT;
    this.browserAutomationMode = "normal_restricted";
    this.boundaryChoiceToolExecutor.clear();
    this.replayToolExecutor.clear();
    if (previous.mode === "runtime_readonly" || previous.mode === "controlled_enhanced" || previous.mode === "full_access") {
      this.notifyAutomationModeChanged("normal_restricted", previous.tabId);
    }
  }

  private getEnhancedToolContext(): { tabId?: number; origin?: string; enhanced: boolean } {
    return {
      tabId: this.connection.attachedTabId,
      origin: this.getCurrentOrigin(),
      enhanced: this.browserAutomationMode === "controlled_enhanced" &&
        isControlledEnhancedAuthorized(this.toolAuthorizationContext, this.connection.attachedTabId),
    };
  }

  private getReplayToolContext(): { tabId?: number; origin?: string; enhanced: boolean; grant?: ReturnType<BoundaryChoiceToolExecutor["getCurrentGrantContext"]> } {
    return {
      ...this.getEnhancedToolContext(),
      grant: this.getScopedBoundaryGrantContext(),
    };
  }

  private getFullAccessToolContext(): { tabId?: number; origin?: string; fullAccess: boolean } {
    return {
      tabId: this.connection.attachedTabId,
      origin: this.getCurrentOrigin(),
      fullAccess: this.browserAutomationMode === "full_access" &&
        isFullAccessAuthorized(this.toolAuthorizationContext, this.connection.attachedTabId),
    };
  }

  private getScopedBoundaryGrantContext(): ReturnType<BoundaryChoiceToolExecutor["getCurrentGrantContext"]> {
    const grant = this.boundaryChoiceToolExecutor.getCurrentGrantContext();
    if (!grant || !this.activeBoundaryGrantScopeKey || grant.scopeKey !== this.activeBoundaryGrantScopeKey) {
      return undefined;
    }
    return grant;
  }

  private getAutomationBoundaryGrantContext(): BoundaryGrantContext | undefined {
    if (this.canExposeFullAccessTool()) {
      return this.createFullAccessGrantContext();
    }

    return this.getScopedBoundaryGrantContext();
  }

  private createFullAccessGrantContext(): BoundaryGrantContext {
    return {
      id: "full-access",
      tabId: this.connection.attachedTabId ?? 0,
      origin: this.getCurrentOrigin() ?? "",
      toolCallId: "full-access",
      scopeKey: "full-access",
      grants: [
        "include_sensitive_field_in_current_tool_result",
        "write_sensitive_result_to_chat_once",
        "expand_js_or_sourcemap_context",
        "expand_runtime_summary_depth",
        "send_single_confirmed_replay_request_without_credentials",
      ],
      selectedChoiceIds: ["full-access"],
      createdAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }

  private async withBoundaryGrantScope<T>(scopeKey: string, action: () => Promise<T>): Promise<T> {
    const previousScopeKey = this.activeBoundaryGrantScopeKey;
    this.activeBoundaryGrantScopeKey = scopeKey;
    try {
      return await action();
    } finally {
      this.activeBoundaryGrantScopeKey = previousScopeKey;
    }
  }

  private canRevealSensitiveNetworkResult(scopeKey: string): boolean {
    const grant = this.boundaryChoiceToolExecutor.getCurrentGrantContext();
    return Boolean(grant && grant.scopeKey === scopeKey &&
      grant.grants.includes("include_sensitive_field_in_current_tool_result") &&
      grant.grants.includes("write_sensitive_result_to_chat_once"));
  }

  private canExpandJsOrSourceMapContext(scopeKey: string): boolean {
    const grant = this.boundaryChoiceToolExecutor.getCurrentGrantContext();
    return Boolean(grant && grant.scopeKey === scopeKey && grant.grants.includes("expand_js_or_sourcemap_context"));
  }

  private canExpandRuntimeSummary(scopeKey: string): boolean {
    const grant = this.boundaryChoiceToolExecutor.getCurrentGrantContext();
    return Boolean(grant && grant.scopeKey === scopeKey && grant.grants.includes("expand_runtime_summary_depth"));
  }

  private hasReplaySendGrant(scopeKey: string): boolean {
    const grant = this.boundaryChoiceToolExecutor.getCurrentGrantContext();
    return Boolean(grant && grant.scopeKey === scopeKey && grant.grants.includes("send_single_confirmed_replay_request_without_credentials"));
  }

  private async applyAutomationBoundaryConfirmation(toolCall: ModelToolCall, result: ModelToolResult): Promise<ModelToolResult> {
    const scopeKey = createBoundaryGrantScopeKey(toolCall);
    return applyAutomationBoundaryConfirmation(result, async (request) => {
      if (!this.canExposeBoundaryChoiceTool()) {
        return undefined;
      }
      const confirmation = await this.boundaryChoiceToolExecutor.execute({
        id: `auto-boundary-${toolCall.id}-${Date.now()}`,
        name: "boundary_request_user_choice",
        arguments: { ...request, scopeKey },
      });
      return confirmation.content;
    });
  }

  private getCurrentOrigin(): string | undefined {
    return this.currentOrigin;
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

  private notifyAutomationModeChanged(mode: BrowserAutomationMode, tabId: number | undefined, expiresAt?: number): void {
    this.chromeApi?.runtime?.sendMessage?.({
      type: BROWSER_CONTROL_AUTOMATION_MODE_CHANGED_MESSAGE_TYPE,
      mode,
      tabId,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }, () => {
      const lastError = this.chromeApi?.runtime?.lastError;
      // Side Panel 未打开时广播可能没有接收者；读取 lastError 避免 MV3 runtime 噪声。
      void lastError?.message;
    });
  }

  private notifyBoundaryChoiceRequest(message: BrowserControlBoundaryChoiceRequestMessage): void {
    this.chromeApi?.runtime?.sendMessage?.(message, () => {
      const lastError = this.chromeApi?.runtime?.lastError;
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

function createPageStateExpression(): string {
  return `(() => {
    const active = document.activeElement;
    const activeText = active
      ? ((active.getAttribute("aria-label") || active.getAttribute("title") || active.textContent || active.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim())
      : "";
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio || 1,
      },
      scroll: {
        x: window.scrollX || 0,
        y: window.scrollY || 0,
        maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      },
      focusedElement: active ? {
        tagName: active.tagName,
        id: active.id || "",
        name: active.getAttribute("name") || "",
        type: active.getAttribute("type") || "",
        text: activeText,
      } : undefined,
    };
  })()`;
}

function createInspectElementFunctionDeclaration(): string {
  return `function() {
    const attributeNames = [
      "name", "type", "role", "aria-label", "placeholder", "title", "href", "src",
      "alt", "disabled", "aria-disabled", "aria-hidden", "aria-expanded",
      "aria-selected", "aria-checked"
    ];
    const attributes = {};
    for (const name of attributeNames) {
      if (this.getAttribute && this.hasAttribute && this.hasAttribute(name)) {
        attributes[name] = this.getAttribute(name) || "";
      }
    }
    const rect = this.getBoundingClientRect ? this.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    const style = window.getComputedStyle ? window.getComputedStyle(this) : {};
    const tagName = String(this.tagName || "").toUpperCase();
    const text = String(
      (this.innerText || this.textContent || this.value || this.getAttribute?.("aria-label") || this.getAttribute?.("placeholder") || "")
    ).replace(/\\s+/g, " ").trim();
    const disabled = Boolean(this.disabled || (this.getAttribute && this.getAttribute("aria-disabled") === "true") || (this.hasAttribute && this.hasAttribute("disabled")));
    const editable = Boolean(this.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName));
    const visible = Boolean(rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
    return {
      tagName,
      id: String(this.id || ""),
      className: typeof this.className === "string" ? this.className : "",
      text,
      attributes,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: {
        display: String(style.display || ""),
        visibility: String(style.visibility || ""),
        opacity: String(style.opacity || ""),
        pointerEvents: String(style.pointerEvents || ""),
        cursor: String(style.cursor || ""),
      },
      state: { visible, disabled, editable },
    };
  }`;
}

function createInteractionBlockerFunctionDeclaration(): string {
  return `function() {
    const rect = this.getBoundingClientRect ? this.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 };
    const style = window.getComputedStyle ? window.getComputedStyle(this) : {};
    const tagName = String(this.tagName || "").toUpperCase();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hitElement = Number.isFinite(centerX) && Number.isFinite(centerY) ? document.elementFromPoint(centerX, centerY) : null;
    const coveredBy = hitElement && hitElement !== this && !this.contains(hitElement)
      ? String(
          hitElement.tagName +
          (hitElement.id ? "#" + hitElement.id : "") +
          (typeof hitElement.className === "string" && hitElement.className ? "." + hitElement.className.replace(/\\s+/g, ".") : "")
        )
      : "";
    const disabled = Boolean(this.disabled || (this.getAttribute && this.getAttribute("aria-disabled") === "true") || (this.hasAttribute && this.hasAttribute("disabled")));
    const editable = Boolean(this.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName));
    const visible = Boolean(rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
    const disabledFieldset = Boolean(this.closest && this.closest("fieldset[disabled]"));
    const form = this.form || (this.closest ? this.closest("form") : null);
    const invalidFields = form && typeof form.querySelectorAll === "function" ? form.querySelectorAll(":invalid").length : 0;
    return {
      tagName,
      text: String(
        (this.innerText || this.textContent || this.value || this.getAttribute?.("aria-label") || this.getAttribute?.("placeholder") || "")
      ).replace(/\\s+/g, " ").trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: {
        display: String(style.display || ""),
        visibility: String(style.visibility || ""),
        opacity: String(style.opacity || ""),
        pointerEvents: String(style.pointerEvents || ""),
        cursor: String(style.cursor || ""),
      },
      state: {
        visible,
        disabled,
        editable,
        connected: Boolean(this.isConnected),
        inViewport: Boolean(rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth),
        occluded: Boolean(coveredBy),
        coveredBy,
      },
      form: {
        disabledFieldset,
        invalidFields,
      },
    };
  }`;
}

function createAnalyzeFormExpression(includeFieldDetails: boolean): string {
  return `(() => {
    const includeFieldDetails = ${includeFieldDetails ? "true" : "false"};
    ${createAnalyzeFormCollectorSource()}
    return collectForms(document.body, includeFieldDetails);
  })()`;
}

function createAnalyzeFormFunctionDeclaration(): string {
  return `function(includeFieldDetails) {
    ${createAnalyzeFormCollectorSource()}
    const form = this && this.tagName === "FORM" ? this : (this && this.closest ? this.closest("form") : null);
    return collectForms(form || this, includeFieldDetails === true);
  }`;
}

function createAnalyzeFormCollectorSource(): string {
  return `
    const compactText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const labelFor = (field) => {
      if (!field) return "";
      const id = field.id ? String(field.id) : "";
      const explicit = id ? document.querySelector("label[for=\\"" + CSS.escape(id) + "\\"]") : null;
      const wrapped = field.closest ? field.closest("label") : null;
      return compactText(
        field.getAttribute?.("aria-label") ||
        field.getAttribute?.("placeholder") ||
        explicit?.textContent ||
        wrapped?.textContent ||
        field.getAttribute?.("title") ||
        ""
      );
    };
    const fieldSummary = (field, index) => ({
      index,
      tagName: String(field.tagName || "").toUpperCase(),
      type: String(field.getAttribute?.("type") || field.type || "").toLowerCase(),
      name: String(field.getAttribute?.("name") || ""),
      label: labelFor(field),
      required: Boolean(field.required || field.getAttribute?.("aria-required") === "true"),
      disabled: Boolean(field.disabled || field.getAttribute?.("aria-disabled") === "true" || field.closest?.("fieldset[disabled]")),
      readonly: Boolean(field.readOnly || field.hasAttribute?.("readonly")),
      invalid: Boolean(field.matches?.(":invalid") || field.getAttribute?.("aria-invalid") === "true"),
      hasValue: field.type === "checkbox" || field.type === "radio" ? Boolean(field.checked) : Boolean(String(field.value || "").length),
    });
    const buttonSummary = (button) => ({
      text: compactText(button.innerText || button.textContent || button.value || button.getAttribute?.("aria-label") || ""),
      disabled: Boolean(button.disabled || button.getAttribute?.("aria-disabled") === "true"),
      type: String(button.getAttribute?.("type") || button.type || "submit").toLowerCase(),
    });
    const errorTexts = (root) => Array.from(root.querySelectorAll?.("[role=alert], .error, .invalid-feedback, .field-error, [aria-live]") || [])
      .map((item) => compactText(item.innerText || item.textContent))
      .filter(Boolean)
      .slice(0, 10);
    const formSummary = (form, index, includeFieldDetails) => {
      const fields = Array.from(form.querySelectorAll?.("input, textarea, select, button") || []);
      const fieldSummaries = fields.map((field, fieldIndex) => fieldSummary(field, fieldIndex + 1));
      const submitButtons = fields
        .filter((field) => {
          const tagName = String(field.tagName || "").toUpperCase();
          const type = String(field.getAttribute?.("type") || field.type || "").toLowerCase();
          return (tagName === "BUTTON" && (!type || type === "submit")) || (tagName === "INPUT" && (type === "submit" || type === "button"));
        })
        .map(buttonSummary)
        .slice(0, 5);
      return {
        index,
        id: String(form.id || ""),
        name: String(form.getAttribute?.("name") || ""),
        action: String(form.getAttribute?.("action") || form.action || ""),
        method: String(form.getAttribute?.("method") || form.method || "get").toLowerCase(),
        fieldCount: fieldSummaries.length,
        invalidFieldCount: fieldSummaries.filter((field) => field.invalid).length,
        disabledFieldCount: fieldSummaries.filter((field) => field.disabled).length,
        requiredFieldCount: fieldSummaries.filter((field) => field.required).length,
        submitButtons,
        errors: errorTexts(form),
        fields: includeFieldDetails ? fieldSummaries.slice(0, 30) : [],
      };
    };
    const collectForms = (root, includeFieldDetails) => {
      const scope = root || document;
      let forms = [];
      if (scope.tagName === "FORM") {
        forms = [scope];
      } else {
        forms = Array.from(scope.querySelectorAll?.("form") || []);
      }
      if (!forms.length && scope !== document && scope.querySelectorAll) {
        forms = [scope];
      }
      return { forms: forms.slice(0, 10).map((form, index) => formSummary(form, index + 1, includeFieldDetails)) };
    };
  `;
}

function createPerformanceSummaryExpression(): string {
  return `(() => {
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    const navigation = navigationEntry ? {
      type: String(navigationEntry.type || ""),
      startTime: Number(navigationEntry.startTime || 0),
      responseEnd: Number(navigationEntry.responseEnd || 0),
      domContentLoaded: Number(navigationEntry.domContentLoadedEventEnd || 0),
      load: Number(navigationEntry.loadEventEnd || 0),
      transferSize: Number(navigationEntry.transferSize || 0),
      encodedBodySize: Number(navigationEntry.encodedBodySize || 0),
      decodedBodySize: Number(navigationEntry.decodedBodySize || 0),
    } : undefined;
    const resources = performance.getEntriesByType("resource")
      .map((entry) => ({
        name: String(entry.name || ""),
        initiatorType: String(entry.initiatorType || "other"),
        duration: Number(entry.duration || 0),
        transferSize: Number(entry.transferSize || 0),
      }));
    const byTypeMap = new Map();
    for (const resource of resources) {
      const current = byTypeMap.get(resource.initiatorType) || { type: resource.initiatorType, count: 0, duration: 0, transferSize: 0 };
      current.count += 1;
      current.duration += resource.duration;
      current.transferSize += resource.transferSize;
      byTypeMap.set(resource.initiatorType, current);
    }
    const longTaskEntries = performance.getEntriesByType("longtask")
      .map((entry) => Number(entry.duration || 0))
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    return {
      navigation,
      resources: {
        totalCount: resources.length,
        byType: Array.from(byTypeMap.values()).sort((a, b) => b.duration - a.duration).slice(0, 10),
        slowest: resources.sort((a, b) => b.duration - a.duration).slice(0, 10),
      },
      longTasks: {
        count: longTaskEntries.length,
        maxDuration: longTaskEntries.length ? Math.max(...longTaskEntries) : 0,
        totalDuration: longTaskEntries.reduce((sum, duration) => sum + duration, 0),
      },
    };
  })()`;
}

function validateExtractContentArguments(toolCall: ModelToolCall): { ok: true; args: BrowserExtractContentArguments } | { ok: false; message: string } {
  const allowedKeys = ["mode", "source", "selectorType", "selector", "maxLength"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器内容提取工具不接受参数：${extraKeys.join("、")}。` };
  }

  const mode = toolCall.arguments.mode === undefined ? "text" : toolCall.arguments.mode;
  if (mode !== "text" && mode !== "html") {
    return { ok: false, message: "extract_content 的 mode 必须是 text 或 html。" };
  }

  const source = toolCall.arguments.source === undefined ? "auto_rule" : toolCall.arguments.source;
  if (source !== "auto_rule" && source !== "document" && source !== "selector") {
    return { ok: false, message: "extract_content 的 source 必须是 auto_rule、document 或 selector。" };
  }

  const selectorType = toolCall.arguments.selectorType;
  if (selectorType !== undefined && selectorType !== "css" && selectorType !== "xpath") {
    return { ok: false, message: "extract_content 的 selectorType 必须是 css 或 xpath。" };
  }

  const selector = typeof toolCall.arguments.selector === "string" ? toolCall.arguments.selector.trim() : "";
  if (source === "selector") {
    if (!selector) {
      return { ok: false, message: "extract_content 使用 selector 来源时必须提供非空 selector。" };
    }
    if (selectorType === undefined) {
      return { ok: false, message: "extract_content 使用 selector 来源时必须提供 selectorType。" };
    }
    if (selector.length > 2000) {
      return { ok: false, message: "extract_content 的 selector 不能超过 2000 个字符。" };
    }
    const selectorValidation = validateExtractionSelector(selector, selectorType);
    if (!selectorValidation.ok) {
      return { ok: false, message: "extract_content 的 selector 格式不正确。" };
    }
  } else {
    if (selectorType !== undefined || selector) {
      return { ok: false, message: "extract_content 只有 source=selector 时才允许携带 selectorType 或 selector。" };
    }
  }

  const maxLength = normalizeExtractContentMaxLength(toolCall.arguments.maxLength);
  if (!maxLength.ok) {
    return maxLength;
  }

  return {
    ok: true,
    args: {
      mode,
      source,
      ...(selectorType ? { selectorType } : {}),
      ...(selector ? { selector } : {}),
      maxLength: maxLength.value,
    },
  };
}

function normalizeExtractContentMaxLength(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: 30000 };
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 500 || value > 200000) {
    return { ok: false, message: "extract_content 的 maxLength 必须是 500 到 200000 的整数。" };
  }
  return { ok: true, value };
}

function createExtractContentRules(args: BrowserExtractContentArguments, extractionRules: ExtractionRule[]): ExtractionRule[] {
  if (args.source === "auto_rule") {
    return extractionRules;
  }

  if (args.source === "document") {
    return [];
  }

  return [{
    id: "tool-selector",
    alias: "工具临时选择器",
    urlPattern: ".*",
    selectorsText: args.selector ?? "",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }];
}

function formatExtractContentResult(response: Extract<PageContextExtractResponse, { ok: true }>, args: BrowserExtractContentArguments): string {
  const sourceLabel: Record<BrowserExtractContentSource, string> = {
    auto_rule: "提取规则",
    document: "全文",
    selector: args.selectorType === "xpath" ? "XPath 选择器" : "CSS 选择器",
  };
  const modeLabel: Record<BrowserExtractContentMode, string> = {
    text: "可见文本",
    html: "HTML",
  };
  const lines = [
    "页面内容提取结果：",
    `- 标题：${response.title?.trim() || "无标题"}`,
    `- URL：${redactPageStateUrl(response.url)}`,
    `- 模式：${modeLabel[args.mode]}`,
    `- 来源：${sourceLabel[args.source]}`,
    `- 使用回退：${response.usedFallback ? "是" : "否"}`,
    `- 已截断：${response.truncated ? "是" : "否"}`,
    response.matchedRuleId ? `- 命中规则 ID：${response.matchedRuleId}` : "",
    args.source === "selector" && args.selector ? `- 选择器：${args.selector}` : "",
    "",
    "## 提取内容",
    response.text || "未提取到内容。",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

function validateInspectElementArguments(toolCall: ModelToolCall): { ok: true } | { ok: false; message: string } {
  const allowedKeys = ["uid"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器元素检查工具不接受参数：${extraKeys.join("、")}。` };
  }

  if (typeof toolCall.arguments.uid !== "string" || !toolCall.arguments.uid.trim()) {
    return { ok: false, message: "inspect_element 需要非空 UID。" };
  }

  return { ok: true };
}

function validateInteractionBlockerArguments(toolCall: ModelToolCall): { ok: true; uid: string; expectedAction: BrowserInteractionExpectedAction } | { ok: false; message: string } {
  const allowedKeys = ["uid", "expectedAction"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器交互阻塞分析工具不接受参数：${extraKeys.join("、")}。` };
  }

  if (typeof toolCall.arguments.uid !== "string" || !toolCall.arguments.uid.trim()) {
    return { ok: false, message: "analyze_interaction_blocker 需要非空 UID。" };
  }

  const expectedAction = toolCall.arguments.expectedAction === undefined ? "click" : toolCall.arguments.expectedAction;
  if (expectedAction !== "click" && expectedAction !== "fill" && expectedAction !== "view") {
    return { ok: false, message: "analyze_interaction_blocker 的 expectedAction 必须是 click、fill 或 view。" };
  }

  return { ok: true, uid: toolCall.arguments.uid.trim(), expectedAction };
}

function validateAnalyzeFormArguments(toolCall: ModelToolCall): { ok: true; uid?: string; includeFieldDetails: boolean } | { ok: false; message: string } {
  const allowedKeys = ["uid", "includeFieldDetails"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器表单分析工具不接受参数：${extraKeys.join("、")}。` };
  }

  if (toolCall.arguments.uid !== undefined && (typeof toolCall.arguments.uid !== "string" || !toolCall.arguments.uid.trim())) {
    return { ok: false, message: "analyze_form 的 uid 必须是 take_snapshot 返回的非空 UID。" };
  }

  if (toolCall.arguments.includeFieldDetails !== undefined && typeof toolCall.arguments.includeFieldDetails !== "boolean") {
    return { ok: false, message: "analyze_form 的 includeFieldDetails 必须是布尔值。" };
  }

  return {
    ok: true,
    uid: typeof toolCall.arguments.uid === "string" ? toolCall.arguments.uid.trim() : undefined,
    includeFieldDetails: toolCall.arguments.includeFieldDetails === true,
  };
}

function validateFindElementsArguments(toolCall: ModelToolCall): { ok: true } | { ok: false; message: string } {
  const allowedKeys = ["query", "strategy", "limit"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器元素查找工具不接受参数：${extraKeys.join("、")}。` };
  }

  if (typeof toolCall.arguments.query !== "string" || !toolCall.arguments.query.trim()) {
    return { ok: false, message: "find_elements 的 query 必须是非空字符串。" };
  }

  if (toolCall.arguments.strategy !== undefined && !["text", "role", "label", "placeholder", "css"].includes(String(toolCall.arguments.strategy))) {
    return { ok: false, message: "find_elements 的 strategy 必须是 text、role、label、placeholder 或 css。" };
  }

  if (toolCall.arguments.limit !== undefined &&
    (typeof toolCall.arguments.limit !== "number" || !Number.isInteger(toolCall.arguments.limit) || toolCall.arguments.limit < 1 || toolCall.arguments.limit > 50)) {
    return { ok: false, message: "find_elements 的 limit 必须是 1 到 50 的整数。" };
  }

  if (toolCall.arguments.strategy === "css" && !isSimpleCssSelector(toolCall.arguments.query.trim())) {
    return { ok: false, message: "find_elements 的 CSS 查询只允许简单标签、类、ID 或单个属性选择器。" };
  }

  return { ok: true };
}

function validateScreenshotArguments(toolCall: ModelToolCall): { ok: true; target: BrowserScreenshotTarget; uid?: string } | { ok: false; message: string } {
  const allowedKeys = ["target", "uid"];
  const extraKeys = Object.keys(toolCall.arguments).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器截图工具不接受参数：${extraKeys.join("、")}。` };
  }

  const target = toolCall.arguments.target === undefined ? "viewport" : toolCall.arguments.target;
  if (target !== "viewport" && target !== "element") {
    return { ok: false, message: "screenshot 的 target 必须是 viewport 或 element。" };
  }

  const uid = typeof toolCall.arguments.uid === "string" ? toolCall.arguments.uid.trim() : "";
  if (target === "element" && !uid) {
    return { ok: false, message: "截取元素截图时必须提供 take_snapshot 返回的 UID。" };
  }

  return { ok: true, target, uid: uid || undefined };
}

function createBrowserScreenshotAttachment(
  toolCall: ModelToolCall,
  target: BrowserScreenshotTarget,
  response: unknown,
  uid?: string,
  clip?: BrowserScreenshotClip,
): NonNullable<ModelToolResult["toolAttachments"]>[number] {
  const data = normalizeScreenshotData(response);
  const dataUrl = `data:image/png;base64,${data}`;
  if (!isPngDataUrl(dataUrl)) {
    throw new Error("invalid_screenshot_data");
  }

  const byteSize = estimateBase64ByteSize(data);
  if (byteSize <= 0 || byteSize > BROWSER_SCREENSHOT_MAX_BYTES) {
    throw new Error("invalid_screenshot_size");
  }

  return {
    id: `tool-attachment-${toolCall.id}-screenshot`,
    kind: "browser-screenshot",
    title: "浏览器截图",
    summary: formatBrowserScreenshotSummary(target, byteSize, uid),
    sourceToolCallId: toolCall.id,
    createdAt: Date.now(),
    redacted: false,
    truncated: false,
    mediaType: "image/png",
    dataUrl,
    target,
    uid,
    byteSize,
    clip,
  };
}

function normalizeScreenshotData(response: unknown): string {
  if (!response || typeof response !== "object" || !("data" in response)) {
    throw new Error("invalid_screenshot_data");
  }
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "string" || !data.trim()) {
    throw new Error("invalid_screenshot_data");
  }
  return data.trim();
}

function normalizeScreenshotClip(response: unknown): BrowserScreenshotClip {
  if (!response || typeof response !== "object" || !("model" in response) || !response.model || typeof response.model !== "object") {
    throw new Error("invalid_screenshot_clip");
  }
  const model = response.model as { border?: unknown; padding?: unknown; content?: unknown };
  const quads = [model.border, model.padding, model.content]
    .filter((quad): quad is number[] => isScreenshotQuad(quad));
  if (!quads.length) {
    throw new Error("invalid_screenshot_clip");
  }

  const xs = quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]]);
  const ys = quads.flatMap((quad) => [quad[1], quad[3], quad[5], quad[7]]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width <= 0 || height <= 0) {
    throw new Error("invalid_screenshot_clip");
  }

  return { x, y, width, height, scale: 1 };
}

function isScreenshotQuad(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length >= 8 &&
    value.slice(0, 8).every((item) => typeof item === "number" && Number.isFinite(item));
}

function estimateBase64ByteSize(base64: string): number {
  const normalized = base64.replace(/\s+/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    return 0;
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function formatBrowserScreenshotSummary(target: BrowserScreenshotTarget, byteSize: number, uid?: string): string {
  return target === "element" && uid
    ? `元素 ${uid} 截图，PNG，${formatByteSize(byteSize)}。`
    : `当前视口截图，PNG，${formatByteSize(byteSize)}。`;
}

function formatByteSize(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${Math.round(kb * 10) / 10} KB`;
  }
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

function normalizeScreenshotError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("UID") || message.includes("旧快照") || message.includes("不存在")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }
  if (message.includes("已从页面中移除")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }
  return "浏览器截图结果无效，请重试。";
}

function normalizeFindElementStrategy(value: unknown): "text" | "role" | "label" | "placeholder" | "css" {
  return value === "role" || value === "label" || value === "placeholder" || value === "css" ? value : "text";
}

function normalizeFindElementLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 20;
}

function isSimpleCssSelector(value: string): boolean {
  if (value.length > 120 || /[\s>+~,*:]/.test(value)) {
    return false;
  }

  return /^[a-zA-Z][\w-]*$/.test(value) ||
    /^#[\w-]+$/.test(value) ||
    /^\.[\w-]+$/.test(value) ||
    /^\[[\w:-]+(?:=(?:"[^"]{1,80}"|'[^']{1,80}'|[\w.-]{1,80}))?\]$/.test(value);
}

function findElementsBySnapshot(
  candidates: BrowserSnapshotElementCandidate[],
  strategy: "text" | "role" | "label" | "placeholder",
  query: string,
  limit: number,
): BrowserSnapshotElementCandidate[] {
  const normalizedQuery = query.toLowerCase();
  return candidates.filter((candidate) => {
    const axNode = candidate.axNode;
    const role = getAxValue(axNode?.role);
    const name = getAxValue(axNode?.name);
    const value = getAxValue(axNode?.value);
    if (strategy === "role") {
      return role.toLowerCase().includes(normalizedQuery);
    }
    if (strategy === "label" || strategy === "placeholder") {
      return name.toLowerCase().includes(normalizedQuery);
    }
    return [role, name, value].some((item) => item.toLowerCase().includes(normalizedQuery));
  }).slice(0, limit);
}

function getResolvedObjectId(response: unknown): string | undefined {
  if (!response || typeof response !== "object" || !("object" in response) || !response.object || typeof response.object !== "object") {
    return undefined;
  }

  const object = response.object as { objectId?: unknown };
  return typeof object.objectId === "string" ? object.objectId : undefined;
}

function getRuntimeResultValue(response: unknown): unknown {
  if (!response || typeof response !== "object" || !("result" in response)) {
    return undefined;
  }
  const result = response.result;
  return result && typeof result === "object" && "value" in result ? result.value : undefined;
}

function normalizeElementInspection(response: unknown): BrowserElementInspection {
  const value = response && typeof response === "object" && "result" in response
    ? (response as { result?: { value?: unknown } }).result?.value
    : undefined;
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    tagName: typeof source.tagName === "string" ? source.tagName.toUpperCase() : "",
    id: typeof source.id === "string" ? source.id : "",
    className: typeof source.className === "string" ? source.className : "",
    text: typeof source.text === "string" ? source.text : "",
    attributes: normalizeElementAttributes(source.attributes),
    rect: normalizeNumericRecord(source.rect, ["x", "y", "width", "height"]),
    style: normalizeStringRecord(source.style, ["display", "visibility", "opacity", "pointerEvents", "cursor"]),
    state: normalizeBooleanRecord(source.state, ["visible", "disabled", "editable"]),
  };
}

function normalizeInteractionBlockerAnalysis(response: unknown): BrowserInteractionBlockerAnalysis {
  const value = response && typeof response === "object" && "result" in response
    ? (response as { result?: { value?: unknown } }).result?.value
    : undefined;
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const state = normalizeBooleanRecord(source.state, ["visible", "disabled", "editable", "connected", "inViewport", "occluded"]);
  const rawState = source.state && typeof source.state === "object" ? source.state as Record<string, unknown> : {};
  const rawForm = source.form && typeof source.form === "object" ? source.form as Record<string, unknown> : {};

  return {
    tagName: typeof source.tagName === "string" ? source.tagName.toUpperCase() : "",
    text: typeof source.text === "string" ? source.text : "",
    rect: normalizeNumericRecord(source.rect, ["x", "y", "width", "height"]),
    style: normalizeStringRecord(source.style, ["display", "visibility", "opacity", "pointerEvents", "cursor"]),
    state: {
      ...state,
      coveredBy: typeof rawState.coveredBy === "string" ? rawState.coveredBy : "",
    },
    form: {
      disabledFieldset: rawForm.disabledFieldset === true,
      invalidFields: typeof rawForm.invalidFields === "number" && Number.isFinite(rawForm.invalidFields) ? Math.max(0, Math.floor(rawForm.invalidFields)) : 0,
    },
  };
}

function normalizeFormAnalysis(response: unknown): BrowserFormAnalysis {
  const value = response && typeof response === "object" && "result" in response
    ? (response as { result?: { value?: unknown } }).result?.value
    : undefined;
  const source = value && typeof value === "object" ? value as { forms?: unknown } : {};
  const forms = Array.isArray(source.forms) ? source.forms : [];
  return {
    forms: forms.map((item, index) => normalizeFormAnalysisItem(item, index + 1)).slice(0, 10),
  };
}

function normalizePerformanceSummary(response: unknown): BrowserPerformanceSummary {
  const value = response && typeof response === "object" && "result" in response
    ? (response as { result?: { value?: unknown } }).result?.value
    : undefined;
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const resources = source.resources && typeof source.resources === "object" ? source.resources as Record<string, unknown> : {};
  const longTasks = source.longTasks && typeof source.longTasks === "object" ? source.longTasks as Record<string, unknown> : {};
  return {
    navigation: normalizePerformanceNavigation(source.navigation),
    resources: {
      totalCount: normalizeNonNegativeInteger(resources.totalCount),
      byType: Array.isArray(resources.byType) ? resources.byType.map(normalizePerformanceResourceType).slice(0, 10) : [],
      slowest: Array.isArray(resources.slowest) ? resources.slowest.map(normalizePerformanceSlowResource).slice(0, 10) : [],
    },
    longTasks: {
      count: normalizeNonNegativeInteger(longTasks.count),
      maxDuration: normalizeFiniteNumber(longTasks.maxDuration),
      totalDuration: normalizeFiniteNumber(longTasks.totalDuration),
    },
  };
}

function normalizePerformanceNavigation(value: unknown): BrowserPerformanceNavigationSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  return {
    type: typeof source.type === "string" ? source.type : "",
    startTime: normalizeFiniteNumber(source.startTime),
    responseEnd: normalizeFiniteNumber(source.responseEnd),
    domContentLoaded: normalizeFiniteNumber(source.domContentLoaded),
    load: normalizeFiniteNumber(source.load),
    transferSize: normalizeFiniteNumber(source.transferSize),
    encodedBodySize: normalizeFiniteNumber(source.encodedBodySize),
    decodedBodySize: normalizeFiniteNumber(source.decodedBodySize),
  };
}

function normalizePerformanceResourceType(value: unknown): BrowserPerformanceResourceTypeSummary {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    type: typeof source.type === "string" ? source.type : "other",
    count: normalizeNonNegativeInteger(source.count),
    duration: normalizeFiniteNumber(source.duration),
    transferSize: normalizeFiniteNumber(source.transferSize),
  };
}

function normalizePerformanceSlowResource(value: unknown): BrowserPerformanceSlowResource {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: typeof source.name === "string" ? source.name : "",
    initiatorType: typeof source.initiatorType === "string" ? source.initiatorType : "other",
    duration: normalizeFiniteNumber(source.duration),
    transferSize: normalizeFiniteNumber(source.transferSize),
  };
}

function normalizeFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatPerformanceSummary(summary: BrowserPerformanceSummary): string {
  return [
    "性能摘要：",
    formatPerformanceNavigation(summary.navigation),
    formatPerformanceTransfer(summary.navigation),
    `- 资源：总数=${summary.resources.totalCount}`,
    `- 资源类型：${formatPerformanceResourceTypes(summary.resources.byType)}`,
    `- 慢资源：${formatSlowResources(summary.resources.slowest)}`,
    `- 长任务：count=${summary.longTasks.count}，max=${formatDuration(summary.longTasks.maxDuration)}，total=${formatDuration(summary.longTasks.totalDuration)}`,
  ].join("\n");
}

function formatDiagnosticsNetworkSummary(requests: NetworkRequestMeta[]): string {
  const notableRequests = requests
    .filter((request) => request.failed === true || (request.status ?? 0) >= 400 || (request.durationMs ?? 0) >= 1000)
    .slice(-10);

  if (notableRequests.length === 0) {
    return requests.length > 0
      ? `最近 ${requests.length} 条 Network 请求中暂无错误或慢请求摘要。`
      : "暂无 Network 请求摘要。";
  }

  return [
    `最近 ${requests.length} 条 Network 请求中发现 ${notableRequests.length} 条错误或慢请求：`,
    ...notableRequests.map((request, index) => `${index + 1}. ${formatDiagnosticsNetworkRequest(request)}`),
  ].join("\n");
}

function formatDiagnosticsNetworkRequest(request: NetworkRequestMeta): string {
  const method = request.method || "GET";
  const status = request.failed ? "failed" : String(request.status ?? "pending");
  const duration = typeof request.durationMs === "number" ? formatDuration(request.durationMs) : "未知耗时";
  const type = request.resourceType || "other";
  const error = request.error ? ` error=${truncatePageStateText(redactPageStateText(request.error), 120)}` : "";
  return `${method} ${status} ${duration} ${type} ${redactPageStateUrl(request.url)}${error}`;
}

function formatPerformanceNavigation(navigation: BrowserPerformanceNavigationSummary | undefined): string {
  if (!navigation) {
    return "- 导航：无 Navigation Timing 数据";
  }
  return `- 导航：type=${navigation.type || "unknown"}，responseEnd=${formatDuration(navigation.responseEnd)}，domContentLoaded=${formatDuration(navigation.domContentLoaded)}，load=${formatDuration(navigation.load)}`;
}

function formatPerformanceTransfer(navigation: BrowserPerformanceNavigationSummary | undefined): string {
  if (!navigation) {
    return "- 传输：无";
  }
  return `- 传输：transfer=${formatByteSize(navigation.transferSize)}，encoded=${formatByteSize(navigation.encodedBodySize)}，decoded=${formatByteSize(navigation.decodedBodySize)}`;
}

function formatPerformanceResourceTypes(resources: BrowserPerformanceResourceTypeSummary[]): string {
  if (!resources.length) {
    return "无";
  }
  return resources
    .map((resource) => `${resource.type || "other"} count=${resource.count} duration=${formatDuration(resource.duration)} transfer=${formatByteSize(resource.transferSize)}`)
    .join("；");
}

function formatSlowResources(resources: BrowserPerformanceSlowResource[]): string {
  if (!resources.length) {
    return "无";
  }
  return resources
    .map((resource, index) => `${index + 1}. ${resource.initiatorType || "other"} ${formatDuration(resource.duration)} ${formatByteSize(resource.transferSize)} ${redactPageStateUrl(resource.name)}`)
    .join("；");
}

function formatDuration(value: number): string {
  return `${formatNumber(value)}ms`;
}

function normalizeFormAnalysisItem(value: unknown, fallbackIndex: number): BrowserFormAnalysisItem {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fields = Array.isArray(source.fields) ? source.fields : [];
  const submitButtons = Array.isArray(source.submitButtons) ? source.submitButtons : [];
  const errors = Array.isArray(source.errors) ? source.errors : [];
  return {
    index: normalizePositiveInteger(source.index, fallbackIndex),
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "",
    action: typeof source.action === "string" ? source.action : "",
    method: typeof source.method === "string" ? source.method.toLowerCase() : "",
    fieldCount: normalizeNonNegativeInteger(source.fieldCount),
    invalidFieldCount: normalizeNonNegativeInteger(source.invalidFieldCount),
    disabledFieldCount: normalizeNonNegativeInteger(source.disabledFieldCount),
    requiredFieldCount: normalizeNonNegativeInteger(source.requiredFieldCount),
    submitButtons: submitButtons.map(normalizeFormSubmitButton).slice(0, 5),
    errors: errors.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 10),
    fields: fields.map((item, index) => normalizeFormField(item, index + 1)).slice(0, 30),
  };
}

function normalizeFormField(value: unknown, fallbackIndex: number): BrowserFormAnalysisField {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    index: normalizePositiveInteger(source.index, fallbackIndex),
    tagName: typeof source.tagName === "string" ? source.tagName.toUpperCase() : "",
    type: typeof source.type === "string" ? source.type.toLowerCase() : "",
    name: typeof source.name === "string" ? source.name : "",
    label: typeof source.label === "string" ? source.label : "",
    required: source.required === true,
    disabled: source.disabled === true,
    readonly: source.readonly === true,
    invalid: source.invalid === true,
    hasValue: source.hasValue === true,
  };
}

function normalizeFormSubmitButton(value: unknown): BrowserFormAnalysisSubmitButton {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    text: typeof source.text === "string" ? source.text : "",
    disabled: source.disabled === true,
    type: typeof source.type === "string" ? source.type.toLowerCase() : "",
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function formatFormAnalysis(analysis: BrowserFormAnalysis, includeFieldDetails: boolean): string {
  if (!analysis.forms.length) {
    return "表单分析：未发现表单或可分析的表单字段。";
  }

  return [
    "表单分析：",
    `共 ${analysis.forms.length} 个表单。`,
    ...analysis.forms.flatMap((form) => formatFormAnalysisItem(form, includeFieldDetails)),
  ].join("\n");
}

function formatFormAnalysisItem(form: BrowserFormAnalysisItem, includeFieldDetails: boolean): string[] {
  const lines = [
    `${form.index}. ${formatFormIdentity(form)} method=${form.method || "unknown"} action=${form.action ? redactPageStateUrl(form.action) : "无"}`,
    `- 字段：总数=${form.fieldCount}，必填=${form.requiredFieldCount}，非法=${form.invalidFieldCount}，禁用=${form.disabledFieldCount}`,
    `- 提交按钮：${formatSubmitButtons(form.submitButtons)}`,
    `- 错误文案：${formatFormErrors(form.errors)}`,
  ];

  if (includeFieldDetails && form.fields.length) {
    lines.push("字段详情：");
    lines.push(...form.fields.map(formatFormField));
  }

  return lines;
}

function formatFormIdentity(form: BrowserFormAnalysisItem): string {
  const id = form.id ? `#${truncatePageStateText(redactPageStateText(form.id), 80)}` : "";
  const name = form.name ? `[name="${truncatePageStateText(redactPageStateText(form.name), ELEMENT_INSPECTION_MAX_TEXT_LENGTH).replace(/"/g, "&quot;")}"]` : "";
  return `FORM${id}${name}`;
}

function formatSubmitButtons(buttons: BrowserFormAnalysisSubmitButton[]): string {
  if (!buttons.length) {
    return "无";
  }
  return buttons
    .map((button) => {
      const text = truncatePageStateText(redactPageStateText(button.text || "无文本"), ELEMENT_INSPECTION_MAX_TEXT_LENGTH);
      return `${text} disabled=${button.disabled} type=${button.type || "unknown"}`;
    })
    .join("；");
}

function formatFormErrors(errors: string[]): string {
  if (!errors.length) {
    return "无";
  }
  return errors
    .map((error) => truncatePageStateText(redactPageStateText(error), ELEMENT_INSPECTION_MAX_TEXT_LENGTH))
    .join("；");
}

function formatFormField(field: BrowserFormAnalysisField): string {
  const tagName = field.tagName || "UNKNOWN";
  const type = field.type ? `[type=${truncatePageStateText(redactPageStateText(field.type), 80)}]` : "";
  const name = field.name ? `[name="${truncatePageStateText(redactPageStateText(field.name), 80).replace(/"/g, "&quot;")}"]` : "";
  const label = truncatePageStateText(redactPageStateText(field.label || "无"), ELEMENT_INSPECTION_MAX_TEXT_LENGTH);
  return `${field.index}. ${tagName}${type}${name} label=${label} required=${field.required} disabled=${field.disabled} readonly=${field.readonly} invalid=${field.invalid} hasValue=${field.hasValue}`;
}

function formatInteractionBlockerAnalysis(
  uid: string,
  expectedAction: BrowserInteractionExpectedAction,
  axNode: AccessibilityNode | undefined,
  analysis: BrowserInteractionBlockerAnalysis,
): string {
  const reasons = collectInteractionBlockerReasons(expectedAction, analysis);
  return [
    "交互阻塞分析：",
    `- UID：${uid}`,
    `- 预期动作：${expectedAction}`,
    `- AX：${formatElementAxSummary(axNode)}`,
    `- DOM：${analysis.tagName || "UNKNOWN"}`,
    `- 文本：${truncatePageStateText(redactPageStateText(analysis.text || "无"), ELEMENT_INSPECTION_MAX_TEXT_LENGTH)}`,
    `- 布局：x=${formatNumber(analysis.rect?.x)}，y=${formatNumber(analysis.rect?.y)}，width=${formatNumber(analysis.rect?.width)}，height=${formatNumber(analysis.rect?.height)}`,
    `- 样式：display=${analysis.style?.display || "unknown"}，visibility=${analysis.style?.visibility || "unknown"}，opacity=${analysis.style?.opacity || "unknown"}，pointerEvents=${analysis.style?.pointerEvents || "unknown"}，cursor=${analysis.style?.cursor || "unknown"}`,
    `- 状态：visible=${formatBoolean(analysis.state?.visible)}，disabled=${formatBoolean(analysis.state?.disabled)}，editable=${formatBoolean(analysis.state?.editable)}，connected=${formatBoolean(analysis.state?.connected)}，inViewport=${formatBoolean(analysis.state?.inViewport)}，occluded=${formatBoolean(analysis.state?.occluded)}`,
    `- 阻塞原因：${reasons.length ? reasons.join("；") : "未发现常见交互阻塞原因"}`,
    `- 建议：${formatInteractionBlockerAdvice(expectedAction, reasons.length > 0)}`,
  ].join("\n");
}

function collectInteractionBlockerReasons(expectedAction: BrowserInteractionExpectedAction, analysis: BrowserInteractionBlockerAnalysis): string[] {
  const reasons: string[] = [];
  const state = analysis.state;
  if (state?.connected === false) {
    reasons.push("元素已脱离当前文档");
  }
  if (state?.visible === false) {
    reasons.push("元素不可见或尺寸为 0");
  }
  if (state?.inViewport === false) {
    reasons.push("元素不在当前视口内");
  }
  if (state?.disabled === true) {
    reasons.push("元素禁用");
  }
  if (analysis.style?.pointerEvents === "none") {
    reasons.push("元素 pointer-events 为 none");
  }
  if (state?.occluded === true) {
    const coveredBy = state.coveredBy ? truncatePageStateText(redactPageStateText(state.coveredBy), ELEMENT_INSPECTION_MAX_TEXT_LENGTH) : "其他元素";
    reasons.push(`元素被 ${coveredBy} 遮挡`);
  }
  if (analysis.form?.disabledFieldset === true) {
    reasons.push("元素位于禁用的 fieldset 内");
  }
  if (expectedAction === "fill" && state?.editable === false) {
    reasons.push("目标元素不可编辑");
  }
  if ((expectedAction === "click" || expectedAction === "fill") && analysis.form?.invalidFields && analysis.form.invalidFields > 0) {
    reasons.push(`表单存在 ${analysis.form.invalidFields} 个非法字段`);
  }
  return reasons;
}

function formatInteractionBlockerAdvice(expectedAction: BrowserInteractionExpectedAction, hasBlocker: boolean): string {
  if (!hasBlocker) {
    return "可先重新 take_snapshot 或 screenshot 核对页面状态；若仍失败，再结合 Console 与 Network 诊断。";
  }
  if (expectedAction === "view") {
    return "先滚动、等待元素可见或检查遮罩层状态，再重新观察页面；不要直接改 DOM 或强制触发脚本。";
  }
  if (expectedAction === "fill") {
    return "先检查字段可编辑性、禁用条件、表单校验或遮罩层状态，再重新观察页面；不要直接改 DOM 或强制触发脚本。";
  }
  return "先检查表单必填项、禁用条件或遮罩层状态，再重新观察页面；不要直接改 DOM 或强制触发脚本。";
}

function normalizeElementAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const [key, attributeValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof attributeValue === "string") {
      attributes[key] = attributeValue;
    }
  }
  return attributes;
}

function normalizeStringRecord<T extends string>(value: unknown, keys: T[]): Partial<Record<T, string>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, typeof source[key] === "string" ? source[key] : undefined])) as Partial<Record<T, string>>;
}

function normalizeBooleanRecord<T extends string>(value: unknown, keys: T[]): Partial<Record<T, boolean>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, typeof source[key] === "boolean" ? source[key] : undefined])) as Partial<Record<T, boolean>>;
}

function formatElementInspection(uid: string, axNode: AccessibilityNode | undefined, inspection: BrowserElementInspection): string {
  return [
    "元素检查：",
    `- UID：${uid}`,
    `- AX：${formatElementAxSummary(axNode)}`,
    `- DOM：${formatElementDomSummary(inspection)}`,
    `- 文本：${truncatePageStateText(redactPageStateText(inspection.text || "无"), ELEMENT_INSPECTION_MAX_TEXT_LENGTH)}`,
    `- 布局：x=${formatNumber(inspection.rect?.x)}，y=${formatNumber(inspection.rect?.y)}，width=${formatNumber(inspection.rect?.width)}，height=${formatNumber(inspection.rect?.height)}`,
    `- 样式：display=${inspection.style?.display || "unknown"}，visibility=${inspection.style?.visibility || "unknown"}，opacity=${inspection.style?.opacity || "unknown"}，pointerEvents=${inspection.style?.pointerEvents || "unknown"}，cursor=${inspection.style?.cursor || "unknown"}`,
    `- 状态：visible=${formatBoolean(inspection.state?.visible)}，disabled=${formatBoolean(inspection.state?.disabled)}，editable=${formatBoolean(inspection.state?.editable)}`,
  ].join("\n");
}

function formatFindElementsResult(candidates: BrowserSnapshotElementCandidate[]): string {
  if (!candidates.length) {
    return "元素查找结果：未找到匹配候选。请调整查询词或重新调用 take_snapshot。";
  }

  return [
    `元素查找结果：共 ${candidates.length} 个候选。`,
    ...candidates.map((candidate, index) => `${index + 1}. uid=${candidate.uid} ${formatElementAxSummary(candidate.axNode)}`),
  ].join("\n");
}

function formatElementAxSummary(node: AccessibilityNode | undefined): string {
  if (!node) {
    return "无快照节点摘要";
  }

  const parts: string[] = [];
  const role = getAxValue(node.role);
  const name = getAxValue(node.name);
  const value = getAxValue(node.value);
  if (role) {
    parts.push(`role=${redactPageStateText(role)}`);
  }
  if (name) {
    parts.push(`name=${truncatePageStateText(redactPageStateText(name), ELEMENT_INSPECTION_MAX_TEXT_LENGTH)}`);
  }
  if (value && value !== name) {
    parts.push(`value=${truncatePageStateText(redactPageStateText(value), ELEMENT_INSPECTION_MAX_TEXT_LENGTH)}`);
  }
  for (const property of node.properties ?? []) {
    if (!property.name || !["checked", "disabled", "expanded", "selected", "focused", "required"].includes(property.name)) {
      continue;
    }
    const propertyValue = getAxValue(property.value);
    if (propertyValue) {
      parts.push(`${property.name}=${redactPageStateText(propertyValue)}`);
    }
  }
  return parts.join("，") || "无快照节点摘要";
}

function formatElementDomSummary(inspection: BrowserElementInspection): string {
  const tagName = inspection.tagName || "UNKNOWN";
  const id = inspection.id ? `#${sanitizeDomToken(inspection.id)}` : "";
  const classes = inspection.className
    .split(/\s+/)
    .map((item) => sanitizeDomToken(item))
    .filter(Boolean)
    .map((item) => `.${item}`)
    .join("");
  const attributes = Object.entries(inspection.attributes)
    .map(([name, value]) => `${name}="${formatElementAttributeValue(name, value)}"`);
  return [tagName + id + classes, ...attributes].join(" ");
}

function sanitizeDomToken(value: string): string {
  return truncatePageStateText(redactPageStateText(value), 80).replace(/\s+/g, "-");
}

function formatElementAttributeValue(name: string, value: string): string {
  const redacted = /^(href|src|action)$/i.test(name) ? redactPageStateUrl(value) : redactPageStateText(value);
  return truncatePageStateText(redacted, ELEMENT_INSPECTION_MAX_TEXT_LENGTH).replace(/"/g, "&quot;");
}

function formatBoolean(value: unknown): string {
  return typeof value === "boolean" ? String(value) : "unknown";
}

function normalizeInspectElementError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("UID") || message.includes("旧快照") || message.includes("不存在")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }
  if (message.includes("已从页面中移除")) {
    return message;
  }

  return "检查元素失败，请确认当前页面仍可访问后重试。";
}

function normalizeInteractionBlockerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("UID") || message.includes("旧快照") || message.includes("不存在")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }
  if (message.includes("已从页面中移除")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }

  return "交互阻塞分析失败，请确认当前页面仍可访问后重试。";
}

function normalizeAnalyzeFormError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("UID") || message.includes("旧快照") || message.includes("不存在")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }
  if (message.includes("已从页面中移除")) {
    return `${message} 请重新调用 take_snapshot 获取最新页面状态后再继续。`;
  }

  return "表单分析失败，请确认当前页面仍可访问后重试。";
}

function normalizePageRuntimeState(response: unknown): BrowserPageRuntimeState {
  const value = response && typeof response === "object" && "result" in response
    ? (response as { result?: { value?: unknown } }).result?.value
    : undefined;
  if (!value || typeof value !== "object") {
    return { url: "", title: "", readyState: "" };
  }

  const source = value as BrowserPageRuntimeState;
  return {
    url: typeof source.url === "string" ? source.url : "",
    title: typeof source.title === "string" ? source.title : "",
    readyState: typeof source.readyState === "string" ? source.readyState : "",
    viewport: normalizeNumericRecord(source.viewport, ["width", "height", "deviceScaleFactor"]),
    scroll: normalizeNumericRecord(source.scroll, ["x", "y", "maxX", "maxY"]),
    focusedElement: normalizeFocusedElement(source.focusedElement),
  };
}

function normalizeNumericRecord<T extends string>(value: unknown, keys: T[]): Partial<Record<T, number>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, typeof source[key] === "number" && Number.isFinite(source[key]) ? source[key] : undefined])) as Partial<Record<T, number>>;
}

function normalizeFocusedElement(value: unknown): BrowserPageRuntimeState["focusedElement"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return {
    tagName: typeof source.tagName === "string" ? source.tagName.toUpperCase() : "",
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "",
    type: typeof source.type === "string" ? source.type : "",
    text: typeof source.text === "string" ? truncatePageStateText(redactPageStateText(source.text)) : "",
  };
}

function formatPageState(state: BrowserPageRuntimeState): string {
  const viewport = state.viewport;
  const scroll = state.scroll;
  return [
    "页面状态：",
    `- 标题：${truncatePageStateText(redactPageStateText(state.title || "无标题"))}`,
    `- URL：${redactPageStateUrl(state.url || "")}`,
    `- readyState：${state.readyState || "unknown"}`,
    `- viewport：${formatNumber(viewport?.width)}x${formatNumber(viewport?.height)}，deviceScaleFactor=${formatNumber(viewport?.deviceScaleFactor)}`,
    `- scroll：x=${formatNumber(scroll?.x)}，y=${formatNumber(scroll?.y)}，maxX=${formatNumber(scroll?.maxX)}，maxY=${formatNumber(scroll?.maxY)}`,
    `- 焦点元素：${formatFocusedElement(state.focusedElement)}`,
  ].join("\n");
}

function formatFocusedElement(element: BrowserPageRuntimeState["focusedElement"]): string {
  if (!element?.tagName) {
    return "无";
  }

  const id = element.id ? `#${truncatePageStateText(redactPageStateText(element.id))}` : "";
  const name = element.name ? `[name="${truncatePageStateText(redactPageStateText(element.name))}"]` : "";
  const type = element.type ? `[type="${truncatePageStateText(redactPageStateText(element.type))}"]` : "";
  const text = element.text ? ` ${element.text}` : "";
  return `${element.tagName}${id}${name}${type}${text}`;
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "unknown";
}

function redactPageStateUrl(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitivePageStateName(key)) {
        url.searchParams.set(key, "[已脱敏]");
      }
    }
    return truncatePageStateText(url.toString().replace(/%5B%E5%B7%B2%E8%84%B1%E6%95%8F%5D/g, "[已脱敏]"), 500);
  } catch {
    return truncatePageStateText(redactPageStateText(value), 500);
  }
}

function redactPageStateText(value: string): string {
  return value.replace(/\b(token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|session|csrf|xsrf)\b\s*[:=]\s*["']?[^"'\s;,}]+/gi, "$1=[已脱敏]");
}

function isSensitivePageStateName(value: string): boolean {
  return /(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|code|csrf|xsrf)/i.test(value);
}

function truncatePageStateText(value: string, maxLength = PAGE_STATE_MAX_TEXT_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
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

function isNetworkDetailLikeToolCall(toolCall: ModelToolCall): boolean {
  return [
    NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
    NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
    NETWORK_COMPARE_REQUESTS_TOOL_ID,
    NETWORK_COMPARE_REQUESTS_TOOL_NAME,
    NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
    NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
    NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
    NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  ].includes(toolCall.name);
}

function isReplaySendToolCall(toolCall: ModelToolCall): boolean {
  return toolCall.name === REPLAY_SEND_REQUEST_TOOL_ID || toolCall.name === REPLAY_SEND_REQUEST_TOOL_NAME;
}

function createExpandedRuntimeToolCall(toolCall: ModelToolCall): ModelToolCall {
  if (toolCall.name === RUNTIME_INSPECT_GLOBALS_TOOL_NAME) {
    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        maxDepth: Math.max(typeof toolCall.arguments.maxDepth === "number" ? toolCall.arguments.maxDepth : 0, 4),
        limit: Math.max(typeof toolCall.arguments.limit === "number" ? toolCall.arguments.limit : 0, 30),
      },
    };
  }

  if (toolCall.name === RUNTIME_SEARCH_MODULES_TOOL_NAME) {
    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        limit: Math.max(typeof toolCall.arguments.limit === "number" ? toolCall.arguments.limit : 0, 20),
        radius: Math.max(typeof toolCall.arguments.radius === "number" ? toolCall.arguments.radius : 0, 500),
      },
    };
  }

  if (toolCall.name === RUNTIME_DESCRIBE_FUNCTION_TOOL_NAME) {
    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        radius: Math.max(typeof toolCall.arguments.radius === "number" ? toolCall.arguments.radius : 0, 1000),
      },
    };
  }

  return toolCall;
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
  if (message.type === BROWSER_CONTROL_SET_AUTOMATION_MODE_MESSAGE_TYPE) {
    return manager.setAutomationMode(message.mode, message.reason);
  }

  if (message.type === BROWSER_CONTROL_BOUNDARY_CHOICE_RESPOND_MESSAGE_TYPE) {
    const ok = manager.respondBoundaryChoice(message.requestId, {
      selectedChoiceIds: message.selectedChoiceIds,
      otherText: message.otherText,
    });
    return ok
      ? { ok: true, attached: true, message: "已提交边界确认选择。" }
      : { ok: false, message: "边界确认请求不存在或已过期。" };
  }

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

