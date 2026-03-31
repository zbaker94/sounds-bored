import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
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

interface AddTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSoundIds: string[];
}

export function AddTagsDialog({
  open,
  onOpenChange,
  selectedSoundIds,
}: AddTagsDialogProps) {
  const tags = useLibraryStore((s) => s.tags);
  const sounds = useLibraryStore((s) => s.sounds);
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();
  const anchorRef = useComboboxAnchor();

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  // Tags that ALL selected sounds share — used for pre-population and diffing on confirm
  const originalTagIds = useMemo(() => {
    const selectedSounds = sounds.filter((s) => selectedSoundIds.includes(s.id));
    if (selectedSounds.length === 0) return [];
    return tags
      .filter((tag) => selectedSounds.every((s) => s.tags.includes(tag.id)))
      .map((t) => t.id);
  }, [sounds, tags, selectedSoundIds]);

  useEffect(() => {
    if (open) {
      setSelectedTagIds(originalTagIds);
      setInputValue("");
    }
    // originalTagIds intentionally omitted — snapshot at open time only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = tags.some(
    (t) => t.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      const { ensureTagExists } = useLibraryStore.getState();
      const newTag = ensureTagExists(trimmedInput);
      setSelectedTagIds([...newIds.filter((id) => id !== "__create__"), newTag.id]);
    } else {
      setSelectedTagIds(newIds);
    }
  }

  async function handleConfirm() {
    const { assignTagsToSounds, removeTagFromSounds } = useLibraryStore.getState();

    const originalSet = new Set(originalTagIds);
    const selectedSet = new Set(selectedTagIds);

    const toAssign = selectedTagIds.filter((id) => !originalSet.has(id));
    const toRemove = originalTagIds.filter((id) => !selectedSet.has(id));

    if (toAssign.length > 0) {
      assignTagsToSounds(selectedSoundIds, toAssign);
    }
    for (const tagId of toRemove) {
      removeTagFromSounds(selectedSoundIds, tagId);
    }

    if (toAssign.length > 0 || toRemove.length > 0) {
      try {
        const latest = useLibraryStore.getState();
        await saveLibrary({
          version: "1.0.0",
          sounds: latest.sounds,
          tags: latest.tags,
          sets: latest.sets,
        });
        toast.success("Tags updated");
      } catch {
        toast.error("Failed to save tags. Please try again.");
        return;
      }
    }

    onOpenChange(false);
  }

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage Tags"
      description={`Manage tags for ${selectedSoundIds.length} sound(s).`}
      content={
        <div className="p-4">
          <Combobox
            value={selectedTagIds}
            onValueChange={handleValueChange}
            onInputValueChange={(val) => setInputValue(val)}
            items={tags}
            multiple
          >
            <ComboboxChips ref={anchorRef}>
              {selectedTagIds.map((id) => {
                const tag = tags.find((t) => t.id === id);
                return tag ? <ComboboxChip key={id}>{tag.name}</ComboboxChip> : null;
              })}
              <ComboboxChipsInput placeholder="Search or create tags..." />
            </ComboboxChips>
            <ComboboxContent anchor={anchorRef}>
              <ComboboxList>
                <ComboboxEmpty>No tags found.</ComboboxEmpty>
                <ComboboxCollection>
                  {(t) => (
                    <ComboboxItem key={t.id} value={t.id}>
                      {t.name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
                {canCreate && (
                  <ComboboxItem value="__create__">
                    Create "{trimmedInput}"
                  </ComboboxItem>
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
          <Button onClick={handleConfirm}>Confirm</Button>
        </div>
      }
    />
  );
}
