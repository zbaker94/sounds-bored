import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettings } from "@/lib/appSettings.queries";
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
import { useState } from "react";

import guyWithTorch from "@/assets/guywithtorch.gif";

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);
  const { data: settings } = useAppSettings();
  const folders = settings?.globalFolders ?? EMPTY_FOLDERS;

  const sounds = useLibraryStore((s) => s.sounds);

  const [selectedId, setSelectedId] = useState<string | null>(folders[0]?.id ?? sets[0]?.id ?? null);
  const [soundsForSelectedId, setSoundsForSelectedId] = useState(selectedId ? sounds.filter(
      (sound) => sound.folderId === selectedId || sound.sets.includes(selectedId as string),
    ) : null);

  const [soundsListHover, setSoundsListHover] = useState(false);

  const handleSelect = (id: string) => {
    if (selectedId === id) {
      // Deselect if clicking the same item
      setSelectedId(null);
      setSoundsForSelectedId(sounds);
      return;
    }

    setSelectedId(id);

    // Load the corresponding set or folder contents so that they show up in the right pane.
    const selectedSounds = sounds.filter(
      (sound) => sound.folderId === id || sound.sets.includes(id),
    );
    setSoundsForSelectedId(selectedSounds);
  };

  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      <div className="flex flex-col w-1/2 gap-2">
        <div
          className={`${panelClass} flex-1 border border-white overflow-y-auto`}
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
                No Data Found. Start by adding some Sounds to your library, then
                organize them into Sets.
              </EmptyDescription>
              <EmptyContent className="flex-row justify-center gap-2">
                <Button variant="outline" className="text-white/70">
                  Add Sounds
                </Button>
                <Button variant="outline" className="text-white/70">
                  Add Set
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
        <div
          className={`${panelClass} flex-1 border border-white overflow-y-auto`}
        >
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
                  {folder.path}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <HugeiconsIcon icon={ChevronRight} className="size-4" />
              </ItemActions>
            </Item>
          ))}
          {folders.length === 0 ? (
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
                <Button variant="outline" className="text-white/70">
                  Add Folder
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Item className={`text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg border-t border-white/60`}>
              <ItemMedia>
                <HugeiconsIcon icon={Add01Icon} size={14} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Add Folder</ItemTitle>
                <ItemDescription className="text-white/40">
                  Add a folder to watch for audio files. This will persist across projects.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
              </ItemActions>
            </Item>
          )}
        </div>
      </div>
      <div className={`${panelClass} w-1/2 border border-white`} onMouseEnter={() => setSoundsListHover(true)} onMouseLeave={() => setSoundsListHover(false)}>
        {soundsForSelectedId?.map((sound) => (
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
                {sound.filePath}
              </ItemDescription>
            </ItemContent>
            <ItemActions></ItemActions>
          </Item>
        ))}
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
