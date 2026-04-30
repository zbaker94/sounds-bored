# Code Review Report: v1.5.4...HEAD

**Reviewed by:** security · performance · architecture · code quality · reuse
**Files reviewed:** 155 across ~100 commits
**Date:** 2026-04-23

---

## Medium (9)

---

### Performance

**[PERF-3] Hidden PadBackFace RAF subscriptions on every visible pad**
`src/components/composite/SceneView/PadBackFace.tsx:71–73`

`PadButton` mounts `PadBackFace` unconditionally inside the flip container. Each `BackFaceLayerRow` subscribes to `layerVolumes` and `activeLayerIds` — both written by the RAF tick on every frame during playback. Every non-visible back face (for all pads not in edit mode) pays these RAF subscription costs even though they render nothing to screen.

**Fix:** Gate the `PadBackFace` mount or its store subscriptions behind `editingPadId === pad.id` so non-editing pads never subscribe to tick-churned fields.

---

**[PERF-4] Unconditional AnimatePresence + continuous spring machinery on all visible pads**
`src/components/composite/SceneView/PadButton.tsx:223–232, 307–312`

Every visible pad runs a Motion `animate={{ opacity: [0.3, 0.8, 0.3] }}` pulse-ring loop while playing, plus `useSpring`/`useTransform` for tilt — allocated unconditionally even when `tiltEnabled` is false (line 215 clamps the displayed value to 0 but the spring still runs). 12 pads on screen = 12 opacity keyframe loops + 24 RAF-driven springs running in parallel.

**Fix:** Conditionally mount the tilt child component (only when `tiltEnabled`) and cancel `handleMouseMove` writes when not tilt-enabled. Replace the Motion opacity keyframe loop with a CSS `@keyframes` class for zero-JS-overhead animation.

---

**[PERF-5] updateLayerVolume spreads entire layerVolumes record on every call**
`src/state/playbackStore.ts:202–203`

`updateLayerVolume: (layerId, volume) => set(s => ({ layerVolumes: { ...s.layerVolumes, [layerId]: volume } }))` spreads the full record on every slider drag (~60×/sec). This is acceptable now but a structural risk if `layerVolumes` grows large.

**Fix:** Use Immer's `produce` to apply a targeted mutation, or accept the current approach with a comment noting the scale assumption.

---

### Architecture

**[ARCH-1] Cross-store import introduces hidden coupling and non-atomic state transitions**
`src/state/projectStore.ts:10–16`

`projectStore` now imports and calls `useUiStore.getState().setActiveSceneId(...)` from `loadProject`, `clearProject`, `addScene`, and `deleteScene`. This breaks store independence: Immer's `set` publishes the project mutation, then a second Zustand `set` fires on `uiStore` — subscribers can observe intermediate inconsistent state (new/cleared scenes, stale `activeSceneId`). The membership check that previously validated `activeSceneId` against `project.scenes` was removed; `setActiveSceneId` is now an unchecked setter.

**Fix:** (a) Keep `activeSceneId` in `projectStore` so scene transitions are atomic, or (b) re-add the scene-existence guard to `setActiveSceneId`, or (c) create a dedicated orchestration helper (e.g., `src/lib/sceneActions.ts`) that owns both calls so the coupling is explicit and contained.

---

### Code Quality

**[QUAL-5] Dual-ownership of `fadingOutPadIds` creates synchronization hazard** *(cross-ref: ARCH-5)*
`src/lib/audio/fadeMixer.ts:68–75`

Every call to `addFadingOutPad`/`removeFadingOutPad` must be paired with a matching call to `usePlaybackStore.getState().addFadingOutPad`/`removeFadingOutPad`. Six code paths must remember both sides of this pair. Any missed call causes the UI to desync from audio engine state with no type-system guard.

**Fix:** Provide a wrapper `markPadFadingOut()` / `unmarkPadFadingOut()` that updates both stores in a single call. See also ARCH-5 for a deeper architectural fix.

---

### Reuse

**[REUSE-2] Four near-identical slider+label blocks across PadBackFace and siblings**
`src/components/composite/SceneView/PadBackFace.tsx:208–217, 397–413, 421–431, 436–442`
Also: `PadButtonFadeOverlay.tsx:58–107`, `PadButton.tsx:318–327`

~6 copies of the pattern: percent label row with `tabular-nums` + `<Slider compact tooltipLabel={(v) => \`${v}%\`}>` + local drag state + `onValueCommit` that persists to the store. The popover copy in `PadButton.tsx` already lacks the percent label present in `PadBackFace`.

**Fix:** Extract `PadPercentSlider` (volume/target, 0–100 scale, percent tooltip, commit callback) and `PadDurationSlider` (ms→s tooltip) into the `SceneView/` folder. Both `PadBackFace` and `PadButtonFadeOverlay` consume them.

---

**[REUSE-3] `createDefaultLayer` and `createDefaultStoreLayer` are byte-for-byte identical at runtime**
`src/lib/padDefaults.ts:3–25`

Both functions return the same object; the only difference is the return type annotation. When one changes, the other must be manually kept in sync.

**Fix:** Have one delegate to the other: `export function createDefaultStoreLayer(): Layer { return createDefaultLayer() as Layer; }`. (Also see QUAL-1 and QUAL-2 — the name divergence is partly responsible for those call-site bugs.)

---

**[REUSE-5] `basename` path extraction duplicated 8+ times across the codebase**
`src/components/composite/DownloadManager/DownloadItem.tsx:22–27`, `src/lib/export.ts:37–39`, `src/hooks/useAddFolder.ts:43`, `src/components/modals/SettingsDialog.tsx:97`, `src/components/modals/ResolveMissingDialog.tsx:163`, `src/components/modals/ResolveMissingFolderDialog.tsx:469`, `src/lib/library.reconcile.ts:114`, `src/lib/utils.ts:47`

The regex `.split(/[\\/]/).pop() ?? fallback` to extract a filename appears at 8+ call sites. `export.ts` has a private `extractBasename`; `DownloadItem.tsx` has its own `getDisplayName`. `utils.ts` already uses the same regex for `truncatePath`.

**Fix:** Export `basename(path: string, fallback?: string): string` from `src/lib/utils.ts` and replace all 8 call sites. Delete the private duplicates.

---

**[REUSE-7] Corrupt-JSON recovery block duplicated verbatim between `history.ts` and `library.ts`**
`src/lib/history.ts:29–54`, `src/lib/library.ts:32–82`

Both `loadProjectHistory` and `loadGlobalLibrary` implement the same try/rename-to-`.corrupt.json`/reset/toast/return-defaults recovery pattern, including the same comment about the single-backup-slot race. `atomicWriteJson` already lives in `fsUtils.ts` — the next natural layer is a shared recovery helper.

**Fix:** Add `backupCorruptFile(path)` to `fsUtils.ts`, or go further with `loadJsonWithRecovery<T>(path, parse, defaults, onCorruption)` that encapsulates the entire try/rename/reset/toast flow.

---

## Low (23)

| # | Dim | Location | Title |
|---|-----|----------|-------|
| SEC-4 | Security | `commands.rs:244` | `download_folder_path` interpolated into yt-dlp template without `%` rejection |
| SEC-5 | Security | `capabilities/default.json:50` | `mcp-bridge:default` granted in release builds; plugin only registered in debug |
| SEC-6 | Security | `src/lib/scope.ts:48–52` | `grantParentAccess` grants recursive directory scope — should be file-level grants |
| PERF-6 | Performance | `audioTick.ts:223–258` | `volumesEqual`/`progressEqual` always allocate `Object.keys` arrays even when both records are empty |
| PERF-7 | Performance | `PadButton.tsx:127–128` | `useSpring` + `useTransform` allocated unconditionally even when `tiltEnabled` is false |
| PERF-8 | Performance | `PadButtonProgress.tsx:33–41` | `layerProgress` selector iterates all layers (not just active) per playing pad per tick |
| PERF-9 | Performance | `audioState.ts:305–307` | `getActiveLayerIdSet()` allocates a new `Set` on every call — not cached by `layerVoiceVersion` |
| PERF-10 | Performance | `streamingCache.ts:47–52` | `preloadStreamingAudio` fires N synchronous `new Audio()` + `.load()` calls in one `useEffect` tick |
| ARCH-4 | Architecture | `src/state/uiStore.ts:70–80` | `activeSceneId` invariant (must match a real scene) no longer enforced — only by convention |
| ARCH-5 | Architecture | `playbackStore.ts:60–81` | `fadingOutPadIds`/`fadingPadIds`/`reversingPadIds` duplicate audio engine state that could be published via `audioTick` |
| ARCH-6 | Architecture | `downloadStore.ts:301` | `loadJobs` full-replace can silently clobber sidecar events that arrived during boot window |
| ARCH-7 | Architecture | `audioState.ts:16–17` | `clearAllAudioState` imports and calls external cache modules — breaks the pure-state-container design |
| QUAL-7 | Quality | `LayerConfigDialog.tsx:83–99, 107–123` | `defaultValues` object literal duplicated between `useForm` and `reset()` — must be kept in sync manually |
| QUAL-8 | Quality | `LayerConfigDialog.tsx:88, 112` | Two identical `as LayerConfigForm["selection"]` casts — centralize in a `layerToFormValues()` helper |
| QUAL-9 | Quality | `PadBackFace.tsx` (327 lines, 14 hooks) | God component — mixes name/color editing, transport, sliders, layer list, overlay, delete confirmation |
| QUAL-10 | Quality | `useBootLoader.ts:30–62` | Three concurrent loads with inconsistent failure semantics — `setLoaded(true)` on error conflates "attempted" with "succeeded" |
| QUAL-11 | Quality | `useAutoSave.ts:101` | `saveProjectMutation.mutate` called from a stale closure while `isPending` is read via ref — inconsistent ref/closure split |
| QUAL-12 | Quality | `ResolveMissingFolderDialog.tsx:174, 201, 333, 354` | Silent `catch {}` blocks swallow error details; real failure modes indistinguishable to users and devs |
| QUAL-13 | Quality | `ResolveMissingDialog.tsx:136, 155` | Same silent-catch pattern |
| QUAL-14 | Quality | `useBootLoader.ts:46–48, 55–57, 61` | Error branches log nothing — boot failures leave no debugging breadcrumbs in devtools |
| QUAL-15 | Quality | `PadBackFace.tsx:86–102` | Inline IIFE for `selectionSummary` — extract to a named `summarizeLayerSelection()` for readability and testability |
| REUSE-8 | Reuse | `useResolveSoundQueue.ts`, `useResolveFolderQueue.ts` | Thin wrappers add no logic — only rename fields. Consider deleting and using `useResolveQueue<T>` directly |
| REUSE-9 | Reuse | `DownloadStatusButton.tsx:15–25`, `DownloadManager.tsx:11–14` | Both components independently filter active jobs — extract `selectActiveJobs` selector to `downloadStore.ts` |

---

## Summary

**Total findings: 32** (High: 0, Medium: 9, Low: 23)

| Dimension | High | Medium | Low | Total |
|-----------|------|--------|-----|-------|
| Security | 0 | 0 | 3 | 3 |
| Performance | 0 | 3 | 5 | 8 |
| Architecture | 0 | 1 | 4 | 5 |
| Code Quality | 0 | 1 | 9 | 10 |
| Reuse | 0 | 4 | 2 | 6 |

**Priority action items:**
1. **ARCH-1** — cross-store coupling in `projectStore` risks invariant drift as scenes grow
2. **REUSE-7** — corrupt-JSON recovery duplication is the most likely place future bugs diverge
3. **REUSE-2** — percent-slider pattern has ~6 near-identical copies accumulating drift
4. **QUAL-5** — `fadingOutPadIds` dual-ownership has no type-system guard against missed paired calls
