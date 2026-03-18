import { useLibraryStore } from "@/state/libraryStore";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderMusicIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

const panelClass = "backdrop-blur-sm bg-black/50 rounded-lg";

export function SoundsPanel() {
  const sets = useLibraryStore((s) => s.sets);

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
                    <HugeiconsIcon icon={FolderMusicIcon} className="text-black/70" />
                  </EmptyMedia>
                  <EmptyTitle className="text-white/70">No sets yet...</EmptyTitle>
                </EmptyHeader>
                <EmptyDescription className="text-white/50">
                  No Data Found. Start by adding some Sounds to your library,
                  then organize them into Sets.
                </EmptyDescription>
              <EmptyContent className="flex-row justify-center gap-2">
                <Button variant="outline" className="text-white/70">
                  Add Sounds
                </Button>
                <Button variant="outline" className="text-white/70">
                  Add Sets
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
        <div className={`${panelClass} flex-1 border border-white`} />
      </div>
      <div className={`${panelClass} w-1/2 border border-white`} />
    </div>
  );
}
