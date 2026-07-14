# 历史会话批量操作紧凑布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让批量模式保留并正确表达三个头部按钮状态，同时采用方案 C 压缩批量控制区高度。

**Architecture:** 批量模式仍由每个 `SessionList` 实例本地管理；`SessionList` 负责头部命令状态，`SessionBatchControls` 负责分区与带数量的批量命令。仅调整组件标记与样式，不改变仓库层、Store 或批量事务语义。

**Tech Stack:** React、TypeScript、Zustand、Tailwind CSS、Vitest、Testing Library

---

### Task 1: 先锁定头部按钮与数量文案契约

**Files:**
- Modify: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 修改批量模式组件测试，使其要求三个头部按钮常驻**

在“批量操作只能按单个文件夹全选并确认归档”用例中，进入批量模式后校验：

```tsx
const batchToggle = screen.getByRole("button", { name: "批量操作" });
expect(batchToggle).toHaveAttribute("aria-pressed", "true");
expect(screen.getByRole("button", { name: "新建文件夹" })).toBeDisabled();
expect(screen.getByRole("button", { name: "新对话" })).toBeDisabled();
expect(screen.getByRole("button", { name: "归档 0" })).toBeDisabled();
expect(screen.getByRole("button", { name: "删除 0" })).toBeDisabled();
```

- [ ] **Step 2: 修改选择数量与已归档分区断言**

选择一项后要求按钮名称更新为“归档 1”和“删除 1”；切换已归档分区后要求“归档 0”不存在，只保留“删除 0”。窄屏历史弹窗同样校验“归档 1”与“删除 1”。

- [ ] **Step 3: 运行定向测试并确认红灯**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx -t "批量"
```

Expected: FAIL，失败原因是新建按钮被移除，且操作按钮尚未包含数量。

### Task 2: 实现头部常驻按钮与方案 C 标记结构

**Files:**
- Modify: `src/side-panel/components/SessionList.tsx`
- Modify: `src/side-panel/components/SessionBatchControls.tsx`

- [ ] **Step 1: 让头部三个按钮常驻并正确禁用**

将条件渲染改为常驻按钮：

```tsx
<button
  className="ui-button-secondary session-header-button"
  type="button"
  aria-label="新建文件夹"
  disabled={batchMode || batchOperationPending}
  onClick={() => void handleCreateFolder()}
>
  新建文件夹
</button>
<button
  className="ui-button-secondary session-header-button"
  type="button"
  aria-label="新对话"
  disabled={batchMode || batchOperationPending}
  onClick={() => void createChatSession({ preserveSelectedModel: composerHasDraft })}
>
  新建
</button>
```

- [ ] **Step 2: 将选择数量并入操作按钮**

保留视觉隐藏的选择状态，并将按钮文案改为：

```tsx
<span className="sr-only" aria-live="polite">已选 {selectedCount} 项</span>
{partition === "active" ? <button>归档 {selectedCount}</button> : null}
<button>删除 {selectedCount}</button>
```

按钮的禁用规则、确认入口与提交状态保持不变。

- [ ] **Step 3: 运行定向测试并确认组件行为转绿**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx -t "批量"
```

Expected: PASS。

### Task 3: 压缩批量工具栏并高亮激活入口

**Files:**
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 更新样式契约测试**

要求样式包含批量入口按下态与单行三列结构：

```tsx
expect(styles).toContain('.session-batch-toggle[aria-pressed="true"]');
expect(styles).toContain("grid-template-columns: minmax(0, 1fr) auto auto;");
```

- [ ] **Step 2: 运行样式契约测试并确认红灯**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx -t "批量管理控件在窄面板保持稳定布局"
```

Expected: FAIL，失败原因是按下态和单行网格尚未实现。

- [ ] **Step 3: 实现方案 C 样式**

使用以下结构压缩控制区：

```css
.session-batch-toggle[aria-pressed="true"] {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-canvas));
  color: var(--color-primary);
}

.session-batch-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
}
```

分段控件缩小内边距和高度，操作按钮使用内容宽度且保持文字不换行；删除按钮固定在第三列，使已归档分区缺少归档按钮时仍保持右对齐。

- [ ] **Step 4: 运行全部批量组件测试**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx -t "批量"
```

Expected: PASS。

### Task 4: 同步工程约束并完成验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 补充历史会话批量 UI 约束**

记录以下规则：批量模式保留三个头部命令，批量入口高亮，非批量命令禁用；选择数量并入操作按钮，控制区使用紧凑稳定网格；文件夹级全选不得跨文件夹。

- [ ] **Step 2: 运行批量功能相关三层测试**

Run:

```powershell
npx vitest run tests/unit/shared/storage.test.ts tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx -t "批量"
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查与扩展构建**

Run:

```powershell
npm run typecheck
npm run build:extension
```

Expected: 两条命令均以退出码 0 完成。

- [ ] **Step 4: 在桌面和 390px 窄屏检查布局**

确认批量控制区为单行、三个头部按钮无溢出、文字无重叠、已归档分区只显示删除操作。

- [ ] **Step 5: 暂存全部变更但不提交**

Run:

```powershell
git add .
git diff --cached --check
```

Expected: 无空白错误。项目规则禁止未经用户明确授权执行 `git commit`，因此本计划不包含提交步骤。
