# Group: Missing Sound Resolution Duplication

## Relationship

Both findings are about duplicated logic in the missing-sound resolution flow. REUSE-4 finds that `SoundList.tsx` and `FoldersPanel.tsx` each manually re-implement the `checkMissingStatus` + `setMissingState` sequence that `refreshMissingState()` already encapsulates. REUSE-8 finds that `useResolveSoundQueue` and `useResolveFolderQueue` are thin wrappers that only rename fields on `useResolveQueue<T>`, adding no logic — suggesting the generic hook can be used directly. Together they indicate the missing-sound resolution feature accumulated parallel implementations instead of reusing shared abstractions at both the hook and the utility layer.

---

## Findings

---

**[REUSE-4] `checkMissingStatus + setMissingState` block reinvents `refreshMissingState`**
`src/components/composite/SidePanel/SoundList.tsx:171–185`
`src/components/composite/SidePanel/FoldersPanel.tsx:193–205`

Both files manually call `checkMissingStatus(folders, sounds)` then spread the four result Sets into `setMissingState(...)`. This logic is already encapsulated in `refreshMissingState()` in `src/lib/library.reconcile.ts:322–336`.

**Fix:** Replace both inline blocks with `await refreshMissingState(updatedFolders)`.

> **Audit note (2026-04-23):** REUSE-4 — valid pending verification of `refreshMissingState` signature at `library.reconcile.ts:322–336`. Confirm the function accepts `updatedFolders` in the same form the callers provide before swapping. REUSE-8 — valid pending review of the wrapper hooks; if they only alias field names, the generic hook can be used directly with renamed props passed at the call site.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| REUSE-8 | Reuse | `useResolveSoundQueue.ts`, `useResolveFolderQueue.ts` | Thin wrappers add no logic — only rename fields. Consider deleting and using `useResolveQueue<T>` directly |
