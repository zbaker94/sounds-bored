import { useState, useRef, useCallback } from "react";
import type React from "react";
import type { GlobalFolder } from "@/lib/schemas";

/**
 * Manages the "resolve missing folder" dialog queue.
 *
 * Queue semantics:
 *  - queue[0] is the currently active item; an empty queue means the dialog is closed.
 *  - One-off clicks push a single-item queue.
 *  - "Review one by one" pushes every missing item at once.
 *  - On resolve+close: slice the head (continue chain).
 *  - On close without resolve: clear the queue (break chain).
 */
export function useResolveFolderQueue(): {
  folderDialogQueue: GlobalFolder[];
  setFolderDialogQueue: React.Dispatch<React.SetStateAction<GlobalFolder[]>>;
  handleFolderDialogResolved: () => void;
  handleFolderDialogClose: () => void;
} {
  const [folderDialogQueue, setFolderDialogQueue] = useState<GlobalFolder[]>(
    [],
  );
  const folderWasResolved = useRef(false);

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
    folderDialogQueue,
    setFolderDialogQueue,
    handleFolderDialogResolved,
    handleFolderDialogClose,
  };
}
