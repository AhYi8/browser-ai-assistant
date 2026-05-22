# Default Chat Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在渠道管理中增加默认对话模型配置，并让新建对话默认使用该模型。

**Architecture:** 使用现有 `appSettings` 表保存 `defaultChatModelId`，在 Zustand store 中加载、设置和解析默认模型。设置页复用标题模型选项生成方式，在“AI 标题生成模型”上方渲染默认对话模型下拉框。

**Tech Stack:** React、Zustand、Dexie、Vitest、Testing Library、TypeScript。

---

### Task 1: 存储与状态

**Files:**
- Modify: `src/shared/storage/repositories.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Test: `tests/unit/side-panel/appStore.test.ts`

- [ ] 写失败测试：默认对话模型可以保存、加载，并在新建对话时选中。
- [ ] 运行 `npm test -- tests/unit/side-panel/appStore.test.ts`，确认新增测试先失败。
- [ ] 增加 `saveAppSetting`、`getAppSetting` 仓储函数。
- [ ] 在 store 增加 `defaultChatModelId` 和 `setDefaultChatModel`。
- [ ] `loadChannelConfig` 加载默认模型设置，并在设置无效时回退到第一个可用模型。
- [ ] `createChatSession` 新建会话时将 `selectedModelId` 设置为有效默认模型。
- [ ] 删除模型或渠道时，如果删除了默认模型，同步清空设置并回退。

### Task 2: 设置页 UI

**Files:**
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] 写失败测试：默认对话模型下拉框显示在 AI 标题生成模型上方，并可保存选择。
- [ ] 运行 `npm test -- tests/unit/side-panel/App.test.tsx`，确认新增测试先失败。
- [ ] 在渠道管理读取 `defaultChatModelId`、`setDefaultChatModel`。
- [ ] 复用模型选项，在标题模型配置上方新增“默认对话模型”下拉框。
- [ ] 下拉框保留空选项“使用第一个可用模型”。

### Task 3: 验证

**Files:**
- No production changes expected.

- [ ] 运行 `npm test -- tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx`。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run build`。
- [ ] 检查 `git diff --check` 和 `git status --short`。
