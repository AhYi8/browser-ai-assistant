import * as Dialog from "@radix-ui/react-dialog";
import { SessionList } from "./SessionList";

interface SessionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionHistoryDialog({ open, onOpenChange }: SessionHistoryDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="drawer-panel history-dialog history-drawer">
          <div className="drawer-header">
            <Dialog.Title className="history-dialog-title">历史记录</Dialog.Title>
            <Dialog.Description className="sr-only">浏览和管理历史对话</Dialog.Description>
            <Dialog.Close className="ui-button-secondary drawer-icon-button" type="button" aria-label="关闭历史记录">
              ×
            </Dialog.Close>
          </div>
          <div className="history-dialog-body">
            <div className="history-dialog-scroll">
              <SessionList compact />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
