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
        <Dialog.Content className="history-dialog">
          <Dialog.Title className="history-dialog-title">历史记录</Dialog.Title>
          <div className="history-dialog-body">
            <div className="history-dialog-scroll">
              <SessionList compact />
            </div>
          </div>
          <Dialog.Close className="ui-button-secondary" type="button">
            关闭
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
