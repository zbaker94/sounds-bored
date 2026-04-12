import { useState, useMemo } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderMusicIcon,
  ChevronRight,
  Add01Icon,
  Playlist01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { CURRENT_LIBRARY_VERSION } from "@/lib/constants";
import { cn } from "@/lib/utils";

const panelClass =
  "backdrop-blur-sm hover:backdrop-blur-lg bg-black/50 rounded-lg";

interface SetsPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchQuery: string;
  onOpenAddSet: () => void;
  onImportSounds: () => void;
  isImporting: boolean;
}

export function SetsPanel({
  selectedId,
  onSelect,
  searchQuery,
  onOpenAddSet,
  onImportSounds,
  isImporting,
}: SetsPanelProps) {
  const sets = useLibraryStore((s) => s.sets);
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  const filteredSets = useMemo(() => {
    if (!searchQuery) return sets;
    const q = searchQuery.toLowerCase();
    return sets.filter((s) => s.name.toLowerCase().includes(q));
  }, [sets, searchQuery]);

  const [confirmDeleteSetOpen, setConfirmDeleteSetOpen] = useState(false);

  function handleSelect(id: string) {
    if (selectedId === id) {
      onSelect(null);
      return;
    }
    onSelect(id);
  }

  async function handleDuplicateSet() {
    if (!selectedId) return;
    const newSet = useLibraryStore.getState().duplicateSet(selectedId);
    if (!newSet) return;
    const latest = useLibraryStore.getState();
    await saveLibrary({
      version: CURRENT_LIBRARY_VERSION,
      sounds: latest.sounds,
      tags: latest.tags,
      sets: latest.sets,
    });
    toast.success(`"${newSet.name}" created`);
  }

  async function handleDeleteSet() {
    if (!selectedId) return;
    const setName = sets.find((s) => s.id === selectedId)?.name ?? "";
    useLibraryStore.getState().deleteSet(selectedId);
    const latest = useLibraryStore.getState();
    await saveLibrary({
      version: CURRENT_LIBRARY_VERSION,
      sounds: latest.sounds,
      tags: latest.tags,
      sets: latest.sets,
    });
    onSelect(null);
    setConfirmDeleteSetOpen(false);
    toast.success(`"${setName}" deleted`);
  }

  return (
    <div
      className={cn(
        panelClass,
        "flex-1 border border-white overflow-y-auto flex flex-col",
      )}
    >
      {sets.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-black/70 backdrop-blur-sm border-b border-white/20 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={onOpenAddSet}
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
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs px-2"
            disabled={!selectedId || !sets.some((s) => s.id === selectedId)}
            onClick={() => setConfirmDeleteSetOpen(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} /> Delete Set
          </Button>
        </div>
      )}
      <div className="p-2 flex-1">
        {filteredSets.map((set) => (
          <Item
            key={set.id}
            variant="panel"
            className={cn(selectedId === set.id && "bg-white/20")}
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
      {sets.length === 0 && !searchQuery && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon
                icon={FolderMusicIcon}
                className="text-black/70"
              />
            </EmptyMedia>
            <EmptyTitle className="text-white/70">No sets yet...</EmptyTitle>
          </EmptyHeader>
          <EmptyDescription className="text-white/50">
            No Data Found. Start by adding some Sounds to your library, then
            organize them into Sets.
          </EmptyDescription>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button
              variant="outline"
              className="text-white/70"
              onClick={onImportSounds}
              disabled={isImporting}
            >
              {isImporting ? "Importing..." : "Add Sounds"}
            </Button>
            <Button
              variant="outline"
              className="text-white/70"
              onClick={onOpenAddSet}
            >
              Add Set
            </Button>
          </EmptyContent>
        </Empty>
      )}
      <Dialog
        open={confirmDeleteSetOpen}
        onOpenChange={setConfirmDeleteSetOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Set</DialogTitle>
            <DialogDescription>
              Delete the set{" "}
              <strong>
                {sets.find((s) => s.id === selectedId)?.name ?? ""}
              </strong>
              ? The sounds in this set will not be deleted — they will just be
              removed from this set.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteSetOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSet}>
              Delete Set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
