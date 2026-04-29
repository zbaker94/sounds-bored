import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AffectedPad } from "@/lib/project.reconcile";

interface ConfirmDeleteSoundsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundCount: number;
  affectedPads: AffectedPad[];
  isDeleting: boolean;
  onConfirm: () => void;
}

/**
 * Presentation-only confirmation dialog for deleting sounds from disk.
 * Pure UI primitive — receives all state via props.
 */
export function ConfirmDeleteSoundsDialog({
  open,
  onOpenChange,
  soundCount,
  affectedPads,
  isDeleting,
  onConfirm,
}: ConfirmDeleteSoundsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Sounds from Disk</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{soundCount}</strong> sound
            {soundCount > 1 ? " files" : " file"} from disk and remove them
            from your library. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {affectedPads.length > 0 && (
          <div className="text-sm space-y-1">
            <p className="font-medium text-amber-400">Affects this project:</p>
            <ul className="space-y-0.5 text-muted-foreground">
              {affectedPads.map((ap, i) => (
                <li key={i}>
                  <span className="text-foreground">"{ap.padName}"</span> (
                  {ap.sceneName}) — Layer
                  {ap.layerIndices.length > 1 ? "s" : ""}{" "}
                  {ap.layerIndices.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting
              ? "Deleting..."
              : `Delete ${soundCount} Sound${soundCount > 1 ? "s" : ""} from Disk`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
