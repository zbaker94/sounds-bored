import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

interface AddTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSoundIds: string[];
}

type CheckState = "checked" | "indeterminate" | "unchecked";

export function AddTagsDialog({
  open,
  onOpenChange,
  selectedSoundIds,
}: AddTagsDialogProps) {
  const tags = useLibraryStore((s) => s.tags);
  const sounds = useLibraryStore((s) => s.sounds);
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  const [newTagName, setNewTagName] = useState("");
  // Track explicit user overrides; tags not in this map use their computed state
  const [overrides, setOverrides] = useState<Record<string, CheckState>>({});

  useEffect(() => {
    if (open) {
      setNewTagName("");
      setOverrides({});
    }
  }, [open]);

  // Compute the "natural" state of each tag based on current sound data
  const computedStates = useMemo(() => {
    const states: Record<string, CheckState> = {};
    const selectedSounds = sounds.filter((s) =>
      selectedSoundIds.includes(s.id),
    );
    for (const tag of tags) {
      const count = selectedSounds.filter((s) =>
        s.tags.includes(tag.id),
      ).length;
      if (count === 0) {
        states[tag.id] = "unchecked";
      } else if (count === selectedSoundIds.length) {
        states[tag.id] = "checked";
      } else {
        states[tag.id] = "indeterminate";
      }
    }
    return states;
  }, [tags, sounds, selectedSoundIds]);

  function getEffectiveState(tagId: string): CheckState {
    return overrides[tagId] ?? computedStates[tagId] ?? "unchecked";
  }

  function handleToggle(tagId: string) {
    const current = getEffectiveState(tagId);
    // Cycle: unchecked/indeterminate -> checked, checked -> unchecked
    const next: CheckState =
      current === "checked" ? "unchecked" : "checked";
    setOverrides((prev) => ({ ...prev, [tagId]: next }));
  }

  function handleCreateTag() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    useLibraryStore.getState().ensureTagExists(trimmed);
    setNewTagName("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateTag();
    }
  }

  async function handleConfirm() {
    const {
      assignTagsToSounds,
      removeTagFromSounds,
      tags: currentTags,
    } = useLibraryStore.getState();

    const toAssign: string[] = [];
    const toRemove: string[] = [];

    for (const tag of currentTags) {
      const original = computedStates[tag.id] ?? "unchecked";
      const final = getEffectiveState(tag.id);

      if (final === "checked" && original !== "checked") {
        toAssign.push(tag.id);
      } else if (final === "unchecked" && original !== "unchecked") {
        toRemove.push(tag.id);
      }
    }

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
      title="Add Tags"
      description={`Manage tags for ${selectedSoundIds.length} sound(s).`}
      content={
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="New tag name..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCreateTag}
              disabled={!newTagName.trim()}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} />
              Create
            </Button>
          </div>

          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tags yet. Create one above.
            </p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {tags.map((tag) => {
                const state = getEffectiveState(tag.id);
                return (
                  <div
                    key={tag.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                    onClick={() => handleToggle(tag.id)}
                  >
                    <Checkbox
                      checked={
                        state === "checked"
                          ? true
                          : state === "indeterminate"
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={() => handleToggle(tag.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-sm">{tag.name}</span>
                  </div>
                );
              })}
            </div>
          )}
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
