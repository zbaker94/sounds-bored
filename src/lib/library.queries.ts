import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { loadGlobalLibrary, saveGlobalLibrary } from "./library";
import { GlobalLibrary } from "./schemas";
import { CURRENT_LIBRARY_VERSION } from "./constants";
import { useLibraryStore } from "@/state/libraryStore";

export function useSaveGlobalLibrary() {
  return useMutation({
    mutationFn: async (library: GlobalLibrary) => {
      await saveGlobalLibrary(library);
      return library;
    },
    onSuccess: () => {
      // Zustand is the single source of truth for library data. Clearing the
      // dirty flag after a successful save is all that's needed — no query
      // invalidation or refetch, which previously created a window where stale
      // query data could overwrite in-flight Zustand mutations.
      useLibraryStore.getState().clearDirtyFlag();
    },
  });
}

/**
 * Builds a save payload from the current libraryStore state.
 * Use this instead of manually spreading `sounds`, `tags`, `sets` and hardcoding
 * `CURRENT_LIBRARY_VERSION` at every call site.
 */
export function getCurrentLibraryPayload(): GlobalLibrary {
  const { sounds, tags, sets } = useLibraryStore.getState();
  return { version: CURRENT_LIBRARY_VERSION, sounds, tags, sets };
}

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
    await mutateAsync(getCurrentLibraryPayload());
  }, [mutateAsync]);

  const saveCurrentLibrarySync = useCallback(
    (options?: Parameters<typeof mutate>[1]) => {
      mutate(getCurrentLibraryPayload(), options);
    },
    [mutate],
  );

  return { saveCurrentLibrary, saveCurrentLibrarySync, isPending };
}

// Re-export the underlying loader for callers that need a one-shot read
// without going through the query cache (e.g. migration tooling).
export { loadGlobalLibrary };
