# 聊天主界面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化聊天主界面历史侧栏、文件夹管理、拖拽移动、上下文弹窗、Switch 控件和滚动布局体验。

**Architecture:** 在现有 React + Zustand + Dexie 存储结构上做增量增强，不新增数据库表。状态层补齐文件夹重命名和会话移动动作，UI 层重构 `SessionList` 的会话操作菜单和拖拽交互，`ChatComposer` 增加上下文弹窗与可访问 Switch，样式层收紧全局滚动并只让消息区内部滚动。

**Tech Stack:** React 19、Zustand、Dexie、Radix Dialog、Testing Library、Vitest、Tailwind CSS、Chrome Extension MV3。

---

## 重要约束

- 所有用户可见文案、文档和注释使用简体中文。
- 未经用户明确授权不得执行 `git commit`。
- 本计划中的保存点只运行 `git add .`、`git diff --check` 和 `git status --short`，不提交。
- 遵守 Claude light 主题，颜色优先使用 `var(--color-*)` token，不在组件中硬编码十六进制颜色。
- 保留上轮 MVP 行为：删除两段式确认、文件夹标题左侧无 `›` / `⌄`、已归档默认折叠且位于底部。
- 当前已有大量暂存变更，执行时不得回滚既有改动。

## 文件结构

### 修改文件

- `src/side-panel/state/appStore.ts`：补齐 `renameChatFolder`、`moveChatSessionToFolder`，并在失败时设置中文失败提示。
- `src/side-panel/components/SessionList.tsx`：历史侧栏加宽后的结构适配、会话菜单、原地重命名、新建文件夹、文件夹重命名、拖拽投放。
- `src/side-panel/components/ChatComposer.tsx`：上下文弹窗、Switch 控件结构。
- `src/side-panel/components/MessageList.tsx`：确认思考过程默认折叠和文案为“思考过程”。
- `src/side-panel/styles.css`：历史侧栏宽度、菜单、拖拽态、Switch、上下文弹窗、固定面板高度和内部滚动样式。
- `tests/unit/side-panel/appStore.test.ts`：补充文件夹重命名和会话移动单测。
- `tests/unit/side-panel/App.test.tsx`：补充 UI 交互测试。

### 不新增文件

本轮不新增组件文件，避免为小交互拆出过多抽象。`SessionHistoryDialog` 继续复用 `SessionList compact`。

## Task 1: Store 文件夹动作补齐

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Test: `tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 1: 写失败测试，覆盖文件夹重命名**

在 `tests/unit/side-panel/appStore.test.ts` 中追加：

```ts
it("可以重命名聊天文件夹", async () => {
  const folder = await useAppStore.getState().createChatFolder("旧文件夹");

  await useAppStore.getState().renameChatFolder(folder.id, " 新文件夹 ");

  expect(useAppStore.getState().chatFolders).toEqual([
    {
      ...folder,
      name: "新文件夹",
      updatedAt: expect.any(Number),
    },
  ]);
});

it("文件夹重命名为空时保持原名称", async () => {
  const folder = await useAppStore.getState().createChatFolder("资料");

  await useAppStore.getState().renameChatFolder(folder.id, "   ");

  expect(useAppStore.getState().chatFolders[0]?.name).toBe("资料");
});
```

- [ ] **Step 2: 写失败测试，覆盖会话移动到文件夹和默认文件夹**

在同一测试文件追加：

```ts
it("可以把会话移动到指定文件夹再移回默认文件夹", async () => {
  const session = await useAppStore.getState().createChatSession();
  const folder = await useAppStore.getState().createChatFolder("工作资料");

  await useAppStore.getState().moveChatSessionToFolder(session.id, folder.id);

  expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.folderId).toBe(folder.id);

  await useAppStore.getState().moveChatSessionToFolder(session.id, undefined);

  expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)?.folderId).toBeUndefined();
});

it("移动会话到不存在的文件夹时不改变会话", async () => {
  const session = await useAppStore.getState().createChatSession();

  await useAppStore.getState().moveChatSessionToFolder(session.id, "missing-folder");

  expect(useAppStore.getState().chatSessions.find((item) => item.id === session.id)).toEqual(session);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npm test -- tests/unit/side-panel/appStore.test.ts
```

Expected: FAIL，提示 `renameChatFolder` 和 `moveChatSessionToFolder` 不存在。

- [ ] **Step 4: 扩展 store 类型**

在 `src/side-panel/state/appStore.ts` 的 `AppState` 中加入：

```ts
  renameChatFolder: (folderId: string, name: string) => Promise<void>;
  moveChatSessionToFolder: (sessionId: string, folderId: string | undefined) => Promise<void>;
```

- [ ] **Step 5: 实现 `renameChatFolder`**

在 `createChatFolder` 后加入：

```ts
  renameChatFolder: async (folderId, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const folder = get().chatFolders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    const updatedFolder: ChatFolder = {
      ...folder,
      name: trimmedName,
      updatedAt: Date.now(),
    };

    try {
      await saveChatFolder(updatedFolder);
      set((state) => ({
        chatFolders: state.chatFolders.map((item) => (item.id === folderId ? updatedFolder : item)),
      }));
    } catch {
      set({ failure: { message: "文件夹保存失败，请重试" } });
    }
  },
```

- [ ] **Step 6: 实现 `moveChatSessionToFolder`**

在 `renameChatFolder` 后加入：

```ts
  moveChatSessionToFolder: async (sessionId, folderId) => {
    const session = get().chatSessions.find((item) => item.id === sessionId);
    if (!session || session.archived) {
      return;
    }

    if (folderId && !get().chatFolders.some((folder) => folder.id === folderId)) {
      return;
    }

    const updatedSession: ChatSession = {
      ...session,
      folderId,
      updatedAt: Date.now(),
    };

    try {
      await saveChatSession(updatedSession);
      set((state) => ({
        chatSessions: state.chatSessions.map((item) => (item.id === sessionId ? updatedSession : item)),
        pendingDeleteSessionId: undefined,
      }));
    } catch {
      set({ failure: { message: "会话移动失败，请重试" } });
    }
  },
```

- [ ] **Step 7: 运行 store 测试**

Run:

```bash
npm test -- tests/unit/side-panel/appStore.test.ts
```

Expected: PASS。

- [ ] **Step 8: 保存点，不提交**

Run:

```bash
git add src/side-panel/state/appStore.ts tests/unit/side-panel/appStore.test.ts
git diff --check
git status --short
```

Expected: `git diff --check` 无空白错误。

## Task 2: 历史侧栏菜单、重命名、文件夹和拖拽

**Files:**
- Modify: `src/side-panel/components/SessionList.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖会话菜单**

在 `tests/unit/side-panel/App.test.tsx` 中追加：

```ts
it("历史会话通过菜单提供重命名归档和删除操作", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新对话" }));
  await screen.findByText("新对话");

  await user.click(screen.getByRole("button", { name: "更多操作 新对话" }));

  expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "归档" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删 新对话" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 写失败测试，覆盖菜单删除确认**

在同一测试文件追加：

```ts
it("历史会话菜单删除需要二次确认", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新对话" }));
  await screen.findByText("新对话");
  await user.click(screen.getByRole("button", { name: "更多操作 新对话" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));

  expect(screen.getByRole("menuitem", { name: "确认删除" })).toBeInTheDocument();
  expect(screen.getByText("新对话")).toBeInTheDocument();

  await user.click(screen.getByRole("menuitem", { name: "确认删除" }));

  await waitFor(() => expect(screen.queryByText("新对话")).not.toBeInTheDocument());
});
```

- [ ] **Step 3: 写失败测试，覆盖会话原地重命名**

在同一测试文件追加：

```ts
it("可以通过菜单原地重命名历史会话", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新对话" }));
  await screen.findByText("新对话");
  await user.click(screen.getByRole("button", { name: "更多操作 新对话" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));

  const input = screen.getByLabelText("重命名会话");
  await user.clear(input);
  await user.type(input, "资料整理{Enter}");

  expect(await screen.findByText("会话：资料整理")).toBeInTheDocument();
});
```

- [ ] **Step 4: 写失败测试，覆盖新建文件夹和文件夹重命名**

在同一测试文件追加：

```ts
it("可以新建文件夹并原地重命名", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新建文件夹" }));

  const input = await screen.findByLabelText("重命名文件夹");
  await user.clear(input);
  await user.type(input, "研究资料{Enter}");

  expect(await screen.findByRole("button", { name: /研究资料/ })).toBeInTheDocument();
});
```

- [ ] **Step 5: 写失败测试，覆盖拖拽移动会话**

在同一测试文件追加：

```ts
it("可以拖拽会话移动到指定文件夹", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "新建文件夹" }));
  const folderInput = await screen.findByLabelText("重命名文件夹");
  await user.clear(folderInput);
  await user.type(folderInput, "工作资料{Enter}");

  await user.click(screen.getByRole("button", { name: "新对话" }));
  const session = await screen.findByText("新对话");
  const folderTarget = screen.getByRole("button", { name: /工作资料/ });

  fireEvent.dragStart(session.closest("article")!, {
    dataTransfer: {
      setData: vi.fn(),
      getData: vi.fn(() => "session-ignored"),
      effectAllowed: "",
    },
  });
  fireEvent.dragOver(folderTarget);
  fireEvent.drop(folderTarget);

  await user.click(folderTarget);

  expect(await screen.findByText("新对话")).toBeInTheDocument();
});
```

执行时如果 Testing Library 的 `dataTransfer` 对象不能覆盖真实 session id，应在组件实现中同时支持从 React 状态读取拖拽中的 session id，测试只需触发 `dragStart` / `drop`。

- [ ] **Step 6: 运行组件测试确认失败**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: FAIL，提示菜单、新建文件夹或拖拽交互不存在。

- [ ] **Step 7: 修改 `SessionList` 引入新 store 动作与局部状态**

在 `src/side-panel/components/SessionList.tsx` 的 `SessionList` 中加入：

```ts
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | undefined>();
  const [renamingSessionId, setRenamingSessionId] = useState<string | undefined>();
  const [renamingFolderId, setRenamingFolderId] = useState<string | undefined>();
  const [draggingSessionId, setDraggingSessionId] = useState<string | undefined>();
  const [dragOverFolderId, setDragOverFolderId] = useState<string | undefined>();
  const renameChatSession = useAppStore((state) => state.renameChatSession);
  const createChatFolder = useAppStore((state) => state.createChatFolder);
  const renameChatFolder = useAppStore((state) => state.renameChatFolder);
  const moveChatSessionToFolder = useAppStore((state) => state.moveChatSessionToFolder);
```

- [ ] **Step 8: 新建文件夹按钮**

把侧栏头部按钮区调整为：

```tsx
<div className="session-list-header">
  <p className="session-list-title">历史对话</p>
  <div className="session-list-header-actions">
    <button
      className="ui-button-secondary"
      type="button"
      onClick={() => {
        void createChatFolder("新文件夹").then((folder) => setRenamingFolderId(folder.id));
      }}
    >
      新建文件夹
    </button>
    <button className="ui-button-secondary" type="button" aria-label="新对话" onClick={() => void createChatSession()}>
      新建
    </button>
  </div>
</div>
```

- [ ] **Step 9: 扩展 `SessionFolder` props**

把 `SessionFolderProps` 扩展为：

```ts
interface SessionFolderProps {
  id?: string;
  title: string;
  sessions: ChatSession[];
  collapsed: boolean;
  activeSessionId: string;
  pendingDeleteSessionId?: string;
  renamingFolder: boolean;
  dragOver: boolean;
  onToggle: () => void;
  onRenameFolder: (name: string) => Promise<void>;
  onStartRenameFolder: () => void;
  onDropSession: () => void;
  onDragOverFolder: () => void;
  onDragLeaveFolder: () => void;
  onSelect: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onConfirmDelete: (sessionId: string) => void;
  onClearPendingDelete: () => void;
  openMenuSessionId?: string;
  renamingSessionId?: string;
  onOpenMenu: (sessionId: string | undefined) => void;
  onStartRenameSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onDragStartSession: (sessionId: string) => void;
}
```

- [ ] **Step 10: 实现文件夹标题编辑和投放目标**

在 `SessionFolder` 内将标题按钮改成以下结构：

```tsx
<div
  className={dragOver ? "session-folder session-folder-drag-over" : "session-folder"}
  onDragOver={(event) => {
    event.preventDefault();
    onDragOverFolder();
  }}
  onDragLeave={onDragLeaveFolder}
  onDrop={(event) => {
    event.preventDefault();
    onDropSession();
  }}
>
  {renamingFolder ? (
    <input
      className="ui-input session-folder-input"
      aria-label="重命名文件夹"
      defaultValue={title}
      autoFocus
      onBlur={(event) => void onRenameFolder(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          void onRenameFolder(event.currentTarget.value);
        }
        if (event.key === "Escape") {
          onRenameFolder(title);
        }
      }}
    />
  ) : (
    <button className="session-folder-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed}>
      <span>{title}</span>
      <span className="session-count">{sessions.length}</span>
    </button>
  )}
```

执行时保留默认文件夹可折叠，但默认文件夹不进入重命名状态。

- [ ] **Step 11: 实现会话菜单和原地重命名**

把 `SessionItem` 渲染改成：

```tsx
<article
  className={active ? "session-item session-item-active" : "session-item"}
  draggable={!session.archived}
  onDragStart={() => onDragStartSession(session.id)}
>
  <div className="session-item-main-row">
    {renaming ? (
      <input
        className="ui-input session-title-input"
        aria-label="重命名会话"
        defaultValue={session.title}
        autoFocus
        onBlur={(event) => void onRenameSession(session.id, event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void onRenameSession(session.id, event.currentTarget.value);
          }
          if (event.key === "Escape") {
            onOpenMenu(undefined);
          }
        }}
      />
    ) : (
      <button className="session-title-button" type="button" onClick={() => onSelect(session.id)}>
        <span className="session-item-title">{session.title === "新对话" ? session.title : `会话：${session.title}`}</span>
      </button>
    )}
    <button
      className="session-menu-button"
      type="button"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={`更多操作 ${session.title}`}
      onClick={() => {
        onClearPendingDelete();
        onOpenMenu(menuOpen ? undefined : session.id);
      }}
    >
      ⋯
    </button>
  </div>
  {menuOpen ? (
    <div className="session-action-menu" role="menu">
      <button role="menuitem" type="button" onClick={() => onStartRenameSession(session.id)}>
        重命名
      </button>
      {onArchive ? (
        <button role="menuitem" type="button" onClick={() => onArchive(session.id)}>
          归档
        </button>
      ) : null}
      <button
        role="menuitem"
        type="button"
        className={pendingDelete ? "session-menu-danger" : undefined}
        onClick={() => (pendingDelete ? onConfirmDelete(session.id) : onRequestDelete(session.id))}
      >
        {pendingDelete ? "确认删除" : "删除"}
      </button>
    </div>
  ) : null}
</article>
```

- [ ] **Step 12: 在 `SessionList` 传入拖拽和重命名回调**

普通文件夹和默认文件夹传入：

```tsx
onRenameFolder={async (name) => {
  setRenamingFolderId(undefined);
  if (folder.id) {
    await renameChatFolder(folder.id, name);
  }
}}
onDropSession={() => {
  if (draggingSessionId) {
    void moveChatSessionToFolder(draggingSessionId, folder.id);
  }
  setDraggingSessionId(undefined);
  setDragOverFolderId(undefined);
}}
onDragOverFolder={() => setDragOverFolderId(folder.id ?? "default")}
onDragLeaveFolder={() => setDragOverFolderId(undefined)}
onRenameSession={async (sessionId, title) => {
  setRenamingSessionId(undefined);
  await renameChatSession(sessionId, title);
}}
onStartRenameSession={(sessionId) => {
  setOpenMenuSessionId(undefined);
  setRenamingSessionId(sessionId);
}}
onDragStartSession={setDraggingSessionId}
```

默认文件夹的 `folder.id` 使用 `undefined`，`dragOver` 使用 `"default"` 哨兵值。

- [ ] **Step 13: 更新历史侧栏样式**

在 `src/side-panel/styles.css` 中更新或新增：

```css
.chat-main-layout {
  @apply grid min-h-0 gap-4 p-4;
  height: calc(100vh - 64px);
  overflow: hidden;
}

@media (min-width: 720px) {
  .chat-main-layout {
    grid-template-columns: 264px minmax(0, 1fr);
  }
}

.session-list {
  @apply hidden min-h-0 flex-col rounded-lg p-3;
  height: 100%;
  background: var(--color-surface-card);
  border: 1px solid var(--color-hairline);
}

.session-list-header-actions {
  @apply flex items-center gap-2;
}

.session-item-main-row {
  @apply flex min-w-0 items-center gap-2;
}

.session-menu-button {
  @apply grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-hairline);
  color: var(--color-body);
}

.session-action-menu {
  @apply grid gap-1 rounded-md p-1;
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
  box-shadow: 0 1px 3px rgba(20, 20, 19, 0.08);
}

.session-action-menu button {
  @apply min-h-8 rounded-sm px-2 text-left text-sm;
  color: var(--color-body);
}

.session-action-menu button:hover {
  background: var(--color-surface-soft);
}

.session-menu-danger {
  color: var(--color-error) !important;
}

.session-folder-drag-over {
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}

.session-title-input,
.session-folder-input {
  @apply min-w-0 flex-1 px-2 py-1 text-sm;
}
```

- [ ] **Step 14: 运行组件测试**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: PASS。

- [ ] **Step 15: 保存点，不提交**

Run:

```bash
git add src/side-panel/components/SessionList.tsx src/side-panel/styles.css tests/unit/side-panel/App.test.tsx
git diff --check
git status --short
```

Expected: `git diff --check` 无空白错误。

## Task 3: 输入区 Switch 与上下文弹窗

**Files:**
- Modify: `src/side-panel/components/ChatComposer.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖上下文弹窗**

在 `tests/unit/side-panel/App.test.tsx` 中追加：

```ts
it("点击查看上下文会通过弹窗展示当前上下文", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
        if (message.type === "pageContext.extract") {
          callback({
            ok: true,
            text: "弹窗上下文内容",
            truncated: false,
            usedFallback: true,
          });
        }
        return undefined;
      }),
    },
  });

  render(<App />);

  await screen.findByText("全局文本");
  await user.click(screen.getByRole("button", { name: "查看上下文" }));

  expect(screen.getByRole("dialog", { name: "当前页上下文" })).toBeInTheDocument();
  expect(screen.getByText("弹窗上下文内容")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "关闭上下文" }));

  expect(screen.queryByRole("dialog", { name: "当前页上下文" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 写失败测试，覆盖 Switch 结构**

在同一测试文件追加：

```ts
it("输入区使用 switch 控件切换流式响应和提取模式", async () => {
  const user = userEvent.setup();
  render(<App />);

  const streamSwitch = screen.getByRole("switch", { name: "流式响应" });
  const contextSwitch = screen.getByRole("switch", { name: "提取文本" });

  expect(streamSwitch).toHaveAttribute("aria-checked", "false");
  expect(contextSwitch).toHaveAttribute("aria-checked", "false");

  await user.click(streamSwitch);
  await user.click(contextSwitch);

  expect(screen.getByRole("switch", { name: "流式响应" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("switch", { name: "提取所有" })).toHaveAttribute("aria-checked", "true");
});
```

- [ ] **Step 3: 运行组件测试确认失败**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: FAIL，提示上下文仍是 `details`，开关仍是 checkbox。

- [ ] **Step 4: 在 `ChatComposer` 增加弹窗状态**

在 `ChatComposer` 中加入：

```ts
  const [contextOpen, setContextOpen] = useState(false);
```

- [ ] **Step 5: 替换上下文 `details` 为按钮和弹窗**

把 `context-strip` 内的 `details` 替换为：

```tsx
<button className="ui-button-secondary" type="button" onClick={() => setContextOpen(true)}>
  查看上下文
</button>
```

在 `</section>` 前加入：

```tsx
{contextOpen ? (
  <div className="context-dialog-backdrop" role="presentation">
    <section className="context-dialog" role="dialog" aria-modal="true" aria-label="当前页上下文">
      <div className="context-dialog-header">
        <h2>当前页上下文</h2>
        <button className="ui-button-secondary" type="button" aria-label="关闭上下文" onClick={() => setContextOpen(false)}>
          关闭
        </button>
      </div>
      <pre className="context-dialog-body">{pageContext.text || "暂无上下文"}</pre>
    </section>
  </div>
) : null}
```

- [ ] **Step 6: 实现可访问 Switch 结构**

在 `ChatComposer.tsx` 中新增本地组件：

```tsx
interface ComposerSwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ComposerSwitch({ label, checked, onCheckedChange }: ComposerSwitchProps) {
  return (
    <button
      className={checked ? "composer-switch composer-switch-on" : "composer-switch"}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="composer-switch-track" aria-hidden="true">
        <span className="composer-switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}
```

把原有两个 checkbox label 替换为：

```tsx
<ComposerSwitch label="流式响应" checked={streamMode} onCheckedChange={setStreamMode} />
<ComposerSwitch
  label={contextMode === "all" ? "提取所有" : "提取文本"}
  checked={contextMode === "all"}
  onCheckedChange={(checked) => setContextMode(checked ? "all" : "text")}
/>
```

- [ ] **Step 7: 添加弹窗和 Switch 样式**

在 `src/side-panel/styles.css` 中新增：

```css
.composer-switches {
  @apply flex flex-wrap items-center gap-3;
}

.composer-switch {
  @apply flex min-h-10 items-center gap-2 rounded-md px-2 text-sm;
  color: var(--color-body);
}

.composer-switch-track {
  @apply relative inline-flex h-6 w-11 shrink-0 rounded-full;
  background: var(--color-primary-disabled);
}

.composer-switch-thumb {
  @apply absolute left-1 top-1 h-4 w-4 rounded-full transition-transform;
  background: var(--color-canvas);
}

.composer-switch-on .composer-switch-track {
  background: var(--color-primary);
}

.composer-switch-on .composer-switch-thumb {
  transform: translateX(20px);
}

.context-dialog-backdrop {
  @apply fixed inset-0 z-40 grid place-items-end p-4;
  background: color-mix(in srgb, var(--color-surface-dark) 28%, transparent);
}

.context-dialog {
  @apply grid max-h-[72vh] w-full max-w-xl overflow-hidden rounded-lg;
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
}

.context-dialog-header {
  @apply flex items-center justify-between gap-3 p-3;
  border-bottom: 1px solid var(--color-hairline);
}

.context-dialog-header h2 {
  @apply text-base font-medium;
  color: var(--color-ink);
}

.context-dialog-body {
  @apply m-0 max-h-[52vh] overflow-auto whitespace-pre-wrap break-words p-3 text-sm;
  background: var(--color-surface-soft);
  color: var(--color-body);
}
```

- [ ] **Step 8: 运行组件测试**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: PASS。

- [ ] **Step 9: 保存点，不提交**

Run:

```bash
git add src/side-panel/components/ChatComposer.tsx src/side-panel/styles.css tests/unit/side-panel/App.test.tsx
git diff --check
git status --short
```

Expected: `git diff --check` 无空白错误。

## Task 4: 固定面板高度、消息区滚动和思考过程文案

**Files:**
- Modify: `src/side-panel/components/MessageList.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖布局滚动容器类名**

在 `tests/unit/side-panel/App.test.tsx` 中追加：

```ts
it("聊天主布局不产生全局滚动且消息区是内部滚动容器", async () => {
  render(<App />);

  const mainLayout = document.querySelector(".chat-main-layout");
  const chatPanel = document.querySelector(".chat-panel");
  const messageList = screen.getByLabelText("消息列表");

  expect(mainLayout).toHaveClass("chat-main-layout");
  expect(chatPanel).toHaveClass("chat-panel");
  expect(messageList).toHaveClass("message-list");
});
```

- [ ] **Step 2: 写失败测试，覆盖思考过程默认折叠文案**

如果已有 thinking 测试，调整断言为：

```ts
const thinking = screen.getByText("思考过程");
expect(thinking.closest("details")).not.toHaveAttribute("open");
```

确保文案为“思考过程”，不是“AI 思考过程”。

- [ ] **Step 3: 修改 `MessageList` 思考过程文案**

在 `src/side-panel/components/MessageList.tsx` 中把：

```tsx
<summary>AI 思考过程</summary>
```

替换为：

```tsx
<summary>思考过程</summary>
```

不要给 `details` 添加 `open` 属性，保持默认折叠。

- [ ] **Step 4: 收紧全局和聊天布局滚动**

在 `src/side-panel/styles.css` 中确认或补充：

```css
html,
body,
#root {
  height: 100%;
  overflow: hidden;
}

.app-shell {
  height: 100vh;
  overflow: hidden;
}

.chat-panel {
  @apply flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg;
  height: 100%;
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
}

.message-list {
  @apply flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3;
}

.chat-composer {
  @apply grid shrink-0 gap-3 p-3;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-hairline);
}
```

如果现有 `.chat-panel` 或 `.message-list` 仍使用 `min-h-[calc(100vh-96px)]`、`min-h-48` 等导致整体溢出的值，应移除。

- [ ] **Step 5: 运行组件测试**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 保存点，不提交**

Run:

```bash
git add src/side-panel/components/MessageList.tsx src/side-panel/styles.css tests/unit/side-panel/App.test.tsx
git diff --check
git status --short
```

Expected: `git diff --check` 无空白错误。

## Task 5: 回归验证与收口

**Files:**
- Modify as needed: `tests/unit/side-panel/App.test.tsx`
- No production changes unless verification reveals a direct regression.

- [ ] **Step 1: 运行侧栏和 store 相关测试**

Run:

```bash
npm test -- tests/unit/side-panel/App.test.tsx tests/unit/side-panel/appStore.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行全量单元测试**

Run:

```bash
npm test
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 运行构建**

Run:

```bash
npm run build
```

Expected: PASS。

- [ ] **Step 5: 检查 content script 构建产物**

Run:

```powershell
Select-String -LiteralPath 'dist\content\index.js' -Pattern '^import|import\('
```

Expected: 无输出。

- [ ] **Step 6: 运行 E2E 冒烟**

Run:

```bash
npm run test:e2e
```

Expected: PASS。

如果只因聊天 UI 文案变化导致 E2E 断言失败，仅更新 `tests/e2e/extension-smoke.spec.ts` 的断言，使其检查：

- 当前模型下拉存在。
- 对话输入框存在。
- 发送按钮存在。
- 历史会话区域或历史按钮至少一个存在。

修改后重新运行 `npm run test:e2e`。

- [ ] **Step 7: 最终 diff 检查，不提交**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无空白错误；`git status --short` 只包含本轮和前序聊天 MVP 相关文件。

## 自检清单

- [ ] 左侧历史侧栏宽度约为 `264px`。
- [ ] 会话项操作通过菜单展示，菜单按钮和标题同一行。
- [ ] 菜单内包含“重命名 / 归档 / 删除”，删除仍需二次确认。
- [ ] 支持新建文件夹和文件夹原地重命名。
- [ ] 支持拖拽会话到指定文件夹或默认文件夹。
- [ ] AI thinking 显示为“思考过程”，默认折叠。
- [ ] `流式响应` 和 `提取文本 / 提取所有` 使用 switch 外观和 `role="switch"`。
- [ ] “查看上下文”打开弹窗，不再使用折叠详情。
- [ ] 页面不出现全局滚动条，聊天记录在消息区内部滚动。
- [ ] 全量验证命令通过。
