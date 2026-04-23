# Code Review Report: v1.5.4...HEAD

**Reviewed by:** security · performance · architecture · code quality · reuse
**Files reviewed:** 155 across ~100 commits
**Date:** 2026-04-23

---

## High (2)

---

**[PERF-1] Per-frame array allocation in audioTick layerPlayOrder/layerChain even when values are stable**
`src/lib/audio/audioTick.ts:130–151`

Every RAF tick calls `playOrder.map(s => s.id)` and `chain.map(s => s.id)` unconditionally for every active layer — allocating fresh arrays before diffing against the previous snapshot. On a 50-sound chain this is ~100 string allocations/frame (6,000/sec at 60fps) that are immediately discarded when nothing changed. The source `Sound[]` arrays in `layerPlayOrderMap`/`layerChainQueue` only change on explicit writes.

**Fix:** Before `playOrder.map`, check if the source reference equals the one from last tick. If it matches, reuse the previous snapshot and skip allocation. Track the source `Sound[]` reference per layer between ticks.

---

**[PERF-2] O(scenes × pads) flatMap + linear find on every multi-fade action**
`src/hooks/useMultiFadeMode.ts:14–21, 69–79`

`executeMultiFadeNow`, `enter`, and `togglePad` each call `scenes.flatMap(s => s.pads)` then `.find(p => p.id === padId)` inside a loop over `selectedPads`. With 50 pads and 20 selected, that's 1,000 linear scans per fade execution.

**Fix:** Build `Map<string, Pad>` once from the flatMap result, then use `.get(padId)` inside the loop.

---

## Medium (22)

---

### Security

**[SEC-1] TOCTOU: symlink check on extra_sound_paths happens before async File::open**
`src-tauri/src/commands.rs:459–577`

`export_project` validates each path with `symlink_metadata` + `is_file()` synchronously, but the actual `File::open` happens inside `tauri::async_runtime::spawn` after the zip file is already created. An attacker can replace a validated file with a symlink to a sensitive file (e.g., `~/.ssh/id_rsa`) during this window — `File::open` follows symlinks transparently, embedding the target's contents in the export zip. The inline comment acknowledges this attack vector, but the defense has a race window.

**Fix:** Open each file during validation and keep the `File` handles in a `Vec<File>` to pass into the async task. Alternatively, use `O_NOFOLLOW` / `FILE_FLAG_OPEN_REPARSE_POINT` at open time.

---

**[SEC-2] yt-dlp sidecar inherits user config — potential RCE via hostile config file**
`src-tauri/src/commands.rs:260–273`

yt-dlp is invoked without `--ignore-config`, so it reads user config from `%APPDATA%/yt-dlp/config` (Windows) or `~/.config/yt-dlp/config`. yt-dlp supports `--exec "shell command"`, which executes after every download. A config file containing `--exec "powershell -e ..."` would execute arbitrary commands the first time a user triggers a download. An attacker with prior write access to the profile config dir (a weaker precondition than full user compromise) achieves code execution.

**Fix:** Add `--ignore-config` (and `--no-plugins`) to the `start_download` args array.

---

**[SEC-3] walkdir follows symlinks for the root `source_path` entry**
`src-tauri/src/commands.rs:507–556`

`WalkDir::new(&source_path)` defaults to `follow_links = false` for *descendants*, but if `source_path` itself is a symlink, walkdir walks the link target. The code checks `entry.file_type().is_symlink()` only for descendant entries — not the root. A crafted project folder whose top-level entry is a symlink to `/etc` or `%SystemRoot%` would archive the entire target tree.

**Fix:** Check `symlink_metadata(&source_path)` before walking and reject the request if the root is a symlink. Optionally also `fs::canonicalize` and verify the canonical path matches the user's selection.

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

**[ARCH-2] Store-reading helper placed in TanStack Query module breaks layer boundary**
`src/lib/library.queries.ts:35–38`

`getCurrentLibraryPayload()` is a plain Zustand-reader (no React Query involved) exported from the `.queries` module. `useBootLoader.ts` imports it while also calling `saveGlobalLibrary` directly (bypassing the mutation hook). This inverts the documented boundary — the `.queries` module should only contain React Query bindings. Other callers will reach into `library.queries.ts` for this helper and drag query-layer imports into boot/reconcile flows.

**Fix:** Move `getCurrentLibraryPayload` to `src/state/libraryStore.ts` or `src/lib/library.ts`.

---

**[ARCH-3] Boot flow bypasses the single save-library abstraction, duplicating the dirty-flag contract**
`src/hooks/useBootLoader.ts:112–118`

`useBootLoader` calls `saveGlobalLibrary(getCurrentLibraryPayload())` directly then manually calls `clearDirtyFlag()`. Every other caller uses `useSaveCurrentLibrary` whose `onSuccess` already clears the dirty flag. Two places now encode the "after a successful library save, clear the dirty flag" contract — a future change (e.g., adding a "last saved at" timestamp) must be applied to both or they'll silently diverge.

**Fix:** Run the boot-time save through the shared mutation hook, or extract a `saveCurrentLibraryAndClearDirty()` helper used by all callers.

---

### Code Quality

**[QUAL-1] Unsafe `createDefaultLayer() as Layer` type cast**
`src/hooks/useGlobalHotkeys.ts:155`

`createDefaultLayer()` returns `LayerConfigForm`, not `Layer`. An `as Layer` cast coerces it into `PadConfig.layers`. `createDefaultStoreLayer()` already exists in `src/lib/padDefaults.ts` returning the correct type.

**Fix:** Replace `createDefaultLayer() as Layer` with `createDefaultStoreLayer()`.

---

**[QUAL-2] Same form/schema type confusion in PadBackFace new-layer insertion**
`src/components/composite/SceneView/PadBackFace.tsx:35, 285`

`createDefaultLayer()` (returns `LayerConfigForm`) is inserted into `pad.layers: Layer[]` without an explicit cast — TypeScript allows it due to structural compatibility today, but if a form-only field is ever added, this silently produces malformed store data.

**Fix:** Use `createDefaultStoreLayer()` in `handleAddLayer()`.

---

**[QUAL-3] `padToConfig` helper duplicated between PadBackFace and LayerConfigDialog**
`src/components/composite/SceneView/PadBackFace.tsx:41–53`
`src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx:37–49`

Identical helper function defined in two sibling files. Any change to `PadConfig` shape or defaults must be applied in both places or the dialog and back-face will drift.

**Fix:** Export a shared `padToConfig` from `src/lib/padDefaults.ts` or `src/lib/padHelpers.ts` and import it in both components.

---

**[QUAL-4] Magic number `0.016` duplicated three times in gainManager**
`src/lib/audio/gainManager.ts:16, 46, 62`

The click-free ramp duration `0.016` (≈ one 60Hz frame in seconds) appears in three separate `linearRampToValueAtTime` calls. `audioVoice.ts` already names a similar constant `STOP_RAMP_S = 0.025`.

**Fix:** Introduce `const CLICK_FREE_RAMP_S = 0.016` at the top of `gainManager.ts` (or share it with `audioVoice.ts`).

---

**[QUAL-5] Dual-ownership of `fadingOutPadIds` creates synchronization hazard** *(cross-ref: ARCH-5)*
`src/lib/audio/fadeMixer.ts:68–75`

Every call to `addFadingOutPad`/`removeFadingOutPad` must be paired with a matching call to `usePlaybackStore.getState().addFadingOutPad`/`removeFadingOutPad`. Six code paths must remember both sides of this pair. Any missed call causes the UI to desync from audio engine state with no type-system guard.

**Fix:** Provide a wrapper `markPadFadingOut()` / `unmarkPadFadingOut()` that updates both stores in a single call. See also ARCH-5 for a deeper architectural fix.

---

**[QUAL-6] Unreachable cleanup branch in `fadePad` else-block**
`src/lib/audio/fadeMixer.ts:102–112`

`fadingDown = toVolume < fromVolume`, so the `else` branch means `toVolume >= fromVolume`. The `if (toVolume === 0)` check inside that else branch can only be true if `fromVolume <= 0` — a degenerate 0→0 fade that cannot occur in normal use. The code reads as intentional but is effectively dead.

**Fix:** Remove the unreachable block or add an assertion/comment making the degenerate-case assumption explicit.

---

### Reuse

**[REUSE-1] `ACTIVE_STATUSES` constant not applied in `loadDownloadHistory`**
`src/lib/downloads.ts:24`

`loadDownloadHistory` uses an inline triple-OR (`job.status === "queued" || job.status === "downloading" || job.status === "processing"`) even though `ACTIVE_STATUSES` was introduced in this PR specifically to centralize this check. `DownloadItem`, `DownloadManager`, and `DownloadStatusButton` were migrated; this site was missed.

**Fix:** Import `ACTIVE_STATUSES` from `downloadStore` and replace the inline check with `ACTIVE_STATUSES.has(job.status)`.

---

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

**[REUSE-4] `checkMissingStatus + setMissingState` block reinvents `refreshMissingState`**
`src/components/composite/SidePanel/SoundList.tsx:171–185`
`src/components/composite/SidePanel/FoldersPanel.tsx:193–205`

Both files manually call `checkMissingStatus(folders, sounds)` then spread the four result Sets into `setMissingState(...)`. This logic is already encapsulated in `refreshMissingState()` in `src/lib/library.reconcile.ts:322–336`.

**Fix:** Replace both inline blocks with `await refreshMissingState(updatedFolders)`.

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

**Total findings: 47** (High: 2, Medium: 22, Low: 23)

| Dimension | High | Medium | Low | Total |
|-----------|------|--------|-----|-------|
| Security | 0 | 3 | 3 | 6 |
| Performance | 2 | 3 | 5 | 10 |
| Architecture | 0 | 3 | 4 | 7 |
| Code Quality | 0 | 6 | 9 | 15 |
| Reuse | 0 | 7 | 2 | 9 |

**Priority action items:**
1. **SEC-2** — add `--ignore-config` to yt-dlp invocation (low effort, high impact)
2. **SEC-1 / SEC-3** — close the symlink TOCTOU windows in `export_project`
3. **PERF-1 / PERF-2** — audioTick per-frame allocations and multi-fade O(n²) scans
4. **ARCH-1** — cross-store coupling in `projectStore` risks invariant drift as scenes grow
5. **REUSE-7** — corrupt-JSON recovery duplication is the most likely place future bugs diverge
