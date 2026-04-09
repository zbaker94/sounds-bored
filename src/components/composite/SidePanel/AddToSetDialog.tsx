import { useState, useEffect } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
  useComboboxAnchor,
} from "@/components/ui/combobox";

interface AddToSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundIds: string[];
}

export function AddToSetDialog({ open, onOpenChange, soundIds }: AddToSetDialogProps) {
  const sets = useLibraryStore((s) => s.sets);
  const addSet = useLibraryStore((s) => s.addSet);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();
  const anchorRef = useComboboxAnchor();

  useEffect(() => {
    if (open) {
      setSelectedSetIds([]);
      setInputValue("");
    }
  }, [open]);

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = sets.some(
    (s) => s.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      const newSet = addSet(trimmedInput);
      setSelectedSetIds([...newIds.filter((id) => id !== "__create__"), newSet.id]);
      return;
    }
    setSelectedSetIds(newIds);
  }

  async function handleConfirm() {
    const { addSoundsToSet } = useLibraryStore.getState();
    for (const setId of selectedSetIds) {
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
        <div className="p-4">
          <Combobox
            value={selectedSetIds}
            onValueChange={handleValueChange}
            onInputValueChange={(val) => setInputValue(val)}
            items={sets}
            multiple
          >
            <ComboboxChips ref={anchorRef}>
              {selectedSetIds.map((id) => {
                const set = sets.find((s) => s.id === id);
                return set ? (
                  <ComboboxChip key={id}>
                    {set.name}
                  </ComboboxChip>
                ) : null;
              })}
              <ComboboxChipsInput placeholder="Search or create sets..." />
            </ComboboxChips>
            <ComboboxContent anchor={anchorRef}>
              <ComboboxList>
                <ComboboxEmpty>No sets found.</ComboboxEmpty>
                <ComboboxCollection>
                  {(s) => (
                    <ComboboxItem key={s.id} value={s.id}>
                      {s.name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
                {canCreate && (
                  <ComboboxItem value="__create__">Create "{trimmedInput}"</ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
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
