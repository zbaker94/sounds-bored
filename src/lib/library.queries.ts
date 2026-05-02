import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { saveCurrentLibraryAndClearDirty } from "./library";
import { logError } from "@/lib/logger";

function useSaveGlobalLibrary() {
  return useMutation({
    mutationFn: async () => {
      await saveCurrentLibraryAndClearDirty();
    },
    onError: (error) => {
      logError("Failed to save library", error instanceof Error ? error : { error: String(error) });
    },
  });
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
