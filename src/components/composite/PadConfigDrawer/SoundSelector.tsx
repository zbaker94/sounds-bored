import { useState, useMemo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import Fuse from "fuse.js";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import type { LayerSelection, Sound, SoundInstance } from "@/lib/schemas";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  ComboboxInput,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { SoundFolderTree } from "./SoundFolderTree";
import { buildTree, findFolderNode, getSoundsInSubtree } from "./soundTreeUtils";

type SoundSearchDoc = { sound: Sound; tagNames: string[] };

interface SoundSelectorProps {
  value: LayerSelection;
  onChange: (value: LayerSelection) => void;
}

export function SoundSelector({ value, onChange }: SoundSelectorProps) {
  const [query, setQuery] = useState("");
  // Anchor ref for Combobox chips dropdown positioning — always called (hook rule)
  const tagAnchorRef = useComboboxAnchor();

  useEffect(() => {
    setQuery("");
  }, [value.type]);

  const sounds = useLibraryStore(useShallow((s) => s.sounds));
  const tags = useLibraryStore(useShallow((s) => s.tags));
  const sets = useLibraryStore(useShallow((s) => s.sets));
  const globalFolders = useAppSettingsStore(
    useShallow((s) => s.settings?.globalFolders ?? [])
  );

  // Build denormalized search docs: sound + resolved tag names (used by assigned mode)
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

  const tagCountMap = useMemo(
    () =>
      Object.fromEntries(
        tags.map((t) => [t.id, sounds.filter((s) => s.tags.includes(t.id)).length])
      ),
    [tags, sounds]
  );

  const setCountMap = useMemo(
    () =>
      Object.fromEntries(
        sets.map((st) => [st.id, sounds.filter((s) => s.sets.includes(st.id)).length])
      ),
    [sets, sounds]
  );

  // ── Assigned mode ────────────────────────────────────────────────────────────

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
                  <Checkbox
                    checked={selectedIds.has(sound.id)}
                    onCheckedChange={() => toggleSound(sound.id)}
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

  // ── Tag mode — multi-select Combobox with chips ───────────────────────────────

  if (value.type === "tag") {
    return (
      <Combobox
        value={value.tagIds}
        onValueChange={(tagIds) =>
          onChange({ type: "tag", tagIds, defaultVolume: value.defaultVolume })
        }
        items={tags}
        multiple
      >
        <ComboboxChips ref={tagAnchorRef}>
          {value.tagIds.map((id) => {
            const tag = tags.find((t) => t.id === id);
            return tag ? <ComboboxChip key={id}>{tag.name}</ComboboxChip> : null;
          })}
          <ComboboxChipsInput placeholder="Search tags..." />
        </ComboboxChips>
        <ComboboxContent anchor={tagAnchorRef}>
          <ComboboxList>
            <ComboboxEmpty>
              {tags.length === 0 ? "No tags in library yet." : "No tags found."}
            </ComboboxEmpty>
            <ComboboxCollection>
              {(t) => (
                <ComboboxItem key={t.id} value={t.id}>
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {tagCountMap[t.id] ?? 0} sounds
                  </span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }

  // ── Set mode — single-select Combobox ────────────────────────────────────────

  return (
    <Combobox
      value={value.setId}
      onValueChange={(setId) =>
        onChange({ type: "set", setId, defaultVolume: value.defaultVolume })
      }
      items={sets}
    >
      <ComboboxInput
        placeholder="Search sets..."
        showClear={!!value.setId}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>
            {sets.length === 0 ? "No sets in library yet." : "No sets found."}
          </ComboboxEmpty>
          <ComboboxCollection>
            {(s) => (
              <ComboboxItem key={s.id} value={s.id}>
                <span className="flex-1">{s.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {setCountMap[s.id] ?? 0} sounds
                </span>
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
