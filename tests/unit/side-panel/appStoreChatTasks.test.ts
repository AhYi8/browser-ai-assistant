import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortChatTaskHandle,
  clearChatTaskAbortHandles,
  finishChatTask,
  registerChatTaskAbortHandle,
  unregisterChatTaskAbortHandle,
  upsertChatTask,
  type ChatTaskState,
} from "../../../src/side-panel/state/appStoreChatTasks";

function createTask(overrides: Partial<ChatTaskState> = {}): ChatTaskState {
  return {
    id: "task-1",
    sessionId: "session-1",
    status: "running",
    startedAt: 1,
    ...overrides,
  };
}

describe("appStoreChatTasks", () => {
  afterEach(() => {
    clearChatTaskAbortHandles();
  });

  it("旧任务收尾不能覆盖同会话的新任务状态", () => {
    const oldTask = createTask({ id: "task-old" });
    const newTask = createTask({ id: "task-new", startedAt: 2 });
    const tasks = upsertChatTask(upsertChatTask({}, oldTask), newTask);

    expect(finishChatTask(tasks, "session-1", "canceled", 3, "task-old")).toBe(tasks);
    expect(finishChatTask(tasks, "session-1", "completed", 4, "task-new")["session-1"]).toMatchObject({
      id: "task-new",
      status: "completed",
      completedAt: 4,
    });
  });

  it("提前终止请求会在取消句柄注册后立即执行", () => {
    const handle = vi.fn();

    expect(abortChatTaskHandle("session-1")).toBe(true);
    registerChatTaskAbortHandle("session-1", "task-1", handle);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(abortChatTaskHandle("session-1")).toBe(false);
  });

  it("旧任务不能注销同会话新任务的取消句柄", () => {
    const handle = vi.fn();

    registerChatTaskAbortHandle("session-1", "task-new", handle);
    unregisterChatTaskAbortHandle("session-1", "task-old");

    expect(abortChatTaskHandle("session-1")).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
