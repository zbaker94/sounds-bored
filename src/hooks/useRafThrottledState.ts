import { useRef, useState, useCallback, useEffect } from "react";

/**
 * Coalesces multiple rapid updates into one React setState per animation frame.
 * Cancels any pending RAF on unmount automatically.
 *
 * @param initialValue - Captured on first render only (like useState). cancel() and
 *   reset() always refer to this first-render value, even if a new initialValue is
 *   passed on later renders.
 *
 * Returns { value, schedule, cancel, reset }:
 *   schedule(v) — stores v and schedules a RAF if none is pending; multiple calls
 *                 within the same frame use the latest value (late-binding ref read).
 *   cancel()    — cancels the pending RAF; does NOT reset state.
 *   reset()     — cancels the pending RAF and immediately sets state back to initialValue.
 */
export function useRafThrottledState<T>(initialValue: T): {
  value: T;
  schedule: (v: T) => void;
  cancel: () => void;
  reset: () => void;
} {
  const [value, setValue] = useState(initialValue);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<T>(initialValue);
  const initialRef = useRef(initialValue);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const schedule = useCallback((v: T) => {
    pendingRef.current = v;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        setValue(pendingRef.current);
        rafRef.current = null;
      });
    }
  }, []);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setValue(initialRef.current);
  }, [cancel]);

  return { value, schedule, cancel, reset };
}
