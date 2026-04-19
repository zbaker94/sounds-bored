import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/state/libraryStore";
import { cn } from "@/lib/utils";
import type { LayerSelection } from "@/lib/schemas";

interface SoundPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerId: string;
  currentSelection: LayerSelection;
  onSelectionChange: (selection: LayerSelection) => void;
}

const NO_SET_VALUE = "__none__";

function getDefaultVolume(selection: LayerSelection): number {
  if (selection.type === "tag" || selection.type === "set") return selection.defaultVolume;
  return 100;
}

export function SoundPickerDialog({
  open,
  onOpenChange,
  layerId,
  currentSelection,
  onSelectionChange,
}: SoundPickerDialogProps) {
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  const [search, setSearch] = useState("");
  const activeSection = currentSelection.type;

  const assignedSoundIds = useMemo(() => {
    if (currentSelection.type === "assigned") {
      return new Set(currentSelection.instances.map((inst) => inst.soundId));
    }
    return new Set<string>();
  }, [currentSelection]);

  const selectedTagIds = currentSelection.type === "tag" ? currentSelection.tagIds : [];
  const tagMatchMode = currentSelection.type === "tag" ? currentSelection.matchMode : "any";
  const selectedSetId = currentSelection.type === "set" ? currentSelection.setId : "";

  const filteredSounds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sounds;
    return sounds.filter((s) => s.name.toLowerCase().includes(q));
  }, [sounds, search]);

  const userTags = useMemo(() => tags.filter((t) => !t.isSystem), [tags]);

  function toggleSound(soundId: string) {
    const existing =
      currentSelection.type === "assigned" ? currentSelection.instances : [];
    const already = existing.some((inst) => inst.soundId === soundId);
    const nextInstances = already
      ? existing.filter((inst) => inst.soundId !== soundId)
      : [
          ...existing,
          { id: crypto.randomUUID(), soundId, volume: 100 },
        ];
    onSelectionChange({ type: "assigned", instances: nextInstances });
  }

  function toggleTag(tagId: string) {
    const existing = currentSelection.type === "tag" ? currentSelection.tagIds : [];
    const already = existing.includes(tagId);
    const nextTagIds = already
      ? existing.filter((id) => id !== tagId)
      : [...existing, tagId];
    onSelectionChange({
      type: "tag",
      tagIds: nextTagIds,
      matchMode: tagMatchMode,
      defaultVolume: getDefaultVolume(currentSelection),
    });
  }

  function setMatchMode(mode: "any" | "all") {
    if (currentSelection.type !== "tag") return;
    onSelectionChange({
      type: "tag",
      tagIds: currentSelection.tagIds,
      matchMode: mode,
      defaultVolume: currentSelection.defaultVolume,
    });
  }

  function handleSetChange(setId: string) {
    if (setId === NO_SET_VALUE) {
      onSelectionChange({ type: "assigned", instances: [] });
      return;
    }
    onSelectionChange({
      type: "set",
      setId,
      defaultVolume: getDefaultVolume(currentSelection),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select sounds</DialogTitle>
          <DialogDescription>
            Choose sounds directly, by tag, or by set for this layer.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid={`sound-picker-dialog-${layerId}`}
          className="flex flex-col gap-4"
        >
          {/* Tag filter */}
          <section
            aria-label="Filter by tag"
            className={cn(
              "flex flex-col gap-2 transition-opacity",
              activeSection === "set" && "opacity-50",
            )}
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tags
              </label>
              {activeSection === "tag" && selectedTagIds.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    aria-pressed={tagMatchMode === "any"}
                    onClick={() => setMatchMode("any")}
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      tagMatchMode === "any"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    any
                  </button>
                  <button
                    type="button"
                    aria-pressed={tagMatchMode === "all"}
                    onClick={() => setMatchMode("all")}
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      tagMatchMode === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    all
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {userTags.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tags available.</span>
              ) : (
                userTags.map((tag) => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Set filter */}
          <section
            aria-label="Filter by set"
            className={cn(
              "flex flex-col gap-2 transition-opacity",
              activeSection === "tag" && "opacity-50",
            )}
          >
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Set
            </label>
            <Select
              value={selectedSetId || NO_SET_VALUE}
              onValueChange={handleSetChange}
            >
              <SelectTrigger aria-label="Set filter" className="w-full">
                <SelectValue placeholder="Select a set..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SET_VALUE}>None</SelectItem>
                {sets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          {/* Search + sound list */}
          <section
            aria-label="Sound list"
            className={cn(
              "flex flex-col gap-2 transition-opacity",
              activeSection !== "assigned" && "opacity-50",
            )}
          >
            <div className="relative flex items-center">
              <HugeiconsIcon
                icon={Search01Icon}
                size={14}
                className="absolute left-3 text-muted-foreground pointer-events-none"
              />
              <Input
                type="text"
                placeholder="Search sounds..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search sounds"
              />
            </div>
            <ul className="flex flex-col gap-0.5 max-h-64 overflow-y-auto rounded-md border p-1">
              {filteredSounds.length === 0 ? (
                <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No sounds found.
                </li>
              ) : (
                filteredSounds.map((sound) => {
                  const checked = assignedSoundIds.has(sound.id);
                  const inputId = `sound-picker-${layerId}-${sound.id}`;
                  return (
                    <li key={sound.id}>
                      <label
                        htmlFor={inputId}
                        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                      >
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          onCheckedChange={() => toggleSound(sound.id)}
                        />
                        <span className="text-sm truncate">{sound.name}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          <div className="flex justify-end">
            <Button variant="default" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
