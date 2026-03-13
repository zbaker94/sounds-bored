import { useState, useEffect } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SaveProjectDialogProps {
  isOpen: boolean;
  onSave: (projectName: string) => void;
  onCancel: () => void;
  defaultName?: string;
  isPending?: boolean;
}

export function SaveProjectDialog({
  isOpen,
  onSave,
  onCancel,
  defaultName = "",
  isPending = false,
}: SaveProjectDialogProps) {
  const [projectName, setProjectName] = useState(defaultName);

  // Sync local state when defaultName prop changes
  useEffect(() => {
    setProjectName(defaultName);
  }, [defaultName]);

  const handleSave = () => {
    if (projectName.trim()) {
      onSave(projectName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && projectName.trim()) {
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <Dialog isOpen={isOpen}>
      <h2 className="text-2xl font-bold mb-4">Save Project</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Enter a name for your project. You'll be prompted to choose a save location next.
      </p>
      <div className="mb-6">
        <label htmlFor="project-name" className="block text-sm font-medium mb-2">
          Project Name
        </label>
        <input
          id="project-name"
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="My Awesome Project"
          autoFocus
          disabled={isPending}
        />
      </div>
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!projectName.trim() || isPending}
        >
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </Dialog>
  );
}
