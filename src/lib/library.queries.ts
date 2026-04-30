import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { getCurrentLibraryPayload, loadGlobalLibrary, saveCurrentLibraryAndClearDirty } from "./library";
import { logError } from "@/lib/logger";

export function useSaveGlobalLibrary() {
  return useMutation({
    // Delegate to the shared primitive so every caller — boot-time included —
    // goes through the same save + dirty-clear sequence. Adding pipeline logic
    // here (e.g. lastSavedAt tracking) automatically applies to all pathways.
    mutationFn: async () => {
      await saveCurrentLibraryAndClearDirty();
    },
    // NOTE: No toast at the mutation level — each call site decides how to
    // surface the failure (immediate toast for manual saves, debounced toast
    // for auto-save so a persistent failure doesn't spam the user every 30s).
    onError: (error) => {
      logError("Failed to save library", error instanceof Error ? error : { error: String(error) });
    },
  });
}

// Re-export the Zustand-reader helper for backward compatibility. It lives in
// `library.ts` now (pure state helpers belong with the data layer, not the
// React Query bindings); callers are encouraged to import from there directly.
export { getCurrentLibraryPayload };

/**
 * Convenience hook: wraps `useSaveGlobalLibrary` so callers don't need to
 * construct the full `GlobalLibrary` payload by hand. Provides:
 *  - `saveCurrentLibrary()` — async, awaitable
 *  - `saveCurrentLibrarySync(options?)` — fire-and-forget; accepts the same
 *    optional `MutateOptions` as TanStack's `mutate()` (e.g. `{ onSuccess }`)
 */
export function useSaveCurrentLibrary() {
  const { mutate, mutateAsync, isPending } = useSaveGlobalLibrary();

  const saveCurrentLibrary = useCallback(async () => {
    await mutateAsync();
  }, [mutateAsync]);

  const saveCurrentLibrarySync = useCallback(
    (options?: Parameters<typeof mutate>[1]) => {
      mutate(undefined, options);
    },
    [mutate],
  );

  return { saveCurrentLibrary, saveCurrentLibrarySync, isPending };
}

// Re-export the underlying loader for callers that need a one-shot read
// without going through the query cache (e.g. migration tooling).
export { loadGlobalLibrary };
