import { useState, useEffect } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { SetPicker } from "@/components/composite/LibraryPickers";

interface AddToSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundIds: string[];
}

export function AddToSetDialog({ open, onOpenChange, soundIds }: AddToSetDialogProps) {
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();

  useEffect(() => {
    if (open) {
      setSelectedSetIds([]);
    }
  }, [open]);

  async function handleConfirm() {
    const { addSoundsToSet } = useLibraryStore.getState();
    for (const setId of selectedSetIds) {
      addSoundsToSet(soundIds, setId);
    }
    await saveCurrentLibrary();
    onOpenChange(false);
  }

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to Set"
      description={`Add ${soundIds.length} sound(s) to one or more sets.`}
      content={
        <div className="p-4">
          <SetPicker value={selectedSetIds} onChange={setSelectedSetIds} />
        </div>
      }
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={selectedSetIds.length === 0} onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      }
    />
  );
}
