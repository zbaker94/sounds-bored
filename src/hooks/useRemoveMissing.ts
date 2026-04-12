import { useState, useRef, useCallback } from "react";
import type React from "react";
import type { GlobalFolder, Sound } from "@/lib/schemas";

/**
 * Manages the "resolve missing" dialog queues for both sounds and folders.
 *
 * Queue semantics:
 *  - queue[0] is the currently active item; an empty queue means the dialog is closed.
 *  - One-off clicks push a single-item queue.
 *  - "Review one by one" pushes every missing item at once.
 *  - On resolve+close: slice the head (continue chain).
 *  - On close without resolve: clear the queue (break chain).
 */
export function useRemoveMissing(): {
  soundDialogQueue: Sound[];
  setSoundDialogQueue: React.Dispatch<React.SetStateAction<Sound[]>>;
  folderDialogQueue: GlobalFolder[];
  setFolderDialogQueue: React.Dispatch<React.SetStateAction<GlobalFolder[]>>;
  handleSoundDialogResolved: () => void;
  handleSoundDialogClose: () => void;
  handleFolderDialogResolved: () => void;
  handleFolderDialogClose: () => void;
} {
  const [soundDialogQueue, setSoundDialogQueue] = useState<Sound[]>([]);
  const [folderDialogQueue, setFolderDialogQueue] = useState<GlobalFolder[]>([]);
  const soundWasResolved = useRef(false);
  const folderWasResolved = useRef(false);

  const handleSoundDialogResolved = useCallback(() => {
    soundWasResolved.current = true;
  }, []);

  const handleSoundDialogClose = useCallback(() => {
    const resolved = soundWasResolved.current;
    soundWasResolved.current = false;
    if (resolved) {
      setSoundDialogQueue((q) => q.slice(1));
    } else {
      setSoundDialogQueue([]);
    }
  }, []);

  const handleFolderDialogResolved = useCallback(() => {
    folderWasResolved.current = true;
  }, []);

  const handleFolderDialogClose = useCallback(() => {
    const resolved = folderWasResolved.current;
    folderWasResolved.current = false;
    if (resolved) {
      setFolderDialogQueue((q) => q.slice(1));
    } else {
      setFolderDialogQueue([]);
    }
  }, []);

  return {
    soundDialogQueue,
    setSoundDialogQueue,
    folderDialogQueue,
    setFolderDialogQueue,
    handleSoundDialogResolved,
    handleSoundDialogClose,
    handleFolderDialogResolved,
    handleFolderDialogClose,
  };
}
