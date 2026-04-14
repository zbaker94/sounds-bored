import type React from "react";
import type { Sound } from "@/lib/schemas";
import { useResolveQueue } from "./useResolveQueue";

/**
 * Manages the "resolve missing sound" dialog queue.
 *
 * Queue semantics:
 *  - queue[0] is the currently active item; an empty queue means the dialog is closed.
 *  - One-off clicks push a single-item queue.
 *  - "Review one by one" pushes every missing item at once.
 *  - On resolve+close: slice the head (continue chain).
 *  - On close without resolve: clear the queue (break chain).
 */
export function useResolveSoundQueue(): {
  soundDialogQueue: Sound[];
  setSoundDialogQueue: React.Dispatch<React.SetStateAction<Sound[]>>;
  handleSoundDialogResolved: () => void;
  handleSoundDialogClose: () => void;
} {
  const { queue, setQueue, handleResolved, handleClose } = useResolveQueue<Sound>();
  return {
    soundDialogQueue: queue,
    setSoundDialogQueue: setQueue,
    handleSoundDialogResolved: handleResolved,
    handleSoundDialogClose: handleClose,
  };
}
