import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";

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
  const assignTagsToSounds = useLibraryStore((s) => s.assignTagsToSounds);
  const removeTagFromSounds = useLibraryStore((s) => s.removeTagFromSounds);
  const ensureTagExists = useLibraryStore((s) => s.ensureTagExists);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();
  const anchorRef = useComboboxAnchor();

  // Full tags: on ALL selected sounds — managed by the Combobox value array
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // Partial tags: on SOME but not all selected sounds — managed manually
  const [partialTagIds, setPartialTagIds] = useState<string[]>([]);
  // Snapshots taken at open time, used for diffing on confirm
  const [originalFullTagIds, setOriginalFullTagIds] = useState<string[]>([]);
  const [originalPartialTagIds, setOriginalPartialTagIds] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  // Only non-system tags are available for manual add/remove
  const userTags = useMemo(() => tags.filter((t) => !t.isSystem), [tags]);

  // For each partial tag: which sound names have it vs don't (for tooltip)
  const tagPartialSoundsMap = useMemo(() => {
    const selectedSounds = sounds.filter((s) => selectedSoundIds.includes(s.id));
    const map = new Map<string, { with: string[]; without: string[] }>();
    for (const tagId of partialTagIds) {
      map.set(tagId, {
        with: selectedSounds.filter((s) => s.tags.includes(tagId)).map((s) => s.name),
        without: selectedSounds.filter((s) => !s.tags.includes(tagId)).map((s) => s.name),
      });
    }
    return map;
  }, [sounds, selectedSoundIds, partialTagIds]);

  // Keep a live ref to the values we need at open time.
  // This avoids listing them as effect deps (which would re-snapshot while open)
  // without needing an eslint-disable.
  const snapshotRef = useRef({ sounds, selectedSoundIds, userTags });
  snapshotRef.current = { sounds, selectedSoundIds, userTags };

  useEffect(() => {
    if (!open) return;
    const { sounds: s, selectedSoundIds: ids, userTags: ut } = snapshotRef.current;
    const selectedSounds = s.filter((sound) => ids.includes(sound.id));
    const fullIds =
      selectedSounds.length === 0
        ? []
        : ut
            .filter((tag) => selectedSounds.every((sound) => sound.tags.includes(tag.id)))
            .map((t) => t.id);
    const partialIds = ut
      .filter(
        (tag) =>
          selectedSounds.some((sound) => sound.tags.includes(tag.id)) &&
          !selectedSounds.every((sound) => sound.tags.includes(tag.id)),
      )
      .map((t) => t.id);

    setSelectedTagIds(fullIds);
    setPartialTagIds(partialIds);
    setOriginalFullTagIds(fullIds);
    setOriginalPartialTagIds(partialIds);
    setInputValue("");
  }, [open]);

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = userTags.some(
    (t) => t.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      const newTag = ensureTagExists(trimmedInput);
      setSelectedTagIds([...newIds.filter((id) => id !== "__create__"), newTag.id]);
      return;
    }

    // Detect if a partial tag was promoted via the dropdown (added to full selection)
    const addedIds = newIds.filter((id) => !selectedTagIds.includes(id));
    const promotedIds = addedIds.filter((id) => partialTagIds.includes(id));
    if (promotedIds.length > 0) {
      setPartialTagIds((prev) => prev.filter((id) => !promotedIds.includes(id)));
    }

    setSelectedTagIds(newIds);
  }

  function handlePromotePartial(tagId: string) {
    setPartialTagIds((prev) => prev.filter((id) => id !== tagId));
    setSelectedTagIds((prev) => [...prev, tagId]);
  }

  function handleRemovePartial(tagId: string) {
    setPartialTagIds((prev) => prev.filter((id) => id !== tagId));
  }

  async function handleConfirm() {
    const originalFullSet = new Set(originalFullTagIds);
    const selectedSet = new Set(selectedTagIds);
    const remainingPartialSet = new Set(partialTagIds);

    // Tags to add to ALL sounds: new tags + promoted partials (anything in selected that wasn't originally full)
    const toAssignToAll = selectedTagIds.filter((id) => !originalFullSet.has(id));

    // Tags to remove from ALL sounds: were full, now gone from chips
    const toRemoveFromAll = originalFullTagIds.filter((id) => !selectedSet.has(id));

    // Tags to remove from sounds that had them: were partial, explicitly removed from chips
    const toRemovePartial = originalPartialTagIds.filter(
      (id) => !selectedSet.has(id) && !remainingPartialSet.has(id),
    );

    if (toAssignToAll.length > 0) {
      assignTagsToSounds(selectedSoundIds, toAssignToAll);
    }
    for (const tagId of toRemoveFromAll) {
      removeTagFromSounds(selectedSoundIds, tagId);
    }
    for (const tagId of toRemovePartial) {
      removeTagFromSounds(selectedSoundIds, tagId);
    }

    const hasChanges =
      toAssignToAll.length > 0 || toRemoveFromAll.length > 0 || toRemovePartial.length > 0;

    if (hasChanges) {
      try {
        await saveCurrentLibrary();
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
            items={userTags}
            multiple
          >
            <ComboboxChips ref={anchorRef}>
              {/* Full tags — managed by the Combobox value */}
              {selectedTagIds.map((id) => {
                const tag = userTags.find((t) => t.id === id);
                return tag ? <ComboboxChip key={id}>{tag.name}</ComboboxChip> : null;
              })}
              {/* Partial tags — custom chips, not part of Combobox value */}
              {partialTagIds.map((id) => {
                const tag = userTags.find((t) => t.id === id);
                if (!tag) return null;
                const info = tagPartialSoundsMap.get(id);
                return (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <span className="flex h-[calc(--spacing(5.5))] w-fit items-center gap-1 rounded-4xl border border-dashed border-muted-foreground/40 bg-muted-foreground/10 px-2 text-xs font-medium whitespace-nowrap text-foreground/60">
                        <button
                          type="button"
                          className="cursor-pointer"
                          onClick={() => handlePromotePartial(id)}
                        >
                          ~ {tag.name}
                        </button>
                        <button
                          type="button"
                          className="-ml-1 opacity-50 hover:opacity-100"
                          onClick={() => handleRemovePartial(id)}
                          aria-label={`Remove ${tag.name} from all`}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            strokeWidth={2}
                            className="pointer-events-none size-3"
                          />
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="flex flex-col items-start gap-0.5">
                        {info && (
                          <>
                            <span>On: {info.with.join(", ")}</span>
                            <span>Not on: {info.without.join(", ")}</span>
                          </>
                        )}
                        <span className="mt-1 text-background/60">Click to apply to all</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
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
                      {partialTagIds.includes(t.id) && (
                        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                          <HugeiconsIcon
                            icon={MinusSignIcon}
                            strokeWidth={2}
                            className="pointer-events-none size-4 text-muted-foreground"
                          />
                        </span>
                      )}
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
          <Button onClick={handleConfirm}>Confirm</Button>
        </div>
      }
    />
  );
}
