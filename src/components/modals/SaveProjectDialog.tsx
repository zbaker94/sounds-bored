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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save Project</DialogTitle>
          <DialogDescription>
            Enter a name for your project. You'll be prompted to choose a save location next.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name">Project Name</Label>
          <Input
            id="project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={handleKeyDown}
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
