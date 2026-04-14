import type React from "react";
import type { Sound } from "@/lib/schemas";
import { useResolveQueue } from "./useResolveQueue";

/** Manages the "resolve missing sound" dialog queue. See {@link useResolveQueue} for queue semantics. */
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
