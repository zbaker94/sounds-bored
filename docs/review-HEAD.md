# Code Review: v1.5.4..HEAD

**Reviewed by:** Security · Performance · Architecture · Code Quality · Code Reuse  
**Files reviewed:** 183 source files changed across 108 commits  
**Date:** 2026-04-23

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 (6 fixed) |
| Medium | 14 (19 fixed) |
| Low | 27 (27 fixed) |
| **Total** | **63** |

**Confirmed FIXED in this diff:** SEC12–SEC18 (shell spawn/kill removed, static fs grants replaced with runtime grants, extensive Unicode/UNC path validation, yt-dlp sidecar isolation, TOCTOU on export extras, HashMap unbounded growth, asset protocol over-broad scope hardened to match fs-scope runtime grant model), several performance issues (audioTick batching, `_padBestStreamingAudio` caches, `_padToLayerIds` reverse index, SceneView preload guard, PadBackFace delayed unmount), and architecture issues (dual TanStack→Zustand state ownership, `padPlayer` decomposed from god component).

---

## Critical (0)

None.

---

## High (4)

### ~~[ARCH-1] Cross-store import introduces hidden coupling and non-atomic state transitions~~ ✅ FIXED
- **File**: `src/state/projectStore.ts:10–16`
- **Severity**: High
- **Finding**: `projectStore` imported and called `useUiStore.getState().setActiveSceneId(...)` from `loadProject`, `clearProject`, `addScene`, and `deleteScene`. This broke store independence: Immer's `set` published the project mutation, then a second Zustand `set` fired on `uiStore` — non-component subscribers (e.g. `useMultiFadeSideEffects` subscribe callbacks) could observe inconsistent intermediate state (new/cleared scenes with stale `activeSceneId`). The coupling also bypassed the ESLint ARCH3 rule via the `ignores` list, making it an invisible exception to the project's own architectural invariant.
- **Fix applied**: Moved `activeSceneId` from `uiStore` into `projectStore`. All four scene lifecycle actions now update `activeSceneId` atomically within the same Immer `set` call — there is no intermediate state window. `setActiveSceneId` is now an action on `projectStore` that self-validates against its own scene list (no external `sceneIds` argument needed). `SetActiveSceneIdFn` overloaded type removed from `uiStore`. `SceneTabBar`, `SceneView`, and `useGlobalHotkeys` updated to read from `projectStore`. `projectStore.ts` removed from the ESLint `ignores` list — it no longer imports any other store. All 2016 tests pass; TypeScript clean.

---

### ~~[ARCH1] Cross-store scene coupling creates observable intermediate state~~ ✅ FIXED
- **File**: `src/state/projectStore.ts:66-79, 103-108, 110-129, 142-162`
- **Severity**: High
- **Finding**: `projectStore` issues a second Zustand `set` to `uiStore` after every scene lifecycle action (`loadProject`, `addScene`, `deleteScene`). Between the two transactions, `activeSceneId` can point to a just-deleted scene or be null while scenes exist. The `setActiveSceneId(id, sceneIds?)` guard is type-optional, so callers in `SceneTabBar` and hotkeys skip invariant enforcement silently.
- **Fix applied**: Introduced `SetActiveSceneIdFn` overloaded type in `uiStore.ts` — `(id: null, sceneIds?: string[]) => void` and `(id: string, sceneIds: string[]) => void`. `sceneIds` is now required by the type system when `id` is non-null. Updated all callers: `SceneTabBar.tsx` wraps `onValueChange` to pass the scene id list; `useGlobalHotkeys.ts` derives and passes `sceneIds` at all three call sites. Moving `activeSceneId` into `projectStore` was considered and rejected — it's transient UI state, not serializable project data, and the existing coupling direction (project → ui, never reverse) is already the documented invariant.

---

### ~~[ARCH2] Audio engine writes directly to `playbackStore`, inverting the layered architecture~~ ✅ FIXED
- **File**: `src/lib/audio/audioState.ts`
- **Severity**: High
- **Fix applied**: Removed `clearPadVolumesEntry()` and its 3 call sites; removed the redundant `setAudioTick({ padVolumes: {} })` in `stopAllVoices()` (already handled by `stopAudioTick()` → `_clearAllTickFields()`). The finding's recommendation to route push-based fields (`playingPadIds`, `fadingPadIds`, etc.) through audioTick was evaluated and rejected — these are correctly written as push-based events; routing them through the RAF would add ~16ms UI latency with no correctness benefit. The module header now accurately documents the two-tier write model (push-based vs tick-managed) and the known `gainManager.updateLayerVolume` exception for inactive-layer drag gestures. audioTick naturally drops stale `padVolumes` entries on the next frame when a pad leaves `voiceMap`. 5 tests updated to verify the new invariant.

---

### ~~[QUAL2] `useAddFolder.handleAddFolder` has `try` with no `catch` — rejections become unhandled~~ ✅ FIXED
- **File**: `src/hooks/useAddFolder.ts`
- **Severity**: High
- **Fix applied**: Added `catch (err) { toast.error(\`Failed to add folder: ${err instanceof Error ? err.message : String(err)}\`); }` between the try block and the existing `finally`. Unhandled rejections from `pickFolder`, `saveSettings`, `reconcileGlobalLibrary`, and `saveCurrentLibrary` are now surfaced to the user. Two tests added covering the catch path (saveSettings rejection and saveCurrentLibrary rejection), each asserting toast.error is called with the error message and `isAddingFolder` resets to false.

---

### ~~[REUSE1] `nameFromFilename` implemented identically in three separate files~~ ✅ FIXED
- **File**: `src/lib/utils.ts`, `src/lib/library.reconcile.ts`, `src/components/modals/ResolveMissingDialog.tsx`, `src/components/modals/ResolveMissingFolderDialog.tsx`
- **Severity**: High
- **Fix applied**: Promoted `nameFromFilename` to an exported function in `src/lib/utils.ts`. Removed the local definition from all three files; each now imports from `@/lib/utils`. 6 tests added to `utils.test.ts` covering the happy path, edge cases (no extension, consecutive separators, uppercase input, leading-dot filenames).

---

## Medium (20)

### ~~[ARCH3] `projectStore → uiStore` coupling direction is unenforced convention~~ ✅ FIXED
- **File**: `src/state/projectStore.ts:14`
- **Severity**: Medium
- **Fix applied**: Bootstrapped ESLint (`eslint` + `@typescript-eslint/parser` devDependencies; `eslint.config.mjs` flat config). Added a `no-restricted-imports` rule covering all of `src/state/**/*.ts` (with domain stores and test files in `ignores`) — blocking imports from `*/projectStore`, `*/libraryStore`, and `*/playbackStore` with diagnostic messages pointing to the `projectStore.ts` header. The folder-level glob means new peripheral stores are automatically guarded without a config edit. Added `"lint": "eslint src/state/"` script and wired it into `.githooks/pre-commit` so the rule is enforced at every commit.

---

### ~~[ARCH4] `PadBackFace` is a 582-line god component subscribing to 6 stores~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadBackFace.tsx:1-582`
- **Severity**: Medium
- **Fix applied**: Extracted the three inline memo components (`BackFaceLayerRow`, `PadFadeControls`, `PadLayerSection`) into dedicated sibling files in `SceneView/`. `PadBackFace.tsx` reduced from 582 to ~195 lines; the root component retains 5 store subscriptions (down from the claimed 6 — `libraryStore` was always in `BackFaceLayerRow` only) which are all legitimate orchestration. The sibling-orchestrator split recommended by the review was evaluated and rejected: it would have required the orchestrator to re-subscribe to the same stores to pass `isPlaying`/`globalFadeDurationMs` as props, adding prop-drilling with no reduction in coupling. Zero functional changes; all 20 existing tests pass.

---

### ~~[ARCH5] Boot-time library save bypasses `useSaveCurrentLibrary` mutation hook~~ ✅ FIXED
- **File**: `src/hooks/useBootLoader.ts:119-124`; `src/lib/library.queries.ts:41-56`; `src/lib/library.ts:103-106`
- **Severity**: Medium
- **Fix applied**: `useBootLoader` now calls `useSaveCurrentLibrary().saveCurrentLibrarySync()` instead of the raw `saveCurrentLibraryAndClearDirty()`. `useSaveGlobalLibrary.mutationFn` delegates to `saveCurrentLibraryAndClearDirty` (the shared primitive); `onSuccess: clearDirtyFlag()` removed since it is now handled inside the primitive. Stale comment in `useReconcileLibrary.ts` referencing the removed `onSuccess` updated. `useReconcileLibrary` now passes an `onError` callback to `saveCurrentLibrarySync` so reconcile-path save failures surface a toast (previously silent). All save pathways now go through the same TanStack mutation.

---

### ~~[ARCH6] `ProjectActionsContext` bundles three unrelated concerns with no value memoization~~ ✅ FIXED
- **File**: `src/contexts/ProjectActionsContext.tsx:34-50, 329-333`
- **Severity**: Medium
- **Fix applied**: Wrapped all five un-memoized handlers (`handleSaveAs`, `handleCancelSave`, `handleNavigateSave`, `handleNavigateDiscard`, `handleNavigateCancel`) in `useCallback` with correct dep arrays. Memoized `saveDialog`, `navigateDialog`, `exportDialog` sub-objects and the top-level context value with `useMemo`. Used `.mutate`/`.mutateAsync` stable TanStack references as deps rather than the whole mutation object to prevent unnecessary cascade invalidation. Code review passed; one follow-up noted: `saveProjectAsMutation.mutateAsync` stability relies on a TanStack v5 implementation detail (not part of the public API) — should be replaced with a `.mutate`-dependent stable wrapper before the next TanStack Query upgrade.

---

### ~~[ARCH7] `gainManager.setLayerVolume` writes to `playbackStore` directly — second write path alongside `audioTick`~~ ✅ FIXED
- **File**: `src/lib/audio/gainManager.ts:57-70`; `src/state/playbackStore.ts:68-70`
- **Severity**: Medium
- **Fix applied**: Removed the `else` branch from `setLayerVolume` — it is now a no-op for inactive layers. `updateLayerVolume` action removed from `playbackStore` entirely. The UI already handled the inactive case correctly: during drag, `localLayerVol` (useState) drives the slider independently of `layerVolumes`; after commit, the `??` fallback to `getLayerNormalizedVolume(layer)` reads `layer.volume` from `projectStore`. The `pendingLayerVolumes` option was considered and rejected — it would add a third write-ownership zone with no benefit since the UI does not need the store for inactive-layer gesture feedback. `gainManager.ts` import of `playbackStore` removed. 3 tests updated; 1 test block removed from `playbackStore.test.ts`.

---

### ~~[PERF1] `useMultiFadeMode()` called for side-effects only causes full `SceneView` re-renders~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/SceneView.tsx:50`
- **Severity**: Medium
- **Finding**: `SceneView` calls `useMultiFadeMode()` but discards its return value. The hook subscribes to 9 store fields (`active`, `originPadId`, `selectedPads`, `reopenPadId`, five actions, plus `editMode` and `overlayStack` from `useUiStore`). Every pad toggled in multi-fade selection produces a new `selectedPads` Map, causing SceneView — the top-level grid container — to re-render and reconcile the entire pad grid.
- **Evidence**:
  ```ts
  // SceneView.tsx:50
  useMultiFadeMode();  // return value discarded
  // ...
  const multiFadeActive = useMultiFadeStore((s) => s.active);  // separate subscription
  ```
- **Recommendation**: Split `useMultiFadeMode` into a side-effect-only variant (uses `getState()` inside callbacks, no subscriptions) and a state-reading variant for components that actually need the state values.
- **Fix applied**: Extracted `useMultiFadeSideEffects` hook with zero React subscriptions. Hotkeys use `getState()` inside callbacks; auto-cancel on `editMode`/`overlayStack` uses a single `useUiStore.subscribe()` in a mount-only `useEffect`. `useMultiFadeMode` retains all state subscriptions for components that read its return value but no longer registers hotkeys or effects. SceneView no longer re-renders on `selectedPads`, `originPadId`, `reopenPadId`, or `overlayStack` changes. 1 new file, 24 tests (8 new + 16 retained), 5 tests removed from useMultiFadeMode.test.ts.

---

### ~~[QUAL1] `addPad + flip` logic duplicated between `SceneView.handleAddPad` and `mod+shift+n` hotkey~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/SceneView.tsx:141-162`; `src/hooks/useGlobalHotkeys.ts:148-160`
- **Severity**: Medium
- **Finding**: The hotkey version skips page navigation and the `setTimeout(…, 0)` flip-transition defer. Pressing `mod+shift+n` on page 1 with a full grid creates a pad on page 2 the user cannot see, and the back-face flip animation is skipped.
- **Evidence**:
  ```ts
  // SceneView.tsx — correct version
  const handleAddPad = useCallback(() => {
    const newId = crypto.randomUUID();
    addPad(activeSceneId, config, newId);
    // … page navigation …
    setTimeout(() => setEditingPadId(newId), 0);  // flip transition defer
  }, …);

  // useGlobalHotkeys.ts — missing page navigation + setTimeout
  useHotkeys("mod+shift+n", () => {
    addPad(activeSceneId, config, newId);
    setEditingPadId(newId);  // immediate — no page update, no defer
  });
  ```
- **Recommendation**: Extract a shared `addPadAndEdit(sceneId: string): string` helper in `src/lib/padDefaults.ts` or a `usePadActions` hook that both call sites use.
- **Fix applied**: Lifted `pageByScene: Record<string, number>` and `setScenePage(sceneId, page)` from `SceneView` local `useState` into `uiStore`. Moved `PADS_PER_PAGE` constant to `constants.ts`. Removed `shift+left` / `shift+right` `useHotkeys` registrations from `SceneView` — they now live in `useGlobalHotkeys` alongside all other hotkeys, using `useUiStore.getState()` to read and write page state. Fixed `mod+shift+n`: after `addPad`, re-reads post-mutation store state to compute the new pad's page, calls `setScenePage`, and wraps `setEditingPadId` in `setTimeout(..., 0)` so the pad mounts at `rotateY(0deg)` before flipping. Added `{ preventDefault: true }` to `mod+shift+n` and `safePage` clamping to `shift+left`. 6 tests added to `uiStore.test.ts`; 8 tests added to `useGlobalHotkeys.test.ts`.

---

### ~~[QUAL3] `DownloadDialog.handleSubmit` awaits `startDownload` with no error handling~~ ✅ FIXED
- **File**: `src/components/modals/DownloadDialog.tsx:104-125`
- **Severity**: Medium
- **Finding**: A rejected `startDownload` bubbles out of the form submit handler as an unhandled rejection. Form fields are not cleared and the dialog remains open in an indeterminate state.
- **Recommendation**: Wrap in `try/catch`, or switch from `mutateAsync` to `mutate` (fire-and-forget) since `useStartDownload.onError` already shows a toast.
- **Fix applied**: Wrapped `await startDownload(...)` in `try/catch`; `catch` block returns early since `useStartDownload.onError` already shows a toast and marks the job as failed. On success, fields are cleared and the dialog closes as before. 1 test added covering the rejection path (dialog stays open, fields preserved, `onOpenChange` not called).

---

### ~~[QUAL4] Empty `catch {}` blocks drop all diagnostic context in multiple handlers~~ ✅ FIXED
- **File**: `src/hooks/useBulkRemove.ts:70-72,129-131`; `src/components/composite/SidePanel/FoldersPanel.tsx:151,198`; `src/components/modals/SettingsDialog.tsx:111`
- **Severity**: Medium
- **Fix applied**: All 5 bare `catch {}` blocks now capture the error as `err`, call `console.error("[context]", err)` for the developer diagnostic trail, and pass `{ description: err instanceof Error ? err.message : undefined }` to `toast.error` so users see the error detail when available. 2 existing error-path tests in `useBulkRemove.test.ts` updated to assert the new toast signature. 2 new tests added to `FolderBrowser.test.tsx` covering the `handleOpenFolderInExplorer` and `handleDeleteFolderFromDisk` rejection paths. 1 new test added to `SettingsDialog.test.tsx` covering the `handleOpenInExplorer` rejection path.

---

### ~~[QUAL7] `multiFadeStore` mixes 0–1 and 0–100 unit scales across adjacent APIs~~ ✅ FIXED
- **File**: `src/state/multiFadeStore.ts:35-67`; `src/hooks/useMultiFadeMode.ts:85-101`
- **Severity**: Medium
- **Fix applied**: Root cause traced to `PadSchema.volume` and `PadSchema.fadeTargetVol` being stored as 0–1 while all other volume fields (`Layer.volume`, `SoundInstance.volume`) used 0–100. Fixed at the schema level: both pad fields changed to `z.number().min(0).max(100)`. Migration `1.3.0 → 1.4.0` rescales existing persisted values by ×100. `padPlayer.ts` now divides by 100 at the 7 read sites where pad volume becomes a Web Audio gain value. `multiFadeStore.enterMultiFade`/`toggleMultiFadePad` params renamed to `volumePct`/`fadeTargetPct` and the internal `Math.round(x * 100)` removed — values are stored directly. All callers updated; `PadFadeControls`, `PadButton`, `PadButtonFadeOverlay`, `PadBackFace`, `useMultiFadeMode`, `useGlobalHotkeys`, `LayerConfigDialog`, and `padDefaults` adjusted to match. 1932/1932 tests pass; TypeScript clean.

---

### ~~[QUAL11] `usePadGesture` swallows `triggerPad` failures; `PadBackFace` toasts — inconsistent UX~~ ✅ FIXED
- **File**: `src/hooks/usePadGesture.ts:130,166,178,227,231`; `src/components/composite/SceneView/PadBackFace.tsx:445`
- **Severity**: Medium
- **Fix applied**: All `triggerPad` and `triggerLayer` call sites now route outer rejections through `emitAudioError` instead of logging silently or calling `toast.error` directly. Specifically:
  - `usePadGesture.ts` — 5× `.catch(console.error)` replaced with `.catch((err: unknown) => { emitAudioError(err); })` (front-face taps now surface errors to the user)
  - `PadBackFace.tsx` — direct `toast.error(...)` replaced with `emitAudioError(err)`; `import { toast }` removed
  - `BackFaceLayerRow.tsx` — same direct-toast anti-pattern on `triggerLayer` fixed; `import { toast }` removed
  - `useAudioErrorHandler.ts` — generic no-`soundName` fallback message changed from `"Playback error: audio fade failed — ${message}"` to `"Playback error: ${message}"` (old wording was misleading for direct trigger errors)
  - `useAudioErrorHandler.test.ts` — expectation updated to match new message
  1935/1935 tests pass; TypeScript clean.

---

### ~~[REUSE2] Web Audio gain ramp pattern open-coded 5 times across 3 files~~ ✅ FIXED
- **File**: `src/lib/audio/gainManager.ts:17-19,47-49,63-65`; `src/lib/audio/padPlayer.ts:430-432`; `src/lib/audio/fadeMixer.ts:98-100`
- **Severity**: Medium
- **Finding**: `cancelScheduledValues → setValueAtTime(gain.value) → linearRampToValueAtTime` is copy-pasted with only the AudioParam and ramp constant differing. Volume clamping (`Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0`) is also repeated at 3 sites in `gainManager.ts`.
- **Recommendation**: Extract `rampGainTo(param: AudioParam, target: number, rampS = CLICK_FREE_RAMP_S)` in `gainManager.ts`. All ramp sites become one-liners.
- **Fix applied**: Extracted `rampGainTo(param: AudioParam, target: number, rampS = CLICK_FREE_RAMP_S, from: number = param.value)` in `gainManager.ts`. The optional `from` parameter (defaulting to the live `param.value` at call time) accommodates `fadePad`'s explicit pre-computed `fromVolume`. Private `clampGain` helper extracted for the repeated clamping expression. `setPadVolume`, `syncLayerVolume`, and `setLayerVolume` each reduce to a single `rampGainTo(gain.gain, clampGain(volume))` call. `padPlayer.ts` stop-all ramp and `fadeMixer.ts` `fadePad` converted to `rampGainTo` calls. 3 tests added to `gainManager.test.ts` for `rampGainTo`; `fadeMixer.test.ts` mock updated to include `rampGainTo`. 185 tests pass; TypeScript clean.

---

### ~~[REUSE4] `evictBuffer(id) + evictStreamingElement(id)` pair repeated at 7 call sites~~ ✅ FIXED
- **File**: `src/hooks/useBulkRemove.ts:59-60,113-114`; `src/components/composite/SidePanel/SoundList.tsx:163-164`; `src/components/composite/SidePanel/FoldersPanel.tsx:179-180`; `src/components/modals/ResolveMissingDialog.tsx:128-129,151-152`; `src/components/modals/ResolveMissingFolderDialog.tsx:310-311,325-326,350-351`
- **Severity**: Medium
- **Finding**: The pairing is invariant — any future call site that omits one will leak audio caches into subsequent sessions.
- **Recommendation**: Add `evictSoundCaches(soundId: string)` that calls both, and `evictSoundCachesMany(ids: Iterable<string>)` for bulk use. Any future cache entry (e.g. waveform metadata) then only requires one change.
- **Fix applied**: Created `src/lib/audio/cacheUtils.ts` with `evictSoundCaches(soundId)` and `evictSoundCachesMany(ids: Iterable<string>)`. All 9 call sites across 6 files migrated — loop sites use `evictSoundCachesMany`, single-id sites use `evictSoundCaches`. Test mocks in all 5 affected test files updated to mock `@/lib/audio/cacheUtils` instead of the two individual cache modules. 1938/1938 tests pass; TypeScript clean.

---

### ~~[REUSE5] `PadPercentSlider` and `PadDurationSlider` are the same component with different formatting~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadPercentSlider.tsx`; `src/components/composite/SceneView/PadDurationSlider.tsx`
- **Severity**: Medium
- **Finding**: Lines 18–36 of both components are structurally identical — only the unit format string, min/max/step differ. `PadButtonFadeOverlay.tsx` also inlines the same slider/label pattern three more times without using either component.
- **Fix applied**: Created `PadLabeledSlider` with `{ min, max, step, formatValue: (v: number) => string }` props. Both `PadPercentSlider` and `PadDurationSlider` deleted; `PadFadeControls` updated to use `PadLabeledSlider` at both call sites. `PadButtonFadeOverlay` intentionally left inline — its slider/label pattern is structurally different (labels below slider, `text-[9px] text-white/70`, white-tinted track classes, `onPointerUp` vs `onValueCommit`) and folding it in would require layout/style props that add more complexity than the three inline blocks.

---

### ~~[REUSE6] `SoundSelector` rebuilds the `LibraryItemPicker` tag-combobox pattern from scratch~~ ✅ FIXED
- **File**: `src/components/composite/PadConfigDrawer/SoundSelector.tsx:302-334`; `src/components/composite/LibraryPickers/LibraryItemPicker.tsx:54-87`
- **Severity**: Medium
- **Fix applied**: Added optional `renderItemSuffix?: (item: { id: string; name: string }) => ReactNode` to `LibraryItemPicker`; passed through in `TagPicker`. `TagModeSection`'s 30-line inline combobox replaced with `<TagPicker renderItemSuffix={…} />` — suffix renders the per-tag sound count badge. The caller-managed `tagAnchorRef` / `useComboboxAnchor()` hook call removed from `SoundSelector` since `LibraryItemPicker` manages its own anchor internally. Set mode intentionally left as-is: it uses `ComboboxInput` (single-select, full Set object value) vs `LibraryItemPicker`'s `ComboboxChips` (multi-select, string[] IDs) — a "single-select variant" would be a new component with no other call sites, adding net code. 2 tests added to `LibraryItemPicker.test.tsx` and `TagPicker.test.tsx`; 3 `SoundSelector.test.tsx` placeholder matches updated.

---

### ~~[REUSE7] `AddTagsDialog` reimplements `LibraryItemPicker`'s create-flow inline~~ ✅ FIXED
- **File**: `src/components/composite/SidePanel/AddTagsDialog.tsx:102-123,184-267`; `src/components/composite/LibraryPickers/LibraryItemPicker.tsx:34-52`
- **Severity**: Medium
- **Fix applied**: Added `renderExtraChips?: () => ReactNode` to `LibraryItemPicker` (rendered between full-value chips and the input) and threaded it through `TagPicker`. `AddTagsDialog` now routes through `TagPicker` — `canCreate`/`__create__`/`inputValue` state and the entire Combobox JSX scaffold removed (73 lines). Partial chips are passed via `renderExtraChips`; MinusSignIcon per-item badge uses the existing `renderItemSuffix` slot. All existing behavior preserved; 2 new tests added. 1942/1942 tests pass; TypeScript clean.

---

### ~~[REUSE8] `ResolveMissingDialog.handleLocate` duplicates `ResolveMissingFolderDialog.handlePickFile`~~ ✅ FIXED
- **File**: `src/components/modals/ResolveMissingDialog.tsx:61-108`; `src/components/modals/ResolveMissingFolderDialog.tsx:212-251`
- **Severity**: Medium
- **Fix applied**: Created `src/lib/fileResolve.ts` with `classifyPickedAudioFile({ pickedPath, existingSound, allSounds }): Promise<AudioFileClassification>` (async — handles tauriBasename calls and the name-mismatch → duplicate → ok decision tree) and `findDuplicateByPath(pickedPath, excludeId, allSounds): Sound | undefined` (synchronous — used in both confirm-name handlers). `AudioFileClassification` is a discriminated union so `duplicate` is typed as `Sound` (not `Sound | undefined`) in the `kind="duplicate"` branch, eliminating non-null assertions at both call sites. `handlePickFile` in `ResolveMissingFolderDialog` gained a `!currentSound` early-return guard that was absent in the original. 8 tests added to `src/lib/fileResolve.test.ts`; 1950/1950 tests pass; TypeScript clean.

---

### ~~[REUSE9] `addFolder + reconcile + save` orchestration duplicated in hook and modal~~ ✅ FIXED
- **File**: `src/hooks/useAddFolder.ts:44-66`; `src/components/modals/ResolveMissingFolderDialog.tsx:280-299`
- **Severity**: Medium
- **Finding**: The `GlobalFolder` create → `saveSettings` → `reconcileGlobalLibrary` → `updateLibrary` sequence is copy-pasted. The only difference is `useAddFolder` also runs the `pickFolder` UI step.
- **Evidence**:
  ```ts
  // useAddFolder.ts:44-66 and ResolveMissingFolderDialog.tsx:280-299 — identical sequence:
  const newFolder: GlobalFolder = { id: crypto.randomUUID(), path: selected, name };
  const updatedSettings = { ...settings, globalFolders: [...settings.globalFolders, newFolder] };
  await saveSettings(updatedSettings);
  const result = await reconcileGlobalLibrary(updatedSettings.globalFolders, sounds);
  if (result.changed) { updateLibrary((draft) => { draft.sounds = result.sounds; }); }
  ```
- **Recommendation**: Extract `addGlobalFolderAndReconcile(folder: GlobalFolder, { settings, sounds, saveSettings, updateLibrary }): Promise<void>` as a shared module helper.
- **Fix applied**: Extracted `addGlobalFolderAndReconcile(newFolder, settings, sounds, saveSettings, setSounds)` to `src/lib/library.reconcile.ts`. Signature uses `setSounds: (newSounds: Sound[]) => void` to avoid importing the unexported `LibraryData` type across module boundaries. Returns `{ updatedSettings, changed }` so callers decide when to call `saveCurrentLibrary`. 4 unit tests added. Both callers migrated.

---

### ~~[REUSE10] `playbackStore` has 4 copy-pasted `add<X>/remove<X>` action pairs~~ ✅ FIXED
- **File**: `src/state/playbackStore.ts:125-189`
- **Severity**: Medium
- **Fix applied**: Extracted `addToSet(field: SetField)` and `removeFromSet(field: SetField)` helper closures inside the `create` callback. Each captures `set` via closure and produces the action function for the given field. The early-exit reference-equality optimization (`if (s[field].has(padId)) return s`) is preserved — Zustand suppresses re-renders only when the returned reference is unchanged. Immer was evaluated and rejected: its Set proxy marks the draft as modified even for no-op `.add()`/`.delete()` calls, which would produce spurious new `Set<string>` references and unnecessary subscriber re-renders. A `SetField` union type (with a comment to extend it when adding new `Set<string>` fields) serves as the single maintenance point. 16 tests added to `playbackStore.test.ts`: 4 per new action group (add, idempotency, remove, no-op-on-absent-id) plus 4 cross-field isolation tests verifying that mutating one Set field does not affect the others. 1970/1970 tests pass; TypeScript clean.

---

## Low (47)

### Security (12)

#### ~~[SEC1] `$AUDIO/**` remains a static fs-scope grant~~ ✅ FIXED
- **File**: `src-tauri/capabilities/default.json:42`
- **Severity**: Low
- **Finding**: The large static grants (`$DOCUMENT/**`, `$DOWNLOAD/**`, `$DESKTOP/**`) were correctly replaced with runtime `grant_path_access` calls this cycle, but `$AUDIO/**` remains. A renderer XSS would have full read/write over the user's entire music library without any further IPC call.
- **Recommendation**: Move behind the runtime grant model — scan `$AUDIO` only if the user opts in, then grant via `grant_path_access`. Otherwise document explicitly that renderer compromise implies music library access.
- **Fix applied**: Removed `{ "path": "$AUDIO/**" }` from the `fs:scope` allow block. The `opener:allow-open-path` entry is intentionally retained — the opener plugin has no runtime scope expansion mechanism, and it only permits OS-default-app launches (not arbitrary file reads/writes). Runtime fs access to user-chosen folders in `~/Music` is already covered by `grant_path_access` calls in `pickFolder`/`useBootLoader`.

#### ~~[SEC18] `assetProtocol.scope` grants renderer read access to entire user home directory~~ ✅ FIXED
- **File**: `src-tauri/tauri.conf.json:43-56`
- **Severity**: High
- **Finding**: `assetProtocol.scope` contained `$HOME/**` (plus `$MUSIC/**`, `$DOCUMENT/**`, `$DOWNLOAD/**`, `$DESKTOP/**`). The audio engine reads sound files via `convertFileSrc(path)` + `fetch(url)` through the `asset:` protocol (see `bufferCache.ts:16-22`, `preview.ts:34`, `streamingCache.ts:67/96/163`). This means a renderer XSS can `fetch('asset://localhost/' + anyPath)` to read any file under the user's home directory — including `~/.ssh/`, browser profiles, and shell history — and exfiltrate the bytes. This is a broader version of what the `fs:scope` cleanup was intended to address: the asset protocol provides an equivalent (and wider) read primitive that was left untouched.
- **Fix applied**: Removed `$HOME/**`, `$MUSIC/**`, `$DOCUMENT/**`, `$DOWNLOAD/**`, and `$DESKTOP/**` from `tauri.conf.json`'s `assetProtocol.scope`; retained `$RESOURCE/**`, `$APP/**/*`, `$APPDATA/**`, `$APPLOCALDATA/**`. Extended `grant_path_access` in `commands.rs` to call `app.asset_protocol_scope().allow_directory(&path, true)` alongside the existing `app.fs_scope()` call (`tauri::Manager` imported for trait access). The boot-time `grantPathAccess` replay in `useBootLoader.ts:42-44` now covers both scopes simultaneously on every app start.

#### [SEC2] `grant_path_access` IPC is reachable from any renderer script ✅ Fixed
- **File**: `src-tauri/src/commands.rs:821-828`
- **Severity**: Low
- **Finding**: `validate_grant_path` enforces many constraints but does not tie the path to a recent user-initiated native dialog selection. A malicious script inside the renderer can call this command to grant itself fs scope over any legitimate-looking absolute path (e.g., `C:/Users/victim/Documents`) and then read/write via the standard fs plugin.
- **Fix applied**: Removed `grant_path_access` from the IPC invoke handler entirely. Replaced with three atomic Rust commands (`pick_folder_and_grant`, `pick_file_and_grant`, `pick_files_and_grant`) that run the native OS dialog inside Rust and grant scope before returning the path — a renderer script can no longer supply an arbitrary path to the grant path. For session-restore cases (replaying persisted folder grants on app startup), a narrower `restore_path_scope` command is exposed that still runs `validate_grant_path`. The drag-and-drop path uses `grantDroppedPaths` → `restore_path_scope`, which relies on OS-event path provenance and server-side `validate_grant_path` enforcement. All 1885 TypeScript tests and 62 Rust tests pass.

#### ~~[SEC3] `start_download` accepts relative `download_folder_path`~~ ✅ FIXED
- **File**: `src-tauri/src/commands.rs:237-251`
- **Severity**: Low
- **Finding**: `validate_no_traversal` rejects `..` and `%` but does not require an absolute path. A tampered `appSettings.json` or compromised renderer could redirect yt-dlp output to the Tauri process CWD.
- **Recommendation**: Add `if !std::path::Path::new(&download_folder_path).is_absolute() { return Err("download_folder_path must be absolute") }`. Apply the same to `export_project`.
- **Fix applied**: Replaced the bare `validate_no_traversal` call in `start_download` with `validate_grant_path` (labeled), which enforces absolute path, traversal-free, no UNC device-namespace/share-root, and no control characters. All 62 Rust tests pass.

#### ~~[SEC4] `export_project` paths not constrained to absolute~~ ✅ FIXED
- **File**: `src-tauri/src/commands.rs:455-496,515`
- **Severity**: Low
- **Finding**: `dest_path`, `source_path`, and `extra_sound_paths` are validated for traversal but not required to be absolute. A locally-tampered `library.json` with a relative `filePath` (e.g., `secret/confidential.mp3` — passes `SoundSchema`'s `..` refine) would be resolved against the Tauri process CWD during `File::open`.
- **Recommendation**: Require all three inputs to be absolute paths in the Rust command handler.
- **Fix applied**: Replaced `validate_no_traversal` calls in `export_project` with `validate_grant_path` (labeled) for `dest_path`, `source_path`, and each `extra_sound_paths` entry. All three inputs now reject relative paths, UNC device-namespace paths, UNC share roots, and control characters. All 62 Rust tests pass.

#### ~~[SEC5] `job_id` accepted without validation~~ ✅ FIXED
- **File**: `src-tauri/src/commands.rs:215-223`
- **Severity**: Low
- **Fix applied**: Added `validate_job_id(job_id: &str) -> Result<(), String>` helper that rejects empty strings, strings longer than 64 characters, and any character outside `[A-Za-z0-9_-]`. Called as the first statement in all four affected commands: `start_download`, `cancel_download`, `export_project`, and `cancel_export`. Additionally added duplicate-ID guards in `start_download` (before sidecar spawn and the initial `queued` event emission) and `export_project` (before async task spawn and HashMap insert) — `HashMap::insert` silently overwrites existing entries, which would orphan the first job's cancel handle and break cancellation. 10 unit tests added covering empty, too-long, invalid-charset (control chars, spaces, Unicode, special chars), UUID format, and slug format inputs.

#### ~~[SEC6] `stderr.contains("ERROR")` allows hostile video metadata to inject misleading events~~ ✅ FIXED
- **File**: `src-tauri/src/commands.rs:326-334`
- **Severity**: Low
- **Finding**: yt-dlp may print server-reported error text verbatim. A hostile video description containing "ERROR" emits a `failed` progress event mid-stream, producing both `failed` and `completed` events for the same job.
- **Recommendation**: Only treat lines beginning with `ERROR:` (yt-dlp's standard prefix) as errors. Truncate to a safe length (256 chars). Do not emit `failed` until the process actually terminates with non-zero exit code.
- **Fix applied**: Extracted `parse_stderr_error(line: &str) -> Option<String>` helper that only matches lines whose first non-whitespace token is `"ERROR:"`, returning the message capped at 256 bytes. The `Stderr` event branch now captures errors silently (no mid-stream emission); the `Terminated` branch uses the captured message (if any) as the error detail for non-zero exits, falling back to the exit code. Eliminates the `failed`→`completed` double-event sequence. 6 unit tests added.

#### ~~[SEC7] Symlink TOCTOU gap in main `WalkDir` loop of `export_project`~~ ✅ FIXED
- **File**: `src-tauri/src/commands.rs:544-598`
- **Severity**: Low
- **Finding**: `entry.file_type().is_symlink()` uses WalkDir's cached metadata from `readdir`; the subsequent `File::open(path)` follows symlinks. Between the two calls, an attacker with write access to the project folder could replace a regular file with a symlink to an out-of-scope file. The `extra_sound_paths` branch correctly uses pre-opened file handles to close this window; the main walk does not.
- **Fix applied**: Added `std::fs::symlink_metadata(path)?` + `is_file()` re-check immediately before `writer.start_file` (not after). Placing the check before `start_file` is critical — a `continue` after `start_file` would leave a zero-byte ghost entry in the zip archive. The early-exit `ft.is_symlink()` check on WalkDir's cached metadata is preserved as a fast path. Cross-platform; no new dependencies.

#### ~~[SEC8] `SoundSchema.filePath` and `GlobalFolderSchema.path` accept relative paths~~ ✅ FIXED
- **File**: `src/lib/schemas.ts:32-38,216-225`
- **Severity**: Low
- **Finding**: Both schemas block `..` traversal but accept relative paths like `sounds/kick.wav`. Combined with SEC4, a locally-tampered `library.json` can feed relative paths to `export_project`.
- **Fix applied**: Extracted `isAbsolutePath` module-level helper (Unix `/`, Windows drive `C:\`/`C:/`, Windows UNC `\\`) in `schemas.ts`. Added `.refine(isAbsolutePath, ...)` to both `SoundSchema.filePath` and `GlobalFolderSchema.path`. The existing relative-path test (`./sounds/kick.wav`) updated to assert rejection; 5 new tests added covering bare filename, Windows relative, UNC acceptance, and GlobalFolderSchema relative/dot-prefix rejection. 1892/1892 tests pass; TypeScript clean.

#### ~~[SEC9] `loadDownloadHistory` bare `catch {}` — no backup, no user notification~~ ✅ FIXED
- **File**: `src/lib/downloads.ts:29-31`
- **Severity**: Low
- **Finding**: Swallows every error category (corrupt JSON, Zod validation, I/O errors) and returns `[]` silently. Inconsistent with `loadProjectHistory` and `loadGlobalLibrary` which distinguish error types, call `backupCorruptFile`, and notify the user.
- **Fix applied**: Added `LoadDownloadHistoryOptions` with `onCorruption?: (message: string) => void` (matching `loadProjectHistory` / `loadGlobalLibrary` pattern). `catch {}` replaced with typed recovery: `SyntaxError`/`ZodError` → `backupCorruptFile`, write fresh `[]`, call `onCorruption`; all other errors rethrow. `useBootLoader` updated to pass `onCorruption: (msg) => toast.warning(msg)` so users see a warning when their download history is cleared. 9 tests added in `src/lib/downloads.test.ts`.

#### ~~[SEC10] `DownloadJobSchema.url` accepts any string — no protocol constraint~~ ✅ FIXED
- **File**: `src/lib/schemas.ts:291-295`
- **Severity**: Low
- **Fix applied**: Replaced `url: z.string()` with `z.string().url().refine((u) => u.startsWith("http://") || u.startsWith("https://"), { message: "URL must use http or https protocol" })`. The `.url()` step rejects structurally invalid strings; the `.refine()` narrows to http/https only, blocking `ftp://`, `data:`, etc. 5 tests added to `schemas.test.ts` covering https acceptance, http acceptance, ftp rejection, data-URL rejection, and bare-string rejection.

#### ~~[SEC11] `DownloadJobSchema.outputPath` not sanitized before use as `Sound.filePath`~~ ✅ FIXED
- **File**: `src/lib/downloads.ts:22-28`; `src/lib/ytdlp.queries.ts:111-148`
- **Severity**: Low
- **Finding**: `outputPath: z.string().optional()` — no traversal or absolute-path refine. The completion handler pushes `outputPath` directly into `draft.sounds` before Zod validates the resulting `Sound`. A tampered `downloads.json` could inject a traversal-containing path into the in-memory library.
- **Fix applied**: Added the same traversal + absolute-path refines (matching `SoundSchema.filePath`) to both `DownloadJobSchema.outputPath` and `DownloadProgressEventSchema.outputPath` in `schemas.ts`. In the completion handler (`ytdlp.queries.ts`), the candidate `Sound` object is now validated with `SoundSchema.safeParse()` before `updateLibrary` is called — an invalid path surfaces a toast and aborts the library push rather than injecting bad data. 10 tests added to `schemas.test.ts` (5 per schema: absent/Unix/Windows accepted; traversal/relative rejected).

---

### Performance (12)

#### ~~[PERF2] `audioTick` allocates two `Set<string>` per RAF frame unnecessarily~~ ✅ FIXED
- **File**: `src/lib/audio/audioTick.ts:139-140`
- **Severity**: Low
- **Finding**: `seenPlayOrderLayerIds` and `seenChainLayerIds` were allocated every frame even when no chained layers are present.
- **Fix applied**: Replaced both `Set<string>` allocations with plain integer counters (`seenPlayOrderCount`, `seenChainCount`). The size-guard comparisons now use the counters; the inner pruning checks use `!(layerId in nextLayerPlayOrder)` and `!(layerId in nextLayerChain)` — O(1) property lookups on the already-populated result records. Saves two Set allocations + GC pressure per frame at 60fps with no behavioral change.

#### ~~[PERF3] `audioTick` rebuilds volume records from scratch every steady-state frame~~ ✅ FIXED
- **File**: `src/lib/audio/audioTick.ts:86-100`
- **Severity**: Low
- **Finding**: `nextPadVolumes` and `nextLayerVolumes` are rebuilt as fresh objects every frame. During stable playback with no fade or gain change, every frame allocates two records, walks the active maps, and runs `volumesEqual` — O(N) per frame per category when nothing changes.
- **Fix applied**: Added `gainRampDeadline` module var, `markGainRamp(durationS)`, and `isAnyGainChanging()` to `audioState.ts`. `isAnyGainChanging()` returns true when `fadePadTimeouts`/`fadingOutPadIds`/`fadingInPadIds` are non-empty (ongoing fade) OR `AudioContext.currentTime < gainRampDeadline` (short ramp still animating); reclaims the `-Infinity` fast path once the deadline naturally expires. `rampGainTo()` in `gainManager.ts` calls `markGainRamp(rampS)` — covers all call sites including `triggerAndFade` (previously called `linearRampToValueAtTime` directly; replaced with `rampGainTo`). `audioTick` short-circuits both volume rebuilds when `isAnyGainChanging()` returns false, skipping the two object allocations and O(N) Map iterations. 6 tests added (2 in `audioTick.test.ts`; 4 in `audioState.test.ts`). `audioVoice.stopWithRamp` intentionally does not call `markGainRamp` — it ramps a per-voice gain node not tracked by the tick; circular dependency concern documented in a comment.

#### ~~[PERF4] `PadButtonProgress` `layerProgress` selector runs on every non-playing pad at 60fps~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButtonProgress.tsx:36-45`
- **Severity**: Low
- **Finding**: The `layerProgress` selector (and likewise `activeLayers`) allocated a fresh object/array and iterated `pad.layers` on every RAF tick for every pad instance, including non-playing ones. With 12 visible pads that's 720+ wasted allocations/sec while any pad plays.
- **Fix applied**: Added module-level `EMPTY_RECORD` and `EMPTY_LAYERS` stable constants. Both selectors now guard with `if (!s.playingPadIds.has(padId)) return EMPTY_*` — short-circuiting all allocation and iteration for idle pads. Shallow equality sees the same reference each tick, so no re-render is triggered. The fix is broader than recommended: `activeLayers` had the same pattern and was fixed in the same commit.

#### ~~[PERF5] `loadedmetadata` listener accumulates without removal on early stop~~ ✅ FIXED
- **File**: `src/lib/audio/audioState.ts:522-529`
- **Severity**: Low
- **Finding**: `registerStreamingAudio` uses `{once: true}` so the listener auto-removes after firing. But when `clearLayerStreamingAudio` is called before metadata loads (common for rapid trigger-then-stop), the listener remains attached. Since `streamingCache` reuses the same `HTMLAudioElement` across triggers, dead closures accumulate over a long session.
- **Fix applied**: Added `pendingMetadataAborts: WeakMap<HTMLAudioElement, Map<"${padId}|${layerId}", AbortController>>`. `registerStreamingAudio` creates an `AbortController` per `(element, padId, layerId)` triple and passes `signal: ac.signal` alongside `{ once: true }` to `addEventListener`. `unregisterStreamingAudio`, `clearLayerStreamingAudio`, and `clearAllStreamingAudio` all abort and evict the controller, proactively removing the listener before it can accumulate. Empty inner maps are evicted from the `WeakMap` immediately. The existing membership guard is preserved as defense-in-depth. 4 new tests added covering: abort on unregister, abort on clear, per-key isolation (aborting one layer doesn't affect another), and re-register pre-abort.

#### ~~[PERF6] `BackFaceLayerRow` subscribes to `layerVolumes` at 60fps during fades~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/BackFaceLayerRow.tsx:44-46` (note: reviewer cited `PadBackFace.tsx:60-62`, which was stale after the ARCH4 extraction)
- **Severity**: Low
- **Finding**: The slider re-renders at up to 60fps during an audio fade while the back face is visible. Slider DOM reflows at audio-rate are measurable for multiple layers.
- **Fix applied**: Replaced `usePlaybackStore(selector)` (which caused 60fps re-renders) with a `usePlaybackStore.subscribe(selector, listener)` in a `useEffect` that throttles `setState` to ~10Hz (100ms). `liveLayerVol` state is initialized from a store snapshot on mount; the effect also re-syncs immediately on `layer.id` change before subscribing so there is no stale intermediate value. When `layerVolumes[layer.id]` is `undefined` (fade ended / layer stopped), `setLiveLayerVol(null)` fires immediately without throttle so the slider snaps to the static project value without delay. `localLayerVol` (drag gesture) continues to take priority via `sliderVol = localLayerVol ?? layerVol`. During steady-state playback with no fade in flight, `layerVolumes[layer.id]` is absent and the subscription listener never fires — zero re-renders beyond the initial mount. The throttle is leading-edge-only; the last sub-100ms intermediate value of a short fade will be missed, which is imperceptible in practice. 1928/1928 tests pass; TypeScript clean.

#### ~~[PERF7] `resolveLayerSounds` re-runs for every `sounds` array replacement~~ ✅ FIXED
- **File**: `src/lib/audio/resolveSounds.ts` (finding cited `PadBackFace.tsx:66-67` — stale after ARCH4 extraction; actual call site is `BackFaceLayerRow.tsx:74`)
- **Severity**: Low
- **Finding**: `useMemo(() => resolveLayerSounds(layer, sounds), [layer, sounds])` re-runs whenever Immer replaces `libraryStore.sounds`. For `tag`/`set` selections this runs an O(n) `.filter()` over the full library for each visible `BackFaceLayerRow`.
- **Fix applied**: Added `_tagSetCache = new WeakMap<Sound[], Map<string, Sound[]>>()` to `resolveSounds.ts` alongside the existing `_soundByIdCache`. The `tag` and `set` switch cases now check the cache before calling `.filter()` and populate it on a miss. Cache key uses `JSON.stringify` to safely encode tag IDs (including those containing any character), plus sorted tag IDs for order-normalization and matchMode discrimination. WeakMap GC semantics ensure each Immer snapshot's cached results are released when the snapshot is no longer referenced. All current consumers are read-only against the returned arrays; a JSDoc note on `_tagSetCache` documents the no-mutation contract. Primary benefit is cross-component deduplication: all `BackFaceLayerRow` instances sharing the same tag/set selection collapse N O(n) filters into 1 per render cycle. 12 tests added (9 initial + 3 post-review: `\0`-in-tagId collision regression, tag/set against empty sounds array); 1940/1940 tests pass; TypeScript clean.

#### ~~[PERF8] `useAutoSave` restarts the 30s interval when TanStack mutation identity changes~~ ✅ FIXED
- **File**: `src/hooks/useAutoSave.ts:101`
- **Severity**: Low
- **Finding**: `saveCurrentLibrarySync` appeared in the effect dependency array. If `useMutation`'s `mutate` function gets a new identity after a success/error state change, the interval is torn down and re-created, restarting the cadence.
- **Fix applied**: Added `saveCurrentLibrarySyncRef` (mirroring the existing `isProjectSavePendingRef`/`isLibrarySavePendingRef` pattern): the ref is updated on every render, the effect closure calls `saveCurrentLibrarySyncRef.current(...)`, and `saveCurrentLibrarySync` is removed from the dep array. 1 regression test added: advances the interval to t=25s, rerenders with a new mock `saveCurrentLibrarySync` identity, then advances 5s more — asserts the tick fires at t=30s (interval was not restarted). 21/21 tests pass; TypeScript clean.

#### ~~[PERF9] `s.project?.scenes ?? []` allocates a new array every selector call when project is null~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/SceneView.tsx:56`
- **Severity**: Low
- **Finding**: Zustand uses `Object.is` by default; a new `[]` on every call causes SceneView to re-render on every store update while no project is loaded.
- **Fix applied**: Hoisted `const EMPTY_SCENES: Scene[] = []` to module scope; selector now returns `s.project?.scenes ?? EMPTY_SCENES`. Stable reference means Zustand suppresses re-renders when project is null. `Scene` added to the `@/lib/schemas` import.

#### ~~[PERF10] `stopAllPads` ramps every historically-seen gain node, not just active ones~~ ✅ FIXED
- **File**: `src/lib/audio/padPlayer.ts:429-433`
- **Severity**: Low
- **Finding**: `forEachPadGain` iterates `padGainMap` — every pad that has ever received a gain node, whether currently playing or not. Gain nodes are not deleted on natural stop, so over a session `stopAllPads` schedules `linearRampToValueAtTime` on all cached gain nodes including silent ones.
- **Fix applied**: Replaced `forEachPadGain` with `forEachActivePadGain` in `stopAllPads`. `forEachActivePadGain` iterates `voiceMap.keys()`, so only pads with currently-active voices have their gain ramped to zero. Pads that have played and stopped in a prior session naturally accumulate entries in `padGainMap` but no longer incur ramp scheduling on global stop. 1 test added verifying that a historically-seen but inactive pad's gain node is not ramped when `stopAllPads` is called while a different pad is playing.

#### ~~[PERF11] `liveVolume` prop causes `PadFadeControls` to re-render entire fade-controls tree at 60fps~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadBackFace.tsx:46,172-183`
- **Severity**: Low
- **Finding**: `liveVolume` (subscribed at RAF rate in `PadBackFace`) is passed as a prop to memoized `PadFadeControls`, invalidating the memo on every tick during a fade and causing two Sliders, text, and AnimatePresence to re-reconcile at ~60fps.
- **Fix applied**: Moved `usePlaybackStore((s) => s.padVolumes[pad.id])` subscription from `PadBackFace` into `PadFadeControls`. Removed `liveVolume` from `PadFadeControlsProps`. `PadBackFace` no longer triggers on tick-rate store updates; only the focused fade-controls subtree re-renders during fades. Further split into a static wrapper + live-volume child was evaluated and rejected — Low severity, single animated section already gated on `isPlaying`, no measurable cost from adjacent static sliders at 60fps. Added `PadFadeControls.test.tsx` (8 tests) covering: live volume display from `padVolumes`, fallback to `pad.volume` when entry absent, fade button label (Fade Out / Fade In / disabled) driven by live volume vs fade target, and Current volume section visibility. All tests pass; TypeScript clean.

#### ~~[PERF-E] Hidden `PadBackFace` RAF subscriptions on non-editing pads~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButton.tsx:143–171`; `src/components/composite/SceneView/BackFaceLayerRow.tsx:42,49–66`
- **Severity**: Low
- **Finding**: `PadButton` was mounting `PadBackFace` unconditionally inside the flip container. Each `BackFaceLayerRow` holds two playback subscriptions: a React hook on `activeLayerIds` (`usePlaybackStore((s) => s.activeLayerIds.has(layer.id))`) and a direct `usePlaybackStore.subscribe` on `layerVolumes[layer.id]`. Both stores are written by the RAF tick on every frame during playback. With 12 pads each having 1–3 layers, all layer rows across all pads subscribed to 60fps updates while their containing back face was invisible, incurring 12–36 active subscriptions firing at audio-tick rate and triggering re-renders for no visible output.
- **Fix applied**: Added `showBackFace` state to `PadButton` (initialized to `isFlipped`) with a delayed-unmount timer. When a pad flips to front (`isFlipped` → false), `showBackFace` is set to false after `PAD_FLIP_DURATION_MS + 50ms` — enough for the CSS flip animation to complete. When a pad flips to back (`isFlipped` → true), `showBackFace` is set immediately. The `PadBackFace` mount is gated by `{showBackFace && <PadBackFace …/>}`, so all `BackFaceLayerRow` subscriptions are torn down as soon as the back face is no longer visible. Non-editing pads pay zero subscription cost. The delayed-unmount approach is intentionally more robust than a plain `editingPadId === pad.id` gate: it prevents the back face from disappearing mid-animation and avoids a flash when global edit mode is toggled on all pads simultaneously.

#### ~~[PERF-4] Unconditional AnimatePresence + continuous spring machinery on all visible pads~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButton.tsx:111–141, 247–264`
- **Severity**: Low
- **Finding**: Every visible pad allocated `useMotionValue`/`useSpring`/`useTransform` hooks unconditionally, even when `tiltEnabled` is false (edit mode, sort drag, multi-fade). The existing `useEffect` that snapped source values to 0 set `mouseX`/`mouseY` to 0, but the spring outputs (`rotateX`, `rotateY`) still animated toward 0 over ~5 RAF frames rather than snapping immediately — keeping the RAF loop alive briefly for all 12 pads whenever tilt was toggled off. A separate concern about a Motion `animate={{ opacity: [0.3, 0.8, 0.3] }}` keyframe loop on the pulse ring was already addressed prior to this finding: the current implementation uses a CSS `@keyframes pad-pulse` animation with Motion only for mount/unmount opacity transitions.
- **Fix applied**: Added `rotateX.set(0)` and `rotateY.set(0)` calls alongside the existing `mouseX.set(0)`/`mouseY.set(0)` in the `tiltEnabled` effect. Calling `.set(0)` directly on spring `MotionValue`s bypasses the spring physics and snaps their output to 0 immediately, eliminating the ~5-frame RAF settlement window when entering edit/multi-fade mode. Source values are still zeroed first so the spring target (via `useTransform`) is also 0, preventing any rebound. Comment updated to accurately describe the immediate snap. Extracting tilt into a conditionally-mounted child component was evaluated and rejected: changing the wrapper component type at the same tree position would force React to unmount/remount the entire pad content tree (flip container, front face button, back face) on every tilt toggle, causing visual glitches that are worse than the settled-spring overhead.

#### ~~[PERF-5] `updateLayerVolume` spreads entire `layerVolumes` record on every call~~ ✅ INVALID
- **File**: `src/state/playbackStore.ts:202–203` (cited; no longer exists)
- **Severity**: Low
- **Finding**: `updateLayerVolume: (layerId, volume) => set(s => ({ layerVolumes: { ...s.layerVolumes, [layerId]: volume } }))` spreads the full record on every slider drag (~60×/sec). Flagged as a structural risk if `layerVolumes` grows large.
- **Resolution**: Finding is stale. The cited `playbackStore.updateLayerVolume` was removed by the ARCH7 fix. The current architecture avoids the pattern entirely: live drag (`onValueChange`) calls `gainManager.setLayerVolume`, which writes directly to the Web Audio gain node with no Zustand mutation; commit (`onValueCommit`) calls `projectStore.updateLayerVolume`, which uses Immer to mutate `layer.volume` once per release (not per frame); the runtime `layerVolumes` record in `playbackStore` is written exclusively by the `audioTick` RAF loop via `setAudioTick`, which has its own short-circuit logic. No spreading of `layerVolumes` occurs at 60fps anywhere in the current codebase.

#### ~~[PERF12] `stopAllPads` ramp timeout races with immediate re-trigger~~ ✅ FIXED
- **File**: `src/lib/audio/padPlayer.ts:437-446`
- **Severity**: Low
- **Finding**: The 30ms cleanup `setTimeout` in `stopAllPads` called `clearAllPadGains()` and `stopAllVoices()` unconditionally. A pad triggered during the ramp window would have its gain node disconnected and its voice stopped by the timeout, silencing it. The reviewer's note about `cancelScheduledValues` cancelling the ramp is correct — the ramp itself is not the issue; the unconditional cleanup is.
- **Fix applied**: `stopAllPads()` now captures a snapshot of active pad IDs (`getActivePadIds()`) and voice objects (`getAllVoices()`) before the ramp starts. The cleanup timeout uses scoped helpers — `clearPadGainsForIds`, `clearLayerGainsForIds`, `stopSpecificVoices` — that operate only on the snapshot, leaving any pad triggered during the window untouched. Additionally, `clearInactivePadGains()` is called synchronously on the same tick to immediately disconnect stale gain nodes for pads with no active voices, eliminating their portion of the race window. 6 new functions added to `audioState.ts`; 2 tests added to `padPlayer.test.ts`; 1 pre-existing test updated to trigger an actual voice instead of manually injecting into `playingPadIds` (the old `stopAllVoices()` cleared the whole store; the new scoped cleanup only handles tracked voices).

---

### Architecture (8)

#### ~~[ARCH8] `reconcileProject.ts` and `projectSoundReconcile.ts` naming is confusing~~ ✅ FIXED
- **File**: `src/lib/reconcileProject.ts`; `src/lib/projectSoundReconcile.ts`
- **Severity**: Low
- **Finding**: Two modules with near-identical names implement the same conceptual flow with opposite pure/impure splits. `library.reconcile.ts` uses yet a third split convention (mixes both in one file). File naming does not communicate the layering.
- **Recommendation**: Adopt one convention, e.g.: `src/lib/reconcile/project.ts` (pure), `src/lib/reconcile/library.ts` (pure), `src/lib/reconcile/orchestrators.ts` (store-coupled).
- **Fix applied**: Merged `projectSoundReconcile.ts` and `reconcileProject.ts` into `src/lib/project.reconcile.ts`, adopting the `domain.reconcile.ts` naming convention already established by `library.reconcile.ts`. The store-coupled orchestrator (`applyProjectSoundReconcile`) moved to a clearly-marked "Store-coupled orchestrators" section at the bottom of the file, matching the section structure in `library.reconcile.ts`. The `ReconcileResult` type renamed to `ProjectReconcileResult` to prevent collision with `library.reconcile.ts`'s identically-named but differently-shaped export. Test files merged into `project.reconcile.test.ts`; all 6 import sites updated; all 1952 tests pass.

#### ~~[ARCH9] `applyProjectSoundReconcile` dedup logic differs between its two callers~~ ✅ FIXED
- **File**: `src/hooks/useProjectLifecycle.ts:91-101`; `src/hooks/useReconcileLibrary.ts:77`
- **Severity**: Low
- **Finding**: `useProjectLifecycle` deduplicates by `folderPath ?? (project.name + "|" + lastSaved)`. `lastSaved` changes on every auto-save, so the dedup key rotates, potentially allowing a redundant second reconcile call if the effect re-fires after the save triggered by the first reconcile. Additionally, `markAsPermanent` (Save As) changes `folderPath` mid-mount, causing the path-based dedup to miss and firing the missing-sounds notification toast a second time for the same logical project session.
- **Fix applied**: Added `loadSessionId: number` to `projectStore` — incremented only in `loadProject`, **not** in `markAsPermanent`. Both dedup refs in `useProjectLifecycle` (`cleanedSessionIdRef`, `lastNotifiedSessionId`) are now keyed on `loadSessionId` (a monotonic integer per project-load event) rather than `folderPath`. This makes both effects stable across Save As path mutations while still re-firing correctly when a genuinely new project is loaded. The dead-code fallback `?? (project.name + "|" + lastSaved)` is eliminated. The reconcile effect's dedup (`cleanedSessionIdRef`) prevents redundant reconcile calls from `updateProject` notifications that change the `project` reference without starting a new load session. The missing-sounds effect fires at most once per `loadSessionId` — Save As no longer duplicates the toast.

#### ~~[ARCH10] `LibraryItemPicker` uses `"__create__"` magic string as a sentinel~~ ✅ FIXED
- **File**: `src/components/composite/LibraryPickers/LibraryItemPicker.tsx:42-50`
- **Severity**: Low
- **Finding**: Any library item whose id happens to be `"__create__"` would silently trigger the create flow. The sentinel is not exported or type-guarded.
- **Fix applied**: Extracted the literal to a named module-level constant `CREATE_SENTINEL` in `LibraryItemPicker.tsx` with a JSDoc comment explaining its purpose and the schema-level guard. Added `id.startsWith("__")` refines to both `TagSchema` and `SetSchema` in `schemas.ts` — any `library.json` entry with a reserved-prefix id is now rejected at parse time, closing the collision window before it can reach the picker. 6 tests added to `schemas.test.ts` (sentinel id and generic `__`-prefix rejection + valid `tag__1`/`set__1` acceptance for each schema); 1 test added to `LibraryItemPicker.test.tsx` verifying that `"__create__"` never appears in `onChange` calls when an item with that id exists in the list.

#### ~~[ARCH11] `backupCorruptFile` extraction is half-done — surrounding recovery structure still duplicated~~ ✅ FIXED
- **File**: `src/lib/library.ts:54-77`; `src/lib/history.ts`
- **Severity**: Low
- **Finding**: `backupCorruptFile` is now imported and called, but the surrounding try/catch/backup/write-fresh-default/notify pattern is still duplicated verbatim between `loadGlobalLibrary` and `loadProjectHistory`.
- **Fix applied**: Added `loadJsonWithRecovery<T>({ path, parse, defaults, onCorruption, corruptMessage })` to `fsUtils.ts`. `readTextFile` is called outside the `try` so I/O errors propagate freely; `opts.parse(JSON.parse(text))` is wrapped in a single `try/catch` that recovers from both `SyntaxError` (bad JSON) and any error from the `parse` callback (ZodError, MigrationError, etc.). `loadGlobalLibrary`, `loadProjectHistory`, and `loadDownloadHistory` all use the new helper — their try/catch/backup/write/notify blocks eliminated. `ZodError`, `MigrationError` (from library), and `readTextFile` imports removed from each caller. 6 tests added to `fsUtils.test.ts`. 1965/1965 tests pass; TypeScript clean.

#### ~~[ARCH12] `useDownloadEventListener` lives in `ytdlp.queries.ts` but uses no TanStack Query~~ ✅ FIXED
- **File**: `src/lib/ytdlp.queries.ts:91-174`
- **Severity**: Low
- **Fix applied**: Moved `useDownloadEventListener` and its private helper `buildJobUpdate` to `src/hooks/useDownloadEventListener.ts`. Trimmed `ytdlp.queries.ts` of now-unused imports (`useEffect`, `useRef`, `stat`, `listenToDownloadEvents`, `DownloadJobUpdate`, `useLibraryStore`, `SoundSchema`, `DownloadProgressEvent`). Split `ytdlp.queries.test.ts` — listener tests moved to `src/hooks/useDownloadEventListener.test.ts`. Updated import in `MainPage.tsx` and mock path in `SoundList.test.tsx`. 1966/1966 tests pass; TypeScript clean.

#### ~~[ARCH13] `audioContext.ts` imports `playbackStore` — lowest audio primitive depends on UI store~~ ✅ FIXED
- **File**: `src/lib/audio/audioContext.ts:15`
- **Severity**: Low
- **Finding**: `audioContext.ts` subscribed to `masterVolume` from `playbackStore`, forming an inbound dependency from the lowest audio primitive into the top of the stack. The layering comment in `audioTick.ts:16-18` described an intended graph that didn't reflect reality.
- **Fix applied**: Removed `usePlaybackStore` import and subscription from `audioContext.ts`. `audioContext.ts` is now a pure leaf — no upward store dependencies. Added `applyMasterVolume(volumePct)` export and a `pendingVolume` module variable that queues the most recent value; `getMasterGain()` initializes the new gain node from `pendingVolume` so volumes set before the first sound triggers are never silently dropped. `applyMasterVolume` always writes `pendingVolume` and additionally sets `masterGain.gain.value` when the node exists. `audioTick.ts` owns the reactive bridge: `export const _stopMasterVolumeSync = usePlaybackStore.subscribe(s => s.masterVolume, applyMasterVolume)` — the unsubscribe handle is exported (`_` prefix per convention) for test teardown. `startAudioTick()` no longer calls `applyMasterVolume` (the pending-volume queue in `audioContext.ts` makes that sync redundant). Layering comment updated. `audioContext.test.ts` rewritten (store mock removed; "queues volume before getMasterGain and applies on first construction" test added); 3 masterVolume sync tests retained in `audioTick.test.ts`. 1979/1979 tests pass; TypeScript clean.

#### ~~[ARCH14] `useProjectLifecycle` mixes 4 unrelated concerns~~ ✅ FIXED
- **File**: `src/hooks/useProjectLifecycle.ts:19-153`
- **Severity**: Low
- **Finding**: The hook owned: (1) window close lifecycle, (2) missing-sounds notification toast, (3) `applyProjectSoundReconcile` side-effect, (4) null-project guard. Only the close-flow values were returned. The other three were invisible side-effects unrelated to the hook's stated JSDoc purpose.
- **Fix applied**: Extracted `useProjectSoundReconcileOnLoad` (`src/hooks/useProjectSoundReconcileOnLoad.ts`) and `useMissingSoundsNotification` (`src/hooks/useMissingSoundsNotification.ts`) as separate focused hooks, each with their own test file. Both are composed in `MainPageInner`. The null-project guard was kept in `useProjectLifecycle` — it is tightly coupled to `closingIntentionallyRef` from the close-flow state and cannot be cleanly separated without passing a ref between hooks. Stale mocks for `applyProjectSoundReconcile` and `libraryStore` removed from `useProjectLifecycle.test.ts`. 1990/1990 tests pass; TypeScript clean.

#### ~~[ARCH15] `useAutoSave` uses TanStack mutations for fire-and-forget saves with no caching benefit~~ ✅ FIXED
- **File**: `src/hooks/useAutoSave.ts:33-34,75-80`
- **Severity**: Low
- **Finding**: TanStack mutations are used purely for fire-and-forget saves; pending state is tracked via refs to work around TanStack's state-object recreation. The mutations add no caching, invalidation, or deduplication value. The project and library saves use two variations of the same pattern (one uses `mutate`, one uses `saveCurrentLibrarySync`).
- **Recommendation**: If the auto-save interval doesn't need TanStack's caching, call `saveProject(folderPath, project)` + `_saveCurrentLibraryAndClearDirty()` directly via refs.
- **Fix applied**: Removed `useSaveProject` and `useSaveCurrentLibrary` from `useAutoSave`. Replaced with direct calls to `saveProject` (from `@/lib/project`) and `saveCurrentLibraryAndClearDirty` (from `@/lib/library`). Pending state now tracked with plain boolean refs (`isProjectSavePendingRef`, `isLibrarySavePendingRef`) set to `true` before each async call and reset in `.finally()`. `clearDirtyFlag` is called inside the `.then()` after a successful project save; `.catch()` routes errors to the shared `notifyAutoSaveFailure` debouncer. The three TanStack-workaround refs (`isProjectSavePendingRef`/`isLibrarySavePendingRef` as TanStack mirrors, `saveCurrentLibrarySyncRef`) are eliminated. Test file rewritten to mock the raw save functions instead of the query hooks; all 21 tests pass; 1990/1990 tests pass; TypeScript clean.

---

### Code Quality (17)

#### ~~[QUAL5] `createDefaultStoreLayer` round-trips through `LayerConfigForm` and uses `as Layer`~~ ✅ FIXED
- **File**: `src/lib/padDefaults.ts:15-17`
- **Severity**: Low
- **Fix applied**: `createDefaultStoreLayer` now constructs the `Layer` object directly. The `as Layer` cast and the delegation to `createDefaultLayer()` are removed. Both functions are now independently correct for their declared return types. 1990/1990 tests pass; TypeScript clean.

#### [QUAL6] `DownloadStatusButton.tsx` exports a component named `DownloadButton` ✅ FIXED
- **File**: `src/components/composite/DownloadManager/DownloadStatusButton.tsx:14`
- **Severity**: Low
- **Finding**: File named `DownloadStatusButton.tsx`, prop interface `DownloadButtonProps`, export `function DownloadButton`. The mismatch hinders searchability.
- **Recommendation**: Either rename the export to `DownloadStatusButton` (and update consumers) or rename the file to `DownloadButton.tsx`.
- **Fix applied**: Rename the export to `DownloadStatusButton` (and update consumers)

#### ~~[QUAL8] `LayerConfigDialog` reallocates Zod schema and resolver on every render~~ ✅ FIXED
- **File**: `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx:78-81`
- **Severity**: Low
- **Finding**: `PadConfigSchema.extend({ name: z.string() })` and `zodResolver(...)` are constructed inside the component body, allocating fresh objects on every render.
- **Fix applied**: Hoisted `LAYER_DIALOG_SCHEMA` and `LAYER_DIALOG_RESOLVER` to module scope (after imports). Removed the local `layerDialogSchema` variable; `useForm` now references `LAYER_DIALOG_RESOLVER` directly. The explanatory comment about overriding `name` to `z.string()` moved to the `resolver:` call site. 2000/2000 tests pass; TypeScript clean.

#### ~~[QUAL9] `useElapsedTime` non-null asserts `startRef.current` inside `setInterval`~~ ✅ FIXED
- **File**: `src/components/composite/DownloadManager/DownloadItem.tsx:32-39`
- **Severity**: Low
- **Finding**: `startRef.current!` is asserted inside the interval callback. The guard runs before `setInterval`, so it's safe now, but a future refactor moving the interval above the guard would produce a silent runtime crash.
- **Fix applied**: Captured `const start = startRef.current!` immediately after the guard (where non-nullness is guaranteed), then closed over `start` inside the interval callback instead of re-reading the ref. The assertion is now co-located with the proof of its safety; the interval closes over a plain `number` rather than a mutable ref.

#### ~~[QUAL10] `projectStore.deleteScene` non-null asserts a double-indexed array access~~ ✅ FIXED
- **File**: `src/state/projectStore.ts:152-161`
- **Severity**: Low
- **Finding**: `(scenes[deletedIdx] ?? scenes[deletedIdx - 1])!.id` — if `deletedIdx` is stale and both indices are undefined, the `!` produces a runtime crash instead of a graceful `null`.
- **Fix applied**: Replaced the ternary + `!` assertion with `const candidate = scenes[deletedIdx] ?? scenes[deletedIdx - 1] ?? scenes[0]; const next = candidate?.id ?? null;`. The `scenes.length > 0` guard is subsumed by `candidate?.id ?? null` which returns `null` when the array is empty. The `?? scenes[0]` third fallback is defensive against a stale `deletedIdx`; the existing `scenes.length > 0` ternary and `!` assertion are both removed. All 81 existing tests pass; TypeScript clean.

#### ~~[QUAL12] All `PadButton` instances subscribe to `fadePopoverTarget` — only one ever reads it~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButton.tsx:46-49`
- **Severity**: Low
- **Finding**: `const fadePopoverTarget = useUiStore((s) => s.fadePopoverTarget)` subscribed every pad instance to pointer-move-rate updates during popover drags, even though only the pad with an open popover reads the value.
- **Fix applied**: Extracted the fade popover UI (amber indicator line + slider panel + commit handler) into a new `PadFadePopoverContent` component, following the same isolation pattern as `PadButtonProgress` and `PadButtonFadeOverlay`. `PadButton` now renders `{isPopoverOpen && <PadFadePopoverContent pad={pad} sceneId={sceneId} />}` — the subscription only exists while the popover is open and only for that one instance. The `isFadingOut` amber line uses `pad.fadeTargetVol ?? 0` directly (the popover commit already persists the target before starting the fade). `fadePopoverTarget` and `setFadePopoverTarget` subscriptions removed from `PadButton`; `handlePopoverCommit` moved into the sub-component. 3 tests added; TypeScript clean.

#### ~~[QUAL13] `LayerConfigSection.getRetriggerHelper` casts to `Exclude<RetriggerMode, "next">`~~ ✅ FIXED
- **File**: `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx:218`
- **Severity**: Low
- **Finding**: After the `if (retriggerMode === "next")` early return, `helpers[retriggerMode as Exclude<RetriggerMode, "next">]` is cast. If a fifth mode is added and `helpers` doesn't have that key, the access returns `undefined` silently.
- **Fix applied**: Removed the redundant `as Exclude<RetriggerMode, "next">` cast. TypeScript already narrows `retriggerMode` to `Exclude<RetriggerMode, "next">` after the early-return guard, and `helpers` typed as `Record<Exclude<RetriggerMode, "next">, ...>` enforces exhaustiveness at the object literal — so adding a new mode would produce a compile error without any cast. TypeScript clean, all 2003 tests pass.

#### ~~[QUAL14] `PadBackFace` duplicates the `canRemove` guard and writes to a ref during render~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadBackFace.tsx:371-372,435-439`
- **Severity**: Low
- **Finding**: `canRemove={pad.layers.length > 1}` and `if (padRef.current.layers.length <= 1) return;` duplicate the same guard. `padRef.current = pad` is written during render — a React anti-pattern fragile under concurrent features.
- **Fix applied**: Replaced `padRef.current = pad` with `useLayoutEffect(() => { padRef.current = pad; }, [pad])` (correct concurrent-mode pattern). Removed `canRemove` prop from `PadLayerSection` → `BackFaceLayerRow`; `BackFaceLayerRow` now derives it locally from `pad.layers.length > 1` (it already had access to `pad`). The defensive guard in `handleRemoveLayer` is retained as a safety net — it and the UI guard serve different layers of defense. TypeScript clean, all 2003 tests pass.

#### ~~[QUAL15] `useMultiFadeMode` and `useGlobalHotkeys` both register `f` key handlers — ordering fragile~~ ✅ FIXED
- **File**: `src/hooks/useGlobalHotkeys.ts:74`; `src/hooks/useGlobalHotkeys.test.ts`
- **Severity**: Low
- **Finding**: The global `f` handler early-returns when `useMultiFadeStore.getState().active` is true. Any future `f`-handler registered without this guard will multi-fire. No test verifies the deferral.
- **Fix applied**: The file reference was stale — `f` hotkeys were previously in `useMultiFadeMode.ts` but had already been refactored into `useMultiFadeSideEffects.ts`. Two changes made: (1) updated the stale comment in `useGlobalHotkeys.ts` from `"useMultiFadeMode owns F"` to `"useMultiFadeSideEffects owns F"`; (2) added a regression test to `useGlobalHotkeys.test.ts` asserting the global `f` callback is a no-op (no `executeFadeTap`, no `setFadePopoverPadId`) when `multiFadeStore.active === true`. The symmetric guard structure (`if (active) return` in globalHotkeys / `if (!active) return` in sideEffects) was evaluated and confirmed sound — no structural change needed.

#### ~~[QUAL16] `PadDurationSlider` / `PadPercentSlider` return Fragments — leaks layout semantics to callers~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadDurationSlider.tsx:18-36`; `src/components/composite/SceneView/PadPercentSlider.tsx:18-36`
- **Severity**: Low
- **Finding**: Both return `<> <div>…</div> <Slider /> </>`. Callers must rely on parent flex/grid layout behaving correctly with two injected children.
- **Fix applied**: These components were already consolidated into `PadLabeledSlider` by the REUSE5 fix, but the Fragment pattern carried over. Replaced `<> … </>` with `<div className="flex flex-col gap-1">` in `PadLabeledSlider.tsx` so the component renders as a single child and owns its own layout.

#### ~~[QUAL17] `PadButtonFadeOverlay` duration slider uses `onPointerUp` instead of `onValueCommit`~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButtonFadeOverlay.tsx:93-103`
- **Severity**: Low
- **Finding**: All other sliders in the codebase use `onValueCommit` for persistence. `onPointerUp` does not fire when the slider thumb is committed via keyboard — keyboard users change the display value but never persist it.
- **Fix applied**: Replaced `onPointerUp` with `onValueCommit={([v]) => useProjectStore.getState().setPadFadeDuration(sceneId, pad.id, v)}`. The committed value `v` is passed directly from Radix rather than closing over local `displayDuration` state. Test updated to verify keyboard commit persists the value.

#### ~~[QUAL18] `onValueChange` style inconsistency in `PadButtonFadeOverlay`~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadButtonFadeOverlay.tsx:97`
- **Severity**: Low
- **Finding**: `onValueChange={(v) => setDisplayDuration(v[0])}` while the two adjacent sliders use `onValueChange={([v]) => …}` destructure style.
- **Fix applied**: Changed to `onValueChange={([v]) => setDisplayDuration(v)}` — functionally equivalent, now consistent with all other sliders in the component.

#### ~~[QUAL19] `audioState.ts` non-null asserts inside generator due to TS closure narrowing~~ ✅ FIXED
- **File**: `src/lib/audio/audioState.ts`
- **Severity**: Low
- **Finding**: `layerMap` is narrowed to non-null via a guard, but TS loses the narrowing inside the inner generator function, requiring `layerMap!.values()`.
- **Fix applied**: Assigned `layerMap` to a narrowed `const lm = layerMap` before the generator declaration. TypeScript infers `lm` as `Map<string, Set<HTMLAudioElement>>` (non-null) because `const` bindings are not re-narrowable, so the generator can access `lm.values()` without the `!` assertion. Zero behavior change.

#### ~~[QUAL20] `PadBackFaceProps` exported but unreferenced externally~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadBackFace.tsx:29`
- **Severity**: Low
- **Finding**: `export interface PadBackFaceProps` was exported but nothing outside the file imported it.
- **Fix applied**: Removed `export` modifier — `PadBackFaceProps` is now a file-private interface. `PadBackFace` (the component) remains exported; only the props type loses public visibility. Zero behavior change.

#### [QUAL21] `LayerConfigDialog` tag/set emptiness check is out-of-band with no explanation
- **File**: `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx:78,118-138`
- **Severity**: Low
- **Finding**: The dialog performs a manual emptiness check for tag/set selections (lines 118-138) alongside Zod's automatic `assigned` validation. No comment explains why this is out-of-band.
- **Recommendation**: Add an inline comment explaining that "sounds exist for tag/set" is not Zod-expressible (requires runtime library state), to prevent future maintainers from consolidating it incorrectly.
- **Fix applied**: Expanded the comment at the top of the validation block to explain that `LAYER_DIALOG_SCHEMA` is a module-level constant with no access to runtime library state, and that even a `z.refine()` callback would not help because the schema instance is fixed at module load. Added explicit "do not consolidate into the schema" guard sentence. Secondary fix: extracted `filterSoundsBySet(sounds, setId)` in `resolveSounds.ts` (mirroring `filterSoundsByTags`) so the set path in `onSubmit` delegates to the shared utility instead of inlining `!!s.filePath`, closing the maintenance gap flagged by code review. 3 tests added to `resolveSounds.test.ts`.

---

### Code Reuse (1 remaining)

#### ~~[REUSE3] 0–1 volume clamp open-coded 6 times in audio engine~~ ✅ FIXED
- **File**: `src/lib/audio/gainManager.ts:16,46,58`; `src/lib/audio/audioState.ts:468`; `src/lib/audio/layerTrigger.ts:88,98`; `src/hooks/usePadGesture.ts:174`
- **Severity**: Low
- **Finding**: `Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback` duplicated 6 times.
- **Recommendation**: Add `clampGain01(value: number, fallback = 0): number` in `src/lib/audio/gainManager.ts` (or alongside `getLayerNormalizedVolume`). Every clamp site becomes a one-liner.
- **Fix applied**: The review's "6 times" count was stale — `gainManager.ts` had already extracted a private `clampGain` helper; its 3 internal uses were not open-coded. The truly open-coded sites were 4. `clampGain` renamed to `clampGain01(value, fallback = 0)` and exported. `layerTrigger.ts:88,98` replaced with `clampGain01(x / 100)` (the `/100` scale-conversion stays at the call site). `usePadGesture.ts:175` replaced with `clampGain01(...)`. `audioState.ts:612` left inline: `gainManager` → `audioState` is an existing import, so importing in the reverse direction would create a cycle; additionally that site uses `fallback = 1` intentionally (non-finite volume defaults to full gain on initialization, not silence). 90/90 test files, 2007/2007 tests pass.

#### ~~[REUSE11] `projectStore` pad-field setters are 3 copies of the same scene→pad lookup~~ ✅ FIXED
- **File**: `src/state/projectStore.ts:262-293`
- **Severity**: Low
- **Finding**: `setPadFadeDuration`, `setPadFadeTarget`, and `setPadVolume` each perform the identical scene-lookup → pad-lookup → field-assign → `isDirty = true` pattern.
- **Recommendation**: Add a private `withPad(sceneId, padId, update: (pad: Draft<Pad>) => void)` helper inside the store creator. All three setters become one-liners, and future pad-field setters stay cheap.
- **Fix applied**: Added module-level `withPad` curried helper (typed against `ProjectStore`, no Immer import needed) before `useProjectStore`. The three setters are now single-expression one-liners. `isDirty = true` and both guard returns live exclusively in `withPad`. Also added 10 missing tests for `setPadFadeTarget` and `setPadVolume` (5 each, mirroring `setPadFadeDuration` coverage). 91/91 tests pass.

#### ~~[REUSE12] `buildPadMap` not exported — other hooks use O(N×M) `flatMap.find` instead~~ ✅ FIXED
- **File**: `src/hooks/useMultiFadeMode.ts:16-24`; `src/hooks/useGlobalHotkeys.ts:90,105,141`
- **Severity**: Low
- **Finding**: `buildPadMap` builds an O(1) lookup Map but is file-private. `useGlobalHotkeys` and `useProjectLifecycle` still use `scenes.flatMap((s) => s.pads).find(...)` for the same operation.
- **Recommendation**: Move `buildPadMap` to `src/lib/projectHelpers.ts` (or `padDefaults.ts`) and export it.
- **Fix applied**: Moved `buildPadMap` to `src/lib/padDefaults.ts` and exported it. Removed the local copy from `useMultiFadeMode.ts`. Replaced the 3 `flatMap(...).find(...)` sites in `useGlobalHotkeys.ts` with `buildPadMap(...).get(id)`. Note: `useProjectLifecycle` had no `flatMap.find` — the review finding was inaccurate on that point. Added 4 tests to `padDefaults.test.ts`. 90/90 test files, 2021/2021 tests pass.

#### ~~[REUSE13] `{ ...padToConfig(pad), field: v }` spread bypasses typed store setters in `PadBackFace`~~ ✅ FIXED
- **File**: `src/components/composite/SceneView/PadBackFace.tsx:285-286,292,409,476,493`
- **Severity**: Low
- **Finding**: 5 call sites use `updatePad(sceneId, pad.id, { ...padToConfig(pad), <field>: v })` while `projectStore` already exposes `setPadFadeDuration`, `setPadVolume`, and `setPadFadeTarget` that do this more safely (no full-config round-trip, no risk of clobbering concurrent field changes).
- **Recommendation**: Replace the spread call sites with the typed store setters. For fields without dedicated setters, add them via the `withPad` helper suggested in REUSE11.
- **Fix applied**: The 3 `fadeDurationMs` call sites in `PadFadeControls.tsx` now use `setPadFadeDuration`; the Duration slider adds `localFadeDuration` local state (mirrors the existing `localFadeTarget` pattern) so the store is only written on commit, not on every drag tick. The `name` and `color` call sites in `PadBackFace.tsx` use two new `withPad`-based setters — `setPadName` and `setPadColor` — added to `projectStore.ts`. `padToConfig` import removed from `PadFadeControls.tsx`. 2021/2021 tests pass.

---

## Fixed Items (Confirmed in This Diff)

| ID | Description |
|----|-------------|
| SEC1 | `$AUDIO/**` removed from `fs:scope`; boot-time `grant_path_access` replay already covers user-chosen `~/Music` paths; `opener:allow-open-path` entry retained (no runtime scope API, launch-only risk) |
| SEC3 | `start_download` `download_folder_path` now validated via `validate_grant_path`; rejects relative, UNC device-namespace, and UNC share-root paths |
| SEC4 | `export_project` `dest_path`, `source_path`, and each `extra_sound_paths` entry now validated via `validate_grant_path`; rejects relative, UNC device-namespace, and UNC share-root paths |
| SEC12 | Shell `allow-spawn` / `allow-kill` removed from frontend capabilities |
| SEC13 | Static broad fs-scope grants replaced with runtime `grant_path_access` |
| SEC14 | Extensive Unicode/BIDI/control-char/UNC-root/device-namespace validation added |
| SEC15 | yt-dlp sidecar hardened: `--ignore-config`, `--no-plugins`, HTTP(S)-only scheme enforcement |
| SEC16 | Export TOCTOU on `extra_sound_paths` closed via pre-opened file handles |
| SEC17 | Download/export job HashMaps now bounded — entries removed on completion/cancellation |
| PERF8 | `saveCurrentLibrarySyncRef` added to `useAutoSave`; ref updated each render; effect closure calls `saveCurrentLibrarySyncRef.current()`; `saveCurrentLibrarySync` removed from dep array — interval no longer restarts on TanStack mutation identity changes; 1 regression test added |
| PERF9 | `EMPTY_SCENES` module-level constant hoisted in `SceneView.tsx`; selector returns stable reference when project is null; suppresses spurious re-renders on every store update |
| PERF10 | `forEachPadGain` → `forEachActivePadGain` in `stopAllPads`; only currently-playing pads are ramped; historical gain nodes no longer incur `linearRampToValueAtTime` scheduling on global stop; 1 test added |
| PERF11 | `liveVolume` subscription moved from `PadBackFace` into `PadFadeControls`; removed from `PadFadeControlsProps`; `PadBackFace` no longer re-renders at tick rate; 8 tests added in `PadFadeControls.test.tsx` |
| PERF12 | `stopAllPads` snapshots active pad IDs + voice objects before ramp; cleanup timeout uses scoped `clearPadGainsForIds`/`clearLayerGainsForIds`/`stopSpecificVoices`; `clearInactivePadGains` disconnects stale gains synchronously on same tick; 6 helpers added to `audioState.ts`, 2 tests added, 1 test updated |
| PERF7 | `_tagSetCache` WeakMap added to `resolveSounds.ts`; `tag`/`set` cases now check/populate cache before O(n) filter; key uses `JSON.stringify` (collision-safe); cross-component deduplication collapses N filters to 1 per render cycle; 12 tests added |
| PERF6 | `BackFaceLayerRow` `layerVolumes` subscription throttled to ~10Hz via `usePlaybackStore.subscribe` + `useEffect`; leading-edge 100ms throttle; immediate clear on `undefined`; sync-read on `layer.id` change; zero re-renders during steady-state playback |
| PERF2 | `seenPlayOrderLayerIds`/`seenChainLayerIds` Set allocations replaced with integer counters; pruning checks use `in` operator on `nextLayerPlayOrder`/`nextLayerChain` — saves 2 allocations/frame at 60fps |
| PERF3 | `isAnyGainChanging()` + `markGainRamp()` added to `audioState.ts`; `audioTick` short-circuits volume rebuild when no fade/ramp is in flight; `triggerAndFade` ramp routed through `rampGainTo`; 6 tests added |
| PERF-A | `audioTick` batches all tick updates into one `set()` call, skips when nothing changed |
| PERF-B | `_padBestStreamingAudio` / `_layerBestStreamingAudio` caches eliminate per-frame linear scans |
| PERF-C | `_padToLayerIds` reverse index makes `stopPadVoices` O(layers-in-pad) instead of O(all-layers) |
| PERF-D | SceneView preload guard prevents re-running on every Immer scenes replacement |
| PERF-E | `PadBackFace` gated behind delayed-unmount so its store subscriptions don't fire on front-facing pads |
| PERF-F | `PadButton` delegates progress/fade-overlay to `PadButtonProgress`/`PadButtonFadeOverlay` — outer pad no longer re-renders at 60fps |
| PERF-4 | `rotateX.set(0)`/`rotateY.set(0)` added alongside source-value snap in the `tiltEnabled` effect; spring outputs now snap immediately instead of settling over ~5 RAF frames when tilt is disabled; pulse ring CSS animation already in place (finding partially stale) |
| PERF-5 | Finding invalid — `playbackStore.updateLayerVolume` removed by ARCH7; live drag routes through `gainManager.setLayerVolume` (no Zustand write); commit routes through `projectStore.updateLayerVolume` (Immer, once per release); `layerVolumes` in `playbackStore` is tick-managed only |
| ARCH-A | Dual TanStack Query → Zustand state ownership eliminated |
| ARCH-B | `PadButton` decomposed from god component into focused sub-components |
| ARCH-C | `activeSceneId` moved from `projectStore` to `uiStore` (no circular dep) |
| ARCH2 | Audio engine no longer writes tick-managed `padVolumes` field directly — `clearPadVolumesEntry()` removed; audioTick drops stale entries naturally |
| QUAL2 | `useAddFolder.handleAddFolder` — added catch block; async errors shown via toast with error message; 2 tests added |
| ARCH5 | Boot-time library save routed through `useSaveCurrentLibrary` mutation; `onSuccess: clearDirtyFlag()` removed (now handled inside primitive); `useReconcileLibrary` save failure now surfaces a toast |
| ARCH6 | All 5 handlers wrapped in `useCallback`; `saveDialog`, `navigateDialog`, `exportDialog` and top-level context value wrapped in `useMemo`; stable `.mutate`/`.mutateAsync` refs used as deps |
| ARCH7 | `setLayerVolume` now no-ops for inactive layers; `updateLayerVolume` removed from `playbackStore`; `gainManager.ts` no longer imports `playbackStore`; 3 tests updated |
| PERF1 | `useMultiFadeSideEffects` extracted; SceneView no longer subscribes to multi-fade state; zero-subscription hotkeys + Zustand subscribe for auto-cancel |
| QUAL1 | `mod+shift+n` hotkey now navigates to new pad's page and plays flip animation; all page hotkeys centralized in `useGlobalHotkeys` |
| QUAL3 | `DownloadDialog.handleSubmit` — `await startDownload` wrapped in `try/catch`; `catch` returns early since `onError` already shows a toast |
| QUAL4 | 5 empty `catch {}` blocks across 3 files now capture `err`, call `console.error`, and pass `description` to `toast.error`; 5 tests added/updated |
| REUSE1 | `nameFromFilename` consolidated into `utils.ts`; removed from 3 files; 6 tests added |
| REUSE4 | `evictSoundCaches`/`evictSoundCachesMany` extracted to `cacheUtils.ts`; all 9 call sites migrated across 6 files; 5 test mock declarations updated |
| REUSE5 | `PadPercentSlider` and `PadDurationSlider` collapsed into `PadLabeledSlider`; both old files deleted; `PadFadeControls` updated; `PadButtonFadeOverlay` intentionally left inline (different layout/styling) |
| REUSE8 | `classifyPickedAudioFile` + `findDuplicateByPath` extracted to `src/lib/fileResolve.ts`; both dialog handlers use shared helpers; `AudioFileClassification` discriminated union eliminates `!` assertions; 8 tests added |
| REUSE9 | `addGlobalFolderAndReconcile` extracted to `library.reconcile.ts`; `useAddFolder` and `ResolveMissingFolderDialog` (add-parent path) both migrated; `setSounds` callback avoids cross-module `LibraryData` import; 4 tests added |
| REUSE10 | `addToSet`/`removeFromSet` helper closures replace 8 copy-pasted Set action bodies in `playbackStore`; `SetField` union is single maintenance point; early-exit reference-equality optimization preserved; 16 tests added (per-group + cross-field isolation) |
| SEC6 | `stderr.contains("ERROR")` replaced with `parse_stderr_error` helper (starts_with `"ERROR:"` after trim, 256-byte cap); no mid-stream `failed` emission; stderr error threaded into non-zero `Terminated` path |
| SEC7 | `symlink_metadata` + `is_file()` re-check added immediately before `writer.start_file` in the main WalkDir loop of `export_project`; closes TOCTOU window between cached readdir metadata and `File::open`; check placed before `start_file` to prevent zero-byte ghost entries on detected races |
| SEC8 | `isAbsolutePath` helper extracted in `schemas.ts`; `.refine(isAbsolutePath)` added to `SoundSchema.filePath` and `GlobalFolderSchema.path`; 5 tests added/updated in `schemas.test.ts` |
| SEC9 | `loadDownloadHistory` bare `catch {}` replaced with typed recovery: `SyntaxError`/`ZodError` → `backupCorruptFile` + write fresh `[]` + `onCorruption` callback; I/O errors rethrow; `useBootLoader` passes `onCorruption: toast.warning`; 9 tests added in `downloads.test.ts` |
| SEC10 | `DownloadJobSchema.url` changed from `z.string()` to `z.string().url().refine(http/https only)`; 5 tests added to `schemas.test.ts` |
| SEC11 | Traversal + absolute-path refines added to `DownloadJobSchema.outputPath` and `DownloadProgressEventSchema.outputPath`; `SoundSchema.safeParse()` guard added before `updateLibrary` push in `ytdlp.queries.ts`; 10 tests added to `schemas.test.ts` |
| ARCH8 | `projectSoundReconcile.ts` + `reconcileProject.ts` merged into `project.reconcile.ts`; `domain.reconcile.ts` convention adopted; `ProjectReconcileResult` rename resolves type-name collision with `library.reconcile.ts`; 6 import sites and 2 hook test `vi.mock` paths updated; 1952/1952 tests pass |
| ARCH9 | `loadSessionId: number` added to `projectStore` (incremented only in `loadProject`, not `markAsPermanent`); both dedup refs in `useProjectLifecycle` keyed on `loadSessionId` instead of `folderPath`; dead-code `?? (name + "\|" + lastSaved)` fallback eliminated; missing-sounds toast no longer fires twice after Save As |
| ARCH12 | `useDownloadEventListener` + `buildJobUpdate` moved to `src/hooks/useDownloadEventListener.ts`; `ytdlp.queries.ts` now contains only TanStack Query bindings; listener tests split into `src/hooks/useDownloadEventListener.test.ts`; import updated in `MainPage.tsx` and mock path in `SoundList.test.tsx`; 1966/1966 tests pass |
| ARCH13 | `usePlaybackStore` import + subscription removed from `audioContext.ts`; `pendingVolume` queue closes initialization gap; `applyMasterVolume(volumePct)` exported; `audioTick.ts` owns the reactive bridge via `_stopMasterVolumeSync = subscribe(masterVolume, applyMasterVolume)`; `startAudioTick()` sync removed (redundant after pending-volume fix); `audioContext.test.ts` rewritten; 1979/1979 tests pass |
| ARCH15 | `useSaveProject`/`useSaveCurrentLibrary` mutations removed from `useAutoSave`; replaced with direct `saveProject` + `saveCurrentLibraryAndClearDirty` calls; plain boolean refs track pending state; `clearDirtyFlag` called in `.then()`, errors routed to shared debounce in `.catch()`, pending reset in `.finally()`; three TanStack-workaround refs eliminated; test file rewritten to mock raw save functions; 1990/1990 tests pass |
| QUAL8 | `LAYER_DIALOG_SCHEMA` and `LAYER_DIALOG_RESOLVER` hoisted to module scope in `LayerConfigDialog.tsx`; local `layerDialogSchema` variable and inline `zodResolver()` call removed; 2000/2000 tests pass |
| QUAL10 | `deleteScene` `!` assertion + `scenes.length > 0` ternary replaced with `const candidate = scenes[deletedIdx] ?? scenes[deletedIdx - 1] ?? scenes[0]; const next = candidate?.id ?? null;` — eliminates the non-null assertion entirely; `?? scenes[0]` is defensive against a stale index; all 81 existing tests pass; TypeScript clean |
| REUSE3 | `clampGain01(value, fallback = 0)` exported from `gainManager.ts` (renamed from private `clampGain`); `layerTrigger.ts` (×2) and `usePadGesture.ts` (×1) open-coded clamps replaced; `audioState.ts:612` left inline (circular dep + intentional `fallback = 1`); 2007/2007 tests pass |
