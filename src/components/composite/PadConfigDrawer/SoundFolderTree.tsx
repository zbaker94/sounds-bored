import { useEffect, useMemo, useRef, useState } from "react";
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

interface SoundFolderTreeProps {
  sounds: Sound[];
  selectedIds: Set<string>;
  onToggleSound: (soundId: string) => void;
  onToggleFolder: (folderId: string) => void;
}

function SoundNodeRow({
  sound,
  selected,
  onToggle,
}: {
  sound: Sound;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="accent-primary"
      />
      {sound.name}
    </label>
  );
}

function FolderNodeRow({
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
  const checkboxRef = useRef<HTMLInputElement>(null);

  const subtreeSounds = useMemo(() => getSoundsInSubtree(node), [node]);
  const selectedCount = subtreeSounds.filter((s) => selectedIds.has(s.id)).length;
  const isChecked = subtreeSounds.length > 0 && selectedCount === subtreeSounds.length;
  const isIndeterminate = selectedCount > 0 && selectedCount < subtreeSounds.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleFolder(node.folder.id)}
          className="accent-primary"
        />
        <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium hover:text-foreground/80">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {node.folder.name}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pl-5 flex flex-col gap-1 mt-1">
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
              onToggle={() => onToggleSound(child.sound.id)}
            />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

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
            onToggle={() => onToggleSound(node.sound.id)}
          />
        )
      )}
    </div>
  );
}
