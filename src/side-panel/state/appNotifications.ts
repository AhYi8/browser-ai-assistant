export type AppNotificationType = "success" | "warning" | "error" | "info";

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title?: string;
  message: string;
  durationMs: number;
  createdAt: number;
}

export interface AppNotificationDraft {
  type: AppNotificationType;
  title?: string;
  message: string;
  durationMs?: number;
}

const DEFAULT_NOTIFICATION_DURATION_MS = 5000;

export function createAppNotification(draft: AppNotificationDraft): AppNotification {
  const now = Date.now();
  return {
    id: `notification-${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: draft.type,
    title: draft.title,
    message: draft.message,
    durationMs: draft.durationMs ?? DEFAULT_NOTIFICATION_DURATION_MS,
    createdAt: now,
  };
}
