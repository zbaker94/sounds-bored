import { useState, useRef, useCallback } from "react";
import type React from "react";

/**
 * Generic queue state machine for "resolve one at a time" dialog flows.
 *
 * Queue semantics:
 *  - queue[0] is the currently active item; an empty queue means the dialog is closed.
 *  - One-off clicks push a single-item queue.
 *  - "Review one by one" pushes every missing item at once.
 *  - On resolve+close: slice the head (continue chain).
 *  - On close without resolve: clear the queue (break chain).
 *
 * Use the domain-specific wrappers `useResolveSoundQueue` and
 * `useResolveFolderQueue` rather than this hook directly.
 */
export function useResolveQueue<T>(): {
  queue: T[];
  setQueue: React.Dispatch<React.SetStateAction<T[]>>;
  handleResolved: () => void;
  handleClose: () => void;
} {
  const [queue, setQueue] = useState<T[]>([]);
  const wasResolved = useRef(false);

  const handleResolved = useCallback(() => {
    wasResolved.current = true;
  }, []);

  const handleClose = useCallback(() => {
    const resolved = wasResolved.current;
    wasResolved.current = false;
    if (resolved) {
      setQueue((q) => q.slice(1));
    } else {
      setQueue([]);
    }
  }, []);

  return { queue, setQueue, handleResolved, handleClose };
}
