import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ChatFolder, ChatSession } from "../../shared/types";
import { useAppStore } from "../state/appStore";

interface SessionListProps {
  compact?: boolean;
}

type DropTargetFolderId = string | undefined;

interface SessionFolderProps {
  folderId?: string;
  title: string;
  sessions: ChatSession[];
  collapsed: boolean;
  menuPlacement?: "down" | "up";
  activeSessionId: string;
  pendingDeleteSessionId?: string;
  renaming: boolean;
  renamingValue: string;
  dragOver: boolean;
  onToggle: () => void;
  onStartRenameFolder?: () => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  onRenameCommit: () => void;
  onSelect: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onRenameSession: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onConfirmDelete: (sessionId: string) => void;
  onDragStart?: (sessionId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver: (folderId: DropTargetFolderId) => void;
  onDragLeave: () => void;
  onDrop: (folderId: DropTargetFolderId, event: DragEvent<HTMLElement>) => void;
  openMenuSessionId?: string;
  renamingSessionId?: string;
  renamingSessionValue: string;
  onToggleSessionMenu: (sessionId: string) => void;
  onCloseSessionMenu: () => void;
  onSessionRenameChange: (value: string) => void;
  onSessionRenameCancel: () => void;
  onSessionRenameSave: () => void;
  onSessionRenameCommit: () => void;
}

interface SessionItemProps {
  session: ChatSession;
  active: boolean;
  menuOpen: boolean;
  menuPlacement: "down" | "up";
  renaming: boolean;
  renamingValue: string;
  pendingDelete: boolean;
  onSelect: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onConfirmDelete: (sessionId: string) => void;
  onDragStart?: (sessionId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onToggleMenu: (sessionId: string) => void;
  onCloseMenu: () => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  onRenameCommit: () => void;
}

export function SessionList({ compact = false }: SessionListProps) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string>();
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renamingSessionValue, setRenamingSessionValue] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [renamingFolderValue, setRenamingFolderValue] = useState("");
  const [draggingSessionId, setDraggingSessionId] = useState<string>();
  const [dragOverFolderId, setDragOverFolderId] = useState<string>();
  const [pendingPrivateSwitchSessionId, setPendingPrivateSwitchSessionId] = useState<string>();
  const handledSessionRenameId = useRef<string | undefined>(undefined);
  const handledFolderRenameId = useRef<string | undefined>(undefined);
  const initializedCollapsedFolderIds = useRef<Set<string>>(new Set());
  const chatSessions = useAppStore((state) => state.chatSessions);
  const chatFolders = useAppStore((state) => state.chatFolders);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const pendingDeleteSessionId = useAppStore((state) => state.pendingDeleteSessionId);
  const composerHasDraft = useAppStore((state) => state.composerHasDraft);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const createChatSession = useAppStore((state) => state.createChatSession);
  const renameChatSession = useAppStore((state) => state.renameChatSession);
  const selectChatSession = useAppStore((state) => state.selectChatSession);
  const archiveChatSession = useAppStore((state) => state.archiveChatSession);
  const requestDeleteChatSession = useAppStore((state) => state.requestDeleteChatSession);
  const confirmDeleteChatSession = useAppStore((state) => state.confirmDeleteChatSession);
  const clearPendingDeleteSession = useAppStore((state) => state.clearPendingDeleteSession);
  const createChatFolder = useAppStore((state) => state.createChatFolder);
  const renameChatFolder = useAppStore((state) => state.renameChatFolder);
  const moveChatSessionToFolder = useAppStore((state) => state.moveChatSessionToFolder);
  const handleSelectChatSession = (sessionId: string) => {
    if (privateModeActive && (privateChatSession?.messages.length ?? 0) > 0) {
      setPendingPrivateSwitchSessionId(sessionId);
      return;
    }

    selectChatSession(sessionId);
  };
  const confirmPrivateSwitch = () => {
    if (!pendingPrivateSwitchSessionId) {
      return;
    }

    selectChatSession(pendingPrivateSwitchSessionId, { discardPrivateSession: true });
    setPendingPrivateSwitchSessionId(undefined);
  };

  const activeSessions = chatSessions.filter((session) => !session.archived);
  const archivedSessions = chatSessions.filter((session) => session.archived);
  const defaultSessions = activeSessions.filter((session) => !session.folderId);
  const sessionsByFolder = useMemo(() => {
    return new Map(chatFolders.map((folder) => [folder.id, activeSessions.filter((session) => session.folderId === folder.id)]));
  }, [activeSessions, chatFolders]);

  useEffect(() => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      for (const folder of chatFolders) {
        if (!initializedCollapsedFolderIds.current.has(folder.id)) {
          initializedCollapsedFolderIds.current.add(folder.id);
          next.add(folder.id);
        }
      }
      return next;
    });
  }, [chatFolders]);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const closeSessionMenu = () => {
    setOpenMenuSessionId(undefined);
    clearPendingDeleteSession();
  };

  const toggleSessionMenu = (sessionId: string) => {
    setRenamingSessionId(undefined);
    setOpenMenuSessionId((current) => (current === sessionId ? undefined : sessionId));
    clearPendingDeleteSession();
  };

  const startRenameSession = (sessionId: string) => {
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    closeSessionMenu();
    handledSessionRenameId.current = undefined;
    setRenamingSessionId(sessionId);
    setRenamingSessionValue(session.title);
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(undefined);
    setRenamingSessionValue("");
  };

  const saveRenameSession = () => {
    if (!renamingSessionId) {
      return;
    }

    const title = renamingSessionValue.trim();
    const sessionId = renamingSessionId;
    cancelRenameSession();
    if (title) {
      void renameChatSession(sessionId, title);
    }
  };

  const startRenameFolder = (folder: ChatFolder) => {
    closeSessionMenu();
    handledFolderRenameId.current = undefined;
    setRenamingFolderId(folder.id);
    setRenamingFolderValue(folder.name);
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folder.id);
      return next;
    });
  };

  const cancelRenameFolder = () => {
    setRenamingFolderId(undefined);
    setRenamingFolderValue("");
  };

  const saveRenameFolder = () => {
    if (!renamingFolderId) {
      return;
    }

    const name = renamingFolderValue.trim();
    const folderId = renamingFolderId;
    cancelRenameFolder();
    if (name) {
      void renameChatFolder(folderId, name);
    }
  };

  const commitRenameSessionByKey = () => {
    handledSessionRenameId.current = renamingSessionId;
    saveRenameSession();
  };

  const cancelRenameSessionByKey = () => {
    handledSessionRenameId.current = renamingSessionId;
    setRenamingSessionId(undefined);
    setRenamingSessionValue("");
  };

  const commitRenameFolderByKey = () => {
    handledFolderRenameId.current = renamingFolderId;
    saveRenameFolder();
  };

  const cancelRenameFolderByKey = () => {
    handledFolderRenameId.current = renamingFolderId;
    setRenamingFolderId(undefined);
    setRenamingFolderValue("");
  };

  const saveRenameSessionOnBlur = () => {
    if (renamingSessionId && handledSessionRenameId.current === renamingSessionId) {
      handledSessionRenameId.current = undefined;
      return;
    }

    saveRenameSession();
  };

  const saveRenameFolderOnBlur = () => {
    if (renamingFolderId && handledFolderRenameId.current === renamingFolderId) {
      handledFolderRenameId.current = undefined;
      return;
    }

    saveRenameFolder();
  };

  const handleCreateFolder = async () => {
    closeSessionMenu();
    const folder = await createChatFolder("新文件夹");
    startRenameFolder(folder);
  };

  const handleDragSessionStart = (sessionId: string, event: DragEvent<HTMLElement>) => {
    setDraggingSessionId(sessionId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sessionId);
    }
  };

  const handleDropSession = (folderId: DropTargetFolderId, event: DragEvent<HTMLElement>) => {
    const sessionId = draggingSessionId ?? event.dataTransfer?.getData("text/plain").trim();
    setDragOverFolderId(undefined);
    setDraggingSessionId(undefined);
    if (sessionId) {
      void moveChatSessionToFolder(sessionId, folderId);
    }
  };

  return (
    <aside aria-label="历史会话" className={compact ? "session-list session-list-compact" : "session-list"}>
      <div className="session-list-header">
        <p className="session-list-title">历史对话</p>
        <div className="session-list-header-actions">
          <button className="ui-button-secondary session-header-button" type="button" aria-label="新建文件夹" onClick={() => void handleCreateFolder()}>
            新建文件夹
          </button>
          <button className="ui-button-secondary session-header-button" type="button" aria-label="新对话" onClick={() => void createChatSession({ preserveSelectedModel: composerHasDraft })}>
            新建
          </button>
        </div>
      </div>
      <div className="session-list-scroll">
        <div className="session-folder-stack-scroll">
          <div className="session-folder-stack">
            <SessionFolder
              folderId={undefined}
              title="默认文件夹"
              sessions={defaultSessions}
              collapsed={collapsedFolderIds.has("default")}
              renaming={false}
              renamingValue=""
              dragOver={dragOverFolderId === "default"}
              onToggle={() => toggleFolder("default")}
              onRenameChange={() => undefined}
              onRenameCancel={() => undefined}
              onRenameSave={() => undefined}
              onRenameCommit={() => undefined}
              activeSessionId={activeSessionId}
              pendingDeleteSessionId={pendingDeleteSessionId}
              onSelect={handleSelectChatSession}
              onArchive={(sessionId) => void archiveChatSession(sessionId)}
              onRenameSession={startRenameSession}
              onRequestDelete={requestDeleteChatSession}
              onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
              onDragStart={handleDragSessionStart}
              onDragEnd={() => {
                setDraggingSessionId(undefined);
                setDragOverFolderId(undefined);
              }}
              onDragOver={() => setDragOverFolderId("default")}
              onDragLeave={() => setDragOverFolderId(undefined)}
              onDrop={handleDropSession}
              openMenuSessionId={openMenuSessionId}
              renamingSessionId={renamingSessionId}
              renamingSessionValue={renamingSessionValue}
              onToggleSessionMenu={toggleSessionMenu}
              onCloseSessionMenu={closeSessionMenu}
              onSessionRenameChange={setRenamingSessionValue}
              onSessionRenameCancel={cancelRenameSessionByKey}
              onSessionRenameSave={saveRenameSessionOnBlur}
              onSessionRenameCommit={commitRenameSessionByKey}
            />
            {chatFolders.map((folder) => (
              <SessionFolder
                key={folder.id}
                folderId={folder.id}
                title={folder.name}
                sessions={sessionsByFolder.get(folder.id) ?? []}
                collapsed={collapsedFolderIds.has(folder.id)}
                renaming={renamingFolderId === folder.id}
                renamingValue={renamingFolderValue}
                dragOver={dragOverFolderId === folder.id}
                onToggle={() => toggleFolder(folder.id)}
                onStartRenameFolder={() => startRenameFolder(folder)}
                onRenameChange={setRenamingFolderValue}
                onRenameCancel={cancelRenameFolderByKey}
                onRenameSave={saveRenameFolderOnBlur}
                onRenameCommit={commitRenameFolderByKey}
                activeSessionId={activeSessionId}
                pendingDeleteSessionId={pendingDeleteSessionId}
                onSelect={handleSelectChatSession}
                onArchive={(sessionId) => void archiveChatSession(sessionId)}
                onRenameSession={startRenameSession}
                onRequestDelete={requestDeleteChatSession}
                onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
                onDragStart={handleDragSessionStart}
                onDragEnd={() => {
                  setDraggingSessionId(undefined);
                  setDragOverFolderId(undefined);
                }}
                onDragOver={() => setDragOverFolderId(folder.id)}
                onDragLeave={() => setDragOverFolderId(undefined)}
                onDrop={handleDropSession}
                openMenuSessionId={openMenuSessionId}
                renamingSessionId={renamingSessionId}
                renamingSessionValue={renamingSessionValue}
                onToggleSessionMenu={toggleSessionMenu}
                onCloseSessionMenu={closeSessionMenu}
                onSessionRenameChange={setRenamingSessionValue}
                onSessionRenameCancel={cancelRenameSessionByKey}
                onSessionRenameSave={saveRenameSessionOnBlur}
                onSessionRenameCommit={commitRenameSessionByKey}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="session-archive-bottom shrink-0">
          <SessionFolder
            title="已归档"
            sessions={archivedSessions}
            collapsed={archivedCollapsed}
            menuPlacement="up"
            renaming={false}
            renamingValue=""
            dragOver={false}
            onToggle={() => setArchivedCollapsed((value) => !value)}
            onRenameChange={() => undefined}
            onRenameCancel={() => undefined}
            onRenameSave={() => undefined}
            onRenameCommit={() => undefined}
            activeSessionId={activeSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
            onSelect={handleSelectChatSession}
            onRenameSession={startRenameSession}
            onRequestDelete={requestDeleteChatSession}
            onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
            onDragOver={() => undefined}
            onDragLeave={() => undefined}
            onDrop={() => undefined}
            openMenuSessionId={openMenuSessionId}
            renamingSessionId={renamingSessionId}
            renamingSessionValue={renamingSessionValue}
            onToggleSessionMenu={toggleSessionMenu}
            onCloseSessionMenu={closeSessionMenu}
            onSessionRenameChange={setRenamingSessionValue}
            onSessionRenameCancel={cancelRenameSessionByKey}
            onSessionRenameSave={saveRenameSessionOnBlur}
            onSessionRenameCommit={commitRenameSessionByKey}
          />
      </div>
      <Dialog.Root open={Boolean(pendingPrivateSwitchSessionId)} onOpenChange={(open) => {
        if (!open) {
          setPendingPrivateSwitchSessionId(undefined);
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="private-switch-dialog">
            <Dialog.Title className="private-switch-dialog-title">丢弃隐私对话？</Dialog.Title>
            <Dialog.Description className="private-switch-dialog-description">
              当前隐私对话尚未保存，切换历史会话会丢弃这些内容。
            </Dialog.Description>
            <div className="private-switch-dialog-actions">
              <Dialog.Close className="ui-button-secondary private-switch-dialog-button" type="button">
                继续保留
              </Dialog.Close>
              <button className="ui-button-primary private-switch-dialog-button" type="button" onClick={confirmPrivateSwitch}>
                丢弃并切换
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}

function SessionFolder({
  folderId,
  title,
  sessions,
  collapsed,
  menuPlacement = "down",
  activeSessionId,
  pendingDeleteSessionId,
  renaming,
  renamingValue,
  dragOver,
  onToggle,
  onStartRenameFolder,
  onRenameChange,
  onRenameCancel,
  onRenameSave,
  onRenameCommit,
  onSelect,
  onArchive,
  onRenameSession,
  onRequestDelete,
  onConfirmDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  openMenuSessionId,
  renamingSessionId,
  renamingSessionValue,
  onToggleSessionMenu,
  onCloseSessionMenu,
  onSessionRenameChange,
  onSessionRenameCancel,
  onSessionRenameSave,
  onSessionRenameCommit,
}: SessionFolderProps) {
  const folderClassName = dragOver ? "session-folder session-folder-drop-active" : "session-folder";

  return (
    <section
      className={folderClassName}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(folderId);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(folderId, event);
      }}
    >
      {renaming ? (
        <input
          className="ui-input session-folder-rename-input"
          aria-label="重命名文件夹"
          value={renamingValue}
          autoFocus
          onChange={(event) => onRenameChange(event.target.value)}
          onBlur={onRenameSave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRenameCommit();
            }
            if (event.key === "Escape") {
              onRenameCancel();
            }
          }}
        />
      ) : (
        <div className="session-folder-row">
          <button className="session-folder-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed}>
            <span>{title}</span>
            <span className="session-count">{sessions.length}</span>
          </button>
          {onStartRenameFolder ? (
            <button className="session-folder-rename-button" type="button" aria-label={`重命名文件夹 ${title}`} onClick={onStartRenameFolder}>
              ⋯
            </button>
          ) : null}
        </div>
      )}
      {collapsed ? null : (
        <div className="session-item-stack">
          {sessions.length === 0 ? <p className="session-empty">暂无对话</p> : null}
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              menuOpen={session.id === openMenuSessionId}
              menuPlacement={menuPlacement}
              renaming={session.id === renamingSessionId}
              renamingValue={renamingSessionValue}
              pendingDelete={session.id === pendingDeleteSessionId}
              onSelect={onSelect}
              onArchive={onArchive}
              onRename={onRenameSession}
              onRequestDelete={onRequestDelete}
              onConfirmDelete={onConfirmDelete}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onToggleMenu={onToggleSessionMenu}
              onCloseMenu={onCloseSessionMenu}
              onRenameChange={onSessionRenameChange}
              onRenameCancel={onSessionRenameCancel}
              onRenameSave={onSessionRenameSave}
              onRenameCommit={onSessionRenameCommit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SessionItem({
  session,
  active,
  menuOpen,
  menuPlacement,
  renaming,
  renamingValue,
  pendingDelete,
  onSelect,
  onArchive,
  onRename,
  onRequestDelete,
  onConfirmDelete,
  onDragStart,
  onDragEnd,
  onToggleMenu,
  onCloseMenu,
  onRenameChange,
  onRenameCancel,
  onRenameSave,
  onRenameCommit,
}: SessionItemProps) {
  const visibleTitle = session.titleGenerating ? "生成标题中..." : session.title;

  return (
    <article
      className={active ? "session-item session-item-active" : "session-item"}
      draggable={Boolean(onArchive)}
      onDragStart={(event) => onDragStart?.(session.id, event)}
      onDragEnd={onDragEnd}
    >
      <div className="session-item-row" onClick={() => !renaming && onSelect(session.id)}>
        {renaming ? (
          <input
            className="ui-input session-rename-input"
            aria-label="重命名会话"
            value={renamingValue}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameChange(event.target.value)}
            onBlur={onRenameSave}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                onRenameCommit();
              }
              if (event.key === "Escape") {
                onRenameCancel();
              }
            }}
          />
        ) : (
          <button
            className="session-title-button"
            type="button"
            title={session.title}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(session.id);
            }}
          >
            <span className="session-item-title">{visibleTitle}</span>
          </button>
        )}
        <div className="session-item-menu-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            className="session-menu-button"
            type="button"
            aria-label={`会话操作 ${session.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMenu(session.id);
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className={menuPlacement === "up" ? "session-menu session-menu-up" : "session-menu"} role="menu">
              <button className="session-menu-item" type="button" role="menuitem" onClick={() => onRename(session.id)}>
                重命名
              </button>
              {onArchive ? (
                <button
                  className="session-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu();
                    onArchive(session.id);
                  }}
                >
                  归档
                </button>
              ) : null}
              <button
                className={pendingDelete ? "session-menu-item session-menu-delete-confirm" : "session-menu-item"}
                type="button"
                role="menuitem"
                onClick={() => (pendingDelete ? onConfirmDelete(session.id) : onRequestDelete(session.id))}
              >
                {pendingDelete ? "确认删除" : "删除"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
