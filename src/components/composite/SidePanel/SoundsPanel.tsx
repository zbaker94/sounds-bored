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

const panelClass = "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);
  const { data: settings } = useAppSettings();
  const folders = settings?.globalFolders ?? EMPTY_FOLDERS;

  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      <div className="flex flex-col w-1/2 gap-2">
        <div
          className={`${panelClass} flex-1 border border-white overflow-y-auto`}
        >
          {sets.map((set) => (
            <div key={set.id} className="px-3 py-2 text-white text-sm">
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
              className="text-white/70 hover:bg-white/20 cursor-pointer hover:backdrop-blur-lg"
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
                <Button variant="outline" className="text-white/70">
                  Add Folder
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
      </div>
      <div className={`${panelClass} w-1/2 border border-white`} />
    </div>
  );
}
