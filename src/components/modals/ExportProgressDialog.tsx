import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";

interface ExportProgressDialogProps {
  isOpen: boolean;
  status: "copying" | "zipping" | "done" | "error" | "idle";
  onCancel: () => void;
}

function getExportDisplayFlags(status: ExportProgressDialogProps["status"]): { showSpinner: boolean; showCancel: boolean } {
  return {
    showSpinner: status === "idle" || status === "copying" || status === "zipping",
    showCancel: status !== "done" && status !== "error",
  };
}

const STATUS_MESSAGE: Record<ExportProgressDialogProps["status"], string> = {
  idle: "Preparing\u2026",
  copying: "Preparing sounds\u2026",
  zipping: "Creating archive\u2026",
  done: "Export complete!",
  error: "Export failed.",
};

export function ExportProgressDialog({
  isOpen,
  status,
  onCancel,
}: ExportProgressDialogProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { showSpinner, showCancel } = getExportDisplayFlags(status);

  const handleRequestCancel = () => setConfirmingCancel(true);
  const handleConfirmCancel = () => { setConfirmingCancel(false); onCancel(); };
  const handleDismissConfirm = () => setConfirmingCancel(false);

  const handleEscapeOrOutside = (e: Event) => {
    e.preventDefault();
    if (showCancel) handleRequestCancel();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={() => { /* non-dismissible — handled by onEscapeKeyDown / onInteractOutside */ }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={handleEscapeOrOutside}
        onInteractOutside={handleEscapeOrOutside}
      >
        {confirmingCancel ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-deathletter">Cancel Export?</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-sm">
              The export is still in progress. Are you sure you want to cancel?
            </DialogDescription>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleDismissConfirm}>
                Keep Exporting
              </Button>
              <Button variant="destructive" onClick={handleConfirmCancel}>
                Cancel Export
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-deathletter">Exporting Project</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-4">
              {showSpinner && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={32}
                  strokeWidth={2}
                  className="animate-spin text-muted-foreground"
                />
              )}
              <DialogDescription className="text-center text-sm">
                {STATUS_MESSAGE[status]}
              </DialogDescription>
            </div>
            {showCancel && (
              <DialogFooter>
                <Button variant="destructive" onClick={handleRequestCancel}>
                  Cancel
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
