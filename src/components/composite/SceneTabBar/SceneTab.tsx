import { useState, useRef, useEffect } from "react";
import { useProjectStore } from "@/state/projectStore";
import { TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Tick01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { Scene } from "@/lib/schemas";
import { ConfirmDeleteSceneDialog } from "@/components/modals/ConfirmDeleteSceneDialog";

interface SceneTabProps {
  scene: Scene;
}

export function SceneTab({ scene }: SceneTabProps) {
  const renameScene = useProjectStore((s) => s.renameScene);
  const deleteScene = useProjectStore((s) => s.deleteScene);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(scene.name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setEditValue(scene.name);
    setIsEditing(true);
  }

  function commitRename() {
    const trimmed = editValue.trim();
    if (trimmed) {
      renameScene(scene.id, trimmed);
    }
    setIsEditing(false);
  }

  function cancelRename() {
    setEditValue(scene.name);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setIsConfirmingDelete(true);
  }

  function handleConfirmDelete() {
    setIsConfirmingDelete(false);
    deleteScene(scene.id);
  }

  function handleCancelDelete() {
    setIsConfirmingDelete(false);
  }

  if (isEditing) {
    return (
      <>
        <TabsTrigger value={scene.id} className="group gap-1" asChild>
          <div
            role="tab"
            data-testid={`scene-tab-${scene.id}`}
          >
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitRename}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="w-20 bg-transparent border-b border-current outline-none text-sm text-inherit"
              aria-label="Scene name input"
            />
            <button
              type="button"
              aria-label="Confirm rename"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                commitRename();
              }}
              className="inline-flex items-center justify-center"
            >
              <HugeiconsIcon icon={Tick01Icon} size={14} />
            </button>
          </div>
        </TabsTrigger>
        <ConfirmDeleteSceneDialog
          isOpen={isConfirmingDelete}
          sceneName={scene.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      </>
    );
  }

  return (
    <>
      <TabsTrigger value={scene.id} className="group gap-0 hover:gap-1.5">
        {scene.name}
        <button
          type="button"
          aria-label="Edit scene name"
          onMouseDown={startEditing}
          className="w-0 overflow-hidden group-hover:w-[14px] opacity-0 group-hover:opacity-100 transition-all inline-flex items-center justify-center"
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
        </button>
        <button
          type="button"
          aria-label="Delete scene"
          onClick={handleDeleteClick}
          className="w-0 overflow-hidden group-hover:w-[14px] opacity-0 group-hover:opacity-100 transition-all inline-flex items-center justify-center"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </TabsTrigger>
      <ConfirmDeleteSceneDialog
        isOpen={isConfirmingDelete}
        sceneName={scene.name}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </>
  );
}
