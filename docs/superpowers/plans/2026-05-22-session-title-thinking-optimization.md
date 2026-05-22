# 会话标题与思考状态优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化历史会话标题展示、标题生成等待态和流式思考文案。

**Architecture:** 在 `ChatSession` 增加可选 `titleGenerating` 状态，并由 `appStore` 在首轮发送时并行启动标题生成。`SessionList` 只负责展示标题和等待态，`MessageList` 只负责根据 `streaming` 切换思考 summary 文案。

**Tech Stack:** React、Zustand、Dexie、Vitest、Testing Library。

---

### Task 1: 历史会话标题展示

**Files:**
- Modify: `src/side-panel/components/SessionList.tsx`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖历史列表只显示原始标题、不显示 `会话：`，并验证标题按钮带有完整标题提示。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/side-panel/App.test.tsx`

- [ ] **Step 3: 最小实现**

移除 `会话：` 前缀，给标题按钮或标题文本增加 `title={session.title}`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/side-panel/App.test.tsx`

### Task 2: 标题生成等待态与并行请求

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage/repositories.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `src/side-panel/components/SessionList.tsx`
- Test: `tests/unit/side-panel/appStore.test.ts`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖配置标题模型后首轮发送立即设置 `titleGenerating`，标题请求与主聊天请求并行，成功或失败都会清除等待态。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`

- [ ] **Step 3: 最小实现**

新增 `titleGenerating?: boolean`，首轮发送时保存等待态，标题生成函数只基于用户首条消息生成标题，并在完成后清除等待态。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`

### Task 3: 思考状态文案

**Files:**
- Modify: `src/side-panel/components/MessageList.tsx`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖流式思考中显示 `思考中`，非流式或完成后显示 `思考过程`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/side-panel/App.test.tsx`

- [ ] **Step 3: 最小实现**

根据 `message.streaming` 切换 summary 文案。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/side-panel/App.test.tsx`

### Task 4: 验证

- [ ] Run: `npm run test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] 检查 `dist/content/index.js` 不包含 `^import` 或 `import(`。
