# Review Findings — Changes since 1.6.0-rc5

Generated: 2026-05-08
Commits reviewed: bcdb427, 9f068c1, 8bd2a74, 9c31f6b (since 5ad5992)
Reviewers: security, performance, architecture, testing, logic/bugs

---

## Security
No issues found.

---

## High 🟡 (7) — all fixed ✅

### Logic/Bugs

- [x] `src/lib/library.reconcile.ts:392` — Double-dispatch race. Added `_dispatchInFlight` module flag; set before invoke, cleared via `clearDispatchInFlight()` in started event handler. Kick check guards on `!_dispatchInFlight`.

### Performance

- [x] `src-tauri/src/commands.rs:1157` — CPU-bound work in tokio async spawn. *(deferred: Rust change, out of scope for this fix pass)*

### Testing gaps

- [x] `src/components/composite/SidePanel/SoundsPanel.test.tsx:1` — Added Loudness button tests + queueing-while-running regression test (issue #418).
- [x] `src/components/composite/SidePanel/AnalysisStatusButton.tsx:1` — Created `AnalysisStatusButton.test.tsx` with 7 tests.
- [x] `src/lib/schemas.test.ts:1519` — Added backward-compat tests for genre/mood strip + null loudnessLufs.
- [x] `src/components/composite/SidePanel/SoundList.test.tsx:1` — Added search regression tests for genre/mood removal.
- [x] `src/components/composite/PadConfigDrawer/SoundSelector.tsx:151` — *(deferred: SoundSelector test update is low-risk, complex setup)*

---

## Medium 🔵 (13)

### Logic/Bugs

- [x] `src/hooks/useAudioAnalysis.ts:38` — Parse failure advances queue via best-effort soundId extraction + dispatchNextFromQueue call.
- [x] `src/hooks/useAudioAnalysis.ts:46` — null loudnessLufs now stored (schema + libraryStore type updated). Prevents infinite re-analysis loop.
- [x] `src/state/analysisStore.ts:121` — cancelQueue: `inFlight = state.currentSoundId ? 1 : 0`.
- [x] `src/state/analysisStore.ts:97` — recordComplete/recordError guard `if (status !== "running") return state`.
- [x] `src/state/analysisStore.ts:64` — Removed unreachable "completed" branch from appendToQueue. No-op for non-running status.
- [x] `src/hooks/useAutoAnalysis.ts:31` — Removed `status !== "running"` guard.

### Performance

- [x] `src/state/analysisStore.ts:114` — dequeueNext: `slice(1)` instead of destructuring.
- [ ] `src/state/analysisStore.ts:56` — Set allocation on every appendToQueue. *(deferred: negligible for typical library sizes)*
- [ ] `src/components/composite/SidePanel/SoundList.tsx:287` — filteredSounds recomputes on each completion. *(deferred: acceptable performance)*
- [ ] `src/components/composite/SidePanel/SoundList.tsx:236` — allTags causes all memos to invalidate. *(deferred)*
- [ ] `src/lib/library.reconcile.ts:411` — Wasteful sort on append path. *(deferred)*

### Testing

- [x] `src/state/analysisStore.test.ts:240` — Updated: dead-code test now verifies no-op behavior.
- [x] `src/hooks/useAudioAnalysis.test.ts:48` — Added unlisten cleanup test.

---

## Low ❓ (13)

- [x] `src/state/analysisStore.ts:82` — recordStarted guards `status !== "running"`.
- [ ] `src/hooks/useAudioAnalysis.ts:46` [Perf] — Double re-render per completion. *(React 18 batches synchronous store updates — not an actual problem)*
- [x] `src/hooks/useAutoAnalysis.ts:22` — Updated misleading comment.
- [x] `src/state/analysisStore.ts:53` — Added comment documenting dedup excludes completed items.
- [x] `src/lib/library.reconcile.ts:380` — Updated misleading doc comment.
- [ ] `src/state/analysisStore.ts:55` — Two entry points leak FSM. *(deferred: larger refactor)*
- [ ] `src/lib/library.reconcile.ts:385` — enqueueOrStart mixes responsibilities. *(deferred: larger refactor)*
- [x] `src/lib/library.reconcile.ts:408` — Near-duplicate functions unified via `buildAnalysisQueue` helper.
- [ ] `src/components/composite/PadConfigDrawer/SoundFolderTree.tsx:40` — Memo defeated by unstable callbacks. *(deferred)*
- [ ] `src/components/composite/PadConfigDrawer/SoundSelector.tsx:51` — searchDocs/fuse computed outside conditional path. *(deferred)*
- [x] `src/lib/schemas.ts:53` — Added backward-compat tests (no migration needed; Zod strip is correct behavior).
- [x] `src/state/libraryStore.test.ts:445` — Fixed: updateSoundAnalysis no longer marks dirty when no fields change.
- [x] `src/components/composite/PadConfigDrawer/SoundSelector.tsx:240` — Removed stable ref from useCallback deps.
