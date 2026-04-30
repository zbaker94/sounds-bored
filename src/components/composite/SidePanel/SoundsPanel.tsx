import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { pickFiles, grantDroppedPaths } from "@/lib/scope";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudUploadIcon, Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useImportSounds } from "@/hooks/useImportSounds";
import { AUDIO_FILE_FILTERS } from "@/lib/constants";
import { AddSetDialog } from "./AddSetDialog";
import { AddToSetDialog } from "./AddToSetDialog";
import { AddTagsDialog } from "./AddTagsDialog";
import { DownloadDialog } from "@/components/modals/DownloadDialog";
import { DownloadStatusButton } from "@/components/composite/DownloadManager/DownloadStatusButton";
import { FolderBrowser } from "./FolderBrowser";
import { SoundList } from "./SoundList";
import { ConfirmRemoveMissingDialog } from "@/components/modals/ConfirmRemoveMissingDialog";
import guyWithTorch from "@/assets/guywithtorch.gif";

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);
  const settings = useAppSettingsStore((s) => s.settings);
  const folders = useMemo(() => settings?.globalFolders ?? [], [settings]);

  const importFolder = folders.find((f) => f.id === settings?.importFolderId);
  const importSounds = useImportSounds(importFolder, folders);
  const importSoundsRef = useRef(importSounds);
  useEffect(() => { importSoundsRef.current = importSounds; }, [importSounds]);

  const [selectedId, setSelectedId] = useState<string | null>(folders[0]?.id ?? sets[0]?.id ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSoundIds, setSelectedSoundIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [addSetOpen, setAddSetOpen] = useState(false);
  const [addToSetOpen, setAddToSetOpen] = useState(false);
  const [addTagsOpen, setAddTagsOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  useEffect(() => { setSelectedSoundIds(new Set()); }, [selectedId]);

  // handleDropImport only reads importSoundsRef.current (a ref, always fresh)
  // and setIsImporting (a stable setState setter), so the empty dep array on
  // the onDragDropEvent effect below is safe. useCallback with [] deps makes
  // the stable-identity contract explicit.
  const handleDropImport = useCallback(async (paths: string[]) => {
    setIsImporting(true);
    try {
      await grantDroppedPaths(paths);
      const count = await importSoundsRef.current(paths);
      if (count > 0) toast.success(`${count} sound(s) imported`);
    } finally {
      setIsImporting(false);
    }
  }, []);

  async function handleImportSounds() {
    if (!settings) return;
    setIsImporting(true);
    try {
      const paths = await pickFiles({
        filters: AUDIO_FILE_FILTERS,
      });
      if (!paths.length) return;
      const count = await importSounds(paths);
      if (count > 0) toast.success(`${count} sound(s) imported`);
    } finally {
      setIsImporting(false);
    }
  }

  // handleDropImport is stable (useCallback with []), so the empty dep array
  // is safe and registers the Tauri listener exactly once per mount.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "enter") setIsDragOver(true);
        else if (event.payload.type === "leave") setIsDragOver(false);
        else if (event.payload.type === "drop") {
          setIsDragOver(false);
          await handleDropImport(event.payload.paths);
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSoundIdsArray = useMemo(() => [...selectedSoundIds], [selectedSoundIds]);

  return (
    <div className="group relative flex flex-col h-full min-h-0 gap-2 p-2">
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/70 backdrop-blur-sm pointer-events-none">
          <HugeiconsIcon icon={CloudUploadIcon} size={64} className="text-white/80" />
          <p className="text-white/80 text-sm font-medium">Drop audio files to import</p>
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" size="sm" onClick={handleImportSounds} disabled={isImporting}>
          <HugeiconsIcon icon={CloudUploadIcon} size={14} />
          {isImporting ? "Importing..." : "Import Sounds"}
        </Button>
        <DownloadStatusButton onOpenDialog={() => setDownloadDialogOpen(true)} />
        <div className="relative ml-auto flex items-center">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-2.5 text-white/50 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search..."
            className="h-8 pl-8 pr-7 w-48 text-sm rounded-full bg-black border-white text-white placeholder:text-white/60 focus-visible:border-white focus-visible:ring-white/20"
            value={searchQuery}
            onChange={(e) => {
              const value = e.target.value;
              setSearchQuery(value);
              if (value) setSelectedId(null);
            }}
          />
          {searchQuery && (
            <button
              className="absolute right-2.5 text-yellow-400 hover:text-yellow-300"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 min-h-0 gap-2">
        <FolderBrowser
          selectedId={selectedId}
          onSelect={setSelectedId}
          searchQuery={searchQuery}
          onOpenAddSet={() => setAddSetOpen(true)}
          onImportSounds={handleImportSounds}
          isImporting={isImporting}
        />
        <SoundList
          selectedId={selectedId}
          searchQuery={searchQuery}
          selectedSoundIds={selectedSoundIds}
          onSelectionChange={setSelectedSoundIds}
          onOpenAddToSet={() => setAddToSetOpen(true)}
          onOpenAddTags={() => setAddTagsOpen(true)}
        />
      </div>
      <img
        src={guyWithTorch}
        alt="Guy with torch"
        className="pointer-events-none opacity-100 group-hover:opacity-20 transition-opacity"
        style={{ position: "absolute", bottom: 0, right: -20, zIndex: 50 }}
        draggable={false}
      />
      <DownloadDialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen} />
      <AddSetDialog open={addSetOpen} onOpenChange={setAddSetOpen} />
      <AddToSetDialog open={addToSetOpen} onOpenChange={setAddToSetOpen} soundIds={selectedSoundIdsArray} />
      <AddTagsDialog open={addTagsOpen} onOpenChange={setAddTagsOpen} selectedSoundIds={selectedSoundIdsArray} />
      <ConfirmRemoveMissingDialog />
    </div>
  );
}
