import type React from "react";
import type { GlobalFolder } from "@/lib/schemas";
import { useResolveQueue } from "./useResolveQueue";

/** Manages the "resolve missing folder" dialog queue. See {@link useResolveQueue} for queue semantics. */
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
