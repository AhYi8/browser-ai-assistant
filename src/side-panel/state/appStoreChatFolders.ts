import { deleteChatFolder, saveChatFolder, saveChatSession } from "../../shared/storage/repositories";
import type { ChatFolder } from "../../shared/types";
import type { StoreGetter, StoreSetter } from "./appStore";

export async function createChatFolderAction(input: { name: string; set: StoreSetter }): Promise<ChatFolder> {
  const now = Date.now();
  const folder: ChatFolder = {
    id: `folder-${now}`,
    name: input.name.trim() || "新文件夹",
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
  };
  await saveChatFolder(folder);
  input.set((state) => ({ chatFolders: [...state.chatFolders, folder] }));
  return folder;
}

export async function renameChatFolderAction(input: {
  folderId: string;
  name: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return;
  }

  if (!input.get().chatFolders.some((item) => item.id === input.folderId)) {
    return;
  }

  try {
    const latestFolder = input.get().chatFolders.find((item) => item.id === input.folderId);
    if (!latestFolder) {
      return;
    }

    const updatedAt = Date.now();
    await saveChatFolder({ ...latestFolder, name: trimmedName, updatedAt });
    input.set((state) => {
      const currentFolder = state.chatFolders.find((item) => item.id === input.folderId);
      if (!currentFolder) {
        return {};
      }

      return {
        chatFolders: state.chatFolders.map((item) =>
          item.id === input.folderId ? { ...item, name: trimmedName, updatedAt } : item,
        ),
      };
    });
  } catch {
    input.set({ failure: { message: "文件夹保存失败，请重试" } });
  }
}

export async function deleteEmptyChatFolderAction(input: {
  folderId: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<boolean> {
  const currentState = input.get();
  if (!currentState.chatFolders.some((item) => item.id === input.folderId)) {
    return false;
  }

  if (currentState.chatSessions.some((session) => !session.archived && session.folderId === input.folderId)) {
    input.set({ failure: { message: "只能删除空文件夹" } });
    return false;
  }

  try {
    await deleteChatFolder(input.folderId);
    input.set((state) => ({
      chatFolders: state.chatFolders.filter((folder) => folder.id !== input.folderId),
      // 底层删除会清理历史脏数据中的 folderId，这里同步内存态避免归档会话保留失效引用。
      chatSessions: state.chatSessions.map((session) =>
        session.folderId === input.folderId ? { ...session, folderId: undefined } : session,
      ),
      failure: undefined,
    }));
    return true;
  } catch {
    input.set({ failure: { message: "文件夹删除失败，请重试" } });
    return false;
  }
}

export async function moveChatSessionToFolderAction(input: {
  sessionId: string;
  folderId: string | undefined;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void> {
  const initialState = input.get();
  const initialSession = initialState.chatSessions.find((item) => item.id === input.sessionId);
  if (!initialSession || initialSession.archived) {
    return;
  }

  if (input.folderId && !initialState.chatFolders.some((folder) => folder.id === input.folderId)) {
    return;
  }

  try {
    const latestState = input.get();
    const latestSession = latestState.chatSessions.find((item) => item.id === input.sessionId);
    if (!latestSession || latestSession.archived || (input.folderId && !latestState.chatFolders.some((folder) => folder.id === input.folderId))) {
      return;
    }

    const updatedAt = Date.now();
    await saveChatSession({ ...latestSession, folderId: input.folderId, updatedAt });
    input.set((current) => {
      const currentSession = current.chatSessions.find((item) => item.id === input.sessionId);
      if (!currentSession || currentSession.archived || (input.folderId && !current.chatFolders.some((folder) => folder.id === input.folderId))) {
        return {};
      }

      return {
        chatSessions: current.chatSessions.map((item) =>
          item.id === input.sessionId ? { ...item, folderId: input.folderId, updatedAt } : item,
        ),
        pendingDeleteSessionId: undefined,
      };
    });
  } catch {
    input.set({ failure: { message: "会话移动失败，请重试" } });
  }
}
