import { useRef } from "react";

// Canonical "latest ref" pattern: assign during render so callers always read
// the current value without creating closure over a specific render's binding.
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
