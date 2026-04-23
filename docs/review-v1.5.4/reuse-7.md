**[REUSE-7] Corrupt-JSON recovery block duplicated verbatim between `history.ts` and `library.ts`**
`src/lib/history.ts:29–54`, `src/lib/library.ts:32–82`

Both `loadProjectHistory` and `loadGlobalLibrary` implement the same try/rename-to-`.corrupt.json`/reset/toast/return-defaults recovery pattern, including the same comment about the single-backup-slot race. `atomicWriteJson` already lives in `fsUtils.ts` — the next natural layer is a shared recovery helper.

**Fix:** Add `backupCorruptFile(path)` to `fsUtils.ts`, or go further with `loadJsonWithRecovery<T>(path, parse, defaults, onCorruption)` that encapsulates the entire try/rename/reset/toast flow.

> **Audit note (2026-04-23):** Confirmed valid. `history.ts:30–57` and `library.ts:32–82` share the same recovery pattern (try/rename/atomicWriteJson/onCorruption/return-defaults). **Recommended fix: `backupCorruptFile(path)`** in `fsUtils.ts` — `loadJsonWithRecovery<T>` is more reusable long-term but the generic signature is harder to type correctly with Zod v4. Start with `backupCorruptFile`, then refactor both callers to use it, preserving the existing `onCorruption` callback pattern.
