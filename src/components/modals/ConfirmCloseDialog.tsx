import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmCloseDialogProps {
  isOpen: boolean;
  onSave: () => void;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
  description?: string;
}

export function ConfirmCloseDialog({
  isOpen,
  onSave,
  onDiscard,
  onCancel,
  description = "You have unsaved changes. Do you want to save your project before closing?",
}: ConfirmCloseDialogProps) {
  return (
    <Dialog isOpen={isOpen}>
      <h2 className="text-2xl font-bold mb-4">Unsaved Changes</h2>
      <p className="text-sm text-muted-foreground mb-6">{description}</p>
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onDiscard}>
          Don't Save
        </Button>
        <Button onClick={onSave}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}
