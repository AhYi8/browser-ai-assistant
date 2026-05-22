# 聊天主界面 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Chrome Side Panel 聊天主界面 MVP，包括历史会话、文件夹、归档、上下文提取模式、真实非流式模型请求和 AI 思考过程展示。

**Architecture:** 在现有 React + Zustand + Dexie + Chrome runtime 架构上做最小扩展。内容脚本负责页面上下文提取，background 负责模型请求，Side Panel 负责会话状态、历史管理和聊天 UI。

**Tech Stack:** React 19、Zustand、Dexie、Vite、Vitest、Testing Library、Chrome Extension MV3、Tailwind CSS。

---

## 重要约束

- 所有用户可见文案、注释和文档均使用简体中文。
- 未经用户明确授权不得执行 `git commit`。
- 当前计划中的“保存点”只执行 `git status` 和 `git diff --check`，不提交。
- 代码实现前先写失败测试，再写最小实现。
- 每个任务完成后运行该任务列出的最小验证命令。

## 文件结构

### 修改文件

- `src/shared/types.ts`：扩展聊天会话、消息、文件夹、上下文提取模式类型。
- `src/shared/constants.ts`：升级 Dexie 数据库版本。
- `src/shared/storage/db.ts`：新增 `chatFolders` 表，扩展 `chatSessions` schema。
- `src/shared/storage/repositories.ts`：新增聊天会话和文件夹仓库方法。
- `src/content/extractPageText.ts`：支持 `extractMode: "text" | "all"`。
- `src/content/index.ts`：转发 `extractMode` 并保持内容脚本响应结构。
- `src/background/pageContextMessageHandler.ts`：转发 `extractMode` 到 content script。
- `src/background/modelRequestHandler.ts`：从导出 payload 工具改为实现 `chat.send` 请求处理。
- `src/background/index.ts`：注册 `chat.send` 消息。
- `src/side-panel/state/appStore.ts`：新增会话、文件夹、聊天发送、提取模式状态和动作。
- `src/side-panel/App.tsx`：调整聊天页响应式布局入口。
- `src/side-panel/components/SessionList.tsx`：实现历史会话与文件夹管理。
- `src/side-panel/components/MessageList.tsx`：实现气泡消息和思考过程。
- `src/side-panel/components/ModelSelector.tsx`：只保留当前模型行能力，流式开关下沉到 composer。
- `src/side-panel/components/ChatPanel.tsx`：组合模型行、历史按钮、消息区、输入区。
- `src/side-panel/styles.css`：补充聊天主界面公共样式，继续使用主题 token。

### 新增文件

- `src/shared/chat/buildChatRequestMessages.ts`：构造发送给模型的当前会话全部消息。
- `src/shared/chat/parseAssistantResponse.ts`：解析 `<think>...</think>`。
- `src/shared/chat/modelConfig.ts`：由 `ModelProvider + ProviderModel` 合成 `ModelConfig`。
- `src/side-panel/components/ChatComposer.tsx`：聊天输入区。
- `src/side-panel/components/SessionHistoryDialog.tsx`：窄面板历史弹窗。
- `tests/unit/shared/chatRequestMessages.test.ts`：聊天请求消息构造测试。
- `tests/unit/shared/assistantResponseParsing.test.ts`：AI 思考解析测试。
- `tests/unit/background/chatMessageHandler.test.ts`：background 聊天请求测试。

## Task 1: 类型与存储扩展

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/storage/db.ts`
- Modify: `src/shared/storage/repositories.ts`
- Test: `tests/unit/shared/storage.test.ts`

- [ ] **Step 1: 写失败测试，覆盖文件夹和扩展会话字段**

在 `tests/unit/shared/storage.test.ts` 的 import 中加入：

```ts
deleteChatFolder,
deleteChatSession,
getChatFolders,
getChatSessions,
saveChatFolder,
```

把类型 import 改为：

```ts
import type { ChatFolder, ChatSession, ExtractionRule, ModelProvider, ProviderModel } from "../../../src/shared/types";
```

在“存储仓库”测试组内追加：

```ts
it("保存并读取聊天文件夹", async () => {
  const folder: ChatFolder = {
    id: "folder-1",
    name: "工作资料",
    sortOrder: 10,
    createdAt: 1,
    updatedAt: 2,
  };

  await saveChatFolder(folder);

  expect(await getChatFolders()).toEqual([folder]);
});

it("删除聊天文件夹时会话回到默认文件夹", async () => {
  const folder: ChatFolder = {
    id: "folder-1",
    name: "工作资料",
    sortOrder: 10,
    createdAt: 1,
    updatedAt: 1,
  };
  const session: ChatSession = {
    id: "session-1",
    title: "示例会话",
    folderId: "folder-1",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 2,
    messages: [],
  };

  await saveChatFolder(folder);
  await saveChatSession(session);
  await deleteChatFolder("folder-1");

  expect(await getChatFolders()).toEqual([]);
  expect(await getChatSession("session-1")).toEqual({
    ...session,
    folderId: undefined,
  });
});

it("按更新时间倒序读取聊天会话并支持删除", async () => {
  const older: ChatSession = {
    id: "session-old",
    title: "旧会话",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 10,
    messages: [],
  };
  const newer: ChatSession = {
    id: "session-new",
    title: "新会话",
    folderId: "folder-1",
    archived: true,
    sortOrder: 2,
    createdAt: 2,
    updatedAt: 20,
    messages: [],
  };

  await saveChatSession(older);
  await saveChatSession(newer);

  expect((await getChatSessions()).map((session) => session.id)).toEqual(["session-new", "session-old"]);

  await deleteChatSession("session-new");

  expect((await getChatSessions()).map((session) => session.id)).toEqual(["session-old"]);
});
```

同时更新现有“保存并读取聊天会话”测试里的 `session`：

```ts
const session: ChatSession = {
  id: "session-1",
  title: "示例会话",
  folderId: undefined,
  archived: false,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "总结页面",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: true,
      systemPrompt: "你是网页助手",
      contextPrompt: "页面内容",
      contextMode: "text",
      matchedRuleId: "rule-1",
    },
  ],
};
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/shared/storage.test.ts
```

Expected: FAIL，提示 `ChatFolder` 类型或 `saveChatFolder/getChatFolders/deleteChatFolder/deleteChatSession/getChatSessions` 不存在，或 `ChatSession` 缺少新增字段。

- [ ] **Step 3: 扩展共享类型**

在 `src/shared/types.ts` 中调整：

```ts
export type EndpointType = "openai_chat" | "anthropic_messages";
export type ChatRole = "system" | "user" | "assistant";
export type PageContextExtractMode = "text" | "all";
```

扩展 `ChatMessage`：

```ts
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  modelId: string;
  endpointType: EndpointType;
  streamMode: boolean;
  systemPrompt: string;
  contextPrompt: string;
  contextMode: PageContextExtractMode;
  matchedRuleId?: string;
  thinking?: string;
}
```

扩展 `ChatSession` 并新增 `ChatFolder`：

```ts
export interface ChatSession {
  id: string;
  title: string;
  folderId?: string;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatFolder {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: 升级 Dexie schema**

在 `src/shared/constants.ts` 中把数据库版本升到 2：

```ts
export const DATABASE_NAME = "browser-ai-assistant";
export const DATABASE_VERSION = 2;
export const DEFAULT_CONTEXT_MAX_LENGTH = 24_000;
```

在 `src/shared/storage/db.ts` 中引入 `ChatFolder`：

```ts
import type { AppSetting, ChatFolder, ChatSession, ExtractionRule, ModelConfig, ModelProvider, ProviderModel } from "../types";
```

新增表声明：

```ts
chatFolders!: EntityTable<ChatFolder, "id">;
```

更新 stores：

```ts
this.version(DATABASE_VERSION).stores({
  modelConfigs: "id, channelName, endpointType, updatedAt",
  modelProviders: "id, name, endpointType, updatedAt",
  providerModels: "id, providerId, displayName, updatedAt",
  extractionRules: "id, sortOrder, urlPattern, updatedAt",
  chatSessions: "id, folderId, archived, sortOrder, updatedAt",
  chatFolders: "id, sortOrder, updatedAt",
  appSettings: "key, updatedAt",
});
```

- [ ] **Step 5: 实现仓库方法**

在 `src/shared/storage/repositories.ts` 类型 import 中加入 `ChatFolder`：

```ts
import type { ChatFolder, ChatSession, ExtractionRule, ModelConfig, ModelProvider, ProviderModel } from "../types";
```

新增或替换聊天仓库方法：

```ts
export async function saveChatSession(session: ChatSession): Promise<void> {
  await db.chatSessions.put(session);
}

export async function getChatSession(id: string): Promise<ChatSession | undefined> {
  return db.chatSessions.get(id);
}

export async function getChatSessions(): Promise<ChatSession[]> {
  const sessions = await db.chatSessions.orderBy("updatedAt").reverse().toArray();
  return sessions;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await db.chatSessions.delete(sessionId);
}

export async function saveChatFolder(folder: ChatFolder): Promise<void> {
  await db.chatFolders.put(folder);
}

export async function getChatFolders(): Promise<ChatFolder[]> {
  return db.chatFolders.orderBy("sortOrder").toArray();
}

export async function deleteChatFolder(folderId: string): Promise<void> {
  await db.transaction("rw", [db.chatFolders, db.chatSessions], async () => {
    await db.chatFolders.delete(folderId);
    const sessions = await db.chatSessions.where("folderId").equals(folderId).toArray();
    const now = Date.now();
    await Promise.all(
      sessions.map((session) =>
        db.chatSessions.put({
          ...session,
          folderId: undefined,
          updatedAt: now,
        }),
      ),
    );
  });
}
```

更新 `clearDatabase` 的表列表，加入 `db.chatFolders`，并在 `Promise.all` 中加入 `db.chatFolders.clear()`。

- [ ] **Step 6: 运行存储测试确认通过**

Run:

```bash
npm test -- tests/unit/shared/storage.test.ts
```

Expected: PASS。

- [ ] **Step 7: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 显示本任务相关文件被修改。

## Task 2: 页面上下文提取模式

**Files:**
- Modify: `src/content/extractPageText.ts`
- Modify: `src/content/index.ts`
- Modify: `src/background/pageContextMessageHandler.ts`
- Test: `tests/unit/content/extractPageText.test.ts`
- Test: `tests/unit/content/index.test.ts`
- Test: `tests/unit/background/index.test.ts`

- [ ] **Step 1: 写失败测试覆盖 `extractMode`**

在 `tests/unit/content/extractPageText.test.ts` 中追加：

```ts
it("提取所有模式命中 CSS 时返回匹配元素 outerHTML", () => {
  setPage("<main class=\"article\"><h1>标题</h1><p style=\"color:red\">正文</p></main><aside>侧栏</aside>");

  const result = extractPageText({
    url: "https://example.com/article",
    rules: [createRule({ selectorsText: "main" })],
    maxLength: 500,
    extractMode: "all",
  });

  expect(result.text).toBe('<main class="article"><h1>标题</h1><p style="color:red">正文</p></main>');
  expect(result.usedFallback).toBe(false);
  expect(result.matchedRuleId).toBe("rule-1");
});

it("提取所有模式命中 XPath 时按顺序返回匹配元素 outerHTML", () => {
  setPage("<section><article>第一段</article><article>第二段</article></section>");

  const result = extractPageText({
    url: "https://example.com/article",
    rules: [createRule({ selectorsText: "//article" })],
    maxLength: 500,
    extractMode: "all",
  });

  expect(result.text).toBe("<article>第一段</article>\n<article>第二段</article>");
  expect(result.usedFallback).toBe(false);
});

it("提取所有模式未命中规则时返回完整 HTML", () => {
  document.documentElement.innerHTML = "<head><title>测试</title></head><body><main>正文</main></body>";

  const result = extractPageText({
    url: "https://other.example.com/page",
    rules: [createRule({ urlPattern: "https://example.com/.*", selectorsText: "main" })],
    maxLength: 500,
    extractMode: "all",
  });

  expect(result.text).toContain("<html>");
  expect(result.text).toContain("<head><title>测试</title></head>");
  expect(result.text).toContain("<body><main>正文</main></body>");
  expect(result.usedFallback).toBe(true);
  expect(result.matchedRuleId).toBeUndefined();
});

it("提取所有模式规则命中但内容为空时回退完整 HTML 并保留规则 ID", () => {
  document.documentElement.innerHTML = "<head></head><body><main>正文</main></body>";

  const result = extractPageText({
    url: "https://example.com/article",
    rules: [createRule({ selectorsText: ".missing" })],
    maxLength: 500,
    extractMode: "all",
  });

  expect(result.text).toContain("<body><main>正文</main></body>");
  expect(result.usedFallback).toBe(true);
  expect(result.matchedRuleId).toBe("rule-1");
});
```

同时把现有所有 `extractPageText({ ... })` 调用保持不传 `extractMode`，用于验证默认仍为 `text`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/content/extractPageText.test.ts
```

Expected: FAIL，提示 `extractMode` 不是输入字段或 all 模式仍返回文本。

- [ ] **Step 3: 实现 `extractMode`**

在 `src/content/extractPageText.ts` 中更新 import：

```ts
import type { ExtractionRule, PageContextExtractMode } from "../shared/types";
```

扩展输入类型：

```ts
export interface ExtractPageTextInput {
  url: string;
  rules: ExtractionRule[];
  maxLength: number;
  extractMode?: PageContextExtractMode;
}
```

替换 `extractPageText`：

```ts
export function extractPageText(input: ExtractPageTextInput): ExtractPageTextResult {
  const extractMode = input.extractMode ?? "text";
  const matchedRule = [...input.rules].sort((left, right) => left.sortOrder - right.sortOrder).find((rule) => matchUrl(rule.urlPattern, input.url));
  const extractedContent = matchedRule ? extractBySelectors(matchedRule.selectorsText, extractMode) : "";
  const usedFallback = extractedContent.length === 0;
  const rawContent = usedFallback ? extractGlobalContent(extractMode) : extractedContent;
  const normalizedContent = extractMode === "text" ? normalizeText(rawContent) : rawContent.trim();
  const truncated = truncateText(normalizedContent, input.maxLength);

  return {
    ...truncated,
    usedFallback,
    matchedRuleId: matchedRule?.id,
  };
}
```

替换选择器提取函数：

```ts
function extractBySelectors(selectorsText: string, extractMode: PageContextExtractMode): string {
  const selectors = getSelectorLines(selectorsText);
  const parts: string[] = [];

  for (const selector of selectors) {
    const selectorText = extractByCss(selector, extractMode) || extractByXPath(selector, extractMode);
    if (selectorText) {
      parts.push(selectorText);
    }
  }

  return extractMode === "text" ? normalizeText(parts.join(" ")) : parts.join("\n").trim();
}

function extractByCss(selector: string, extractMode: PageContextExtractMode): string {
  try {
    const nodes = Array.from(document.querySelectorAll(selector));
    return extractNodes(nodes, extractMode);
  } catch {
    return "";
  }
}

function extractByXPath(xpath: string, extractMode: PageContextExtractMode): string {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const nodes: Node[] = [];

    for (let index = 0; index < result.snapshotLength; index += 1) {
      const node = result.snapshotItem(index);
      if (node) {
        nodes.push(node);
      }
    }

    return extractNodes(nodes, extractMode);
  } catch {
    return "";
  }
}
```

新增辅助函数：

```ts
function extractNodes(nodes: Node[], extractMode: PageContextExtractMode): string {
  if (extractMode === "text") {
    return normalizeText(nodes.map((node) => extractVisibleTextFromNode(node)).join(" "));
  }

  return nodes.map(serializeNodeContent).filter(Boolean).join("\n").trim();
}

function extractGlobalContent(extractMode: PageContextExtractMode): string {
  if (extractMode === "all") {
    return document.documentElement.outerHTML;
  }

  return extractVisibleTextFromNode(document.body);
}

function serializeNodeContent(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).outerHTML.trim();
  }

  return normalizeText(node.textContent ?? "");
}
```

删除或停止使用旧的 `extractGlobalText`。

- [ ] **Step 4: 转发 `extractMode`**

在 `src/content/index.ts` 中引入类型：

```ts
import type { ExtractionRule, PageContextExtractMode } from "../shared/types";
```

扩展消息接口：

```ts
export interface PageContextExtractMessage {
  type: "pageContext.extract";
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
}
```

调用 `extractPageText` 时加入：

```ts
extractMode: message.extractMode ?? "text",
```

在 `src/background/pageContextMessageHandler.ts` 同样扩展 `PageContextExtractMessage`，并在 `extractMessage` 中加入：

```ts
extractMode: message.extractMode ?? "text",
```

- [ ] **Step 5: 更新消息转发测试**

在 `tests/unit/background/index.test.ts` 的“转发当前活动页提取请求到 content script”用例里，把输入消息加入：

```ts
extractMode: "all",
```

并把期望的 `chrome.tabs.sendMessage` 参数改为：

```ts
{
  type: "pageContext.extract",
  rules: [],
  maxLength: 100,
  extractMode: "all",
}
```

- [ ] **Step 6: 运行相关测试**

Run:

```bash
npm test -- tests/unit/content/extractPageText.test.ts tests/unit/content/index.test.ts tests/unit/background/index.test.ts
```

Expected: PASS。

- [ ] **Step 7: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。

## Task 3: 聊天请求构造与思考解析

**Files:**
- Create: `src/shared/chat/modelConfig.ts`
- Create: `src/shared/chat/buildChatRequestMessages.ts`
- Create: `src/shared/chat/parseAssistantResponse.ts`
- Test: `tests/unit/shared/chatRequestMessages.test.ts`
- Test: `tests/unit/shared/assistantResponseParsing.test.ts`
- Modify: `tests/unit/shared/modelAdapters.test.ts`
- Modify: `tests/unit/shared/titleGeneration.test.ts`

- [ ] **Step 1: 写聊天请求构造测试**

创建 `tests/unit/shared/chatRequestMessages.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildChatRequestMessages } from "../../../src/shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../../src/shared/chat/modelConfig";
import type { ChatMessage, ModelProvider, ProviderModel } from "../../../src/shared/types";

function createProvider(): ModelProvider {
  return {
    id: "provider-1",
    name: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createModel(): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "默认模型",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMessage(id: string, role: ChatMessage["role"], content: string, createdAt: number): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "旧上下文",
    contextMode: "text",
  };
}

describe("聊天请求消息构造", () => {
  it("将模型系统提示、页面上下文、当前会话全部消息和本次用户消息一起提交", () => {
    const model = createModelConfig(createProvider(), createModel());
    const existingMessages = [
      createMessage("message-1", "user", "第一问", 1),
      createMessage("message-2", "assistant", "第一答", 2),
    ];
    const userMessage = createMessage("message-3", "user", "第二问", 3);

    const result = buildChatRequestMessages({
      model,
      pageContext: "当前页面正文",
      existingMessages,
      userMessage,
    });

    expect(result.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "你是网页助手\n\n当前页面上下文：\n当前页面正文" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
    ]);
  });

  it("没有页面上下文时只使用模型系统提示", () => {
    const model = createModelConfig(createProvider(), createModel());
    const userMessage = createMessage("message-1", "user", "你好", 1);

    const result = buildChatRequestMessages({
      model,
      pageContext: "",
      existingMessages: [],
      userMessage,
    });

    expect(result.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "你是网页助手" },
      { role: "user", content: "你好" },
    ]);
  });
});
```

- [ ] **Step 2: 写思考解析测试**

创建 `tests/unit/shared/assistantResponseParsing.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseAssistantResponse } from "../../../src/shared/chat/parseAssistantResponse";

describe("AI 回复解析", () => {
  it("提取 think 标签内容并从最终回答中剥离", () => {
    expect(parseAssistantResponse("<think>先分析页面</think>\n最终回答")).toEqual({
      content: "最终回答",
      thinking: "先分析页面",
    });
  });

  it("支持多行 think 内容", () => {
    expect(parseAssistantResponse("<think>第一步\n第二步</think>\n\n回答正文")).toEqual({
      content: "回答正文",
      thinking: "第一步\n第二步",
    });
  });

  it("没有 think 标签时只返回正文", () => {
    expect(parseAssistantResponse("普通回答")).toEqual({
      content: "普通回答",
      thinking: undefined,
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/shared/chatRequestMessages.test.ts tests/unit/shared/assistantResponseParsing.test.ts
```

Expected: FAIL，提示模块不存在。

- [ ] **Step 4: 实现 `createModelConfig`**

创建 `src/shared/chat/modelConfig.ts`：

```ts
import type { ModelConfig, ModelProvider, ProviderModel } from "../types";

export function createModelConfig(provider: ModelProvider, model: ProviderModel): ModelConfig {
  return {
    ...model,
    name: model.displayName,
    channelName: provider.name,
    endpointType: provider.endpointType,
    endpointUrl: provider.endpointUrl,
    apiKey: provider.apiKey,
  };
}
```

- [ ] **Step 5: 实现 `buildChatRequestMessages`**

创建 `src/shared/chat/buildChatRequestMessages.ts`：

```ts
import type { ChatMessage, ModelConfig } from "../types";

interface BuildChatRequestMessagesInput {
  model: ModelConfig;
  pageContext: string;
  existingMessages: ChatMessage[];
  userMessage: ChatMessage;
}

export function buildChatRequestMessages(input: BuildChatRequestMessagesInput): ChatMessage[] {
  const systemContent = buildSystemContent(input.model.systemPrompt, input.pageContext);
  const now = Date.now();
  const systemMessage: ChatMessage = {
    id: `system-${now}`,
    role: "system",
    content: systemContent,
    createdAt: now,
    modelId: input.model.id,
    endpointType: input.model.endpointType,
    streamMode: input.userMessage.streamMode,
    systemPrompt: input.model.systemPrompt,
    contextPrompt: input.pageContext,
    contextMode: input.userMessage.contextMode,
    matchedRuleId: input.userMessage.matchedRuleId,
  };

  return [systemMessage, ...input.existingMessages, input.userMessage];
}

function buildSystemContent(systemPrompt: string, pageContext: string): string {
  const trimmedSystemPrompt = systemPrompt.trim();
  const trimmedPageContext = pageContext.trim();

  if (!trimmedPageContext) {
    return trimmedSystemPrompt;
  }

  return `${trimmedSystemPrompt}\n\n当前页面上下文：\n${trimmedPageContext}`.trim();
}
```

- [ ] **Step 6: 实现 `parseAssistantResponse`**

创建 `src/shared/chat/parseAssistantResponse.ts`：

```ts
export interface ParsedAssistantResponse {
  content: string;
  thinking?: string;
}

export function parseAssistantResponse(rawContent: string): ParsedAssistantResponse {
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
  if (!thinkMatch) {
    return {
      content: rawContent.trim(),
      thinking: undefined,
    };
  }

  return {
    content: rawContent.replace(thinkMatch[0], "").trim(),
    thinking: thinkMatch[1].trim() || undefined,
  };
}
```

- [ ] **Step 7: 补齐现有测试里的新增 ChatMessage 字段**

在 `tests/unit/shared/modelAdapters.test.ts` 和 `tests/unit/shared/titleGeneration.test.ts` 的所有 `ChatMessage` 测试数据里加入：

```ts
contextMode: "text",
```

需要测试 `matchedRuleId` 时再单独添加，不要给所有样例硬塞无意义字段。

- [ ] **Step 8: 运行共享聊天测试**

Run:

```bash
npm test -- tests/unit/shared/chatRequestMessages.test.ts tests/unit/shared/assistantResponseParsing.test.ts tests/unit/shared/modelAdapters.test.ts tests/unit/shared/titleGeneration.test.ts
```

Expected: PASS。

- [ ] **Step 9: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。

## Task 4: Background 聊天请求处理

**Files:**
- Modify: `src/background/modelRequestHandler.ts`
- Modify: `src/background/index.ts`
- Test: `tests/unit/background/chatMessageHandler.test.ts`
- Test: `tests/unit/background/index.test.ts`

- [ ] **Step 1: 写 background handler 测试**

创建 `tests/unit/background/chatMessageHandler.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { handleChatSendMessage } from "../../../src/background/modelRequestHandler";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "页面内容",
    contextMode: "text",
  };
}

describe("聊天模型请求处理", () => {
  it("OpenAI-compatible 成功时返回解析后的正文和思考过程", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "<think>先分析</think>\n这是回答",
            },
          },
        ],
      }),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("system", "系统提示"), createMessage("user", "总结页面")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      content: "这是回答",
      thinking: "先分析",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("模型接口失败时返回中文错误", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: vi.fn().mockResolvedValue("bad key"),
    });

    const result = await handleChatSendMessage(
      {
        type: "chat.send",
        model: createModel(),
        messages: [createMessage("user", "你好")],
        stream: false,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      message: "模型请求失败：401 Unauthorized",
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/background/chatMessageHandler.test.ts
```

Expected: FAIL，提示 `handleChatSendMessage` 不存在。

- [ ] **Step 3: 实现 handler 类型和非流式请求**

替换 `src/background/modelRequestHandler.ts` 内容：

```ts
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import type { ChatMessage, ModelConfig } from "../shared/types";

export interface ChatSendMessage {
  type: "chat.send";
  model: ModelConfig;
  messages: ChatMessage[];
  stream: boolean;
}

export type ChatSendResponse =
  | {
      ok: true;
      content: string;
      thinking?: string;
    }
  | {
      ok: false;
      message: string;
    };

type Fetcher = typeof fetch;

export async function handleChatSendMessage(message: ChatSendMessage, fetcher: Fetcher = fetch): Promise<ChatSendResponse> {
  if (message.stream) {
    return { ok: false, message: "当前版本暂不支持真实流式响应，请关闭流式响应后重试" };
  }

  try {
    const payload = createModelRequestPayload(message.model, message.messages, message.stream);
    const response = await fetcher(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `模型请求失败：${response.status} ${response.statusText}`.trim(),
      };
    }

    const data = await response.json();
    const rawContent = extractAssistantContent(data);
    if (!rawContent) {
      return { ok: false, message: "模型响应中没有可用内容" };
    }

    return {
      ok: true,
      ...parseAssistantResponse(rawContent),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `模型请求失败：${error.message}` : "模型请求失败",
    };
  }
}

function extractAssistantContent(data: unknown): string {
  if (isOpenAIResponse(data)) {
    return data.choices[0]?.message?.content ?? "";
  }

  if (isAnthropicResponse(data)) {
    return data.content.map((item) => item.text).join("");
  }

  return "";
}

function isOpenAIResponse(data: unknown): data is { choices: Array<{ message?: { content?: string } }> } {
  return Boolean(data && typeof data === "object" && "choices" in data && Array.isArray(data.choices));
}

function isAnthropicResponse(data: unknown): data is { content: Array<{ type: string; text: string }> } {
  return Boolean(data && typeof data === "object" && "content" in data && Array.isArray(data.content));
}
```

- [ ] **Step 4: 注册 `chat.send` runtime 消息**

在 `src/background/index.ts` import 加入：

```ts
import { handleChatSendMessage, type ChatSendMessage } from "./modelRequestHandler";
```

扩展 RuntimeMessage：

```ts
type RuntimeMessage = ModelCatalogMessage | PageContextExtractMessage | UrlPatternGenerationMessage | CurrentTabUrlMessage | ChatSendMessage;
```

在 `onMessage` 中页面上下文分支后加入：

```ts
if (message.type === "chat.send") {
  void handleChatSendMessage(message).then(sendResponse);
  return true;
}
```

- [ ] **Step 5: 更新 background 入口测试**

在 `tests/unit/background/index.test.ts` 中追加用例：

```ts
it("处理聊天发送请求并返回模型回复", async () => {
  const mock = createChromeMock();
  vi.stubGlobal("chrome", mock.chrome);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "模型回复" } }],
      }),
    }),
  );
  await import("../../../src/background/index");
  const sendResponse = vi.fn();

  const keepChannelOpen = mock.messageListeners[0](
    {
      type: "chat.send",
      model: {
        id: "model-1",
        providerId: "provider-1",
        name: "默认模型",
        displayName: "默认模型",
        channelName: "默认渠道",
        endpointType: "openai_chat",
        endpointUrl: "https://api.example.com/v1/chat/completions",
        apiKey: "sk-test",
        modelId: "gpt-test",
        temperature: 0.7,
        maxTokens: 1024,
        systemPrompt: "你是网页助手",
        isTitleModel: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      messages: [],
      stream: false,
    },
    {} as chrome.runtime.MessageSender,
    sendResponse,
  );

  expect(keepChannelOpen).toBe(true);
  await vi.waitFor(() => {
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      content: "模型回复",
      thinking: undefined,
    });
  });
});
```

- [ ] **Step 6: 运行 background 测试**

Run:

```bash
npm test -- tests/unit/background/chatMessageHandler.test.ts tests/unit/background/index.test.ts
```

Expected: PASS。

- [ ] **Step 7: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。

## Task 5: App Store 聊天状态与动作

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Test: `tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 1: 写 store 失败测试**

在 `tests/unit/side-panel/appStore.test.ts` 中追加：

```ts
it("发送聊天时保存用户消息和 AI 回复，并提交当前会话全部消息", async () => {
  const provider = createProvider();
  const model = createModel();
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      url: "https://example.com/article",
      text: "页面内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    })
    .mockResolvedValueOnce({
      ok: true,
      content: "AI 回复",
      thinking: "思考内容",
    });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
    },
  });

  await saveModelProvider(provider);
  await saveProviderModel(model);
  await useAppStore.getState().loadChannelConfig();
  await useAppStore.getState().loadChatData();
  await useAppStore.getState().refreshPageContext();

  await useAppStore.getState().sendChatMessage("第一问");
  await useAppStore.getState().sendChatMessage("第二问");

  const state = useAppStore.getState();
  const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
  expect(state.chatSessions).toHaveLength(1);
  expect(activeSession?.messages.map((message) => message.content)).toEqual(["第一问", "AI 回复", "第二问", "AI 回复"]);
  expect(activeSession?.messages[1].thinking).toBe("思考内容");
  expect(sendMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "chat.send",
      stream: false,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "第一问" }),
        expect.objectContaining({ role: "assistant", content: "AI 回复" }),
        expect.objectContaining({ role: "user", content: "第二问" }),
      ]),
    }),
    expect.any(Function),
  );
});

it("提取模式切换后刷新页面上下文时传递 all 模式", async () => {
  const sendMessage = vi.fn().mockResolvedValue({
    ok: true,
    url: "https://example.com/article",
    text: "<html><body>页面</body></html>",
    truncated: false,
    usedFallback: true,
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
    },
  });

  useAppStore.getState().setContextMode("all");
  await useAppStore.getState().refreshPageContext();

  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "pageContext.extract",
      extractMode: "all",
    }),
    expect.any(Function),
  );
});

it("历史会话支持新建、重命名、归档和删除确认", async () => {
  await useAppStore.getState().loadChatData();
  const session = await useAppStore.getState().createChatSession();

  await useAppStore.getState().renameChatSession(session.id, "新标题");
  expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.title).toBe("新标题");

  await useAppStore.getState().archiveChatSession(session.id);
  expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.archived).toBe(true);

  useAppStore.getState().requestDeleteChatSession(session.id);
  expect(useAppStore.getState().pendingDeleteSessionId).toBe(session.id);
  await useAppStore.getState().confirmDeleteChatSession(session.id);
  expect(useAppStore.getState().chatSessions.some((item) => item.id === session.id)).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/side-panel/appStore.test.ts
```

Expected: FAIL，提示聊天 store 方法不存在。

- [ ] **Step 3: 扩展 store 状态类型**

在 `src/side-panel/state/appStore.ts` import 中加入：

```ts
import { buildChatRequestMessages } from "../../shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../shared/chat/modelConfig";
import {
  deleteChatSession,
  getChatFolders,
  getChatSessions,
  saveChatFolder,
  saveChatSession,
} from "../../shared/storage/repositories";
import type { ChatFolder, ChatMessage, ChatSession, PageContextExtractMode } from "../../shared/types";
```

在 `PageContextState` 中加入：

```ts
extractMode: PageContextExtractMode;
```

新增聊天状态：

```ts
chatSessions: ChatSession[];
chatFolders: ChatFolder[];
activeSessionId: string;
pendingDeleteSessionId?: string;
sending: boolean;
contextMode: PageContextExtractMode;
```

新增动作签名：

```ts
loadChatData: () => Promise<void>;
createChatSession: () => Promise<ChatSession>;
selectChatSession: (sessionId: string) => void;
renameChatSession: (sessionId: string, title: string) => Promise<void>;
archiveChatSession: (sessionId: string) => Promise<void>;
requestDeleteChatSession: (sessionId: string) => void;
confirmDeleteChatSession: (sessionId: string) => Promise<void>;
clearPendingDeleteSession: () => void;
createChatFolder: (name: string) => Promise<ChatFolder>;
setContextMode: (contextMode: PageContextExtractMode) => void;
sendChatMessage: (content: string) => Promise<void>;
```

把派生 `activeSession` 不放入 Zustand 状态，在组件中用 `chatSessions.find` 计算；如果测试需要，可新增 getter 风格字段会增加复杂度，不建议。

- [ ] **Step 4: 初始化和 reset**

初始化加入：

```ts
chatSessions: [],
chatFolders: [],
activeSessionId: "",
sending: false,
contextMode: "text",
```

`pageContext` 初始化加入：

```ts
extractMode: "text",
```

`reset` 同步清空这些字段。

- [ ] **Step 5: 实现聊天数据和历史动作**

在 store 内实现：

```ts
loadChatData: async () => {
  const [chatSessions, chatFolders] = await Promise.all([getChatSessions(), getChatFolders()]);
  set((state) => ({
    chatSessions,
    chatFolders,
    activeSessionId: state.activeSessionId && chatSessions.some((session) => session.id === state.activeSessionId)
      ? state.activeSessionId
      : (chatSessions[0]?.id ?? ""),
  }));
},
createChatSession: async () => {
  const now = Date.now();
  const session: ChatSession = {
    id: `session-${now}`,
    title: "新对话",
    archived: false,
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  await saveChatSession(session);
  set((state) => ({
    chatSessions: [session, ...state.chatSessions],
    activeSessionId: session.id,
    pendingDeleteSessionId: undefined,
  }));
  return session;
},
selectChatSession: (sessionId) => set({ activeSessionId: sessionId, pendingDeleteSessionId: undefined }),
renameChatSession: async (sessionId, title) => {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return;
  }

  const session = get().chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }

  const updatedSession = { ...session, title: trimmedTitle };
  await saveChatSession(updatedSession);
  set((state) => ({
    chatSessions: state.chatSessions.map((item) => (item.id === sessionId ? updatedSession : item)),
  }));
},
archiveChatSession: async (sessionId) => {
  const session = get().chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }

  const updatedSession = { ...session, archived: true, updatedAt: Date.now() };
  await saveChatSession(updatedSession);
  set((state) => ({
    chatSessions: state.chatSessions.map((item) => (item.id === sessionId ? updatedSession : item)),
    pendingDeleteSessionId: undefined,
  }));
},
requestDeleteChatSession: (sessionId) => set({ pendingDeleteSessionId: sessionId }),
confirmDeleteChatSession: async (sessionId) => {
  await deleteChatSession(sessionId);
  set((state) => {
    const chatSessions = state.chatSessions.filter((session) => session.id !== sessionId);
    return {
      chatSessions,
      activeSessionId: state.activeSessionId === sessionId ? (chatSessions[0]?.id ?? "") : state.activeSessionId,
      pendingDeleteSessionId: undefined,
    };
  });
},
clearPendingDeleteSession: () => set({ pendingDeleteSessionId: undefined }),
createChatFolder: async (name) => {
  const now = Date.now();
  const folder: ChatFolder = {
    id: `folder-${now}`,
    name: name.trim() || "新文件夹",
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
  };
  await saveChatFolder(folder);
  set((state) => ({ chatFolders: [...state.chatFolders, folder] }));
  return folder;
},
```

- [ ] **Step 6: 实现上下文模式**

实现：

```ts
setContextMode: (contextMode) => {
  set((state) => ({
    contextMode,
    pageContext: {
      ...state.pageContext,
      extractMode: contextMode,
    },
  }));
  void get().refreshPageContext();
},
```

在 `refreshPageContext` 的 runtime message 中加入：

```ts
extractMode: get().contextMode,
```

成功设置 `pageContext` 时加入：

```ts
extractMode: get().contextMode,
```

- [ ] **Step 7: 实现发送聊天**

在 store 中实现 `sendChatMessage`。关键逻辑：

```ts
sendChatMessage: async (content) => {
  const trimmedContent = content.trim();
  if (!trimmedContent || get().sending) {
    return;
  }

  const state = get();
  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }

  const modelConfig = createModelConfig(provider, model);
  const now = Date.now();
  const baseSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
  const session =
    baseSession ??
    {
      id: `session-${now}`,
      title: createDefaultSessionTitle(trimmedContent),
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  const userMessage: ChatMessage = {
    id: `message-${now}-user`,
    role: "user",
    content: trimmedContent,
    createdAt: now,
    modelId: model.id,
    endpointType: provider.endpointType,
    streamMode: state.streamMode,
    systemPrompt: model.systemPrompt,
    contextPrompt: state.pageContext.text,
    contextMode: state.contextMode,
    matchedRuleId: state.pageContext.matchedRuleId,
  };
  const nextSession: ChatSession = {
    ...session,
    title: session.messages.length === 0 ? createDefaultSessionTitle(trimmedContent) : session.title,
    updatedAt: now,
    messages: [...session.messages, userMessage],
  };

  await saveChatSession(nextSession);
  set((current) => ({
    sending: true,
    failure: undefined,
    activeSessionId: nextSession.id,
    chatSessions: upsertSession(current.chatSessions, nextSession),
  }));

  const response = await sendRuntimeMessage<{ ok: true; content: string; thinking?: string } | { ok: false; message: string }>({
    type: "chat.send",
    model: modelConfig,
    messages: buildChatRequestMessages({
      model: modelConfig,
      pageContext: state.pageContext.text,
      existingMessages: session.messages,
      userMessage,
    }),
    stream: state.streamMode,
  });

  if (!response.ok) {
    set({ sending: false, failure: { message: response.message } });
    return;
  }

  const assistantMessage: ChatMessage = {
    id: `message-${Date.now()}-assistant`,
    role: "assistant",
    content: response.content,
    thinking: response.thinking,
    createdAt: Date.now(),
    modelId: model.id,
    endpointType: provider.endpointType,
    streamMode: state.streamMode,
    systemPrompt: model.systemPrompt,
    contextPrompt: state.pageContext.text,
    contextMode: state.contextMode,
    matchedRuleId: state.pageContext.matchedRuleId,
  };
  const completedSession: ChatSession = {
    ...nextSession,
    updatedAt: assistantMessage.createdAt,
    messages: [...nextSession.messages, assistantMessage],
  };

  await saveChatSession(completedSession);
  set((current) => ({
    sending: false,
    chatSessions: upsertSession(current.chatSessions, completedSession),
  }));
},
```

在 store 文件底部新增辅助函数：

```ts
function createDefaultSessionTitle(content: string): string {
  return content.length > 20 ? `${content.slice(0, 20)}...` : content;
}

function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  const nextSessions = sessions.filter((item) => item.id !== session.id);
  return [session, ...nextSessions].sort((left, right) => right.updatedAt - left.updatedAt);
}
```

- [ ] **Step 8: 检查测试没有依赖派生状态字段**

确认 `tests/unit/side-panel/appStore.test.ts` 不读取 `state.activeSession`。当前会话统一通过下面的方式派生：

```ts
const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
```

- [ ] **Step 9: 运行 store 测试**

Run:

```bash
npm test -- tests/unit/side-panel/appStore.test.ts
```

Expected: PASS。

- [ ] **Step 10: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。

## Task 6: 聊天 UI 组件

**Files:**
- Modify: `src/side-panel/App.tsx`
- Modify: `src/side-panel/components/ChatPanel.tsx`
- Modify: `src/side-panel/components/MessageList.tsx`
- Modify: `src/side-panel/components/ModelSelector.tsx`
- Modify: `src/side-panel/components/SessionList.tsx`
- Create: `src/side-panel/components/ChatComposer.tsx`
- Create: `src/side-panel/components/SessionHistoryDialog.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写组件失败测试**

在 `tests/unit/side-panel/App.test.tsx` 中追加：

```ts
it("聊天页展示气泡消息、思考过程和提取模式开关", async () => {
  const user = userEvent.setup();
  const provider: ModelProvider = {
    id: "provider-chat",
    name: "聊天渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-chat",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const model: ProviderModel = {
    id: "model-chat",
    providerId: "provider-chat",
    displayName: "聊天模型",
    modelId: "gpt-chat",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      url: "https://example.com/article",
      text: "页面内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    })
    .mockResolvedValueOnce({
      ok: true,
      content: "AI 总结",
      thinking: "先阅读页面",
    });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
    },
  });
  await saveExtractionRule(createExtractionRule({ id: "rule-1", alias: "正文规则" }));
  await saveModelProvider(provider);
  await saveProviderModel(model);

  render(<App />);

  expect(await screen.findByText("已匹配规则：正文规则")).toBeInTheDocument();
  expect(screen.getByLabelText("提取文本")).not.toBeChecked();
  await user.click(screen.getByLabelText("提取文本"));
  expect(screen.getByLabelText("提取所有")).toBeChecked();

  await user.type(screen.getByLabelText("对话输入"), "总结页面");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("总结页面")).toBeInTheDocument();
  expect(await screen.findByText("AI 总结")).toBeInTheDocument();
  expect(screen.getByText("AI 思考过程")).toBeInTheDocument();
});

it("历史会话删除需要先点删再点确认", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新对话" }));
  expect(screen.getByText("新对话")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "删 新对话" }));
  expect(screen.getByRole("button", { name: "确认删除 新对话" })).toBeInTheDocument();
  expect(screen.getByText("新对话")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认删除 新对话" }));
  expect(screen.queryByText("新对话")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行组件测试确认失败**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: FAIL，提示新 UI 和动作未实现。

- [ ] **Step 3: App 启动加载聊天数据**

在 `src/side-panel/App.tsx` 中从 store 读取：

```ts
const loadChatData = useAppStore((state) => state.loadChatData);
```

更新初始化 effect：

```ts
useEffect(() => {
  void Promise.all([loadChannelConfig(), loadExtractionRules(), loadChatData()]).then(() => refreshPageContext());
}, [loadChannelConfig, loadExtractionRules, loadChatData, refreshPageContext]);
```

聊天页布局保持：

```tsx
<section className={showSettings ? "p-4" : "chat-main-layout"}>
  {showSettings ? (
    <SettingsPanel />
  ) : (
    <>
      <SessionList />
      <ChatPanel />
    </>
  )}
</section>
```

- [ ] **Step 4: 实现 `SessionList`**

替换 `src/side-panel/components/SessionList.tsx`。核心结构：

```tsx
import { useMemo, useState } from "react";
import { useAppStore } from "../state/appStore";
import type { ChatSession } from "../../shared/types";

interface SessionListProps {
  compact?: boolean;
}

export function SessionList({ compact = false }: SessionListProps) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const chatSessions = useAppStore((state) => state.chatSessions);
  const chatFolders = useAppStore((state) => state.chatFolders);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const pendingDeleteSessionId = useAppStore((state) => state.pendingDeleteSessionId);
  const createChatSession = useAppStore((state) => state.createChatSession);
  const selectChatSession = useAppStore((state) => state.selectChatSession);
  const archiveChatSession = useAppStore((state) => state.archiveChatSession);
  const requestDeleteChatSession = useAppStore((state) => state.requestDeleteChatSession);
  const confirmDeleteChatSession = useAppStore((state) => state.confirmDeleteChatSession);

  const activeSessions = chatSessions.filter((session) => !session.archived);
  const archivedSessions = chatSessions.filter((session) => session.archived);
  const defaultSessions = activeSessions.filter((session) => !session.folderId);
  const sessionsByFolder = useMemo(() => {
    return new Map(chatFolders.map((folder) => [folder.id, activeSessions.filter((session) => session.folderId === folder.id)]));
  }, [activeSessions, chatFolders]);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  return (
    <aside aria-label="历史会话" className={compact ? "session-list session-list-compact" : "session-list"}>
      <div className="session-list-header">
        <p className="session-list-title">历史对话</p>
        <button className="ui-button-secondary" type="button" onClick={() => void createChatSession()}>
          新对话
        </button>
      </div>
      <div className="session-list-scroll">
        <div className="session-folder-stack">
          <SessionFolder
            title="默认文件夹"
            sessions={defaultSessions}
            collapsed={collapsedFolderIds.has("default")}
            onToggle={() => toggleFolder("default")}
            activeSessionId={activeSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
            onSelect={selectChatSession}
            onArchive={(sessionId) => void archiveChatSession(sessionId)}
            onRequestDelete={requestDeleteChatSession}
            onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
          />
          {chatFolders.map((folder) => (
            <SessionFolder
              key={folder.id}
              title={folder.name}
              sessions={sessionsByFolder.get(folder.id) ?? []}
              collapsed={collapsedFolderIds.has(folder.id)}
              onToggle={() => toggleFolder(folder.id)}
              activeSessionId={activeSessionId}
              pendingDeleteSessionId={pendingDeleteSessionId}
              onSelect={selectChatSession}
              onArchive={(sessionId) => void archiveChatSession(sessionId)}
              onRequestDelete={requestDeleteChatSession}
              onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
            />
          ))}
        </div>
        <div className="session-archive-bottom">
          <SessionFolder
            title="已归档"
            sessions={archivedSessions}
            collapsed={archivedCollapsed}
            onToggle={() => setArchivedCollapsed((value) => !value)}
            activeSessionId={activeSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
            onSelect={selectChatSession}
            onRequestDelete={requestDeleteChatSession}
            onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
          />
        </div>
      </div>
    </aside>
  );
}
```

同文件中补 `SessionFolder` 和 `SessionItem`，按钮 aria-label 使用 `删 ${session.title}`、`确认删除 ${session.title}`。

- [ ] **Step 5: 实现 `MessageList`**

`src/side-panel/components/MessageList.tsx` 改为接收当前会话消息：

```tsx
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../../shared/types";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <section aria-label="消息列表" className="message-list">
        <p className="ui-muted text-sm">暂无消息</p>
      </section>
    );
  }

  return (
    <section aria-label="消息列表" className="message-list">
      {messages.map((message) => (
        <article key={message.id} className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
          <div className="message-avatar" aria-hidden="true">
            {message.role === "user" ? "我" : "AI"}
          </div>
          <div className="message-bubble-wrap">
            {message.role === "assistant" && message.thinking ? (
              <details className="message-thinking">
                <summary>AI 思考过程</summary>
                <p>{message.thinking}</p>
              </details>
            ) : null}
            <div className="message-bubble">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
```

- [ ] **Step 6: 实现 `ChatComposer`**

创建 `src/side-panel/components/ChatComposer.tsx`：

```tsx
import { useState } from "react";
import { useAppStore } from "../state/appStore";

interface ChatComposerProps {
  canSend: boolean;
  matchedRuleLabel: string;
}

export function ChatComposer({ canSend, matchedRuleLabel }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const streamMode = useAppStore((state) => state.streamMode);
  const contextMode = useAppStore((state) => state.contextMode);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const setStreamMode = useAppStore((state) => state.setStreamMode);
  const setContextMode = useAppStore((state) => state.setContextMode);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);

  const submit = async () => {
    const content = input.trim();
    if (!content) {
      return;
    }

    await sendChatMessage(content);
    setInput("");
  };

  return (
    <section className="chat-composer" aria-label="聊天输入区">
      <div className="context-strip">
        <details>
          <summary>查看上下文</summary>
          <p className="context-preview">{pageContext.text || "暂无上下文"}</p>
        </details>
        <span className="context-chip">{matchedRuleLabel}</span>
        <button className="ui-button-secondary" type="button" onClick={() => void refreshPageContext()}>
          刷新
        </button>
      </div>
      {pageContext.truncated ? <p className="text-sm text-[var(--color-warning)]">内容已截断，请细化 CSS/XPath</p> : null}
      {pageContext.error ? <p className="text-sm text-[var(--color-error)]">{pageContext.error}</p> : null}
      <textarea
        className="ui-input chat-input"
        aria-label="对话输入"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <div className="composer-actions">
        <div className="composer-switches">
          <label className="switch-label">
            <input type="checkbox" checked={streamMode} onChange={(event) => setStreamMode(event.target.checked)} />
            流式响应
          </label>
          <label className="switch-label">
            <input
              type="checkbox"
              aria-label={contextMode === "all" ? "提取所有" : "提取文本"}
              checked={contextMode === "all"}
              onChange={(event) => setContextMode(event.target.checked ? "all" : "text")}
            />
            {contextMode === "all" ? "提取所有" : "提取文本"}
          </label>
        </div>
        <button className="ui-button-primary" type="button" disabled={!canSend || sending || !input.trim()} onClick={() => void submit()}>
          {sending ? "发送中" : "发送"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: 实现窄面板历史弹窗**

创建 `src/side-panel/components/SessionHistoryDialog.tsx`：

```tsx
import * as Dialog from "@radix-ui/react-dialog";
import { SessionList } from "./SessionList";

interface SessionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionHistoryDialog({ open, onOpenChange }: SessionHistoryDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="history-dialog">
          <Dialog.Title className="history-dialog-title">历史记录</Dialog.Title>
          <SessionList compact />
          <Dialog.Close className="ui-button-secondary" type="button">
            关闭
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 8: 改造 `ChatPanel`**

`ChatPanel` 中计算：

```ts
const activeSession = useAppStore((state) => state.chatSessions.find((session) => session.id === state.activeSessionId));
const contextMode = useAppStore((state) => state.contextMode);
```

保留模型可用判断，移除示例按钮和模拟失败按钮。渲染结构：

```tsx
<section className="chat-panel">
  <div className="chat-model-row">
    <ModelSelector />
    <button className="ui-button-secondary chat-history-trigger" type="button" onClick={() => setHistoryOpen(true)}>
      历史
    </button>
  </div>
  <MessageList messages={activeSession?.messages ?? []} />
  <ChatComposer canSend={canSend} matchedRuleLabel={matchedRuleLabel} />
  <SessionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
</section>
```

`matchedRuleLabel` 规则：

```ts
const matchedRuleLabel = matchedRule
  ? `已匹配规则：${matchedRule.alias || matchedRule.urlPattern}`
  : contextMode === "all"
    ? "全局 HTML"
    : "全局文本";
```

如果 `pageContext.usedFallback && pageContext.matchedRuleId`，显示 `规则命中但无内容，已回退`。

- [ ] **Step 9: 简化 `ModelSelector`**

`ModelSelector` 只保留“当前模型”和下拉菜单，不再包含流式响应 checkbox。

- [ ] **Step 10: 添加样式**

在 `src/side-panel/styles.css` 的 `@layer components` 中追加聊天样式。所有颜色使用 `var(--color-*)`，例如：

```css
.chat-main-layout {
  @apply grid gap-4 p-4;
}

@media (min-width: 720px) {
  .chat-main-layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }
}

.session-list {
  @apply hidden min-h-[calc(100vh-96px)] flex-col rounded-lg p-3;
  background: var(--color-surface-card);
  border: 1px solid var(--color-hairline);
}

@media (min-width: 720px) {
  .session-list {
    @apply flex;
  }
}

.session-list-compact {
  @apply flex min-h-0;
}

.session-list-scroll {
  @apply flex min-h-0 flex-1 flex-col overflow-auto;
}

.session-archive-bottom {
  @apply mt-auto pt-3;
}

.chat-panel {
  @apply flex min-h-[calc(100vh-96px)] min-w-0 flex-col overflow-hidden rounded-lg;
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
}

.message-list {
  @apply flex min-h-48 flex-1 flex-col gap-3 overflow-auto p-3;
}

.message-row {
  @apply flex items-start gap-2;
}

.message-row-user {
  @apply justify-end;
}

.message-row-user .message-avatar {
  @apply order-2;
  background: var(--color-primary);
}

.message-avatar {
  @apply grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs;
  background: var(--color-surface-dark);
  color: var(--color-on-dark);
}

.message-bubble-wrap {
  max-width: min(78%, 560px);
}

.message-bubble {
  @apply rounded-lg px-3 py-2 text-sm;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-hairline);
}

.message-row-user .message-bubble {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
}
```

继续补齐 composer、dialog、session-item 样式，避免硬编码新颜色。

- [ ] **Step 11: 运行组件测试**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: PASS。

- [ ] **Step 12: 保存点，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出。

## Task 7: 端到端验证与构建收口

**Files:**
- Modify as needed: `tests/e2e/extension-smoke.spec.ts`
- No production file changes unless previous tasks reveal test-only gaps.

- [ ] **Step 1: 运行全量单元测试**

Run:

```bash
npm test
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected: PASS。

- [ ] **Step 3: 运行构建**

Run:

```bash
npm run build
```

Expected: PASS。

- [ ] **Step 4: 检查 content script 构建产物不是 ES Module**

Run:

```bash
Select-String -LiteralPath 'dist\content\index.js' -Pattern '^import|import\('
```

Expected: 无输出。

- [ ] **Step 5: 如 E2E 依赖旧文案则更新冒烟断言**

先运行：

```bash
npm run test:e2e
```

Expected: PASS。
如果失败且只因旧文案或旧布局断言导致，更新 `tests/e2e/extension-smoke.spec.ts`，让它断言：

- 侧边栏标题存在。
- 当前模型下拉存在。
- 对话输入框存在。
- 发送按钮存在。
- 历史会话区域或历史按钮至少一个存在。

然后再次运行：

```bash
npm run test:e2e
```

Expected: PASS。

- [ ] **Step 6: 最终 diff 检查，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 只包含本需求相关文件。

## 自检清单

- [ ] 设计文档中的“当前会话全部消息提交给 AI”由 Task 3 和 Task 5 覆盖。
- [ ] `extractMode="text" | "all"` 由 Task 2 覆盖。
- [ ] 文件夹、归档、删除确认由 Task 1、Task 5、Task 6 覆盖。
- [ ] AI 思考过程解析和 UI 展示由 Task 3、Task 6 覆盖。
- [ ] background 非流式真实请求由 Task 4 覆盖。
- [ ] 响应式宽窄布局由 Task 6 覆盖。
- [ ] 构建产物 content script 检查由 Task 7 覆盖。
