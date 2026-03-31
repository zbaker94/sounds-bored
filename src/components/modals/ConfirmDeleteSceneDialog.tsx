import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeleteSceneDialogProps {
  isOpen: boolean;
  sceneName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteSceneDialog({
  isOpen,
  sceneName,
  onConfirm,
  onCancel,
}: ConfirmDeleteSceneDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Scene</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{sceneName}"? This action cannot be undone.
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
