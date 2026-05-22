# AI 对话标题生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加可配置的 AI 对话标题生成能力，未配置时保持当前标题逻辑。

**Architecture:** 复用 `ProviderModel.isTitleModel` 表示全局标题模型。标题生成逻辑集中在 `src/shared/models/titleGeneration.ts`，聊天发送完成后由 `appStore` 触发一次非流式 `chat.send` 请求并更新会话标题。渠道管理 UI 增加一个选择框来设置或取消标题模型。

**Tech Stack:** React、Zustand、Dexie、Vitest、Chrome Extension Runtime Message。

---

### Task 1: 标题 JSON Prompt 与解析

**Files:**
- Modify: `src/shared/models/titleGeneration.ts`
- Test: `tests/unit/shared/titleGeneration.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 未配置标题模型时不调用请求函数，返回当前默认标题。
- 标题模型返回 `{"title":"页面摘要讨论"}` 时返回该标题。
- 标题模型返回非 JSON 时返回当前默认标题。
- 标题消息必须要求 JSON 格式，并且请求参数固定非流式由调用方保证。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/shared/titleGeneration.test.ts`

Expected: 新增用例失败，原因是缺少 JSON Prompt 构造与解析逻辑。

- [ ] **Step 3: 实现最小逻辑**

在 `titleGeneration.ts` 中增加：
- `createTitleGenerationMessages(content: string, assistantContent?: string): ChatMessage[]`
- `parseGeneratedTitle(rawContent: string): string | undefined`
- `generateSessionTitle` 保持失败兜底，但只接受 JSON `title`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/shared/titleGeneration.test.ts`

Expected: 标题生成单元测试通过。

### Task 2: 渠道管理标题模型配置

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Test: `tests/unit/side-panel/appStore.test.ts`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖：
- `setTitleModel("model-1")` 后仅该模型 `isTitleModel` 为 `true`。
- `setTitleModel("")` 后所有模型 `isTitleModel` 为 `false`。
- 设置页展示“AI 标题生成模型”选择框。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`

Expected: 新增用例失败，原因是 store 没有 `setTitleModel`，UI 没有选择框。

- [ ] **Step 3: 实现最小逻辑**

在 `AppState` 增加 `setTitleModel(modelId: string) => void`。更新模型时保存所有被影响模型，并在渠道管理 UI 增加 `AI 标题生成模型` 下拉框，选项包括“不开启自动标题生成”和所有当前模型。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`

Expected: store 和 UI 测试通过。

### Task 3: 聊天完成后非流式生成标题

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Test: `tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 未配置标题模型时，发送消息不会额外请求标题。
- 配置标题模型时，主回复完成后发送一次 `stream: false` 的标题请求。
- 标题请求返回 JSON 后更新会话标题。
- 标题请求失败时保留默认标题且不影响主回复。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts`

Expected: 新增用例失败，原因是聊天链路未调用标题生成。

- [ ] **Step 3: 实现最小逻辑**

在非流式和流式主回复完成后调用同一个标题生成辅助函数。辅助函数只在首轮用户消息场景、存在启用标题模型和启用渠道时执行；请求 `chat.send` 时固定 `stream: false`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts`

Expected: 聊天 store 测试通过。

### Task 4: 全量验证

**Files:**
- No code changes.

- [ ] **Step 1: 运行相关单元测试**

Run: `npm run test -- tests/unit/shared/titleGeneration.test.ts tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`

Expected: 相关测试通过。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`

Expected: TypeScript 类型检查通过。

- [ ] **Step 3: 运行构建**

Run: `npm run build`

Expected: Vite 构建通过，且 content script 产物仍不含静态 import。
