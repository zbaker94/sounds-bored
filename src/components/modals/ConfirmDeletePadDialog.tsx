import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeletePadDialogProps {
  isOpen: boolean;
  padName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeletePadDialog({
  isOpen,
  padName,
  onConfirm,
  onCancel,
}: ConfirmDeletePadDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Pad</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{padName}"? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
