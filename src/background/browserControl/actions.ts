import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";

export interface BrowserControlCommandConnection {
  resolveNodeByBackendId(backendNodeId: number): Promise<unknown>;
  scrollIntoViewIfNeeded(objectId: string): Promise<unknown>;
  getBoxModel(backendNodeId: number): Promise<unknown>;
  callFunctionOn(params: Record<string, unknown>): Promise<unknown>;
  evaluate(params: Record<string, unknown>): Promise<unknown>;
  dispatchMouseEvent(params: Record<string, unknown>): Promise<unknown>;
  dispatchKeyEvent(params: Record<string, unknown>): Promise<unknown>;
  insertText(text: string): Promise<unknown>;
}

export interface BrowserControlActionSnapshot {
  getBackendNodeId(uid: string): number;
  takeSnapshot(): Promise<string>;
}

export interface BrowserControlActionOptions {
  waitForNetworkIdle?: (options: { timeoutMs?: number }) => Promise<{ ok: true; idleMs: number } | { ok: false; message: string }>;
}

type BrowserControlActionName = "click" | "fill" | "press_key" | "wait_for" | "wait_for_state" | "scroll" | "hover" | "double_click" | "context_click" | "drag";
type ScrollDirection = "up" | "down" | "left" | "right" | "top" | "bottom";
type WaitForStateName = "url_contains" | "ready_state" | "element_visible" | "element_hidden" | "network_idle";

interface ElementInfo {
  tagName: string;
  type: string;
  role: string;
  isContentEditable: boolean;
}

const BROWSER_ACTION_DISABLED_MESSAGE = "浏览器控制未开启，无法执行浏览器操作。请先在顶部浏览器控制按钮中显式开启。";
const RETAKE_SNAPSHOT_MESSAGE = "请重新调用 take_snapshot 获取最新页面状态后再继续。";
const INCLUDE_SNAPSHOT_ERROR_SUFFIX = ` ${RETAKE_SNAPSHOT_MESSAGE}`;
const WAIT_FOR_DEFAULT_TIMEOUT_MS = 5000;
const WAIT_FOR_MAX_TIMEOUT_MS = 30000;
const SCROLL_DEFAULT_AMOUNT = 800;
const SCROLL_MAX_AMOUNT = 5000;
const DRAG_MAX_DELTA = 2000;
const SAFE_CLICK_OCCLUDED_ERROR = "元素当前被遮挡，无法安全点击。";
const MODIFIER_BITS = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
} as const;
const MODIFIER_ALIASES: Record<string, keyof typeof MODIFIER_BITS> = {
  Ctrl: "Control",
  Cmd: "Meta",
  Command: "Meta",
  Option: "Alt",
};

export function isBrowserControlActionName(name: string): name is BrowserControlActionName {
  return name === "click" || name === "fill" || name === "press_key" || name === "wait_for" || name === "wait_for_state" || name === "scroll" || name === "hover" || name === "double_click" || name === "context_click" || name === "drag";
}

export function createBrowserActionDisabledResult(toolCall: ModelToolCall): ModelToolResult {
  return createBrowserActionErrorResult(toolCall, BROWSER_ACTION_DISABLED_MESSAGE);
}

export function createBrowserActionErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

export class BrowserControlActionExecutor {
  constructor(
    private readonly connection: BrowserControlCommandConnection,
    private readonly snapshot: BrowserControlActionSnapshot,
    private readonly options: BrowserControlActionOptions = {},
  ) {}

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!isBrowserControlActionName(toolCall.name)) {
      return createBrowserActionErrorResult(toolCall, `未知的浏览器操作工具：${toolCall.name}。`);
    }

    const validation = validateArguments(toolCall);
    if (!validation.ok) {
      return createBrowserActionErrorResult(toolCall, validation.message);
    }

    try {
      const content = await this.executeAction(toolCall.name, toolCall.arguments);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content,
      };
    } catch (error) {
      return createBrowserActionErrorResult(toolCall, normalizeActionError(error, Boolean(toolCall.arguments.includeSnapshot)));
    }
  }

  private async executeAction(name: BrowserControlActionName, args: Record<string, unknown>): Promise<string> {
    if (name === "click") {
      return this.click(String(args.uid));
    }
    if (name === "fill") {
      return this.fill(String(args.uid), String(args.value));
    }
    if (name === "press_key") {
      return this.pressKey(String(args.key));
    }
    if (name === "scroll") {
      return this.scroll(String(args.direction), args.amount, typeof args.uid === "string" ? args.uid : undefined);
    }
    if (name === "hover") {
      return this.hover(String(args.uid));
    }
    if (name === "double_click") {
      return this.doubleClick(String(args.uid));
    }
    if (name === "context_click") {
      return this.contextClick(String(args.uid));
    }
    if (name === "wait_for_state") {
      return this.waitForState(String(args.state), args.value, args.uid, args.timeout);
    }
    if (name === "drag") {
      return this.drag(args);
    }

    return this.waitFor(args.text, args.timeout);
  }

  private async click(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);

    try {
      const { x, y } = await this.getElementCenter(objectId, backendNodeId);
      const hitTest = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: `function(x, y) {
          const hitElement = document.elementFromPoint(x, y);
          if (!hitElement) return false;
          return this.contains(hitElement) || hitElement.contains(this);
        }`,
        arguments: [{ value: x }, { value: y }],
        returnByValue: true,
      });
      if (getResultValue(hitTest) === false) {
        throw new Error(SAFE_CLICK_OCCLUDED_ERROR);
      }

      await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
      await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    } catch (error) {
      if (error instanceof Error && error.message === SAFE_CLICK_OCCLUDED_ERROR) {
        throw error;
      }

      await this.connection.callFunctionOn({
        objectId,
        // 这里是固定的受控 fallback，只允许补发鼠标事件和聚焦；不要扩展为模型可控脚本入口。
        functionDeclaration: `function() {
          this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          const rect = this.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
            this.dispatchEvent(new MouseEvent(type, {
              view: window,
              bubbles: true,
              cancelable: true,
              composed: true,
              buttons: 1,
              clientX: x,
              clientY: y,
            }));
          }
          if (typeof this.focus === "function") this.focus();
        }`,
        userGesture: true,
      });
    }

    return `已点击元素 ${uid}。`;
  }

  private async hover(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    return `已悬停元素 ${uid}。`;
  }

  private async doubleClick(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 2 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 2 });
    return `已双击元素 ${uid}。`;
  }

  private async contextClick(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "right", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "right", clickCount: 1 });
    return `已右键元素 ${uid}。`;
  }

  private async drag(args: Record<string, unknown>): Promise<string> {
    const sourceUid = String(args.sourceUid);
    const source = await this.getElementPoint(sourceUid);
    let target: { x: number; y: number };
    let resultText: string;

    if (typeof args.targetUid === "string" && args.targetUid.trim()) {
      target = await this.getElementPoint(args.targetUid);
      resultText = `已将元素 ${sourceUid} 拖拽到元素 ${args.targetUid}。`;
    } else {
      const deltaX = Number(args.deltaX);
      const deltaY = Number(args.deltaY);
      target = { x: source.x + deltaX, y: source.y + deltaY };
      resultText = `已将元素 ${sourceUid} 拖拽偏移 x=${deltaX}，y=${deltaY}。`;
    }

    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x: source.x, y: source.y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x: source.x, y: source.y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({
      type: "mouseMoved",
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
      button: "left",
      buttons: 1,
    });
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x: target.x, y: target.y, button: "left", buttons: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
    return resultText;
  }

  private async fill(uid: string, value: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const info = await this.getElementInfo(objectId);

    if (info.tagName === "SELECT") {
      await this.fillSelect(objectId, value);
      return `已填写元素 ${uid}。`;
    }

    if (isToggleElement(info)) {
      await this.fillToggle(objectId, value);
      return `已填写元素 ${uid}。`;
    }

    await this.fillTextInput(objectId, value);
    return `已填写元素 ${uid}。`;
  }

  private async pressKey(key: string): Promise<string> {
    const tokens = parseKeyTokens(key);
    const mainKey = tokens[tokens.length - 1];
    const modifiers = tokens.slice(0, -1);
    const mainDefinition = getKeyDefinition(mainKey, 0);
    if (!mainDefinition) {
      throw new Error(`按键 ${key} 不在允许列表中。`);
    }

    for (const modifier of modifiers) {
      if (!(modifier in MODIFIER_BITS)) {
        throw new Error(`修饰键 ${modifier} 不在允许列表中。`);
      }
    }

    let modifierBits = 0;

    try {
      for (const modifier of modifiers) {
        modifierBits |= MODIFIER_BITS[modifier as keyof typeof MODIFIER_BITS];
        await this.connection.dispatchKeyEvent({
          type: "keyDown",
          ...getKeyDefinition(modifier, modifierBits),
        });
      }

      const modifiedMainDefinition = getKeyDefinition(mainKey, modifierBits);
      await this.connection.dispatchKeyEvent({ type: "keyDown", ...modifiedMainDefinition });
      await this.connection.dispatchKeyEvent({ type: "keyUp", ...modifiedMainDefinition });
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        if (!(modifier in MODIFIER_BITS)) {
          continue;
        }
        modifierBits &= ~MODIFIER_BITS[modifier as keyof typeof MODIFIER_BITS];
        await this.connection.dispatchKeyEvent({
          type: "keyUp",
          ...getKeyDefinition(modifier, modifierBits),
        });
      }
    }

    return `已按下按键 ${key}。`;
  }

  private async waitFor(text: unknown, timeout: unknown): Promise<string> {
    const targets = normalizeWaitForTargets(text);
    if (!targets.length) {
      throw new Error("wait_for 的 text 必须包含至少一个非空文本。");
    }

    const timeoutMs = normalizeTimeout(timeout);
    const response = await this.connection.evaluate({
      expression: createWaitForExpression(targets, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    const matchedText = getResultValue(response);
    if (typeof matchedText === "string" && matchedText) {
      return `已等待到页面文本：${matchedText}。`;
    }

    throw new Error(`等待页面文本超时：${targets.join("、")}。`);
  }

  private async waitForState(state: string, value: unknown, uid: unknown, timeout: unknown): Promise<string> {
    const normalizedState = state as WaitForStateName;
    const timeoutMs = normalizeTimeout(timeout);
    if (normalizedState === "network_idle") {
      if (!this.options.waitForNetworkIdle) {
        throw new Error("Network 采集未开启，无法等待 Network 空闲。");
      }
      const result = await this.options.waitForNetworkIdle({ timeoutMs });
      if (result.ok) {
        return "已等待到页面状态：network_idle。";
      }
      throw new Error(result.message);
    }
    if (normalizedState === "element_visible" || normalizedState === "element_hidden") {
      const normalizedUid = String(uid);
      const objectId = await this.getObjectIdFromUid(normalizedUid);
      const response = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createWaitForElementStateFunctionDeclaration(),
        arguments: [{ value: normalizedState }, { value: timeoutMs }],
        returnByValue: true,
        awaitPromise: true,
      });
      const result = normalizeWaitForStateResult(getResultValue(response));
      if (result.matched) {
        return `已等待到页面状态：${normalizedState}=${normalizedUid}。`;
      }
      throw new Error(`等待页面状态超时：${normalizedState}=${normalizedUid}。`);
    }

    const targetValue = String(value);
    const response = await this.connection.evaluate({
      expression: createWaitForPageStateExpression(normalizedState, targetValue, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    const result = normalizeWaitForStateResult(getResultValue(response));
    if (result.matched) {
      return `已等待到页面状态：${normalizedState}=${targetValue}。`;
    }
    throw new Error(`等待页面状态超时：${normalizedState}=${targetValue}。`);
  }

  private async scroll(direction: string, amount: unknown, uid?: string): Promise<string> {
    const normalizedDirection = direction as ScrollDirection;
    const normalizedAmount = normalizeScrollAmount(amount);
    const normalizedUid = uid?.trim();
    if (normalizedUid) {
      const objectId = await this.getObjectIdFromUid(normalizedUid);
      const response = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createElementScrollFunctionDeclaration(),
        arguments: [{ value: normalizedDirection }, { value: normalizedAmount }],
        returnByValue: true,
      });
      if (getResultValue(response) !== true) {
        throw new Error(`元素 ${normalizedUid} 不支持滚动。`);
      }
      return formatElementScrollResult(normalizedUid, normalizedDirection, normalizedAmount);
    }

    const response = await this.connection.evaluate({
      expression: createViewportScrollExpression(normalizedDirection, normalizedAmount),
      awaitPromise: true,
      returnByValue: true,
    });
    if (getResultValue(response) !== true) {
      throw new Error("页面视口滚动失败，请确认当前页面仍可访问后重试。");
    }
    return formatViewportScrollResult(normalizedDirection, normalizedAmount);
  }

  private async getObjectIdFromUid(uid: string): Promise<string> {
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const response = await this.connection.resolveNodeByBackendId(backendNodeId);
    const object = getObject(response);
    if (!object?.objectId) {
      throw new Error(`元素 ${uid} 已从页面中移除。`);
    }

    return object.objectId;
  }

  private async getElementCenter(objectId: string, backendNodeId: number): Promise<{ x: number; y: number }> {
    await this.connection.scrollIntoViewIfNeeded(objectId);
    const response = await this.connection.getBoxModel(backendNodeId);
    const model = getBoxModel(response);
    if (!model?.content || model.content.length < 8) {
      throw new Error("无法读取元素布局。");
    }

    return {
      x: (model.content[0] + model.content[4]) / 2,
      y: (model.content[1] + model.content[5]) / 2,
    };
  }

  private async getElementPoint(uid: string): Promise<{ x: number; y: number }> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    return this.getElementCenter(objectId, backendNodeId);
  }

  private async getElementInfo(objectId: string): Promise<ElementInfo> {
    const response = await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function() {
        return {
          tagName: String(this.tagName || "").toUpperCase(),
          type: String(this.type || "").toLowerCase(),
          role: String((this.getAttribute && this.getAttribute("role")) || "").toLowerCase(),
          isContentEditable: Boolean(this.isContentEditable),
        };
      }`,
      returnByValue: true,
    });
    const value = getResultValue(response);
    if (!value || typeof value !== "object") {
      return { tagName: "", type: "", role: "", isContentEditable: false };
    }

    const info = value as Partial<ElementInfo>;
    return {
      tagName: typeof info.tagName === "string" ? info.tagName.toUpperCase() : "",
      type: typeof info.type === "string" ? info.type.toLowerCase() : "",
      role: typeof info.role === "string" ? info.role.toLowerCase() : "",
      isContentEditable: info.isContentEditable === true,
    };
  }

  private async fillSelect(objectId: string, value: string): Promise<void> {
    const response = await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function(targetValue) {
        let matched = false;
        for (const option of Array.from(this.options || [])) {
          if (option.value === targetValue || option.text === targetValue) {
            this.value = option.value;
            matched = true;
            break;
          }
        }
        if (!matched) return false;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }`,
      arguments: [{ value }],
      returnByValue: true,
    });
    if (getResultValue(response) !== true) {
      throw new Error(`下拉框中没有匹配的选项：${value}。`);
    }
  }

  private async fillToggle(objectId: string, value: string): Promise<void> {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue !== "true" && normalizedValue !== "false") {
      throw new Error("复选框、单选框和开关只能填写 true 或 false。");
    }

    await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function(nextChecked) {
        const dispatchStateEvents = () => {
          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
        };
        if (this instanceof HTMLInputElement) {
          if (this.checked !== nextChecked && typeof this.click === "function") this.click();
          if (this.checked !== nextChecked) {
            this.checked = nextChecked;
            dispatchStateEvents();
          }
          return;
        }
        const nextValue = nextChecked ? "true" : "false";
        if (this.getAttribute && this.getAttribute("aria-checked") !== null) this.setAttribute("aria-checked", nextValue);
        if (this.getAttribute && this.getAttribute("aria-pressed") !== null) this.setAttribute("aria-pressed", nextValue);
        if (typeof this.click === "function") this.click();
        dispatchStateEvents();
      }`,
      arguments: [{ value: normalizedValue === "true" }],
      userGesture: true,
    });
  }

  private async fillTextInput(objectId: string, value: string): Promise<void> {
    await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function() {
        this.focus();
        if (typeof this.select === "function") {
          this.select();
          return;
        }
        if (window.getSelection && document.createRange) {
          const range = document.createRange();
          range.selectNodeContents(this);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }`,
    });
    await this.connection.dispatchKeyEvent({
      type: "keyDown",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
      key: "Backspace",
      code: "Backspace",
    });
    await this.connection.dispatchKeyEvent({
      type: "keyUp",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
      key: "Backspace",
      code: "Backspace",
    });
    if (value) {
      await this.connection.insertText(value);
    }
    await this.connection.callFunctionOn({
      objectId,
      // 空字符串是明确的清空语义；这里兜底清理残留值，避免全选或 Backspace 被页面框架干扰后只删掉一个字符。
      arguments: [{ value }],
      functionDeclaration: `function() {
        if (arguments[0] === "" && "value" in this) {
          this.value = "";
          this.dispatchEvent(new Event("input", { bubbles: true }));
        }
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
    });
  }

}

function validateArguments(toolCall: ModelToolCall): { ok: true } | { ok: false; message: string } {
  const args = toolCall.arguments;
  const allowedKeysByName: Record<BrowserControlActionName, string[]> = {
    click: ["uid", "includeSnapshot"],
    fill: ["uid", "value", "includeSnapshot"],
    press_key: ["key", "includeSnapshot"],
    wait_for: ["text", "timeout"],
    wait_for_state: ["state", "value", "uid", "timeout", "includeSnapshot"],
    scroll: ["direction", "amount", "uid", "includeSnapshot"],
    hover: ["uid", "includeSnapshot"],
    double_click: ["uid", "includeSnapshot"],
    context_click: ["uid", "includeSnapshot"],
    drag: ["sourceUid", "targetUid", "deltaX", "deltaY", "includeSnapshot"],
  };
  const allowedKeys = allowedKeysByName[toolCall.name as BrowserControlActionName] ?? [];
  const extraKeys = Object.keys(args).filter((key) => !allowedKeys.includes(key));
  if (extraKeys.length > 0) {
    if (toolCall.name === "wait_for_state") {
      return { ok: false, message: `浏览器状态等待工具不接受参数：${extraKeys.join("、")}。` };
    }
    if (toolCall.name === "drag") {
      return { ok: false, message: `浏览器拖拽工具不接受参数：${extraKeys.join("、")}。` };
    }
    return { ok: false, message: toolCall.name === "scroll" ? `浏览器滚动工具不接受参数：${extraKeys.join("、")}。` : `浏览器操作工具 ${toolCall.name} 不接受参数：${extraKeys.join("、")}。` };
  }

  if ((toolCall.name === "click" || toolCall.name === "fill" || toolCall.name === "hover" || toolCall.name === "double_click" || toolCall.name === "context_click") && (typeof args.uid !== "string" || !args.uid.trim())) {
    return { ok: false, message: "浏览器操作需要非空 UID。" };
  }
  if (toolCall.name === "fill" && typeof args.value !== "string") {
    return { ok: false, message: "fill 的 value 必须是字符串。" };
  }
  if (toolCall.name === "press_key" && (typeof args.key !== "string" || !args.key.trim())) {
    return { ok: false, message: "press_key 的 key 必须是非空字符串。" };
  }
  if ((toolCall.name === "click" || toolCall.name === "fill" || toolCall.name === "press_key" || toolCall.name === "hover" || toolCall.name === "double_click" || toolCall.name === "context_click") &&
    args.includeSnapshot !== undefined &&
    typeof args.includeSnapshot !== "boolean") {
    return { ok: false, message: "includeSnapshot 必须是布尔值。" };
  }
  if (toolCall.name === "wait_for" && !Array.isArray(args.text)) {
    return { ok: false, message: "wait_for 的 text 必须是字符串数组。" };
  }
  if (toolCall.name === "wait_for" && args.timeout !== undefined && typeof args.timeout !== "number") {
    return { ok: false, message: "wait_for 的 timeout 必须是数字。" };
  }
  if (toolCall.name === "wait_for_state") {
    if (!isWaitForStateName(args.state)) {
      return { ok: false, message: "wait_for_state 的 state 必须是 url_contains、ready_state、element_visible、element_hidden 或 network_idle。" };
    }
    if ((args.state === "url_contains" || args.state === "ready_state") && (typeof args.value !== "string" || !args.value.trim())) {
      return { ok: false, message: "wait_for_state 等待 URL 或 readyState 时必须提供非空 value。" };
    }
    if ((args.state === "element_visible" || args.state === "element_hidden") && (typeof args.uid !== "string" || !args.uid.trim())) {
      return { ok: false, message: "wait_for_state 等待元素状态时必须提供 take_snapshot 返回的非空 UID。" };
    }
    if (args.timeout !== undefined && (typeof args.timeout !== "number" || !Number.isFinite(args.timeout) || args.timeout < 1 || args.timeout > WAIT_FOR_MAX_TIMEOUT_MS)) {
      return { ok: false, message: "wait_for_state 的 timeout 必须是 1 到 30000 的数字。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, message: "includeSnapshot 必须是布尔值。" };
    }
  }
  if (toolCall.name === "drag") {
    if (typeof args.sourceUid !== "string" || !args.sourceUid.trim()) {
      return { ok: false, message: "drag 需要非空 sourceUid。" };
    }
    const hasTargetUid = typeof args.targetUid === "string" && args.targetUid.trim();
    const hasDeltaX = args.deltaX !== undefined;
    const hasDeltaY = args.deltaY !== undefined;
    const hasAnyDelta = hasDeltaX || hasDeltaY;
    if (!hasTargetUid && !hasAnyDelta) {
      return { ok: false, message: "drag 必须提供 targetUid，或同时提供 deltaX 和 deltaY。" };
    }
    if (hasTargetUid && hasAnyDelta) {
      return { ok: false, message: "drag 不能同时提供 targetUid 和 deltaX/deltaY。" };
    }
    if (!hasTargetUid && (!hasDeltaX || !hasDeltaY)) {
      return { ok: false, message: "drag 必须提供 targetUid，或同时提供 deltaX 和 deltaY。" };
    }
    if (args.targetUid !== undefined && (typeof args.targetUid !== "string" || !args.targetUid.trim())) {
      return { ok: false, message: "drag 的 targetUid 必须是 take_snapshot 返回的非空 UID。" };
    }
    if (hasAnyDelta && (!isValidDragDelta(args.deltaX) || !isValidDragDelta(args.deltaY))) {
      return { ok: false, message: "drag 的 deltaX 和 deltaY 必须是 -2000 到 2000 的整数。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, message: "includeSnapshot 必须是布尔值。" };
    }
  }
  if (toolCall.name === "scroll") {
    if (!isScrollDirection(args.direction)) {
      return { ok: false, message: "scroll 的 direction 必须是 up、down、left、right、top 或 bottom。" };
    }
    if (args.amount !== undefined && (typeof args.amount !== "number" || !Number.isInteger(args.amount) || args.amount < 1 || args.amount > SCROLL_MAX_AMOUNT)) {
      return { ok: false, message: "scroll 的 amount 必须是 1 到 5000 的整数。" };
    }
    if (args.uid !== undefined && (typeof args.uid !== "string" || !args.uid.trim())) {
      return { ok: false, message: "scroll 的 uid 必须是 take_snapshot 返回的非空 UID。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, message: "includeSnapshot 必须是布尔值。" };
    }
  }

  return { ok: true };
}

function isScrollDirection(value: unknown): value is ScrollDirection {
  return value === "up" || value === "down" || value === "left" || value === "right" || value === "top" || value === "bottom";
}

function isWaitForStateName(value: unknown): value is WaitForStateName {
  return value === "url_contains" || value === "ready_state" || value === "element_visible" || value === "element_hidden" || value === "network_idle";
}

function isValidDragDelta(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -DRAG_MAX_DELTA && value <= DRAG_MAX_DELTA;
}

function normalizeActionError(error: unknown, includeSnapshot: boolean): string {
  const message = error instanceof Error ? error.message : "";
  let normalized = message || "浏览器操作失败，请确认当前页面仍可访问后重试。";
  if (message.includes("不在允许列表") || message.includes("只能填写") || message.includes("text 必须") || message.includes("没有匹配的选项")) {
    normalized = message;
  } else if (message === SAFE_CLICK_OCCLUDED_ERROR) {
    normalized = `${message}${RETAKE_SNAPSHOT_MESSAGE}`;
  } else if (message.includes("旧快照") || message.includes("不存在") || message.includes("移除") || message.includes("UID")) {
    normalized = `${message} ${RETAKE_SNAPSHOT_MESSAGE}`;
  }

  if (includeSnapshot && !normalized.includes("take_snapshot")) {
    return `${normalized}${INCLUDE_SNAPSHOT_ERROR_SUFFIX}`;
  }

  return normalized;
}

function isToggleElement(info: ElementInfo): boolean {
  return (info.tagName === "INPUT" && (info.type === "checkbox" || info.type === "radio")) ||
    info.role === "checkbox" ||
    info.role === "radio" ||
    info.role === "switch";
}

function normalizeTimeout(timeout: unknown): number {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    return WAIT_FOR_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(timeout), WAIT_FOR_MAX_TIMEOUT_MS);
}

function normalizeScrollAmount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : SCROLL_DEFAULT_AMOUNT;
}

function createViewportScrollExpression(direction: ScrollDirection, amount: number): string {
  const payload = JSON.stringify({ direction, amount });
  return `(() => {
    const { direction, amount } = ${payload};
    if (direction === "top") {
      window.scrollTo({ top: 0, left: window.scrollX, behavior: "instant" });
      return true;
    }
    if (direction === "bottom") {
      window.scrollTo({ top: document.documentElement.scrollHeight, left: window.scrollX, behavior: "instant" });
      return true;
    }
    const delta = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    }[direction];
    if (!delta) return false;
    window.scrollBy({ left: delta[0], top: delta[1], behavior: "instant" });
    return true;
  })()`;
}

function createElementScrollFunctionDeclaration(): string {
  return `function(direction, amount) {
    if (!this || typeof this.scrollBy !== "function") return false;
    if (direction === "top") {
      this.scrollTo({ top: 0, left: this.scrollLeft || 0, behavior: "instant" });
      return true;
    }
    if (direction === "bottom") {
      this.scrollTo({ top: this.scrollHeight || 0, left: this.scrollLeft || 0, behavior: "instant" });
      return true;
    }
    const delta = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    }[direction];
    if (!delta) return false;
    this.scrollBy({ left: delta[0], top: delta[1], behavior: "instant" });
    return true;
  }`;
}

function formatViewportScrollResult(direction: ScrollDirection, amount: number): string {
  if (direction === "top") {
    return "已将当前视口滚动到顶部。";
  }
  if (direction === "bottom") {
    return "已将当前视口滚动到底部。";
  }
  return `已向${formatScrollDirection(direction)}滚动当前视口 ${amount} 像素。`;
}

function formatElementScrollResult(uid: string, direction: ScrollDirection, amount: number): string {
  if (direction === "top") {
    return `已将元素 ${uid} 滚动到顶部。`;
  }
  if (direction === "bottom") {
    return `已将元素 ${uid} 滚动到底部。`;
  }
  return `已向${formatScrollDirection(direction)}滚动元素 ${uid} ${amount} 像素。`;
}

function formatScrollDirection(direction: ScrollDirection): string {
  const labels: Record<ScrollDirection, string> = {
    up: "上",
    down: "下",
    left: "左",
    right: "右",
    top: "顶部",
    bottom: "底部",
  };
  return labels[direction];
}

function normalizeWaitForTargets(text: unknown): string[] {
  if (!Array.isArray(text)) {
    return [];
  }

  if (text.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("wait_for 的 text 只能包含非空字符串。");
  }

  return text.map((item) => item.trim());
}

function createWaitForExpression(targets: string[], timeoutMs: number): string {
  // targets 和 timeoutMs 只能通过 JSON.stringify 注入表达式，禁止后续改成字符串拼接，避免等待文本变成脚本片段。
  return `
    (async () => {
      const targets = ${JSON.stringify(targets)};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const getPageText = () => document.body ? document.body.innerText || document.body.textContent || "" : "";
      const findMatch = () => targets.find((target) => getPageText().includes(target)) || null;
      const existing = findMatch();
      if (existing) return existing;
      return await new Promise((resolve) => {
        let done = false;
        let observer = null;
        const finish = (value) => {
          if (done) return;
          done = true;
          if (observer) observer.disconnect();
          resolve(value);
        };
        const check = () => {
          const match = findMatch();
          if (match) finish(match);
        };
        if (document.body) {
          observer = new MutationObserver(check);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        setTimeout(() => finish(null), timeoutMs);
      });
    })()
  `;
}

function createWaitForPageStateExpression(state: WaitForStateName, value: string, timeoutMs: number): string {
  // state、value 和 timeoutMs 只能序列化为数据；等待逻辑保持固定模板，避免把模型参数变成页面脚本。
  return `
    (async function waitForBrowserState() {
      const state = ${JSON.stringify(state)};
      const value = ${JSON.stringify(value)};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const readCurrentValue = () => {
        if (state === "url_contains") return window.location.href || "";
        if (state === "ready_state") return document.readyState || "";
        return "";
      };
      const isMatched = () => {
        const current = readCurrentValue();
        if (state === "url_contains") return current.includes(value);
        if (state === "ready_state") return current === value;
        return false;
      };
      if (isMatched()) return { matched: true, state, value: readCurrentValue() };
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
          if (isMatched()) {
            clearInterval(timer);
            resolve({ matched: true, state, value: readCurrentValue() });
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            resolve({ matched: false, state, value: readCurrentValue() });
          }
        }, 100);
      });
    })()
  `;
}

function createWaitForElementStateFunctionDeclaration(): string {
  return `async function waitForBrowserElementState(state, timeoutMs) {
    const isVisible = () => {
      if (!this || !this.isConnected) return false;
      const style = window.getComputedStyle(this);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      const rect = this.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const isMatched = () => state === "element_visible" ? isVisible() : !isVisible();
    if (isMatched()) return { matched: true, state, value: state === "element_visible" ? "visible" : "hidden" };
    return await new Promise((resolve) => {
      const startedAt = Date.now();
      let observer = null;
      const finish = (matched) => {
        if (observer) observer.disconnect();
        resolve({ matched, state, value: isVisible() ? "visible" : "hidden" });
      };
      const check = () => {
        if (isMatched()) finish(true);
        else if (Date.now() - startedAt >= timeoutMs) finish(false);
      };
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      const timer = setInterval(() => {
        if (isMatched()) {
          clearInterval(timer);
          finish(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          finish(false);
        }
      }, 100);
    });
  }`;
}

function normalizeWaitForStateResult(value: unknown): { matched: boolean } {
  return value && typeof value === "object" && "matched" in value && value.matched === true
    ? { matched: true }
    : { matched: false };
}

function parseKeyTokens(key: string): string[] {
  const rawTokens = key.split("+");
  const tokens: string[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    if (token) {
      tokens.push(MODIFIER_ALIASES[token] || token);
    } else if (index === rawTokens.length - 1 || rawTokens[index + 1] === "") {
      tokens.push("+");
      break;
    }
  }

  return tokens;
}

function getKeyDefinition(key: string, modifiers = 0): Record<string, unknown> | null {
  const keyMap: Record<string, Record<string, unknown>> = {
    Control: { windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, key: "Control", code: "ControlLeft", modifiers },
    Shift: { windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, key: "Shift", code: "ShiftLeft", modifiers },
    Alt: { windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, key: "Alt", code: "AltLeft", modifiers },
    Meta: { windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 91, key: "Meta", code: "MetaLeft", modifiers },
    Enter: { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r", modifiers },
    Backspace: { windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, key: "Backspace", code: "Backspace", modifiers },
    Tab: { windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: "Tab", code: "Tab", modifiers },
    Escape: { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape", modifiers },
    Delete: { windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46, key: "Delete", code: "Delete", modifiers },
    ArrowDown: { windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown", modifiers },
    ArrowUp: { windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38, key: "ArrowUp", code: "ArrowUp", modifiers },
    ArrowLeft: { windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37, key: "ArrowLeft", code: "ArrowLeft", modifiers },
    ArrowRight: { windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, key: "ArrowRight", code: "ArrowRight", modifiers },
    PageUp: { windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33, key: "PageUp", code: "PageUp", modifiers },
    PageDown: { windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34, key: "PageDown", code: "PageDown", modifiers },
    End: { windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35, key: "End", code: "End", modifiers },
    Home: { windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36, key: "Home", code: "Home", modifiers },
    Space: { windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, key: " ", code: "Space", text: " ", modifiers },
  };
  if (keyMap[key]) {
    return keyMap[key];
  }
  if (key.length !== 1) {
    return null;
  }

  const upper = key.toUpperCase();
  if (!/^[A-Z0-9+]$/.test(upper)) {
    return null;
  }
  const windowsVirtualKeyCode = key === "+" ? 187 : upper.charCodeAt(0);
  const shouldEmitText = (modifiers & (MODIFIER_BITS.Control | MODIFIER_BITS.Meta | MODIFIER_BITS.Alt)) === 0;
  return {
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    key,
    code: /^[A-Z]$/.test(upper) ? `Key${upper}` : key === "+" ? "Equal" : `Digit${upper}`,
    modifiers,
    ...(shouldEmitText ? { text: key } : {}),
  };
}

function getResultValue(response: unknown): unknown {
  if (!response || typeof response !== "object" || !("result" in response)) {
    return undefined;
  }
  const result = response.result;
  return result && typeof result === "object" && "value" in result ? result.value : undefined;
}

function getObject(response: unknown): { objectId?: string } | undefined {
  if (!response || typeof response !== "object" || !("object" in response) || !response.object || typeof response.object !== "object") {
    return undefined;
  }

  return response.object as { objectId?: string };
}

function getBoxModel(response: unknown): { content?: number[] } | undefined {
  if (!response || typeof response !== "object" || !("model" in response) || !response.model || typeof response.model !== "object") {
    return undefined;
  }

  return response.model as { content?: number[] };
}
