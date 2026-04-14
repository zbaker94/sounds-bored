import type React from "react";
import type { GlobalFolder } from "@/lib/schemas";
import { useResolveQueue } from "./useResolveQueue";

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
  const { queue, setQueue, handleResolved, handleClose } = useResolveQueue<GlobalFolder>();
  return {
    folderDialogQueue: queue,
    setFolderDialogQueue: setQueue,
    handleFolderDialogResolved: handleResolved,
    handleFolderDialogClose: handleClose,
  };
}
