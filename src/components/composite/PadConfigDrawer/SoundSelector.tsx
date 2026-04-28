import { useState, useMemo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import Fuse from "fuse.js";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { filterSoundsByTags } from "@/lib/audio/resolveSounds";
import type { LayerSelection, Sound, SoundInstance } from "@/lib/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxInput,
} from "@/components/ui/combobox";
import { TagPicker } from "@/components/composite/LibraryPickers";
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

  // Single pass over sounds: O(sounds × (avgTagsPerSound + avgSetsPerSound))
  const { tagCountMap, setCountMap } = useMemo(() => {
    const tc: Record<string, number> = {};
    const sc: Record<string, number> = {};
    for (const s of sounds) {
      for (const tid of s.tags) tc[tid] = (tc[tid] ?? 0) + 1;
      for (const sid of s.sets) sc[sid] = (sc[sid] ?? 0) + 1;
    }
    return { tagCountMap: tc, setCountMap: sc };
  }, [sounds]);

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
      <TagModeSection
        value={value}
        onChange={onChange}
        sounds={sounds}
        tagCountMap={tagCountMap}
      />
    );
  }

  // ── Set mode — single-select Combobox ────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        value={sets.find((s) => s.id === value.setId) ?? null}
        onValueChange={(set) => {
          if (set) onChange({ type: "set", setId: set.id, defaultVolume: value.defaultVolume });
        }}
        items={sets}
        isItemEqualToValue={(a, b) => a.id === b.id}
        itemToStringLabel={(s) => s.name}
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
                <ComboboxItem key={s.id} value={s}>
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
      <p className="text-xs text-muted-foreground">Sounds are drawn from this set at trigger time. Manage set membership in the Library panel.</p>
    </div>
  );
}

// ── Tag mode extracted component ─────────────────────────────────────────────

interface TagModeSectionProps {
  value: Extract<LayerSelection, { type: "tag" }>;
  onChange: (value: LayerSelection) => void;
  sounds: Sound[];
  tagCountMap: Record<string, number>;
}

function TagModeSection({ value, onChange, sounds, tagCountMap }: TagModeSectionProps) {
  const matchCount = useMemo(() => {
    if (value.tagIds.length === 0) return null;
    return filterSoundsByTags(sounds, value.tagIds, value.matchMode).length;
  }, [sounds, value.tagIds, value.matchMode]);

  const helperText = value.tagIds.length === 0
    ? "Select tags above to filter which sounds are eligible."
    : matchCount === 0
      ? "No sounds match — adjust your tags or add matching sounds to the library."
      : `${matchCount} sound(s) match ${value.matchMode === "any" ? "any" : "all"} of these tags.`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Label variant="section">Match Mode</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" tabIndex={-1}
              className="inline-flex items-center text-muted-foreground hover:text-foreground cursor-help">
              <HugeiconsIcon icon={InformationCircleIcon} size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Controls how sounds are filtered when multiple tags are selected.</TooltipContent>
        </Tooltip>
      </div>
      <Tabs
        value={value.matchMode}
        onValueChange={(mode) =>
          onChange({ ...value, matchMode: mode as "any" | "all" })
        }
      >
        <TabsList stretch>
          <TabsTrigger value="any">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>Any</span>
              </TooltipTrigger>
              <TooltipContent side="top">Eligible if the sound has at least one of the selected tags.</TooltipContent>
            </Tooltip>
          </TabsTrigger>
          <TabsTrigger value="all">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>All</span>
              </TooltipTrigger>
              <TooltipContent side="top">Eligible only if the sound has every one of the selected tags.</TooltipContent>
            </Tooltip>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <TagPicker
        value={value.tagIds}
        onChange={(tagIds) =>
          onChange({ type: "tag", tagIds, matchMode: value.matchMode, defaultVolume: value.defaultVolume })
        }
        renderItemSuffix={(t) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {tagCountMap[t.id] ?? 0} sounds
          </span>
        )}
      />
      <p className="text-xs text-muted-foreground">{helperText}</p>
    </div>
  );
}
