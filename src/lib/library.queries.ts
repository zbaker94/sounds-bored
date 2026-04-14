import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { loadGlobalLibrary, saveGlobalLibrary } from "./library";
import { GlobalLibrary } from "./schemas";
import { QUERY_STALE_TIME, CURRENT_LIBRARY_VERSION } from "./constants";
import { useLibraryStore } from "@/state/libraryStore";

export function useGlobalLibrary() {
  return useQuery<GlobalLibrary, Error>({
    queryKey: ["globalLibrary"],
    queryFn: loadGlobalLibrary,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveGlobalLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (library: GlobalLibrary) => {
      await saveGlobalLibrary(library);
      return library;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["globalLibrary"] });
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
 *  - `saveCurrentLibrarySync()` — fire-and-forget (use where you cannot await)
 */
export function useSaveCurrentLibrary() {
  const { mutate, mutateAsync, isPending } = useSaveGlobalLibrary();

  const saveCurrentLibrary = useCallback(async () => {
    await mutateAsync(getCurrentLibraryPayload());
  }, [mutateAsync]);

  const saveCurrentLibrarySync = useCallback(() => {
    mutate(getCurrentLibraryPayload());
  }, [mutate]);

  return { saveCurrentLibrary, saveCurrentLibrarySync, isPending };
}
