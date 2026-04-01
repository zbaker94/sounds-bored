import { useState, useMemo, useEffect, useRef, memo, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettings, useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary, checkMissingStatus } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportSounds } from "@/hooks/useImportSounds";
import { AUDIO_EXTENSIONS } from "@/lib/constants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderMusicIcon,
  Folder01Icon,
  ChevronRight,
  Music,
  Add01Icon,
  CloudUploadIcon,
  Playlist01Icon,
  PlayIcon,
  StopIcon,
  Tag01Icon,
  LockIcon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import type { GlobalFolder, Sound, Tag } from "@/lib/schemas";
import { ResolveMissingDialog } from "@/components/modals/ResolveMissingDialog";
import { ResolveMissingFolderDialog } from "@/components/modals/ResolveMissingFolderDialog";
import { AddSetDialog } from "./AddSetDialog";
import { AddToSetDialog } from "./AddToSetDialog";
import { AddTagsDialog } from "./AddTagsDialog";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TruncatedPath } from "@/components/ui/truncated-path";
import { useSoundPreview } from "@/hooks/useSoundPreview";
import guyWithTorch from "@/assets/guywithtorch.gif";

const EMPTY_FOLDERS: GlobalFolder[] = [];

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

interface SoundListItemTagsProps {
  soundTagIds: string[];
  allTags: Tag[];
}

const SoundListItemTags = memo(function SoundListItemTags({
  soundTagIds,
  allTags,
}: SoundListItemTagsProps) {
  const soundTags = useMemo(
    () => allTags.filter((t) => soundTagIds.includes(t.id)),
    [allTags, soundTagIds]
  );
  const systemTags = useMemo(() => soundTags.filter((t) => t.isSystem), [soundTags]);
  const userTags = useMemo(() => soundTags.filter((t) => !t.isSystem), [soundTags]);
  if (soundTagIds.length === 0) return null;
  if (soundTags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {systemTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-0.5 rounded-full bg-white/10 text-white/50 border border-white/20 drop-shadow-[0_2px_0px_rgba(255,255,255,0.05)] px-1.5 py-0 text-[10px] leading-4"
        >
          <HugeiconsIcon icon={LockIcon} size={8} />
          {tag.name}
        </span>
      ))}
      {userTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full bg-primary text-primary-foreground border border-[rgba(194,67,113,1)] drop-shadow-[0_2px_0px_rgba(194,67,113,1)] px-1.5 py-0 text-[10px] leading-4"
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
});

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const missingFolderIds = useLibraryStore((s) => s.missingFolderIds);

  const { data: settings } = useAppSettings();
  const folders = settings?.globalFolders ?? EMPTY_FOLDERS;

  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

  const importFolder = settings?.globalFolders.find(
    (f) => f.id === settings?.importFolderId,
  );
  const importSounds = useImportSounds(importFolder, folders);

  const importSoundsRef = useRef(importSounds);
  useEffect(() => {
    importSoundsRef.current = importSounds;
  }, [importSounds]);

  const [selectedId, setSelectedId] = useState<string | null>(
    folders[0]?.id ?? sets[0]?.id ?? null,
  );

  const soundsForSelectedId = useMemo(
    () =>
      selectedId
        ? sounds.filter(
            (s) => s.folderId === selectedId || s.sets.includes(selectedId),
          )
        : sounds,
    [sounds, selectedId],
  );

  const selectableSounds = useMemo(
    () => soundsForSelectedId.filter((s) => !missingSoundIds.has(s.id)),
    [soundsForSelectedId, missingSoundIds],
  );

  const allMissingSounds = useMemo(
    () => sounds.filter((s) => missingSoundIds.has(s.id)),
    [sounds, missingSoundIds],
  );

  const allMissingFolders = useMemo(
    () => folders.filter((f) => missingFolderIds.has(f.id)),
    [folders, missingFolderIds],
  );

  // ── Dialog queue handlers ──────────────────────────────────────────────────

  const handleSoundDialogResolved = useCallback(() => {
    soundWasResolved.current = true;
  }, []);

  const handleSoundDialogClose = useCallback(() => {
    const resolved = soundWasResolved.current;
    soundWasResolved.current = false;
    if (resolved) {
      setSoundDialogQueue((q) => q.slice(1));
    } else {
      setSoundDialogQueue([]);
    }
  }, []);

  const handleFolderDialogResolved = useCallback(() => {
    folderWasResolved.current = true;
  }, []);

  const handleFolderDialogClose = useCallback(() => {
    const resolved = folderWasResolved.current;
    folderWasResolved.current = false;
    if (resolved) {
      setFolderDialogQueue((q) => q.slice(1));
    } else {
      setFolderDialogQueue([]);
    }
  }, []);

  // ── Bulk remove handlers ───────────────────────────────────────────────────

  async function handleRemoveAllMissingSounds() {
    if (!settings) return;
    setIsBulkRemoving(true);
    try {
      const idsToRemove = new globalThis.Set(allMissingSounds.map((s) => s.id));
      for (const id of idsToRemove) evictBuffer(id);
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => !idsToRemove.has(s.id));
      });
      const latest = useLibraryStore.getState();
      await saveLibrary({ version: "1.0.0", sounds: latest.sounds, tags: latest.tags, sets: latest.sets });
      const result = await checkMissingStatus(settings.globalFolders, latest.sounds);
      useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
      toast.success(`${idsToRemove.size} missing sound${idsToRemove.size > 1 ? "s" : ""} removed`);
    } catch {
      toast.error("Failed to remove missing sounds");
    } finally {
      setIsBulkRemoving(false);
      setConfirmRemoveSoundsOpen(false);
    }
  }

  async function handleRemoveAllMissingFolders() {
    if (!settings) return;
    setIsBulkRemoving(true);
    try {
      const folderIdsToRemove = new globalThis.Set(allMissingFolders.map((f) => f.id));
      const updatedSettings = {
        ...settings,
        globalFolders: settings.globalFolders.filter((f) => !folderIdsToRemove.has(f.id)),
      };
      await saveSettings(updatedSettings);
      const soundIdsToRemove = new globalThis.Set(
        sounds.filter((s) => s.folderId && folderIdsToRemove.has(s.folderId)).map((s) => s.id),
      );
      for (const id of soundIdsToRemove) evictBuffer(id);
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => !soundIdsToRemove.has(s.id));
      });
      const latest = useLibraryStore.getState();
      await saveLibrary({ version: "1.0.0", sounds: latest.sounds, tags: latest.tags, sets: latest.sets });
      const result = await checkMissingStatus(updatedSettings.globalFolders, latest.sounds);
      useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
      toast.success(
        `${folderIdsToRemove.size} missing folder${folderIdsToRemove.size > 1 ? "s" : ""} and ${soundIdsToRemove.size} sound${soundIdsToRemove.size !== 1 ? "s" : ""} removed`,
      );
    } catch {
      toast.error("Failed to remove missing folders");
    } finally {
      setIsBulkRemoving(false);
      setConfirmRemoveFoldersOpen(false);
    }
  }

  const [soundsListHover, setSoundsListHover] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [addSetOpen, setAddSetOpen] = useState(false);
  const [addToSetOpen, setAddToSetOpen] = useState(false);
  const [addTagsOpen, setAddTagsOpen] = useState(false);
  // Dialog queues — queue[0] is the active item; empty = closed.
  // One-off clicks push a single-item queue; "Review one by one" pushes all missing items.
  // onResolved: slice head → continue chain. onClose without onResolved: clear queue → break chain.
  const [soundDialogQueue, setSoundDialogQueue] = useState<Sound[]>([]);
  const [folderDialogQueue, setFolderDialogQueue] = useState<GlobalFolder[]>([]);
  const soundWasResolved = useRef(false);
  const folderWasResolved = useRef(false);
  const [confirmRemoveSoundsOpen, setConfirmRemoveSoundsOpen] = useState(false);
  const [confirmRemoveFoldersOpen, setConfirmRemoveFoldersOpen] = useState(false);
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);
  const [selectedSoundIds, setSelectedSoundIds] = useState<globalThis.Set<string>>(new globalThis.Set());
  const { previewingId, togglePreview, stopPreview } = useSoundPreview();

  useEffect(() => {
    setSelectedSoundIds(new globalThis.Set());
    stopPreview();
  }, [selectedId, stopPreview]);

  const handleSelect = (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
  };

  async function handleDropImport(paths: string[]) {
    setIsImporting(true);
    try {
      const count = await importSoundsRef.current(paths);
      if (count > 0) toast.success(`${count} sound(s) imported`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleImportSounds() {
    if (!settings) return;
    setIsImporting(true);
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS.map((e) => e.replace(".", "")) }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const count = await importSounds(paths);
      if (count > 0) toast.success(`${count} sound(s) imported`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleAddFolder() {
    if (!settings) return;
    setIsAddingFolder(true);
    try {
      const selected = await open({ directory: true });
      if (!selected || typeof selected !== "string") return;
      if (settings.globalFolders.some((f) => f.path === selected)) {
        toast.error("That folder is already in your library.");
        return;
      }
      const name = selected.split(/[\\/]/).pop() ?? selected;
      const newFolder: GlobalFolder = {
        id: crypto.randomUUID(),
        path: selected,
        name,
      };
      const updatedSettings = {
        ...settings,
        globalFolders: [...settings.globalFolders, newFolder],
      };
      await saveSettings(updatedSettings);

      const result = await reconcileGlobalLibrary(
        updatedSettings.globalFolders,
        sounds,
      );
      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });
        const latest = useLibraryStore.getState();
        await saveLibrary({
          version: "1.0.0",
          sounds: latest.sounds,
          tags: latest.tags,
          sets: latest.sets,
        });
      }
      toast.success(`Folder "${name}" added`);
    } finally {
      setIsAddingFolder(false);
    }
  }

  async function handleDuplicateSet() {
    if (!selectedId) return;
    const newSet = useLibraryStore.getState().duplicateSet(selectedId);
    if (!newSet) return;
    const latest = useLibraryStore.getState();
    await saveLibrary({ version: "1.0.0", sounds: latest.sounds, tags: latest.tags, sets: latest.sets });
    toast.success(`"${newSet.name}" created`);
  }

  function handleSelectAllNone() {
    const selectableIds = selectableSounds.map((s) => s.id);
    const allSelectableSelected =
      selectableIds.length > 0 && selectableIds.every((id) => selectedSoundIds.has(id));
    if (allSelectableSelected) {
      setSelectedSoundIds(new globalThis.Set());
    } else {
      setSelectedSoundIds(new globalThis.Set(selectableIds));
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "enter") {
          setIsDragOver(true);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          await handleDropImport(event.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const selectedSoundIdsArray = useMemo(
    () => [...selectedSoundIds],
    [selectedSoundIds],
  );

  return (
    <div className="relative flex flex-col h-full min-h-0 gap-2 p-2">
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/70 backdrop-blur-sm pointer-events-none">
          <HugeiconsIcon
            icon={CloudUploadIcon}
            size={64}
            className="text-white/80"
          />
          <p className="text-white/80 text-sm font-medium">
            Drop audio files to import
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleImportSounds}
          disabled={isImporting}
        >
          <HugeiconsIcon icon={CloudUploadIcon} size={14} />
          {isImporting ? "Importing..." : "Import Sounds"}
        </Button>
      </div>
      <div className="flex flex-1 min-h-0 gap-2">
        <div className="flex flex-col w-1/2 gap-2">
          <div
            className={`${panelClass} flex-1 border border-white overflow-y-auto flex flex-col`}
          >
            {sets.length > 0 && (
              <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-black/70 backdrop-blur-sm border-b border-white/20 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setAddSetOpen(true)}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} /> Add Set
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={!selectedId || !sets.some((s) => s.id === selectedId)}
                  onClick={handleDuplicateSet}
                >
                  Duplicate Set
                </Button>
              </div>
            )}
            <div className="p-2 flex-1">
            {sets.map((set) => (
              <Item
                key={set.id}
                variant="outline"
                className={`text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg ${
                  selectedId === set.id ? "bg-white/20" : ""
                }`}
                onClick={() => handleSelect(set.id)}
              >
                <ItemMedia>
                  <HugeiconsIcon icon={Playlist01Icon} size={14} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{set.name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <HugeiconsIcon icon={ChevronRight} className="size-4" />
                </ItemActions>
              </Item>
            ))}
            </div>
            {sets.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon
                      icon={FolderMusicIcon}
                      className="text-black/70"
                    />
                  </EmptyMedia>
                  <EmptyTitle className="text-white/70">
                    No sets yet...
                  </EmptyTitle>
                </EmptyHeader>
                <EmptyDescription className="text-white/50">
                  No Data Found. Start by adding some Sounds to your library,
                  then organize them into Sets.
                </EmptyDescription>
                <EmptyContent className="flex-row justify-center gap-2">
                  <Button
                    variant="outline"
                    className="text-white/70"
                    onClick={handleImportSounds}
                    disabled={isImporting}
                  >
                    {isImporting ? "Importing..." : "Add Sounds"}
                  </Button>
                  <Button
                    variant="outline"
                    className="text-white/70"
                    onClick={() => setAddSetOpen(true)}
                  >
                    Add Set
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </div>
          <div
            className={`${panelClass} flex-1 border border-white overflow-y-auto flex flex-col`}
          >
            {folders.length > 0 && (
              <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-black/70 backdrop-blur-sm border-b border-white/20 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={handleAddFolder}
                  disabled={isAddingFolder}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} />
                  {isAddingFolder ? "Adding..." : "Add Folder"}
                </Button>
              </div>
            )}
            {allMissingFolders.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs shrink-0">
                <HugeiconsIcon icon={Alert02Icon} size={12} />
                <span>{allMissingFolders.length} folder{allMissingFolders.length > 1 ? "s" : ""} missing</span>
                <div className="ml-auto flex gap-1">
                  <button
                    className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                    onClick={() => setConfirmRemoveFoldersOpen(true)}
                  >
                    Remove All
                  </button>
                  <button
                    className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                    onClick={() => setFolderDialogQueue([...allMissingFolders])}
                  >
                    Review →
                  </button>
                </div>
              </div>
            )}
            <div className="p-2 flex-1">
              {folders.map((folder) => {
                const isFolderMissing = missingFolderIds.has(folder.id);
                return (
                  <Item
                    key={folder.id}
                    variant="outline"
                    className={`text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg ${
                      selectedId === folder.id ? "bg-white/20" : ""
                    }`}
                    onClick={() => {
                      if (isFolderMissing) {
                        setFolderDialogQueue([folder]);
                      } else {
                        handleSelect(folder.id);
                      }
                    }}
                  >
                    <ItemMedia>
                      <HugeiconsIcon
                        icon={isFolderMissing ? Alert02Icon : Folder01Icon}
                        size={14}
                        className={isFolderMissing ? "text-destructive" : undefined}
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className={isFolderMissing ? "text-destructive" : undefined}>
                        {folder.name}
                      </ItemTitle>
                      <ItemDescription className="text-white/40">
                        <TruncatedPath path={folder.path} />
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {isFolderMissing ? (
                        <HugeiconsIcon icon={Alert02Icon} className="size-4 text-destructive" />
                      ) : (
                        <HugeiconsIcon icon={ChevronRight} className="size-4" />
                      )}
                    </ItemActions>
                  </Item>
                );
              })}
              {folders.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        className="text-black/70"
                      />
                    </EmptyMedia>
                    <EmptyTitle className="text-white/70">
                      No folders yet...
                    </EmptyTitle>
                  </EmptyHeader>
                  <EmptyDescription className="text-white/50">
                    Add a folder to watch for audio files.
                  </EmptyDescription>
                  <EmptyContent className="flex-row justify-center">
                    <Button
                      variant="outline"
                      className="text-white/70"
                      onClick={handleAddFolder}
                      disabled={isAddingFolder}
                    >
                      Add Folder
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </div>
          </div>
        </div>
        <div
          className={`${panelClass} w-1/2 border border-white flex flex-col overflow-hidden`}
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
              onClick={() => setAddToSetOpen(true)}
            >
              <HugeiconsIcon icon={Add01Icon} size={12} /> Add to Set
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs px-2"
              disabled={selectedSoundIds.size === 0}
              onClick={() => setAddTagsOpen(true)}
            >
              <HugeiconsIcon icon={Tag01Icon} size={12} /> Manage Tags
            </Button>
          </div>
          {allMissingSounds.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs shrink-0">
              <HugeiconsIcon icon={Alert02Icon} size={12} />
              <span>{allMissingSounds.length} sound{allMissingSounds.length > 1 ? "s" : ""} missing</span>
              <div className="ml-auto flex gap-1">
                <button
                  className="px-1.5 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                  onClick={() => setConfirmRemoveSoundsOpen(true)}
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
          <div
            className="overflow-y-auto p-2 flex-1"
            onMouseEnter={() => setSoundsListHover(true)}
            onMouseLeave={() => setSoundsListHover(false)}
          >
            {soundsForSelectedId.map((sound) => {
              const isSoundMissing = missingSoundIds.has(sound.id);
              return (
                <Item
                  key={sound.id}
                  variant="muted"
                  className={`text-white/70 bg-black/5 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg`}
                  onClick={() => {
                    if (isSoundMissing) {
                      setSoundDialogQueue([sound]);
                      return;
                    }
                    setSelectedSoundIds((prev) => {
                      const next = new globalThis.Set(prev);
                      if (next.has(sound.id)) next.delete(sound.id);
                      else next.add(sound.id);
                      return next;
                    });
                  }}
                >
                  <ItemMedia>
                    {isSoundMissing ? (
                      <HugeiconsIcon icon={Alert02Icon} size={14} className="text-destructive" />
                    ) : (
                      <Checkbox
                        checked={selectedSoundIds.has(sound.id)}
                        onCheckedChange={() => {
                          setSelectedSoundIds((prev) => {
                            const next = new globalThis.Set(prev);
                            if (next.has(sound.id)) next.delete(sound.id);
                            else next.add(sound.id);
                            return next;
                          });
                        }}
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
                    <ItemTitle className={isSoundMissing ? "text-destructive" : undefined}>
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
                        <TooltipContent>File missing — click to resolve</TooltipContent>
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
        </div>
      </div>
      <img
        src={guyWithTorch}
        alt="Guy with torch"
        style={{
          position: "absolute",
          bottom: 0,
          right: -20,
          opacity: soundsListHover ? 0.2 : 1,
          pointerEvents: "none",
          zIndex: 50,
        }}
        draggable={false}
      />
      <AddSetDialog open={addSetOpen} onOpenChange={setAddSetOpen} />
      <AddToSetDialog open={addToSetOpen} onOpenChange={setAddToSetOpen} soundIds={selectedSoundIdsArray} />
      <AddTagsDialog open={addTagsOpen} onOpenChange={setAddTagsOpen} selectedSoundIds={selectedSoundIdsArray} />
      <ResolveMissingDialog
        sound={soundDialogQueue[0] ?? null}
        onResolved={handleSoundDialogResolved}
        onClose={handleSoundDialogClose}
      />
      <ResolveMissingFolderDialog
        folder={folderDialogQueue[0] ?? null}
        onResolved={handleFolderDialogResolved}
        onClose={handleFolderDialogClose}
      />

      {/* Bulk remove — missing sounds */}
      <Dialog open={confirmRemoveSoundsOpen} onOpenChange={setConfirmRemoveSoundsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove All Missing Sounds</DialogTitle>
            <DialogDescription>
              Remove all <strong>{allMissingSounds.length}</strong> missing sound{allMissingSounds.length > 1 ? "s" : ""} from your library?
              Their files are already gone — this just cleans up the library entries. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRemoveSoundsOpen(false)} disabled={isBulkRemoving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveAllMissingSounds} disabled={isBulkRemoving}>
              {isBulkRemoving ? "Removing…" : `Remove ${allMissingSounds.length} Sound${allMissingSounds.length > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk remove — missing folders */}
      <Dialog open={confirmRemoveFoldersOpen} onOpenChange={setConfirmRemoveFoldersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove All Missing Folders</DialogTitle>
            <DialogDescription>
              Remove all <strong>{allMissingFolders.length}</strong> missing folder{allMissingFolders.length > 1 ? "s" : ""} from your library?
              This will also remove all sounds associated with{" "}
              {allMissingFolders.length > 1 ? "those folders" : "that folder"} (
              <strong>
                {sounds.filter((s) => s.folderId && missingFolderIds.has(s.folderId)).length} sound{sounds.filter((s) => s.folderId && missingFolderIds.has(s.folderId)).length !== 1 ? "s" : ""}
              </strong>
              ). This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRemoveFoldersOpen(false)} disabled={isBulkRemoving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveAllMissingFolders} disabled={isBulkRemoving}>
              {isBulkRemoving ? "Removing…" : `Remove ${allMissingFolders.length} Folder${allMissingFolders.length > 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
