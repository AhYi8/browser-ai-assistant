# AI 请求重试与工具分组实现计划

> **给子代理的执行要求：** 必须使用 `superpowers:subagent-driven-development`，按任务逐步实施；每个任务先写测试再改代码；不要改动其他任务的责任文件。

**目标：** 为所有 AI 请求增加可配置的失败重试，并为工具增加系统内置分组与浏览器自动化组的自动启停逻辑。

**架构：** 复用现有的模型请求构造链路，在共享层加入统一重试封装，确保聊天、标题生成、Network 筛选、URL 正则生成都走同一策略。工具侧则在注册表补充分组元数据，在请求构造和 UI 展示中使用同一份分组信息，浏览器自动化组由 debugger 状态自动控制可用性。

**技术栈：** TypeScript、React、Zustand、Vitest。

---

### 任务 1：统一 AI 请求重试

**责任文件：**
- 新增：`src/shared/models/modelRequestRetry.ts`
- 修改：`src/shared/models/modelRequestPayload.ts`
- 修改：`src/background/modelRequestHandler.ts`
- 修改：`src/shared/models/titleGeneration.ts`
- 修改：`src/shared/extractionRules/urlPatternGeneration.ts`
- 修改：`src/side-panel/state/appStore.ts`
- 修改：`src/shared/types.ts`
- 修改：`src/side-panel/components/SettingsPanel.tsx`
- 修改：`src/side-panel/components/ChatPreferenceDrawer.tsx`
- 测试：`tests/unit/shared/*`、`tests/unit/background/*`、`tests/unit/side-panel/*`

- [ ] **步骤 1：先补失败重试测试**

```ts
it("当模型请求前两次失败时会自动重试并最终成功", async () => {
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new Error("network down"))
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));

  const result = await requestModelOnceWithRetry(input, fetcher, { retryCount: 5 });
  expect(result.ok).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
```

- [ ] **步骤 2：实现共享重试封装**

```ts
export async function withModelRequestRetry<T>(
  operation: () => Promise<T>,
  retryCount: number,
): Promise<T> {
  // 仅对网络错误、429、408、5xx 重试，避免把业务错误反复放大。
}
```

- [ ] **步骤 3：接入所有 AI 请求入口**

```ts
const response = await withModelRequestRetry(() => fetcher(payload.url, init), retryCount);
```

- [ ] **步骤 4：补齐偏好设置与归一化**

```ts
export interface ChatPreferenceValues {
  // ...
  aiRequestRetryCount: number;
}
```

- [ ] **步骤 5：跑定向测试与类型检查**

运行：
```bash
npm run vitest -- tests/unit/shared/modelRequestRetry.test.ts tests/unit/background/modelRequestHandler.test.ts tests/unit/side-panel/appStore.test.ts
npm run typecheck
```

**预期：** 相关测试通过，类型检查通过。

---

### 任务 2：工具系统内置分组与浏览器自动化组联动

**责任文件：**
- 修改：`src/shared/models/toolRegistry.ts`
- 修改：`src/shared/models/types.ts`
- 修改：`src/background/modelRequestHandler.ts`
- 修改：`src/background/browserControlMessageHandler.ts`
- 修改：`src/side-panel/state/appStore.ts`
- 修改：`src/side-panel/components/ChatComposer.tsx`
- 修改：`src/side-panel/components/SettingsPanel.tsx`
- 测试：`tests/unit/shared/toolRegistry.test.ts`、`tests/unit/background/chatMessageHandler.test.ts`、`tests/unit/side-panel/App.test.tsx`

- [ ] **步骤 1：先补工具分组测试**

```ts
it("浏览器自动化工具归入内置 browser_automation 分组", () => {
  const browserTools = getRegisteredModelTools().filter((tool) => tool.groupId === "browser_automation");
  expect(browserTools).toHaveLength(9);
});
```

- [ ] **步骤 2：给注册表补充分组元数据与读取辅助**

```ts
export interface ModelToolRegistryEntry {
  // ...
  groupId?: "browser_automation" | "system";
  groupLabel?: string;
}
```

- [ ] **步骤 3：让浏览器自动化组随 debugger 状态自动启停**

```ts
const enabledTools = resolveEnabledModelTools(getRegisteredModelTools(), enabledToolIds, {
  browserAutomationEnabled: input.state.browserControlEnabled,
});
```

- [ ] **步骤 4：更新 UI 的分组展示**

```tsx
{toolGroups.map((group) => (
  <section key={group.groupId}>
    <h4>{group.groupLabel}</h4>
    {/* 组内工具 */}
  </section>
))}
```

- [ ] **步骤 5：跑定向测试与构建**

运行：
```bash
npm run vitest -- tests/unit/shared/toolRegistry.test.ts tests/unit/background/chatMessageHandler.test.ts tests/unit/side-panel/App.test.tsx
npm run typecheck
npm run build:extension
```

**预期：** 工具分组可见，浏览器自动化组在 debugger 关闭时不下发，开启时自动恢复。

