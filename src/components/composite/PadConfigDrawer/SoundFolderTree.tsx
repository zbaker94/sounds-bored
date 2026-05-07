import { useMemo, useState, memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { buildTree, getSoundsInSubtree, type TreeNode } from "./soundTreeUtils";
import type { Sound } from "@/lib/schemas";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface SoundFolderTreeProps {
  sounds: Sound[];
  selectedIds: Set<string>;
  onToggleSound: (soundId: string) => void;
  onToggleFolder: (folderId: string) => void;
}

const SoundNodeRow = memo(function SoundNodeRow({
  sound,
  selected,
  onToggle,
}: {
  sound: Sound;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <Checkbox checked={selected} onCheckedChange={() => onToggle(sound.id)} />
      {sound.name}
    </label>
  );
});

const FolderNodeRow = memo(function FolderNodeRow({
  node,
  selectedIds,
  onToggleSound,
  onToggleFolder,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  selectedIds: Set<string>;
  onToggleSound: (soundId: string) => void;
  onToggleFolder: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const subtreeSounds = useMemo(() => getSoundsInSubtree(node), [node]);
  const selectedCount = subtreeSounds.filter((s) => selectedIds.has(s.id)).length;
  const isChecked = subtreeSounds.length > 0 && selectedCount === subtreeSounds.length;
  const isIndeterminate = selectedCount > 0 && selectedCount < subtreeSounds.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isIndeterminate ? "indeterminate" : isChecked}
          onCheckedChange={() => onToggleFolder(node.folder.id)}
          aria-label={`Toggle all sounds in ${node.folder.name}`}
        />
        <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium hover:text-foreground/80">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            className={cn("transition-transform duration-150", open && "rotate-90")}
          />
          {node.folder.name}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent animated isOpen={open} className="pl-5 flex flex-col gap-1 mt-1">
        {node.children.map((child) =>
          child.kind === "folder" ? (
            <FolderNodeRow
              key={child.folder.id}
              node={child}
              selectedIds={selectedIds}
              onToggleSound={onToggleSound}
              onToggleFolder={onToggleFolder}
            />
          ) : (
            <SoundNodeRow
              key={child.sound.id}
              sound={child.sound}
              selected={selectedIds.has(child.sound.id)}
              onToggle={onToggleSound}
            />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

export function SoundFolderTree({
  sounds,
  selectedIds,
  onToggleSound,
  onToggleFolder,
}: SoundFolderTreeProps) {
  const globalFolders = useAppSettingsStore(
    useShallow((s) => s.settings?.globalFolders ?? [])
  );

  const roots = useMemo(
    () => buildTree(sounds, globalFolders),
    [sounds, globalFolders]
  );

  if (roots.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
      {roots.map((node) =>
        node.kind === "folder" ? (
          <FolderNodeRow
            key={node.folder.id}
            node={node}
            selectedIds={selectedIds}
            onToggleSound={onToggleSound}
            onToggleFolder={onToggleFolder}
          />
        ) : (
          <SoundNodeRow
            key={node.sound.id}
            sound={node.sound}
            selected={selectedIds.has(node.sound.id)}
            onToggle={onToggleSound}
          />
        )
      )}
    </div>
  );
}
