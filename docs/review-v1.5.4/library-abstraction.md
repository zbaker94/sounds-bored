# Group: Library Abstraction Layer Violations

## Relationship

Both findings are violations of the same module boundary: the `.queries` layer should only contain React Query bindings, and all callers should go through the shared `useSaveCurrentLibrary` mutation. ARCH-2 puts a plain Zustand reader (`getCurrentLibraryPayload`) in the `.queries` module, blurring that boundary. ARCH-3 shows `useBootLoader` exploiting that misplaced helper to bypass the shared mutation, directly calling `saveGlobalLibrary` + `clearDirtyFlag()` instead — duplicating the dirty-flag contract that the mutation hook already owns. Fixing ARCH-2 (moving the helper to `libraryStore` or `library.ts`) is a prerequisite for cleanly fixing ARCH-3.

---

## Findings

---

**[ARCH-2] Store-reading helper placed in TanStack Query module breaks layer boundary**
`src/lib/library.queries.ts:35–38`

`getCurrentLibraryPayload()` is a plain Zustand-reader (no React Query involved) exported from the `.queries` module. `useBootLoader.ts` imports it while also calling `saveGlobalLibrary` directly (bypassing the mutation hook). This inverts the documented boundary — the `.queries` module should only contain React Query bindings. Other callers will reach into `library.queries.ts` for this helper and drag query-layer imports into boot/reconcile flows.

**Fix:** Move `getCurrentLibraryPayload` to `src/state/libraryStore.ts` or `src/lib/library.ts`.

---

**[ARCH-3] Boot flow bypasses the single save-library abstraction, duplicating the dirty-flag contract**
`src/hooks/useBootLoader.ts:112–118`

`useBootLoader` calls `saveGlobalLibrary(getCurrentLibraryPayload())` directly then manually calls `clearDirtyFlag()`. Every other caller uses `useSaveCurrentLibrary` whose `onSuccess` already clears the dirty flag. Two places now encode the "after a successful library save, clear the dirty flag" contract — a future change (e.g., adding a "last saved at" timestamp) must be applied to both or they'll silently diverge.

**Fix:** Run the boot-time save through the shared mutation hook, or extract a `saveCurrentLibraryAndClearDirty()` helper used by all callers.

> **Audit note (2026-04-23):** Both findings confirmed valid. `library.queries.ts:35–38` exports `getCurrentLibraryPayload` as a plain Zustand reader. `useBootLoader.ts:111–115` calls `saveGlobalLibrary(getCurrentLibraryPayload())` directly then `clearDirtyFlag()`. **Preferred fix:** move `getCurrentLibraryPayload` to `library.ts` (not `libraryStore.ts` — it also needs `CURRENT_LIBRARY_VERSION` from constants) and re-export from `library.queries.ts` for backward compat; extract `saveCurrentLibraryAndClearDirty()` in `library.ts`. Running the save through the React hook (`useSaveCurrentLibrary`) is not feasible in `useBootLoader` since hooks cannot be called from non-component async code.
