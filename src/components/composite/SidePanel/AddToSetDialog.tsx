import { useState, useEffect } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";

interface AddToSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundIds: string[];
}

export function AddToSetDialog({ open, onOpenChange, soundIds }: AddToSetDialogProps) {
  const sets = useLibraryStore((s) => s.sets);
  const [checkedSetIds, setCheckedSetIds] = useState<globalThis.Set<string>>(new globalThis.Set());
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  useEffect(() => {
    if (open) {
      setCheckedSetIds(new globalThis.Set());
    }
  }, [open]);

  function toggleSet(setId: string) {
    setCheckedSetIds((prev) => {
      const next = new globalThis.Set(prev);
      if (next.has(setId)) {
        next.delete(setId);
      } else {
        next.add(setId);
      }
      return next;
    });
  }

  async function handleConfirm() {
    const { addSoundsToSet } = useLibraryStore.getState();
    for (const setId of checkedSetIds) {
      addSoundsToSet(soundIds, setId);
    }
    const { sounds, tags, sets: currentSets } = useLibraryStore.getState();
    await saveLibrary({ version: "1.0.0", sounds, tags, sets: currentSets });
    onOpenChange(false);
  }

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to Set"
      description={`Add ${soundIds.length} sound(s) to one or more sets.`}
      content={
        <div className="flex flex-col gap-1 p-4">
          {sets.length === 0 && (
            <p className="text-sm text-white/50">No sets yet. Create a set first.</p>
          )}
          {sets.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer text-sm text-white/80"
            >
              <input
                type="checkbox"
                checked={checkedSetIds.has(s.id)}
                onChange={() => toggleSet(s.id)}
                className="accent-white cursor-pointer"
              />
              {s.name}
            </label>
          ))}
        </div>
      }
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={checkedSetIds.size === 0} onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      }
    />
  );
}
