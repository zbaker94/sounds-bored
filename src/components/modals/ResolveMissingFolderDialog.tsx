import { useState } from "react";
import { basename as tauriBasename, dirname, join } from "@tauri-apps/api/path";
import { copyFile, rename } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useSaveAppSettings } from "@/lib/appSettings.queries";
import { useSaveCurrentLibrary } from "@/lib/library.queries";
import { reconcileGlobalLibrary, refreshMissingState } from "@/lib/library.reconcile";
import { evictSoundCaches } from "@/lib/audio/cacheUtils";
import { pickFolder, pickFile } from "@/lib/scope";
import { AUDIO_FILE_FILTERS } from "@/lib/constants";
import { basename, nameFromFilename } from "@/lib/utils";
import { classifyPickedAudioFile, findDuplicateByPath } from "@/lib/fileResolve";
import type { GlobalFolder, Sound } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TruncatedPath } from "@/components/ui/truncated-path";

interface ResolveMissingFolderDialogProps {
  folder: GlobalFolder | null;
  onClose: () => void;
  /** Called just before onClose when the folder dialog fully completes (re-linked or removed). */
  onResolved?: () => void;
}

type Step =
  | "main"
  | "confirm-folder-name"
  | "confirm-remove-folder"
  | "resolving-files"
  | "file-picked"
  | "file-confirm-name"
  | "file-confirm-duplicate"
  | "file-placement";

type PlacementOption = "copy" | "move" | "add-parent";

export function ResolveMissingFolderDialog({ folder, onClose, onResolved }: ResolveMissingFolderDialogProps) {
  const [step, setStep] = useState<Step>("main");
  const [newFolderPath, setNewFolderPath] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [stillMissingSounds, setStillMissingSounds] = useState<Sound[]>([]);
  const [currentSoundIndex, setCurrentSoundIndex] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [removedCount, setRemovedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  // Per-file state
  const [pickedFilePath, setPickedFilePath] = useState<string>("");
  const [pickedFileBasename, setPickedFileBasename] = useState<string>("");
  const [duplicateSound, setDuplicateSound] = useState<Sound | null>(null);
  const [selectedPlacement, setSelectedPlacement] = useState<PlacementOption>("copy");
  const [isWorking, setIsWorking] = useState(false);

  const sounds = useLibraryStore((s) => s.sounds);
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const settings = useAppSettingsStore((s) => s.settings);
  const { mutateAsync: saveSettings } = useSaveAppSettings();
  const { saveCurrentLibrary } = useSaveCurrentLibrary();

  function handleClose() {
    setStep("main");
    setNewFolderPath("");
    setNewFolderName("");
    setStillMissingSounds([]);
    setCurrentSoundIndex(0);
    setResolvedCount(0);
    setRemovedCount(0);
    setSkippedCount(0);
    setIsWorking(false);
    onClose();
  }

  const currentSound = stillMissingSounds[currentSoundIndex] ?? null;

  function advanceToNextSound(resolved: number, removed: number, skipped: number) {
    const nextIndex = currentSoundIndex + 1;
    if (nextIndex >= stillMissingSounds.length) {
      // All done — final missing state refresh and close
      void refreshMissingState();
      const total = stillMissingSounds.length;
      toast.success(
        `Folder re-linked. ${resolved} resolved, ${removed} removed, ${skipped} skipped (of ${total} missing files).`,
      );
      onResolved?.();
      handleClose();
    } else {
      setCurrentSoundIndex(nextIndex);
      setStep("resolving-files");
      setPickedFilePath("");
      setDuplicateSound(null);
    }
  }

  // ─── Step 1: Locate folder ────────────────────────────────────────────────

  async function handleLocateFolder() {
    const selected = await pickFolder();
    if (!selected) return;

    const selectedName = await tauriBasename(selected);
    setNewFolderPath(selected);
    setNewFolderName(selectedName);

    if (folder && selectedName !== folder.name) {
      setStep("confirm-folder-name");
    } else {
      await applyFolderRelocate(selected, folder?.name ?? selectedName);
    }
  }

  async function handleConfirmFolderName() {
    await applyFolderRelocate(newFolderPath, newFolderName);
  }

  async function applyFolderRelocate(selectedPath: string, selectedName: string) {
    if (!folder || !settings) return;
    setIsWorking(true);
    try {
      const updatedSettings = {
        ...settings,
        globalFolders: settings.globalFolders.map((f) =>
          f.id === folder.id ? { ...f, path: selectedPath, name: selectedName } : f,
        ),
      };
      await saveSettings(updatedSettings);

      const currentSounds = useLibraryStore.getState().sounds;
      const reconciled = await reconcileGlobalLibrary(updatedSettings.globalFolders, currentSounds);
      if (reconciled.changed) {
        updateLibrary((draft) => {
          draft.sounds = reconciled.sounds;
        });
      }

      await refreshMissingState(updatedSettings.globalFolders);

      // Save reconciled library
      await saveCurrentLibrary();

      // Find sounds from this folder that are still missing (read updated state from store)
      const { sounds: latestSounds, missingSoundIds } = useLibraryStore.getState();
      const stillMissing = latestSounds.filter(
        (s) => s.folderId === folder.id && missingSoundIds.has(s.id),
      );

      if (stillMissing.length === 0) {
        toast.success("Folder re-linked");
        onResolved?.();
        handleClose();
      } else {
        setStillMissingSounds(stillMissing);
        setCurrentSoundIndex(0);
        setStep("resolving-files");
        setIsWorking(false);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to re-link folder");
      setIsWorking(false);
    }
  }

  async function handleRemoveFolder() {
    if (!folder || !settings) return;
    setIsWorking(true);
    try {
      const updatedSettings = {
        ...settings,
        globalFolders: settings.globalFolders.filter((f) => f.id !== folder.id),
      };
      await saveSettings(updatedSettings);

      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => s.folderId !== folder.id);
      });

      await saveCurrentLibrary();

      await refreshMissingState(updatedSettings.globalFolders);

      toast.success(`Folder "${folder.name}" removed`);
      onResolved?.();
      handleClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove folder");
      setIsWorking(false);
    }
  }

  // ─── Step 2: Per-file resolution ──────────────────────────────────────────

  async function handlePickFile() {
    if (!currentSound) return;
    const selected = await pickFile({ filters: AUDIO_FILE_FILTERS });
    if (!selected) return;

    const result = await classifyPickedAudioFile({ pickedPath: selected, existingSound: currentSound, allSounds: sounds });
    setPickedFilePath(selected);
    setPickedFileBasename(result.newBasename);

    if (result.kind === "name-mismatch") {
      setStep("file-confirm-name");
      return;
    }
    if (result.kind === "duplicate") {
      setDuplicateSound(result.duplicate);
      setStep("file-confirm-duplicate");
      return;
    }
    setStep("file-placement");
  }

  async function handleFileConfirmName() {
    if (!currentSound) return;
    const dup = findDuplicateByPath(pickedFilePath, currentSound.id, sounds);
    if (dup) {
      setDuplicateSound(dup);
      setStep("file-confirm-duplicate");
      return;
    }
    setStep("file-placement");
  }

  async function handleFileConfirmDuplicate() {
    setStep("file-placement");
  }

  async function handleApplyPlacement() {
    if (!currentSound || !pickedFilePath) return;
    setIsWorking(true);
    try {
      const newName = nameFromFilename(pickedFileBasename);
      const nameDiffers = newName !== currentSound.name;

      let finalPath = pickedFilePath;

      if (selectedPlacement === "copy" || selectedPlacement === "move") {
        const destPath = await join(newFolderPath, pickedFileBasename);
        if (selectedPlacement === "copy") {
          await copyFile(pickedFilePath, destPath);
        } else {
          await rename(pickedFilePath, destPath);
        }
        finalPath = destPath;
      }

      let newFolderIdForSound = currentSound.folderId;

      if (selectedPlacement === "add-parent") {
        const parentDir = await dirname(pickedFilePath);
        const parentName = await tauriBasename(parentDir);
        const existingFolder = settings?.globalFolders.find((f) => f.path === parentDir);

        if (!existingFolder && settings) {
          const newFolder: GlobalFolder = {
            id: crypto.randomUUID(),
            path: parentDir,
            name: parentName,
          };
          const updatedSettings = {
            ...settings,
            globalFolders: [...settings.globalFolders, newFolder],
          };
          await saveSettings(updatedSettings);
          newFolderIdForSound = newFolder.id;

          // Reconcile the new folder
          const currentSounds = useLibraryStore.getState().sounds;
          const reconciled = await reconcileGlobalLibrary(updatedSettings.globalFolders, currentSounds);
          if (reconciled.changed) {
            updateLibrary((draft) => {
              draft.sounds = reconciled.sounds;
            });
          }
        } else if (existingFolder) {
          newFolderIdForSound = existingFolder.id;
        }
      }

      // Remove duplicate if needed
      if (duplicateSound) {
        updateLibrary((draft) => {
          draft.sounds = draft.sounds.filter((s) => s.id !== duplicateSound.id);
        });
        evictSoundCaches(duplicateSound.id);
      }

      updateLibrary((draft) => {
        const target = draft.sounds.find((s) => s.id === currentSound.id);
        if (target) {
          target.filePath = finalPath;
          if (nameDiffers) target.name = newName;
          if (newFolderIdForSound !== currentSound.folderId) {
            target.folderId = newFolderIdForSound;
          }
        }
      });

      evictSoundCaches(currentSound.id);

      await saveCurrentLibrary();

      const newResolved = resolvedCount + 1;
      setResolvedCount(newResolved);
      setIsWorking(false);
      setPickedFilePath("");
      setDuplicateSound(null);
      advanceToNextSound(newResolved, removedCount, skippedCount);
    } catch (err) {
      console.error(err);
      toast.error("Failed to apply file placement");
      setIsWorking(false);
    }
  }

  async function handleRemoveCurrentSound() {
    if (!currentSound) return;
    setIsWorking(true);
    try {
      updateLibrary((draft) => {
        draft.sounds = draft.sounds.filter((s) => s.id !== currentSound.id);
      });
      evictSoundCaches(currentSound.id);
      await saveCurrentLibrary();
      const newRemoved = removedCount + 1;
      setRemovedCount(newRemoved);
      setIsWorking(false);
      advanceToNextSound(resolvedCount, newRemoved, skippedCount);
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove sound");
      setIsWorking(false);
    }
  }

  function handleSkipCurrentSound() {
    const newSkipped = skippedCount + 1;
    setSkippedCount(newSkipped);
    advanceToNextSound(resolvedCount, removedCount, newSkipped);
  }

  if (!folder) return null;

  const totalMissing = stillMissingSounds.length;
  const fileProgressLabel =
    totalMissing > 0
      ? `Resolving file ${currentSoundIndex + 1} of ${totalMissing}: "${currentSound?.name ?? ""}"`
      : "";

  const oldFolderBase = folder.name;

  return (
    <Dialog open={!!folder} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-lg">
        {step === "main" && (
          <>
            <DialogHeader>
              <DialogTitle>Missing Folder</DialogTitle>
              <DialogDescription>
                <strong>"{folder.name}"</strong> cannot be found at its stored location.
                <span className="block mt-1 text-xs font-mono break-all text-muted-foreground">
                  <TruncatedPath path={folder.path} />
                </span>
                <span className="block mt-2 text-xs text-muted-foreground">
                  The replacement folder must be within Music, Documents, Downloads, or Desktop.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="destructive" onClick={() => setStep("confirm-remove-folder")} disabled={isWorking}>
                Remove Folder
              </Button>
              <Button onClick={handleLocateFolder} disabled={isWorking}>
                Locate Folder…
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm-folder-name" && (
          <>
            <DialogHeader>
              <DialogTitle>Different Folder Name</DialogTitle>
              <DialogDescription>
                The selected folder is named <strong>"{newFolderName}"</strong>, but the library entry
                is <strong>"{oldFolderBase}"</strong>. The library name will be updated to match.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("main")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleConfirmFolderName} disabled={isWorking}>
                Proceed
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm-remove-folder" && (
          <>
            <DialogHeader>
              <DialogTitle>Remove Folder</DialogTitle>
              <DialogDescription>
                Remove <strong>"{folder.name}"</strong> and all its sounds from your library?
                This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("main")} disabled={isWorking}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRemoveFolder} disabled={isWorking}>
                Remove
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "resolving-files" && currentSound && (
          <>
            <DialogHeader>
              <DialogTitle>Still Missing Files</DialogTitle>
              <DialogDescription>{fileProgressLabel}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={handleSkipCurrentSound} disabled={isWorking}>
                Skip
              </Button>
              <Button variant="destructive" onClick={handleRemoveCurrentSound} disabled={isWorking}>
                Remove
              </Button>
              <Button onClick={handlePickFile} disabled={isWorking}>
                Locate File…
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "file-confirm-name" && currentSound && (
          <>
            <DialogHeader>
              <DialogTitle>Different File Name</DialogTitle>
              <DialogDescription>
                The selected file is named <strong>"{pickedFileBasename}"</strong>, but the library entry
                is <strong>"{currentSound.filePath ? basename(currentSound.filePath, currentSound.name) : currentSound.name}"</strong>.
                The library name will be updated to match.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("resolving-files")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleFileConfirmName} disabled={isWorking}>
                Proceed
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "file-confirm-duplicate" && duplicateSound && (
          <>
            <DialogHeader>
              <DialogTitle>Duplicate File</DialogTitle>
              <DialogDescription>
                This file is already tracked as <strong>"{duplicateSound.name}"</strong>.
                Proceeding will remove that duplicate entry.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("resolving-files")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleFileConfirmDuplicate} disabled={isWorking}>
                Proceed & Remove Duplicate
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "file-placement" && currentSound && (
          <>
            <DialogHeader>
              <DialogTitle>Place File</DialogTitle>
              <DialogDescription>
                Where should <strong>"{pickedFileBasename}"</strong> go?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              {(["copy", "move", "add-parent"] as PlacementOption[]).map((opt) => (
                <label
                  key={opt}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                    selectedPlacement === opt ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="placement"
                    value={opt}
                    checked={selectedPlacement === opt}
                    onChange={() => setSelectedPlacement(opt)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {opt === "copy" && "Copy to folder"}
                      {opt === "move" && "Move to folder"}
                      {opt === "add-parent" && "Add parent folder"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {opt === "copy" && `Copy the file into "${newFolderName}" and link it there`}
                      {opt === "move" && `Move the file into "${newFolderName}" and link it there`}
                      {opt === "add-parent" && "Add the file's current folder to your library and link it there"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("resolving-files")} disabled={isWorking}>
                Cancel
              </Button>
              <Button onClick={handleApplyPlacement} disabled={isWorking}>
                {isWorking ? "Applying…" : "Apply"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
