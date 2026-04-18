import { useState, useMemo, useEffect } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Music,
  Add01Icon,
  PlayIcon,
  StopIcon,
  Tag01Icon,
  Alert02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { checkMissingStatus } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";
import { useSoundPreview } from "@/hooks/useSoundPreview";
import { useResolveSoundQueue } from "@/hooks/useResolveSoundQueue";
import { ResolveMissingDialog } from "@/components/modals/ResolveMissingDialog";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { getAffectedPads, type AffectedPad } from "@/lib/projectSoundReconcile";
import { cn } from "@/lib/utils";
import { SoundListItemTags } from "./SoundListItemTags";
import { ConfirmDeleteSoundsDialog } from "./ConfirmDeleteSoundsDialog";

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

interface SoundListProps {
  selectedId: string | null;
  searchQuery: string;
  selectedSoundIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenAddToSet: () => void;
  onOpenAddTags: () => void;
}

export function SoundList({
  selectedId,
  searchQuery,
  selectedSoundIds,
  onSelectionChange,
  onOpenAddToSet,
  onOpenAddTags,
}: SoundListProps) {
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const project = useProjectStore((s) => s.project);

  const { saveCurrentLibrary } = useSaveCurrentLibrary();

  const { previewingId, togglePreview, stopPreview } = useSoundPreview();

  useEffect(() => {
    stopPreview();
  }, [selectedId, stopPreview]);
  const {
    soundDialogQueue,
    setSoundDialogQueue,
    handleSoundDialogResolved,
    handleSoundDialogClose,
  } = useResolveSoundQueue();

  const soundsForSelectedId = useMemo(
    () =>
      selectedId
        ? sounds.filter(
            (s) => s.folderId === selectedId || s.sets.includes(selectedId),
          )
        : sounds,
    [sounds, selectedId],
  );

  const filteredSounds = useMemo(() => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return sounds.filter((s) => {
        if (s.name.toLowerCase().includes(q)) return true;
        return tags
          .filter((t) => s.tags.includes(t.id))
          .some((t) => t.name.toLowerCase().includes(q));
      });
    }
    return soundsForSelectedId;
  }, [sounds, soundsForSelectedId, tags, searchQuery]);

  const selectableSounds = useMemo(
    () => filteredSounds.filter((s) => !missingSoundIds.has(s.id)),
    [filteredSounds, missingSoundIds],
  );

  const allMissingSounds = useMemo(
    () => sounds.filter((s) => missingSoundIds.has(s.id)),
    [sounds, missingSoundIds],
  );

  const [
    confirmDeleteSoundsFromDiskOpen,
    setConfirmDeleteSoundsFromDiskOpen,
  ] = useState(false);
  const [isDeletingSounds, setIsDeletingSounds] = useState(false);
  const [affectedPadsForSoundsDelete, setAffectedPadsForSoundsDelete] =
    useState<AffectedPad[]>([]);

  function handleSelectAllNone() {
    const selectableIds = selectableSounds.map((s) => s.id);
    const allSelectableSelected =
      selectableIds.length > 0 &&
      selectableIds.every((id) => selectedSoundIds.has(id));
    if (allSelectableSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(selectableIds));
    }
  }

  function toggleSelection(soundId: string) {
    const next = new Set(selectedSoundIds);
    if (next.has(soundId)) next.delete(soundId);
    else next.add(soundId);
    onSelectionChange(next);
  }

  async function handleDeleteSoundsFromDisk() {
    setIsDeletingSounds(true);
    try {
      const count = selectedSoundIds.size;
      const soundsToDelete = sounds.filter((s) => selectedSoundIds.has(s.id));
      let deletedFromDisk = 0;
      let failedCount = 0;
      for (const sound of soundsToDelete) {
        if (
          sound.filePath &&
          sound.folderId &&
          !missingSoundIds.has(sound.id)
        ) {
          try {
            await remove(sound.filePath);
            deletedFromDisk++;
          } catch {
            failedCount++;
          }
        }
        evictBuffer(sound.id);
        evictStreamingElement(sound.id);
      }
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => !selectedSoundIds.has(s.id));
      });
      await saveCurrentLibrary();
      const latest = useLibraryStore.getState();
      const currentFolders =
        useAppSettingsStore.getState().settings?.globalFolders ?? [];
      const missingResult = await checkMissingStatus(
        currentFolders,
        latest.sounds,
      );
      useLibraryStore
        .getState()
        .setMissingState(
          missingResult.missingSoundIds,
          missingResult.missingFolderIds,
          missingResult.unknownSoundIds,
          missingResult.unknownFolderIds,
        );
      onSelectionChange(new Set());
      if (failedCount > 0) {
        toast.warning(
          `${deletedFromDisk} of ${count} file${count > 1 ? "s" : ""} deleted; ${failedCount} could not be removed from disk`,
        );
      } else if (deletedFromDisk < count) {
        toast.success(
          `${count} removed from library (${deletedFromDisk} deleted from disk)`,
        );
      } else {
        toast.success(
          `${count} sound${count > 1 ? "s" : ""} deleted from disk`,
        );
      }
    } catch {
      toast.error("Failed to delete sounds from disk");
    } finally {
      setIsDeletingSounds(false);
      setConfirmDeleteSoundsFromDiskOpen(false);
    }
  }

  function handleRequestDeleteSoundsFromDisk() {
    if (project) {
      setAffectedPadsForSoundsDelete(
        getAffectedPads(project, selectedSoundIds),
      );
    } else {
      setAffectedPadsForSoundsDelete([]);
    }
    setConfirmDeleteSoundsFromDiskOpen(true);
  }

  return (
    <div
      className={cn(
        panelClass,
        "w-1/2 border border-white flex flex-col overflow-hidden",
      )}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-black/70 backdrop-blur-sm border-b border-white/20 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={handleSelectAllNone}
          disabled={selectableSounds.length === 0}
        >
          {selectableSounds.length > 0 &&
          selectableSounds.every((s) => selectedSoundIds.has(s.id))
            ? "Select None"
            : "Select All"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          disabled={selectedSoundIds.size === 0}
          onClick={onOpenAddToSet}
        >
          <HugeiconsIcon icon={Add01Icon} size={12} /> Add to Set
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          disabled={selectedSoundIds.size === 0}
          onClick={onOpenAddTags}
        >
          <HugeiconsIcon icon={Tag01Icon} size={12} /> Manage Tags
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs px-2"
          disabled={selectedSoundIds.size === 0}
          onClick={handleRequestDeleteSoundsFromDisk}
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} /> Delete from Disk
        </Button>
      </div>
      {allMissingSounds.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs shrink-0">
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          <span>
            {allMissingSounds.length} sound
            {allMissingSounds.length > 1 ? "s" : ""} missing
          </span>
          <div className="ml-auto flex gap-1">
            <button
              className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
              onClick={() =>
                useUiStore
                  .getState()
                  .openOverlay(OVERLAY_ID.CONFIRM_REMOVE_MISSING_SOUNDS, "dialog")
              }
            >
              Remove All
            </button>
            <button
              className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
              onClick={() => setSoundDialogQueue([...allMissingSounds])}
            >
              Review →
            </button>
          </div>
        </div>
      )}
      <div className="overflow-y-auto p-2 flex-1">
        {filteredSounds.map((sound) => {
          const isSoundMissing = missingSoundIds.has(sound.id);
          return (
            <Item
              key={sound.id}
              variant="panel"
              className="bg-black/5"
              onClick={() => {
                if (isSoundMissing) {
                  setSoundDialogQueue([sound]);
                  return;
                }
                toggleSelection(sound.id);
              }}
            >
              <ItemMedia>
                {isSoundMissing ? (
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    size={14}
                    className="text-destructive"
                  />
                ) : (
                  <Checkbox
                    checked={selectedSoundIds.has(sound.id)}
                    onCheckedChange={() => toggleSelection(sound.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </ItemMedia>
              <ItemMedia>
                <HugeiconsIcon
                  icon={Music}
                  size={14}
                  className={isSoundMissing ? "text-destructive/70" : undefined}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle
                  className={isSoundMissing ? "text-destructive" : undefined}
                >
                  {sound.name}
                </ItemTitle>
                <SoundListItemTags soundTagIds={sound.tags} allTags={tags} />
              </ItemContent>
              <ItemActions>
                {isSoundMissing ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSoundDialogQueue([sound]);
                          }}
                        >
                          <HugeiconsIcon icon={Alert02Icon} size={14} />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      File missing — click to resolve
                    </TooltipContent>
                  </Tooltip>
                ) : sound.filePath ? (
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    className="hover:text-white hover:bg-ghost/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreview(sound);
                    }}
                  >
                    <HugeiconsIcon
                      icon={previewingId === sound.id ? StopIcon : PlayIcon}
                      size={14}
                    />
                  </Button>
                ) : null}
              </ItemActions>
            </Item>
          );
        })}
      </div>
      <ResolveMissingDialog
        sound={soundDialogQueue[0] ?? null}
        onResolved={handleSoundDialogResolved}
        onClose={handleSoundDialogClose}
      />
      <ConfirmDeleteSoundsDialog
        open={confirmDeleteSoundsFromDiskOpen}
        onOpenChange={setConfirmDeleteSoundsFromDiskOpen}
        soundCount={selectedSoundIds.size}
        affectedPads={affectedPadsForSoundsDelete}
        isDeleting={isDeletingSounds}
        onConfirm={handleDeleteSoundsFromDisk}
      />
    </div>
  );
}
