import { useState, useMemo, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettings } from "@/lib/appSettings.queries";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { copyFilesToFolder } from "@/lib/import";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
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
} from "@hugeicons/core-free-icons";
import type { GlobalFolder } from "@/lib/schemas";

const EMPTY_FOLDERS: GlobalFolder[] = [];
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

import { TruncatedPath } from "@/components/ui/truncated-path";
import guyWithTorch from "@/assets/guywithtorch.gif";

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);

  const { data: settings } = useAppSettings();
  const folders = settings?.globalFolders ?? EMPTY_FOLDERS;

  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();
  const { mutateAsync: saveSettings } = useSaveAppSettings();

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

  const [soundsListHover, setSoundsListHover] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleSelect = (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
  };

  async function handleDropImport(paths: string[]) {
    if (!settings) return;
    const importFolder = settings.globalFolders.find(
      (f) => f.id === settings.importFolderId,
    );
    if (!importFolder) return;
    setIsImporting(true);
    try {
      const copied = await copyFilesToFolder(paths, importFolder.path);
      if (copied.length === 0) return;
      const result = await reconcileGlobalLibrary(
        settings.globalFolders,
        sounds,
      );
      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });
        await saveLibrary({
          version: "1.0.0",
          sounds: result.sounds,
          tags,
          sets,
        });
      }
      toast.success(`${copied.length} sound(s) imported`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleImportSounds() {
    if (!settings) return;
    const importFolder = settings.globalFolders.find(
      (f) => f.id === settings.importFolderId,
    );
    if (!importFolder) return;

    setIsImporting(true);
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Audio",
            extensions: AUDIO_EXTENSIONS.map((e) => e.replace(".", "")),
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const copied = await copyFilesToFolder(paths, importFolder.path);
      if (copied.length === 0) return;

      const result = await reconcileGlobalLibrary(
        settings.globalFolders,
        sounds,
      );
      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });
        await saveLibrary({
          version: "1.0.0",
          sounds: result.sounds,
          tags,
          sets,
        });
      }
      toast.success(`${copied.length} sound(s) imported`);
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
        await saveLibrary({
          version: "1.0.0",
          sounds: result.sounds,
          tags,
          sets,
        });
      }
      toast.success(`Folder "${name}" added`);
    } finally {
      setIsAddingFolder(false);
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
            className={`${panelClass} flex-1 border border-white overflow-y-auto p-2`}
          >
            {sets.map((set) => (
              <div
                key={set.id}
                className={`px-3 py-2 text-white text-sm ${
                  selectedId === set.id ? "bg-white/20" : ""
                }`}
                onClick={() => handleSelect(set.id)}
              >
                {set.name}
              </div>
            ))}
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
                  <Button variant="outline" className="text-white/70">
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
                  variant="ghost"
                  size="sm"
                  className="text-white/70 h-7 text-xs px-2"
                  onClick={handleAddFolder}
                  disabled={isAddingFolder}
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} />
                  {isAddingFolder ? "Adding..." : "Add Folder"}
                </Button>
              </div>
            )}
            <div className="p-2 flex-1">
              {folders.map((folder) => (
                <Item
                  key={folder.id}
                  variant="outline"
                  className={`text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg ${
                    selectedId === folder.id ? "bg-white/20" : ""
                  }`}
                  onClick={() => handleSelect(folder.id)}
                >
                  <ItemMedia>
                    <HugeiconsIcon icon={Folder01Icon} size={14} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{folder.name}</ItemTitle>
                    <ItemDescription className="text-white/40">
                      <TruncatedPath path={folder.path} />
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <HugeiconsIcon icon={ChevronRight} className="size-4" />
                  </ItemActions>
                </Item>
              ))}
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
          className={`${panelClass} w-1/2 border border-white overflow-y-auto p-2`}
          onMouseEnter={() => setSoundsListHover(true)}
          onMouseLeave={() => setSoundsListHover(false)}
        >
          {soundsForSelectedId.map((sound) => (
            <Item
              key={sound.id}
              variant="muted"
              className={`text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg`}
            >
              <ItemMedia>
                <HugeiconsIcon icon={Music} size={14} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{sound.name}</ItemTitle>
                <ItemDescription className="text-white/40">
                  <TruncatedPath path={sound.filePath} />
                </ItemDescription>
              </ItemContent>
              <ItemActions></ItemActions>
            </Item>
          ))}
        </div>
      </div>
      <img
        src={guyWithTorch}
        alt="Guy with torch"
        style={{
          position: "absolute",
          bottom: -12,
          right: -20,
          opacity: soundsListHover ? 0.5 : 1,
          pointerEvents: "none",
          zIndex: 50,
        }}
        draggable={false}
      />
    </div>
  );
}
