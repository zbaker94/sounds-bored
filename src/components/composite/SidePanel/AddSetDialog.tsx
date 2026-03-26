import { useState, useEffect } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface AddSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSetDialog({ open, onOpenChange }: AddSetDialogProps) {
  const [name, setName] = useState("");
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    useLibraryStore.getState().addSet(trimmed);
    const { sounds, tags, sets } = useLibraryStore.getState();
    await saveLibrary({ version: "1.0.0", sounds, tags, sets });
    onOpenChange(false);
  }

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Set"
      description="Create a new set to organize your sounds."
      content={
        <div className="flex flex-col gap-3 p-4">
          <Label htmlFor="set-name">Set Name</Label>
          <Input
            id="set-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Drums, Ambient, SFX"
            autoFocus
          />
        </div>
      }
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={name.trim() === ""} onClick={handleSave}>
            Save
          </Button>
        </div>
      }
    />
  );
}
