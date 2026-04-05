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
  const showCancel = status !== "done" && status !== "error";
  const showSpinner = status === "idle" || status === "copying" || status === "zipping";

  return (
    <Dialog open={isOpen} onOpenChange={() => { /* non-dismissible */ }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Exporting Project</DialogTitle>
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
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
