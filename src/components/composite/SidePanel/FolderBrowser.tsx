import { SetsPanel } from "./SetsPanel";
import { FoldersPanel } from "./FoldersPanel";

interface FolderBrowserProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchQuery: string;
  onOpenAddSet: () => void;
  onImportSounds: () => void;
  isImporting: boolean;
}

export function FolderBrowser({
  selectedId,
  onSelect,
  searchQuery,
  onOpenAddSet,
  onImportSounds,
  isImporting,
}: FolderBrowserProps) {
  return (
    <div className="flex flex-col w-1/2 gap-2">
      <SetsPanel
        selectedId={selectedId}
        onSelect={onSelect}
        searchQuery={searchQuery}
        onOpenAddSet={onOpenAddSet}
        onImportSounds={onImportSounds}
        isImporting={isImporting}
      />
      <FoldersPanel
        selectedId={selectedId}
        onSelect={onSelect}
        searchQuery={searchQuery}
      />
    </div>
  );
}
