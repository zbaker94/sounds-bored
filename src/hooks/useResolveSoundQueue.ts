import { useState, useRef, useCallback } from "react";
import type React from "react";
import type { Sound } from "@/lib/schemas";

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
  const [soundDialogQueue, setSoundDialogQueue] = useState<Sound[]>([]);
  const soundWasResolved = useRef(false);

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

  return {
    soundDialogQueue,
    setSoundDialogQueue,
    handleSoundDialogResolved,
    handleSoundDialogClose,
  };
}
