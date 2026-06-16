export type ChatTaskStatus = "running" | "completed" | "failed" | "canceled";

export interface ChatTaskState {
  id: string;
  sessionId: string;
  status: ChatTaskStatus;
  startedAt: number;
  completedAt?: number;
}

export type ChatTaskMap = Record<string, ChatTaskState>;

export type ChatTaskAbortHandle = () => void;

// 取消句柄来自流式 port 生命周期，不能安全放入可序列化的 Zustand 状态；这里作为跨 action 的运行时桥接表。
const abortHandles = new Map<string, { taskId: string; handle: ChatTaskAbortHandle }>();
const pendingAbortSessionIds = new Set<string>();
const consumedAbortSessionIds = new Set<string>();

export function createChatTask(sessionId: string, now = Date.now()): ChatTaskState {
  return {
    id: `chat-task-${now}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    status: "running",
    startedAt: now,
  };
}

export function upsertChatTask(tasks: ChatTaskMap, task: ChatTaskState): ChatTaskMap {
  return {
    ...tasks,
    [task.sessionId]: task,
  };
}

export function finishChatTask(
  tasks: ChatTaskMap,
  sessionId: string,
  status: Exclude<ChatTaskStatus, "running">,
  now = Date.now(),
  taskId?: string,
): ChatTaskMap {
  const task = tasks[sessionId];
  if (!task || task.status !== "running") {
    return tasks;
  }
  if (taskId && task.id !== taskId) {
    return tasks;
  }

  return {
    ...tasks,
    [sessionId]: {
      ...task,
      status,
      completedAt: now,
    },
  };
}

export function clearChatTask(tasks: ChatTaskMap, sessionId: string): ChatTaskMap {
  if (!tasks[sessionId]) {
    return tasks;
  }

  const nextTasks = { ...tasks };
  delete nextTasks[sessionId];
  return nextTasks;
}

export function isSessionTaskRunning(tasks: ChatTaskMap, sessionId?: string): boolean {
  if (!sessionId) {
    return false;
  }

  return tasks[sessionId]?.status === "running";
}

export function registerChatTaskAbortHandle(sessionId: string, taskId: string, handle: ChatTaskAbortHandle): void {
  if (pendingAbortSessionIds.delete(sessionId)) {
    consumedAbortSessionIds.add(sessionId);
    handle();
    return;
  }

  abortHandles.set(sessionId, { taskId, handle });
}

export function unregisterChatTaskAbortHandle(sessionId: string, taskId?: string): void {
  const current = abortHandles.get(sessionId);
  if (!taskId || current?.taskId === taskId) {
    abortHandles.delete(sessionId);
  }
}

export function abortChatTaskHandle(sessionId: string): boolean {
  const current = abortHandles.get(sessionId);
  if (!current) {
    if (consumedAbortSessionIds.delete(sessionId)) {
      return false;
    }
    pendingAbortSessionIds.add(sessionId);
    return true;
  }

  current.handle();
  abortHandles.delete(sessionId);
  return true;
}

export function clearChatTaskAbortHandles(): void {
  abortHandles.clear();
  pendingAbortSessionIds.clear();
  consumedAbortSessionIds.clear();
}
