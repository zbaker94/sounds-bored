import { useState } from "react";
import { basename as tauriBasename } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { refreshMissingState } from "@/lib/library.reconcile";
import { evictBuffer } from "@/lib/audio/bufferCache";
import { evictStreamingElement } from "@/lib/audio/streamingCache";
import { pickFile } from "@/lib/scope";
import { AUDIO_FILE_FILTERS } from "@/lib/constants";
import { basename, nameFromFilename } from "@/lib/utils";
import type { Sound } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ResolveMissingDialogProps {
  sound: Sound | null;
  onClose: () => void;
  /** Called just before onClose when an action (locate/remove) completes successfully. */
  onResolved?: () => void;
}

type Step = "main" | "confirm-name" | "confirm-duplicate" | "confirm-remove";

export function ResolveMissingDialog({ sound, onClose, onResolved }: ResolveMissingDialogProps) {
  const [step, setStep] = useState<Step>("main");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [pendingBasename, setPendingBasename] = useState<string>("");
  const [duplicateSound, setDuplicateSound] = useState<Sound | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const sounds = useLibraryStore((s) => s.sounds);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const { saveCurrentLibrary } = useSaveCurrentLibrary();

  function handleClose() {
    setStep("main");
    setPendingPath(null);
    setDuplicateSound(null);
    setIsWorking(false);
    onClose();
  }

  async function handleLocate() {
    if (!sound) return;
    const selected = await pickFile({
      filters: AUDIO_FILE_FILTERS,
    });
    if (!selected) return;

    const newBasename = await tauriBasename(selected);
    const oldBasename = sound.filePath ? await tauriBasename(sound.filePath) : "";

    setPendingPath(selected);
    setPendingBasename(newBasename);

    // Check name mismatch first
    if (newBasename !== oldBasename) {
      setStep("confirm-name");
      return;
    }

    // Check duplicate path
    const dup = sounds.find((s) => s.id !== sound.id && s.filePath === selected);
    if (dup) {
      setDuplicateSound(dup);
      setStep("confirm-duplicate");
      return;
    }

    await applyLocate(selected, newBasename, null);
  }

  async function handleConfirmName() {
    if (!pendingPath || !sound) return;

    // Now check for duplicates
    const dup = sounds.find((s) => s.id !== sound.id && s.filePath === pendingPath);
    if (dup) {
      setDuplicateSound(dup);
      setStep("confirm-duplicate");
      return;
    }

    await applyLocate(pendingPath, pendingBasename, null);
  }

  async function handleConfirmDuplicate() {
    if (!pendingPath || !sound) return;
    await applyLocate(pendingPath, pendingBasename, duplicateSound);
  }

  async function applyLocate(selectedPath: string, newBasename: string, dup: Sound | null) {
    if (!sound) return;
    setIsWorking(true);
    try {
      const newName = nameFromFilename(newBasename);
      const nameDiffers = newName !== sound.name;

      updateLibrary((draft) => {
        if (dup) {
          draft.sounds = draft.sounds.filter((s) => s.id !== dup.id);
        }
        const target = draft.sounds.find((s) => s.id === sound.id);
        if (target) {
          target.filePath = selectedPath;
          if (nameDiffers) target.name = newName;
        }
      });

      evictBuffer(sound.id);
      evictStreamingElement(sound.id);

      await refreshMissingState();

      await saveCurrentLibrary();
      toast.success("Sound re-linked");
      onResolved?.();
      handleClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to re-link sound");
      setIsWorking(false);
    }
  }

  async function handleRemove() {
    if (!sound) return;
    setIsWorking(true);
    try {
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => s.id !== sound.id);
      });
      evictBuffer(sound.id);
      evictStreamingElement(sound.id);
      await saveCurrentLibrary();
      toast.success(`"${sound.name}" removed from library`);
      onResolved?.();
      handleClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove sound");
      setIsWorking(false);
    }
  }

  if (!sound) return null;

  const oldBasename = sound.filePath ? basename(sound.filePath, sound.name) : sound.name;

  return (
    <Dialog open={!!sound} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent>
        {step === "main" && (
          <>
            <DialogHeader>
              <DialogTitle>Missing File</DialogTitle>
              <DialogDescription>
                <strong>"{sound.name}"</strong> cannot be found at its stored location.
                {sound.filePath && (
                  <span className="block mt-1 text-xs font-mono break-all text-muted-foreground">
                    {sound.filePath}
                  </span>
                )}
                <span className="block mt-2 text-xs text-muted-foreground">
                  The replacement file can be located anywhere on your system.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="destructive" onClick={() => setStep("confirm-remove")} disabled={isWorking}>
                Remove from Library
              </Button>
              <Button onClick={handleLocate} disabled={isWorking}>
                Locate File…
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm-name" && (
          <>
            <DialogHeader>
              <DialogTitle>Different File Name</DialogTitle>
              <DialogDescription>
                The selected file is named <strong>"{pendingBasename}"</strong>, but the library entry
                is <strong>"{oldBasename}"</strong>. The library name will be updated to match.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("main")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleConfirmName} disabled={isWorking}>
                Proceed
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm-duplicate" && duplicateSound && (
          <>
            <DialogHeader>
              <DialogTitle>Duplicate File</DialogTitle>
              <DialogDescription>
                This file is already tracked as <strong>"{duplicateSound.name}"</strong>.
                Proceeding will remove that duplicate entry from the library.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("main")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleConfirmDuplicate} disabled={isWorking}>
                Proceed & Remove Duplicate
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm-remove" && (
          <>
            <DialogHeader>
              <DialogTitle>Remove Sound</DialogTitle>
              <DialogDescription>
                Remove <strong>"{sound.name}"</strong> from your library? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("main")} disabled={isWorking}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRemove} disabled={isWorking}>
                Remove
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
