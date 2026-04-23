# Group: Duplicated Utility Patterns Across the Codebase

## Relationship

Both findings are cases where a small utility (path basename extraction, audio file filter construction) was written inline at each call site rather than exported from a shared module, resulting in 8+ and 3+ duplicates respectively. Both already have a natural home: `basename` belongs in `src/lib/utils.ts` (which already uses the same regex), and `AUDIO_FILE_FILTERS` belongs in `src/lib/constants.ts` (which already owns `AUDIO_EXTENSIONS`). Centralizing both reduces the risk of silent divergence when the pattern changes (e.g., adding a new audio extension, changing the fallback).

---

## Findings

---

**[REUSE-5] `basename` path extraction duplicated 8+ times across the codebase**
`src/components/composite/DownloadManager/DownloadItem.tsx:22–27`, `src/lib/export.ts:37–39`, `src/hooks/useAddFolder.ts:43`, `src/components/modals/SettingsDialog.tsx:97`, `src/components/modals/ResolveMissingDialog.tsx:163`, `src/components/modals/ResolveMissingFolderDialog.tsx:469`, `src/lib/library.reconcile.ts:114`, `src/lib/utils.ts:47`

The regex `.split(/[\\/]/).pop() ?? fallback` to extract a filename appears at 8+ call sites. `export.ts` has a private `extractBasename`; `DownloadItem.tsx` has its own `getDisplayName`. `utils.ts` already uses the same regex for `truncatePath`.

**Fix:** Export `basename(path: string, fallback?: string): string` from `src/lib/utils.ts` and replace all 8 call sites. Delete the private duplicates.

---

**[REUSE-6] Audio file-filter literal duplicated across three picker call sites**
`src/components/composite/SidePanel/SoundsPanel.tsx:65`
`src/components/modals/ResolveMissingDialog.tsx:63`
`src/components/modals/ResolveMissingFolderDialog.tsx:211`

All three construct `[{ name: "Audio", extensions: AUDIO_EXTENSIONS.map(e => e.replace(".", "")) }]` inline.

**Fix:** Export `export const AUDIO_FILE_FILTERS = [...]` from `src/lib/constants.ts`, or add `pickAudioFile`/`pickAudioFiles` convenience wrappers to `src/lib/scope.ts`.

> **Audit note (2026-04-23):** Both findings confirmed valid. `utils.ts:47` already uses the same split regex (confirmed by inspection of the `truncatePath` function). **REUSE-5 fix:** add `export function basename(path: string, fallback = ""): string` to `utils.ts`. **REUSE-6 fix:** add `export const AUDIO_FILE_FILTERS` to `constants.ts` (simpler than wrapper functions in `scope.ts` since callers use different picker options).
