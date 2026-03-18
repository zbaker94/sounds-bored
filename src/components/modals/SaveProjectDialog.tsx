import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save Project</DialogTitle>
          <DialogDescription>
            Enter a name for your project. You'll be prompted to choose a save location next.
          </DialogDescription>
        </DialogHeader>
        <div>
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
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!projectName.trim() || isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
