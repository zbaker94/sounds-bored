import { useState, useMemo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import Fuse from "fuse.js";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import type { LayerSelection, Sound, SoundInstance } from "@/lib/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SoundFolderTree } from "./SoundFolderTree";
import { buildTree, findFolderNode, getSoundsInSubtree } from "./soundTreeUtils";

type SoundSearchDoc = { sound: Sound; tagNames: string[] };

interface SoundSelectorProps {
  value: LayerSelection;
  onChange: (value: LayerSelection) => void;
}

export function SoundSelector({ value, onChange }: SoundSelectorProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [value.type]);

  const sounds = useLibraryStore(useShallow((s) => s.sounds));
  const tags = useLibraryStore(useShallow((s) => s.tags));
  const sets = useLibraryStore(useShallow((s) => s.sets));
  const globalFolders = useAppSettingsStore(
    useShallow((s) => s.settings?.globalFolders ?? [])
  );

  // Build denormalized search docs: sound + resolved tag names
  const searchDocs: SoundSearchDoc[] = useMemo(
    () =>
      sounds.map((sound) => ({
        sound,
        tagNames: sound.tags.map(
          (tid) => tags.find((t) => t.id === tid)?.name ?? ""
        ),
      })),
    [sounds, tags]
  );

  const fuse = useMemo(
    () =>
      new Fuse(searchDocs, {
        keys: ["sound.name", "tagNames"],
        threshold: 0.4,
      }),
    [searchDocs]
  );

  if (value.type === "assigned") {
    const selectedIds = new Set(value.instances.map((i) => i.soundId));

    function toggleSound(soundId: string) {
      if (value.type !== "assigned") return;
      if (selectedIds.has(soundId)) {
        onChange({
          type: "assigned",
          instances: value.instances.filter((i) => i.soundId !== soundId),
        });
      } else {
        const newInstance: SoundInstance = {
          id: crypto.randomUUID(),
          soundId,
          volume: 100,
        };
        onChange({
          type: "assigned",
          instances: [...value.instances, newInstance],
        });
      }
    }

    function toggleFolder(folderId: string) {
      if (value.type !== "assigned") return;
      const tree = buildTree(sounds, globalFolders);
      const folderNode = findFolderNode(tree, folderId);
      if (!folderNode) return;
      const subtreeSounds = getSoundsInSubtree(folderNode);
      const allSelected = subtreeSounds.every((s) => selectedIds.has(s.id));
      if (allSelected) {
        const subtreeIds = new Set(subtreeSounds.map((s) => s.id));
        onChange({
          type: "assigned",
          instances: value.instances.filter((i) => !subtreeIds.has(i.soundId)),
        });
      } else {
        const existing = new Set(value.instances.map((i) => i.soundId));
        const newInstances: SoundInstance[] = subtreeSounds
          .filter((s) => !existing.has(s.id))
          .map((s) => ({ id: crypto.randomUUID(), soundId: s.id, volume: 100 }));
        onChange({
          type: "assigned",
          instances: [...value.instances, ...newInstances],
        });
      }
    }

    if (sounds.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">No sounds in library yet.</p>
      );
    }

    const trimmed = query.trim();
    const searchResults = trimmed
      ? fuse.search(trimmed).map((r) => r.item.sound)
      : null;

    return (
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Search sounds or tags..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No results.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {searchResults.map((sound) => (
                <label
                  key={sound.id}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(sound.id)}
                    onChange={() => toggleSound(sound.id)}
                    className="accent-primary"
                  />
                  {sound.name}
                </label>
              ))}
            </div>
          )
        ) : (
          <SoundFolderTree
            sounds={sounds}
            selectedIds={selectedIds}
            onToggleSound={toggleSound}
            onToggleFolder={toggleFolder}
          />
        )}
      </div>
    );
  }

  if (value.type === "tag") {
    const trimmed = query.trim();
    const filteredTags = trimmed
      ? tags.filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()))
      : tags;

    return (
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Search tags..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filteredTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {trimmed ? "No results." : "No tags in library yet."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Select tag</Label>
            <Select
              value={value.tagId}
              onValueChange={(tagId) =>
                onChange({ type: "tag", tagId, defaultVolume: value.defaultVolume })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a tag..." />
              </SelectTrigger>
              <SelectContent>
                {filteredTags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  }

  // value.type === "set"
  const trimmed = query.trim();
  const filteredSets = trimmed
    ? sets.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()))
    : sets;

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Search sets..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filteredSets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {trimmed ? "No results." : "No sets in library yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Select set</Label>
          <Select
            value={value.setId}
            onValueChange={(setId) =>
              onChange({ type: "set", setId, defaultVolume: value.defaultVolume })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a set..." />
            </SelectTrigger>
            <SelectContent>
              {filteredSets.map((set) => (
                <SelectItem key={set.id} value={set.id}>
                  {set.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
