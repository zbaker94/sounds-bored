# Changelog

## Current Changes
- Corrupted data files (sound library, project history, download history) are now recovered more reliably and consistently, with cleaner fallback behavior if a file can't be parsed.
- Fixed a bug where selecting a tag or sound set with the id `__create__` would incorrectly trigger the "create new item" flow instead of selecting it
- Tag and set ids starting with `__` are now rejected at load time, preventing reserved-prefix collisions with internal UI sentinels
- Fixed a bug where the "missing sounds" warning notification would appear twice after using Save As to save a project to a new location.
- Consolidated two internal sound-reconciliation modules (`projectSoundReconcile.ts` and `reconcileProject.ts`) into a single, consistently-named file (`project.reconcile.ts`), reducing internal complexity with no change to app behavior.
- Fixed a bug where triggering a pad immediately after pressing Stop All could cause the newly triggered sound to be silenced mid-playback.
- Stale audio connections from previously stopped pads are now cleaned up instantly rather than after a delay, reducing the window for audio glitches during rapid stop-and-retrigger sequences.
- Improved rendering performance during pad fades — only the fade controls section now updates at animation rate, reducing unnecessary UI work elsewhere on the pad.
- Stopping all pads at once is now more efficient — only currently-playing pads have their audio ramped down, reducing unnecessary work on pads that have already stopped naturally during a session.
- Fixed a performance issue where the scene view was unnecessarily re-rendering on every state update when no project was loaded.
- Fixed auto-save interval restarting unexpectedly when the library save function changed identity after a mutation state change — saves now fire on schedule without being reset mid-countdown
- Improved performance when scrolling or editing the sound library: tag and set sound selections are now cached and shared across pads, eliminating redundant work per render cycle
- Fixed a performance issue where layer volume sliders were re-rendering at 60fps during audio fades; updates are now throttled to ~10Hz, reducing unnecessary UI work during playback
- Fixed a memory leak where event listeners on reused audio elements could accumulate over long sessions when sounds were stopped before metadata finished loading
- Fixed a performance issue where idle pad buttons were allocating objects and iterating layers on every animation frame (~60fps), even when not playing — now skips all work for non-playing pads
- Reduced CPU usage during stable audio playback — the audio engine no longer rebuilds volume state every frame (60fps) when no fades or gain changes are in flight.
- Fade-in behavior (`triggerAndFade`) now consistently routes through the shared gain ramp utility, fixing a gap where ramp activity could be missed by the audio tick's change detection.
- Reduced memory allocations in the audio engine's per-frame tick loop, lowering garbage collection pressure during playback at 60fps
- Downloaded audio files are now validated before being added to your sound library, preventing corrupted or tampered download data from affecting your project.
- Path traversal attacks via manipulated download output paths are now blocked at the schema level.
- Download URLs are now validated to only accept `http://` and `https://` protocols, blocking unsafe schemes like `ftp://` or `data:` URIs from being stored in your download history.
- If your download history file becomes corrupted, the app now automatically backs it up and resets it instead of silently failing — you'll see a warning notification when this happens.
- Fixed a security issue where tampered project files could reference relative file paths to access files outside the project folder
- Sound file paths and global folder paths are now required to be absolute, blocking a potential path traversal attack vector
- Fixed a security vulnerability (SEC7) where a malicious symlink swapped into a project folder between file scanning and file opening could leak out-of-scope files during project export.
- Fixed a bug where video titles or metadata containing the word "ERROR" could incorrectly trigger a download failure notification mid-stream
- Download error details now accurately reflect the actual yt-dlp error message when a download fails, rather than always showing a generic exit code message
- Fixed a security vulnerability where malformed job IDs could exhaust memory or inject control characters into event payloads — job IDs are now strictly validated (alphanumeric, hyphens, underscores only; max 64 characters)
- Fixed a bug where submitting a duplicate job ID could silently orphan an in-progress download or export, breaking its cancel button
- Hardened path validation for download and export operations: file paths must now be absolute and are rejected if they contain traversal segments, UNC device-namespace paths, or control characters — reducing the risk of malicious or misconfigured paths redirecting files outside intended folders.
- **Tightened file system access**: The app no longer requests broad read access to your home directory, Music, Documents, Downloads, or Desktop folders at startup — access is now granted only for folders you explicitly select.
- **Hardened folder/file pickers**: Dialog selection and folder access are now handled atomically in the backend, so the app cannot be tricked into accessing paths you didn't choose through the native picker.
- **Reduced static permissions**: Removed the standing `$AUDIO/**` file system scope grant; audio file access is now granted dynamically when you add a folder or import sounds.
- Tightened app file access permissions: the app no longer has broad read access to your home directory, music library, documents, downloads, and desktop at startup — access is now granted only to folders you explicitly choose.
- Fixed a security issue where a compromised renderer could have read arbitrary files (SSH keys, browser data, shell history) via the asset protocol; access is now scoped to app data directories and user-selected folders only.
- Internal audio playback state management refactored to eliminate code duplication, with 16 new tests added to verify correctness and stability.
- Duplicate logic for adding a global sound folder and syncing the library has been consolidated — the app now uses a single shared implementation, reducing the chance of inconsistencies between the two places this action could be triggered.
- Fixed a bug where the "Resolve Missing File" dialog could crash or behave unexpectedly when no sound was selected before picking a replacement file
- Improved reliability of duplicate-file detection when locating missing sounds — the app now correctly identifies when a picked file is already used by another sound in your library
- Partial tags (applied to some but not all selected sounds) now display correctly alongside full tags in the Add Tags dialog
- Tags with partial selection now show a minus-sign indicator in the dropdown, making mixed-state selections easier to identify
- The tag picker in the pad configuration drawer now uses the same shared component as the rest of the app, ensuring consistent behavior and appearance across all tag selection UI.
- Tag dropdown items continue to display per-tag sound counts alongside each tag name.
- Refactored audio cache cleanup into shared utility functions, reducing the risk of future memory leaks when removing sounds
- Consolidated duplicate slider components into a single reusable `PadLabeledSlider`, simplifying internal code without any change to slider behavior
- Internal audio cache cleanup has been refactored for reliability — removing sounds from your library now clears all cached audio data more consistently.
- Audio errors that previously failed silently when triggering pads now surface as proper error notifications.
- Playback errors now show as user-visible toast notifications instead of being silently swallowed — this affects all pad interactions (tap, hold, drag, and back-face controls)
- Error notifications now include specific error details (e.g., "permission denied", "disk full") instead of generic messages when folder operations fail — affects opening folders in file explorer, deleting folders, and removing missing sounds/folders.
- Fixed an internal volume scale inconsistency where pad volume and fade target were stored differently from all other volume fields; existing projects are automatically migrated to the new format (v1.4.0) on load with no change to playback behavior.
- Fixed a bug where a failed download could leave the Download Dialog in a broken state — it now stays open with your input preserved so you can retry
- Fixed `mod+shift+n` hotkey so adding a new pad now correctly navigates to the new pad's page and plays the flip animation
- Keyboard shortcuts `shift+left` and `shift+right` for paging through pads are now centralized alongside all other global hotkeys
- Fixed `mod+shift+n` hotkey to automatically navigate to the new pad's page and play the flip animation when adding a pad to a full grid
- Page navigation hotkeys (`shift+left`, `shift+right`) are now centralized and consistent across the app
- Fixed a bug where `Shift+Left` / `Shift+Right` pad-grid page navigation could jump to the wrong page if the stored page index was out of range (e.g. after pads were deleted).
- Fixed the "new pad" keyboard shortcut to no longer trigger unintended browser default behavior.
- Added **Shift+Left** and **Shift+Right** keyboard shortcuts to navigate between pages of the pad grid in the active scene (wraps around).
- When adding a new pad with **Mod+Shift+N**, the view now automatically jumps to the page containing the newly created pad before opening it for editing.
- Each scene now remembers its current pad grid page, so navigating between scenes preserves your place in the pad list.
- Improved UI performance during multi-fade pad selection — the scene view no longer re-renders on every pad toggle, resulting in smoother interaction.
- Removed a redundant audio engine write path: inactive layer volumes are no longer written to the playback store during drag gestures; the audio tick loop is now the sole owner of that state.
- Volume slider adjustments now only affect the live audio gain node when a layer is actively playing; idle layers are unaffected until next playback.
- Internal audio engine cleanup: removed a redundant playback-store write path from the volume control logic, reducing unnecessary state updates.
- Improved performance: the pad grid (SceneView) no longer re-renders when selecting pads during multi-fade mode
- Fixed a dual-write bug where volume changes could conflict between the drag gesture and the audio tick loop
- Reduced unnecessary re-renders in the project actions context by properly memoizing handlers and dialog state
- Sound library save errors during project load now show a user-facing error toast instead of failing silently.
- Fixed unnecessary re-renders across the app — components using project action context now only update when the specific actions they rely on change, not on every state update.
- Improved reliability of sound library saving — all save operations now share a single code path, reducing the risk of inconsistent behavior after future updates.
- Error handling for library saves during app startup is now consistent with saves triggered during normal use.
- Internal code refactoring only — no user-facing features or behavior changed.
- Added ESLint enforcement to prevent circular dependencies between state stores, blocking peripheral stores (e.g. `uiStore`) from importing domain stores (`projectStore`, `libraryStore`, `playbackStore`)
- Lint check now runs automatically on every commit via the pre-commit hook
- Improved internal code quality by consolidating duplicate filename-to-display-name logic into a single shared utility, reducing risk of inconsistent sound naming behavior across the app.
- When adding a sound folder fails (e.g. disk full, permission error), an error message is now shown instead of the operation silently failing with no feedback.
- Fixed a potential audio state race condition that could cause inconsistent volume bar display when pads stop playing.
- Internal audio engine cleanup is now more reliable — stale volume entries are cleared automatically each animation frame rather than through ad-hoc synchronous writes.
- Fixed a bug where switching or deleting scenes could briefly leave the active scene tab pointing to a non-existent scene, causing inconsistent UI state.
- Fixed a security issue where a malicious yt-dlp config file containing shell commands could execute arbitrary code during downloads; the bundled yt-dlp now runs in isolated mode.
- Fixed a security vulnerability in project export where a symlink could trick the app into embedding sensitive files from outside the project folder.
- Improved performance: pad controls and store subscriptions now unmount when a pad is not in edit mode, reducing CPU usage during playback.
- Improved performance: the playing-pad pulse ring animation now runs entirely in CSS with no JavaScript overhead, and audio tick per-frame memory allocations are eliminated when sound order is unchanged.
- Fixed a race condition where download events arriving at startup could be silently lost when boot-time history loaded after sidecar events.
- Internal code review documentation added covering security, performance, and quality findings — no user-facing changes shipped in this diff
- Planned security fixes identified: yt-dlp config injection risk and symlink path traversal in project export will be hardened in a follow-up release
- Performance improvements planned: reduced memory allocations during audio playback and faster pad lookup in multi-fade mode
- Reliability fixes planned: boot failures will surface clearer error messages, and errors in missing-file resolution dialogs will no longer be silently swallowed
- Adding a new pad now plays a smooth flip animation when the pad opens to its edit view.
- Fade controls are now simpler: each pad has a single **volume** level and a **fade target** level, replacing the old "start/end" range slider
- Pressing **F** on a pad now opens a target-volume popover first, letting you set where the fade will land before it fires; pressing F again executes the fade
- An amber indicator line on the pad shows exactly where the fade will stop while a fade is in progress or the popover is open
- While a fade is running, new **Stop Fade** and **Reverse** buttons appear so you can freeze or reverse the ramp mid-flight
- Existing projects are automatically migrated to the new volume/fade-target format on load (project format 1.3.0)
- Right-clicking an empty (unassigned) pad now opens the back-face editor so you can assign sounds to it.
- The fade slider now tracks live volume in real time and correctly labels which side is "current" while a pad is playing or fading.
- The Fade Out / Fade In button label now stays accurate after dragging the fade boundaries mid-playback.
- Adding a new pad when the scene has filled a full page now automatically navigates to the new page so the pad appears immediately in edit mode.
- Fading in a stopped pad now ramps from the configured low-volume boundary instead of silence.
- Fixed a bug where pressing the fade hotkey (F) rapidly could trigger multiple fades in the wrong direction or get stuck
- Pressing F on a pad that has faded down to its low volume now correctly fades it back up, completing the fade toggle cycle
- Pads now play at their configured high-fade volume by default when triggered normally, instead of always starting at full volume
- Fade range sliders no longer allow the two thumbs to overlap each other
- The "Add Layer" button in the pad editor is now larger and easier to click
- Removed an outdated test comment referencing a deleted component (`PadControlContent`)
- Internal code cleanup: `createDefaultLayer` now imports directly from its source module instead of a re-export
- Right-clicking a pad now flips it in place to reveal an inline editing surface, replacing the separate config drawer.
- Pad name, color, layers, and fade settings can be edited directly on the pad's back face without opening a modal.
- Per-layer configuration (sound selection, playback mode) is now accessible via a focused dialog opened from the back face.
- New pads are created and immediately flipped to edit mode, so you can configure them without extra steps.
- New pads now open immediately in edit mode when added to a scene
- New pads are created with correct default fade volume settings applied automatically
- Clicking "Add Pad" now immediately creates the pad and opens the editor, rather than requiring a two-step flow through a dialog first.
- Right-clicking a pad to edit it now dismisses more reliably when clicking outside
- Improved internal test reliability for right-click behavior on pads (no user-facing change)
- Right-clicking a pad now flips it to its back face inline instead of opening a popover/drawer overlay
- Individual pads can now flip independently via right-click; clicking outside flips them back
- The 3D flip animation now triggers for both global edit mode and per-pad right-click
- Clearing a pad's name field and leaving it blank now restores the original name instead of saving an empty name
- Dragging the fade level slider no longer resets the slider position mid-drag when playback state changes
- Minor internal cleanup: removed an unused prop from the layer row component
- The "Synchronized Fades" keyboard shortcut tooltip now shows only `X` (previously showed `F / X`).
- Pads with a single layer now correctly disable the "Remove Layer" button, preventing accidental deletion of the last layer.
- Pads now have an editable back face with per-layer controls: play/stop individual layers, adjust layer volume, skip forward/back in sequential arrangements, and edit or remove layers inline
- You can rename a pad and change its color directly from the pad back face
- Added layer management to pads: add new layers or remove existing ones without opening a separate drawer
- Fade controls are now accessible from the pad back face, including fade in/out, configurable fade levels, fade duration, and synchronized multi-fade
- Fixed an edge case where the layer editor dialog could render in a broken state if the target layer was missing or invalid.
- No user-facing changes; internal test comments removed (no functional impact).
- Improved test coverage for the Layer Config dialog to verify layer-specific data (volume) is correctly displayed when opening a configured layer.
- Improved test coverage for the Layer Config Dialog, including validation of sound selector rendering, sync behavior on save, and tag-selection error handling.
- Added a new "Edit Layer" dialog that lets you configure individual pad layers — including sound selection, playback mode, retrigger behavior, arrangement, and volume — without editing the entire pad at once.
- New pads added via keyboard shortcut now automatically open in edit mode for immediate configuration
- Pressing `Mod+Shift+N` now immediately creates a new pad in the active scene and opens it for editing, instead of just opening an empty config drawer.
- Keyboard shortcuts (`F` for fade, `X` for multi-fade) now correctly check whether a pad is being edited before activating, preventing unintended hotkey triggers during pad editing.
- Pad editing now uses a backface panel instead of a context popover — clicking a pad to configure it will show its settings on a flipped card face
- No user-facing changes (internal test refactor only).
- You can now configure custom **fade volume levels** (low and high endpoints) per pad — set them in the Pad Config drawer or by dragging the fade slider, and they are saved with your project
- The **Fade In / Fade Out** button label now correctly shows "Fade In" when a pad is mid-fade-out (reversing), instead of always reading from play state
- Fade level adjustments made in the pad control overlay are now **persisted** when you release the slider
- Internal developer tooling plan added for extracting reusable tag and set picker components (no user-facing changes in this commit).
- Added a reusable Set Picker component to the "Add to Set" dialog, replacing the inline combobox implementation.
- The tag and set pickers in the Download dialog now use shared, reusable picker components for a more consistent experience across the app.
- Added TagPicker and SetPicker components for selecting tags and sets from the sound library
- Added a **Set Picker** component, allowing sounds to be assigned to sets directly from the library picker interface (with inline set creation support).
- Fixed an internal code issue with tag creation in the Tag Picker (no change to functionality)
- Added a tag picker component that lets you search for existing tags or create new tags inline when assigning tags to sounds.
- Fixed the "Create" option in library pickers to properly select the newly created item after creation.
- Added a reusable `LibraryItemPicker` component for selecting and creating tags/sets via a searchable chip input with inline "Create" support
- Internal developer refactor: tag and set picker logic has been extracted into reusable shared components, reducing code duplication with no change to user-facing behavior.
- When downloading audio via URL, you can now assign tags and sets to the sound before it downloads — they'll be applied automatically when the download completes.
- New tag and set pickers in the Download dialog support searching existing entries or creating new ones on the fly.
- Selected tags and sets are cleared when the dialog is cancelled or after a successful download.
- The active download count badge on the Download button has moved from the top-right to the top-left corner.
- The "Download from URL" button and download status indicator are now combined into a single button group for a cleaner toolbar layout
- Active download count badge now appears directly on the download status icon
- The download status button now shows a badge with the count of active downloads in progress, capped at "9+" for 10 or more.
- The download status button is now always visible in the toolbar, even when no downloads are active
- Opening the download panel with no downloads shows a "No downloads yet" placeholder message
- Completed and failed downloads are now saved to disk and restored when you reopen the app
- Downloads that were in-progress when the app closed are marked as failed on next launch
- The Downloads panel now stays visible as a persistent header rather than animating away when the list is empty
- Active downloads are always shown before completed or cancelled ones in the Downloads panel
- Minor internal performance improvement to the download status button
- Added a download status button to the sound library toolbar that shows active downloads with a spinning icon and opens a popover with the full download queue
- Download event listening moved to the main page level so it works regardless of which folder is selected in the sound library
- Active download jobs are no longer shown inline in the sound list; they now appear exclusively in the download manager popover
- Internal code cleanup with no user-facing behavior changes
- Internal code refactoring: download and export progress events now use cleaner constructor methods — no user-facing behavior changes.
- Exported project ZIP files now use "no compression" (Stored) mode, improving export speed for already-compressed audio files
- Folder picker now shows a clear error message if the selected folder cannot be accessed, instead of silently failing
- Export now warns you when referenced sounds are missing files and lists how many couldn't be included
- Export now warns you when multiple sounds share the same filename, which could cause conflicts in the exported zip
- Project dialog logic (save, confirm-close, export progress) moved into a dedicated component for cleaner code organization
- Paths containing Unicode BIDI control characters, line/paragraph separators, or BOM characters are now blocked from being granted file access, closing a potential path-spoofing security vulnerability.
- Accented and CJK characters in folder names continue to work correctly and are unaffected by the new restrictions.
- Fixed a security bug where UNC paths with doubled separators (e.g. `\\?\UNC\\server\share`) could bypass root path detection and gain unauthorized file access
- Fixed a security bug where UNC network paths with doubled interior separators (e.g., `\\server\\share`) could bypass root path detection and incorrectly gain file access grants.
- Fixed a security vulnerability where file paths containing null bytes or ASCII control characters could bypass access controls — such paths are now blocked in both the Rust backend and TypeScript frontend.
- Fixed a security issue where file paths with doubled backslashes (e.g. `\\\\server\share`) could bypass UNC share root restrictions and gain unauthorized file access.
- Fixed a security issue where certain Windows device-namespace paths (e.g., `\\?\PIPE\`, `\\?\MAILSLOT\`, `\\?\HarddiskVolume3`) could bypass file access restrictions.
- The app now uses an allowlist approach for extended-length paths, permitting only drive-letter, UNC share, and Volume GUID subfolders — all other device paths are blocked.
- Improved security: Volume GUID paths (e.g. `\\?\Volume{GUID}`) are now correctly blocked from being granted root-level file access
- Subfolders under Volume GUID paths (e.g. `\\?\Volume{GUID}\music`) continue to work as expected
- Improved security: the app now blocks granting file access to dangerous Windows path types, including UNC share roots, DOS device namespace paths, and extended-length prefix roots.
- Subfolders on network shares (e.g. `\\server\share\music`) continue to work as expected.
- You can now open sound files and folders from anywhere on your system — the previous restriction to Music, Documents, Downloads, and Desktop folders has been removed.
- Sound library folders are automatically re-authorized on app startup, so folders added in a previous session are accessible without manual re-selection.
- When locating a missing sound file or folder, the file browser now accepts any location on your system.
- Internal stability improvement: orphaned sound references are now automatically cleaned from pads when sounds are removed from the library, preventing broken pad configurations.
- Orphaned temporary files left behind by app crashes are now automatically cleaned up on startup, preventing gradual disk space accumulation.
- Fixed a bug where deleting a non-existent file silently succeeded instead of throwing an error — it now correctly fails with a "file not found" error, matching real filesystem behavior.
- Fixed a bug where renaming a file in tests would silently succeed even if the source file didn't exist — it now correctly throws an ENOENT error
- Fixed test mock rename logic to properly sync content to both internal file maps, preventing stale state after a rename
- Renaming a file to itself is now a safe no-op instead of potentially corrupting state
- Fixed a file corruption risk where concurrent saves to the same file could overwrite each other's temporary files — each save now uses a unique temp filename.
- Internal test infrastructure improvement: multi-fade store reset logic is now shared from a single exported constant, reducing duplication across test files.
- Active scene tab tracking moved to UI state (no behavioral change for users); scene navigation via keyboard and tab clicks works the same as before.
- The sound library's internal state fields (`isDirty`, `missingSoundIds`, `isReconciling`) are now protected against accidental modification when updating sounds, tags, or sets.
- Improved internal documentation for audio gain handling (no behavior change).
- App settings, project files, sound library, and recent projects history are now saved atomically — if a save is interrupted (crash, power loss), your files will never be left in a partially-written, corrupted state.
- Improved security: shell command execution is now restricted to the Rust backend only, preventing the frontend from directly spawning or killing system processes.
1. Audio playback correctness: Volume changes now fade smoothly instead of snapping (no audio clicks); invalid/NaN
  volumes default to silence; pad layers now trigger simultaneously rather than sequentially; retriggers are
  correctly debounced across all layers at once.                                                                     
  2. Fade/skip race conditions fixed: Re-triggering or skipping forward/back during a fade-out no longer silences the
   new sound — fade cleanup timers are cancelled before the next voice starts. Layers stuck in "pending" after an    
  audio error now recover correctly.                                                                                 
  3. Audio engine performance: Progress calculation reads the audio clock once per frame (not once per pad); sound   
  lookups are cached so the index isn't rebuilt on every trigger; stopping a pad scans only that pad's layers; master
   gain now only reacts to volume changes, not all 60fps playback state updates.                                     
  4. Auto-save reliability: Overlapping saves are deferred; the dirty flag alone controls whether a save fires;
  auto-save shows a rate-limited error toast on write failure and keeps retrying until the issue clears.
  5. Streaming & download improvements: Large-file streaming threshold lowered from 20 MB to 5 MB; streaming elements
   preload correctly; download status transitions clear stale fields (speed, ETA, error); all download/export errors
  (including finalization failures) surface as toast notifications.
  6. Memory & resource management: Audio buffers and streaming data are fully released when switching projects;
  completed and cancelled download/export jobs are removed from tracking maps, preventing unbounded memory growth.
  7. Library & file corruption recovery: Corrupt library and history files are auto-backed-up and replaced with empty
   defaults, with a warning toast; duplicate IDs, invalid durations, negative file sizes, and malformed tags are
  auto-cleaned on load; newer-version files prompt an upgrade message instead of silently corrupting data.
  8. Validation hardening: Volume values clamped to 0–100 across layers, sound instances, and selections;
  duration/file-size fields reject negative, NaN, and infinite values; set names require 1–100 characters; Set type
  renamed to SoundSet to avoid JavaScript built-in collisions.
  9. Keyboard shortcuts: Scene navigation moved from bare arrow keys to Alt + Left/Right (with tooltip) to prevent
  conflicts with text inputs, sliders, and comboboxes; hotkeys F, X, Enter, and Escape now fire correctly when a
  slider or input is focused.
  10. App startup reliability: Boot sequence runs exactly once (React StrictMode-safe), preventing duplicate library
  scans; settings and library load failures surface error notifications; loading screen stays visible until both are
  ready; save-race conditions during startup are resolved.
  11. UI rendering: Volume bar no longer flashes after playback ends; high-frequency audio tick re-renders are
  isolated to dedicated sub-components (PadButtonProgress, PadButtonFadeOverlay), reducing jitter on active pads;
  sequential-layer current-sound display is more reliable.
  12. Security: Path traversal protection added to downloads and project exports; symlinks and non-audio files are
  rejected from export archives; download filenames validated to block path separators and special characters.

## v1.5.4

- Removed deprecated internal audio API alias (`clearFadePadTimeouts`); use `clearAllFadeTracking` directly for any custom integrations.
- Library files are now saved with a centralized version constant instead of a hardcoded `"1.0.0"` string, ensuring version numbers stay consistent across all save operations.
- Fixed a bug where pressing the left or right arrow keys to navigate scenes could jump to an unexpected scene if the active scene ID was missing or stale — the app now correctly falls back to the first scene in that case.
- Fixed a false "No project loaded" error that appeared when intentionally saving or discarding changes before closing a project
- Pressing **F** while hovering a pad now immediately fades that pad out (single fade), without needing to open the context menu first
- Pressing **X** while hovering a pad now enters multi-fade mode with that pad pre-selected
- Both **F** and **X** are now context-aware: they do nothing if a pad's context popover is open, and they exit edit mode first if edit mode is active
- Pad flip and enter animations now use CSS transitions instead of JavaScript springs, making the scene grid smoother and more responsive when toggling edit mode with many pads visible.
- Volume drag on pads is throttled to one UI update per animation frame, preventing unnecessary re-renders while keeping audio adjustments glitch-free.
- Master volume changes no longer trigger redundant audio graph updates when the value hasn't actually changed.
- Streaming audio elements are now rebuilt correctly when the audio context is recreated (e.g. after a hot reload), preventing silent playback failures.
- Audio tick loop now skips Zustand store updates entirely on frames where pad volumes, layer volumes, progress, and active layer IDs are all unchanged, reducing CPU usage during stable playback.
- Added **F** and **X** keyboard shortcuts to trigger fade and enter Synchronized Fades mode from a pad's control popover
- **F** and **X** now also execute a multi-fade when pressed while in Synchronized Fades mode (same as pressing Enter)
- Pressing **F** or **X** in edit mode exits edit mode and enters multi-fade with no pad pre-selected
- Pressing **Escape** in multi-fade mode no longer accidentally opens the hamburger menu drawer
- Buttons in the pad popover and edit-mode back face now show keyboard shortcut tooltips (**F**, **X**, or **F / X**)
- Keyboard shortcuts added: press **F** to fade a pad in/out and **X** to enter Synchronized Fades mode when a pad's control popover is open
- Tooltips on the Fade In/Out and Synchronized Fades buttons now show the corresponding keyboard shortcut keys
- Pressing **F** or **X** while in edit mode now exits edit mode and enters multi-fade mode with no pad pre-selected
- **Escape** no longer conflicts with multi-fade mode — when a multi-fade is active, Escape is handled by the fade (to cancel it) rather than toggling the menu drawer
- Added `f` then `x` as an alternative keyboard shortcut to confirm a multi-fade action (in addition to the existing `Enter` key)
- Added ability to enter multi-fade mode without a triggering pad, allowing fade controls to be opened independently
- Added **F** and **X** keyboard shortcuts to the pad control popover: press **F** to fade a pad, press **X** to enter Synchronized Fades (multi-fade) mode with that pad pre-selected.
- Keyboard shortcut hints now appear as tooltips when hovering the Fade and Synchronized Fades buttons in the pad popover.
- Pressing **F** or **X** in edit mode now exits edit mode and enters multi-fade with no pad pre-selected, making it faster to start a synchronized fade from the keyboard.
- **F** and **X** now execute a multi-fade when pads are selected in Synchronized Fades mode (same as pressing Enter).
- Fixed a bug where pressing **Escape** to cancel multi-fade mode would also open the hamburger menu drawer.
- Added keyboard shortcuts to the pad context menu: press `F` to fade a pad or `X` to enter synchronized fade mode
- In edit mode, pressing `F` or `X` now exits edit mode and launches synchronized fade with no pad pre-selected
- During synchronized fade mode, `F` and `X` can now execute the fade (in addition to the existing `Enter` key)
- Fixed an issue where pressing `Escape` to cancel a synchronized fade would also incorrectly open the side menu drawer
- Pad buttons now show keyboard shortcut tooltips so the available hotkeys are visible on hover
- Playback mode changes (loop → one-shot) now let the current buffer finish naturally instead of stopping immediately; no toast notification is shown
- Arrangement changes mid-playback silently rebuild the chain queue instead of showing a toast notification
- Fade controls moved from global hotkeys (F/X keys) to a per-pad control popover with fade level sliders, duration override, and a "Synchronized Fades" multi-pad mode
- New pad control popover accessible by clicking a pad, with start/stop, duplicate, delete, per-layer play, skip forward/back, and sound list controls
- New keyboard shortcuts documented: Esc, Ctrl+S/Shift+S, Mod+E (edit mode), number keys 1–9 (scene jump), arrow keys (scene navigation), and Enter/Escape in Synchronized Fades mode
- Fixed a blank screen bug where hot-reloading during development would wipe the app state and leave the editor empty
- The main editor now automatically redirects to the home screen if no project is loaded, instead of showing a blank page
- Updated "New Project" flow: projects are now created instantly with an auto-generated name — no name entry dialog required
- New projects start with no scenes, showing an "Add Scene" prompt instead of a pre-populated empty scene
- Added MCP bridge integration (debug builds only) to enable AI assistant tooling support during development
- Fixed sound preview not recovering when playback fails — the app now correctly resets preview state instead of getting stuck
- Previewing a missing or unloadable sound now shows a specific error message in the notification bar
- Previewing a sound that fails for any other reason (e.g. unsupported codec, decode error) now shows an informative "Preview failed: ..." error instead of silently failing
- Fixed a bug where pad settings (mute group, color, icon) could silently persist after being cleared in the pad config drawer
- Saving pad configuration now correctly clears optional fields like mute group and color when they are not set
- Fixed a bug where saving pad configuration would apply layer volume at 100× the correct level during active playback (the 0–100 schema value was being passed directly to the audio gain node instead of being normalized to 0–1)
- Fixed a bug where invalid download progress values (negative percentages, values above 100%, NaN, or Infinity) could cause incorrect behavior in the download manager
- Download progress events that fail schema validation now log a diagnostic error instead of silently dropping, making stuck or stalled downloads easier to diagnose.
- Projects created with a newer version of SoundsBored can no longer be silently corrupted when opened — the app now shows a clear error asking you to update instead.
- Projects with unknown or unsupported version numbers are now rejected with an informative error rather than being loaded in a potentially broken state.
- Unversioned (legacy) projects are now correctly migrated to the current format on load.
- Fixed a race condition where submitting two downloads with the same name in quick succession could bypass duplicate name validation
- Files and folders that can't be checked due to permission errors are now tracked as "unknown" instead of being silently treated as present
- Sounds in a missing folder are now correctly flagged as missing (previously only the folder was flagged)
- Sounds with no file path now inherit their folder's missing/unknown status
- Download URL validation is now stricter: only `http://` and `https://` URLs are accepted — `ftp://`, `file://`, `javascript:`, `data:`, and other schemes are blocked with a clear error message
- Leading and trailing whitespace in the URL field is automatically trimmed before validation and submission
- Missing sound/folder detection is now more reliable — the app correctly refreshes missing-file status after resolving files, removing sounds, previewing audio, and on auto-save
- Resolving a missing file or folder now always updates the missing-file indicators immediately, regardless of app settings load order
- Stale "missing" indicators are now properly cleared when files become available again
- Fixed unnecessary UI re-renders during audio playback by only updating active layer state when it actually changes
- Internal audio engine refactored: `padPlayer.ts` split into focused modules (`fadeMixer`, `gainManager`, `layerTrigger`) for easier maintenance — no behavior changes.
- Duplicate retrigger logic consolidated into a single shared helper, reducing the risk of inconsistent behavior between pad and layer triggers.
- Project close now instantly releases all audio state and stops the audio tick, preventing potential resource leaks on unmount.
- Fixed a bug where pending stop timers were not cancelled when clearing all audio state, preventing ghost stop actions after scene changes
- Fixed streaming audio not being cleared when `clearAllAudioState` was called, which could leave stale audio elements registered
- Fixed "next" retrigger mode to correctly stop the currently playing voice before advancing to the next sound in the sequence
- Fixed fade-out cleanup to properly clear layer play order state alongside chain and cycle index state
- Fixed a bug where closing a project while audio was fading out could cause sounds from the previous session to bleed into the next session
- Fixed a race condition where rapidly triggering a pad could start multiple overlapping sounds unexpectedly
- Fixed sounds incorrectly continuing to chain to the next track during a fade-out
- Fixed volume controls silently ignoring invalid values (NaN or out-of-range numbers) instead of applying a safe default
- Improved audio cleanup when leaving the main editor — all active sounds and audio state are now fully stopped on exit.
- Internal audio engine code has been reorganized into smaller, focused modules with no change to playback behavior.
- Improved reliability when closing a project — all active audio state is now cleared instantly and in the correct order, preventing sounds from restarting or callbacks from firing after close.
- Improved audio engine reliability by refactoring layer trigger logic into a dedicated module, reducing the risk of playback bugs
- Retrigger behavior (stop, continue, restart, next) is now handled by a single consolidated code path, ensuring consistent behavior across all trigger scenarios
- Added test coverage for core audio layer functions including sound resolution, volume calculation, and retrigger modes
- Pads now support smooth volume fade-in and fade-out transitions, including mid-fade reversal (re-triggering a fading pad ramps volume back up without restarting audio)
- Per-pad fade duration can override the global fade setting; falls back to 2000ms if neither is configured
- Added real-time volume control for pads and layers, with smooth gain ramping to prevent audio clicks when adjusting volume mid-playback.
- The SidePanel's folder browser and sets panel have been split into separate, focused components for improved reliability and maintainability
- Missing sound folders are now automatically scanned on panel open, so the missing-folder warning appears immediately without requiring a manual Refresh
- The "Delete Sounds from Disk" confirmation dialog now clearly shows how many files will be deleted and which pads/layers will be affected before you confirm
- Internal hooks for resolving missing sounds and folders have been separated (`useResolveSoundQueue` / `useResolveFolderQueue`) to fix a bug where dismissing one dialog type could interfere with the other
- The sound library panel has been refactored into focused sub-components (`FolderBrowser`, `SoundList`, `BulkActions`), improving maintainability without changing visible behavior.
- "Remove All Missing Sounds" and "Remove All Missing Folders" confirmation dialogs are now coordinated through a shared UI store, so any component in the panel can trigger them without prop-threading.
- Added folder management logic (`useAddFolder`) and bulk-remove logic (`useBulkRemove`) as standalone hooks with full test coverage.
- Missing-item resolution dialog queues (review-one-by-one flow) extracted into a dedicated `useRemoveMissing` hook and tested independently.
- No user-facing changes in this release.
- Pad icons are now validated to ensure they use a proper identifier format (alphanumeric, starting with a letter, max 64 characters)
- Fixed a bug where the pad icon setting was lost when saving pad configuration changes
- Fixed a bug where progress bars would freeze at 100% between sounds in sequential/looping pad chains instead of resetting to 0%

## v1.5.2

Playback progress bars now display a separate indicator for each active layer, giving you clearer visual feedback when multiple sounds are playing on a pad. This release also fixes an unintentional multi-trigger bug when dragging pads and improves performance for large scenes by eliminating unnecessary re-renders on idle pads.

- Playback progress bars now show a separate bar for each active layer on a pad, split vertically, instead of a single combined bar
- Non-playing pads no longer re-render on every audio tick, improving performance for large scenes
- Fixed an issue where dragging on a pad could trigger it to play multiple times unintentionally

## v1.5.0

This release introduces a comprehensive live pad control system — right-click any pad to start/stop playback, fade in/out with adjustable volume levels, control individual layers, and set per-pad fade durations, all without leaving the pad grid. It also adds multi-pad synchronized fades, a sound library search bar, pre-buffering for large audio files to eliminate first-trigger latency, and a wide range of visual improvements including real-time volume meters, responsive layout adaption for mobile, and more accurate playback indicators.

- Large audio files (20 MB+) are now pre-buffered when you switch to a scene, eliminating first-trigger latency on streaming sounds
- Retriggering a streaming sound now reuses the same buffered audio element instead of creating a new one, making rapid retriggers faster
- Removing or relocating sounds now properly cleans up streaming audio elements alongside buffer cache entries, preventing stale data buildup
- Pad volume display now stays perfectly in sync while dragging the volume knob, eliminating any lag between your gesture and the visual feedback.
- The fade duration slider on pads now updates smoothly while dragging, only saving the value when you release the mouse
- Fixed fade duration display to stay in sync when the slider value changes
- Added a per-pad fade duration slider to the live controls popover, letting you set how long a pad's fade lasts independently from the global setting. Per-pad fade duration is saved with the project and persists across sessions.
- Right-click live controls popover on pads now opens at the cursor position instead of anchored to the full pad cell, so it no longer clips off-screen on tall grids
- On mobile/small screens, right-clicking a pad now opens the live controls in a bottom drawer instead of a floating popover
- Fixed buttons inside the pad control panel being unclickable when dragging pads in edit mode
- Fixed an issue where entering multi-fade mode while in edit mode would immediately cancel the multi-fade control
- Pad option popovers now correctly close when edit mode is activated
- Volume sliders now respond instantly while dragging, eliminating a subtle lag caused by audio timing updates.
- Volume display on pads now updates immediately while dragging, eliminating the visual lag caused by audio processing latency
- The volume indicator on pads now stays visible while dragging to adjust volume and hides cleanly after you finish, rather than disappearing prematurely during mid-drag pauses.
- Volume display on pads now only appears when actively dragging (not during the hold phase before any drag movement)
- Volume bar correctly reflects real-time audio engine state, eliminating visual glitches where the bar would show stale or incorrect values
- Fading indicators are now driven by the audio engine directly, improving accuracy when pads fade in or out
- Internal cleanup: removed a redundant per-pad animation loop (`startFadeRaf`) in favor of the global audio tick, reducing overhead during fade transitions
- Pad volume display and layer activity indicators now update via a shared audio engine tick, reducing CPU overhead from multiple per-pad animation loops
- Progress tracking for playing pads is now driven by centralized store state, improving consistency across the UI
- Active layer indicators on pad buttons now update via a centralized engine tick instead of per-pad animation loops, improving reliability and performance.
- Volume fade slider no longer tracks an intermediate "transitioning" state, simplifying volume adjustment behavior.
- Pad volume fade bars and playback progress indicators now update more reliably during simultaneous pad activity, reducing missed or stuttering visual feedback.
- Volume fill bars now clear immediately when all pads are stopped, rather than lingering until the next animation frame.
- Active layer indicators in the live pad controls panel now stay in sync with actual playback state without polling delays.
- Improved audio engine performance by consolidating multiple per-pad animation loops into a single global RAF loop, reducing CPU overhead during playback
- Volume meters, progress bars, and active layer indicators now update from one unified tick rather than scattered individual polling loops
- Pad volume, layer volume, playback progress, and active layer tracking are now updated in a single batched operation each audio frame, reducing UI jitter and improving performance
- Added per-pad playback progress indicator support (`padProgress`), enabling future progress bar display on pads
- Added active layer tracking (`activeLayerIds`), replacing per-component polling for whether a layer is currently playing
- Active pad playback progress is now tracked more efficiently — the audio engine computes progress for all playing pads in a single pass, reducing overhead during playback.
- Fixed an issue where stopping a pad did not cancel an in-progress fade, preventing fade artifacts on stop.
- Right-clicking an unplayable pad (one with no sounds assigned) no longer opens the live control popover
- Fixed the pad edit panel background so it correctly uses the card background color instead of a dark black overlay, improving readability when pads have custom colors.
- The layers list in pad controls now scrolls independently within full-size pads, keeping action buttons and header always visible instead of being pushed off screen.
- Tapping "Edit" on a pad's live control popover now navigates directly to the pad's full configuration panel instead of requiring you to close the popover first.
- Pad buttons no longer show a close/dismiss action on the back face — exit edit mode using the global toggle instead
- Pad edit controls (edit, duplicate, delete) on the back face in edit mode now use the same shared control panel as the live control popover, ensuring a consistent UI in both views
- The layer count indicator (e.g., "1 layer") is no longer displayed on the pad's back face in edit mode
- Moved `getSoundsForLayer` tests from `PadLiveControlPopover.test.tsx` to `PadControlContent.test.tsx` to better co-locate tests with the function they cover
- Simplified `PadLiveControlPopover` tests by removing unnecessary mocks (audio, tooltip, store state) that were testing implementation details not relevant to the popover itself
- Added a new test verifying the close button in the mobile drawer calls `onOpenChange(false)` correctly
- Pad live control content extracted into a separate `PadControlContent` component, improving code organization and maintainability
- Drawer header on mobile no longer shows a duplicate pad name; accessibility title is now screen-reader only
- Improved test coverage for the pad control panel's responsive layout, verifying correct behavior across full, condensed, and compact display modes.
- Improved reliability of pad control panel layout tests to correctly simulate component dimensions in the test environment
- Added test coverage verifying the Layers section heading renders correctly in the pad control panel
- Fixed a bug where the pad control panel didn't close automatically after duplicating or deleting a pad
- Added a new pad control panel with playback controls (Start/Stop, Fade In/Out, per-layer play/stop) accessible directly from the pad
- Pad controls now adapt their layout based on available space — full controls when space allows, compact popover-based controls when the pad is smaller
- Individual layers can now be triggered and stopped independently from the pad control panel, with volume sliders per layer
- Synchronized Fades button is now accessible directly from the pad control panel
- Pad management actions (Edit, Duplicate, Delete) are available inline in the pad control panel
- Added internal implementation plan for refactoring the pad control panel into a shared `PadControlContent` component (developer-facing only; no user-visible changes in this diff)
- Added internal design spec for the upcoming Pad Control Panel refactor, consolidating edit/duplicate/delete actions and live controls into a unified shared component with responsive layout modes
- No user-facing changes (internal test update only)
- Active shuffled layers now display only the currently playing sound name instead of the full sound list
- The sound list popover for sequential/shuffled layers now shows sounds in actual play order
- Clicking the sound list icon while it's open now correctly closes it (fixes unintended reopen behavior)
- When a pad's layer uses sequential or shuffled playback, the sound list in the live control popover now reflects the actual play order and updates when the sequence wraps or shuffles.
- The currently-playing sound is now shown in **bold** in the pad's sound list popover, making it easier to track which sound is active during playback.
- Missing sounds in the sound list popover are now displayed in *italic* to visually distinguish unavailable files.
- Fixed an interaction bug where clicking the "Show sound list" button could unexpectedly steal focus.
- Layers with multiple sounds now show a list icon button that opens a popover with all available sounds numbered in order
- The sound list popover displays a contextual title based on selection type: "Sounds" for assigned, "Tag: \<name\>" for tag-based, or "Set: \<name\>" for set-based layers
- The currently playing sound is highlighted in the list; missing sounds are shown in italics
- Fixed an issue where the current sound indicator in the pad live control popover would not reset when a layer became inactive
- When a pad with sequential or shuffled sounds is actively playing, the sound display now shows only the currently-playing sound name instead of the full list
- Simultaneous layers continue to show all sound names regardless of playback state
- Fixed spacing between repeating text in the scrolling sound name display on pad controls
- Each pad layer now shows the names of its assigned sounds (e.g. "Kick · Snare · Hi-hat") directly in the live control popover
- When sound names are too long to fit, the display automatically scrolls with a marquee animation
- Added sound display to pad live control popover layers, showing which sounds are assigned to each layer based on its selection type (assigned, tag, or set)
- Added a sound display row in each layer's live control panel showing the names of assigned sounds (e.g., "Kick · Snare · Hi-hat"), with a scrolling marquee when the text overflows
- For sequential and shuffled layers, the display updates in real-time to highlight the currently-playing sound while the layer is active
- Added a list icon button (hidden for single-sound layers) that opens a popover showing all sounds numbered, with the current sound bolded and missing sounds shown in italics
- Added internal design spec for layer sound display in the pad live control popover (upcoming feature)
- Pad live control popover now includes a per-pad fade duration slider, letting you set a custom fade time (0.1s–10s) directly from the pad controls
- A "Reset to default" option appears when a custom fade duration is set, reverting the pad to the global default fade time
- When using the global default, the current global fade duration is displayed as a reference
- Fixed skip forward/back controls for pads in cycle mode — they now correctly step through sounds in sequence without losing track of position
- Fixed an issue where skipping forward then backward could fail because the play order wasn't preserved after a skip
- Fixed a visual glitch where the volume bar could remain visible after a fade that doesn't go to silence
- Improved slider component indentation and code formatting for better readability (no functional changes)
- The pad live control popover now displays a visual arrow pointing to the pad it belongs to
- Slider tooltips now render correctly when used outside of a global tooltip provider
- Popovers can now display a styled arrow pointing to their trigger element via a new `showArrow` option
- Added a speech bubble-style arrow to the pad live control popover, visually connecting it to the pad that triggered it
- Added a speech bubble-style arrow to pad live control popovers on desktop, making it clearer which pad a popover is attached to
- Sliders now display a tooltip showing the current percentage value when hovering or dragging a thumb
- The "Multi-Fade with Others" button has been renamed to "Synchronized Fades"
- Compact slider variant introduced for tighter UI areas (smaller track and thumb size)
- Renamed "Multi-fade with others..." button to "Synchronized Fades" for clearer labeling
- Updated button styles in the pad live control popover for improved visual hierarchy
- Live volume adjustment: dragging the fade slider now updates the volume of a playing pad in real time
- Right-clicking a pad now correctly toggles the live controls popover closed when it is already open, instead of reopening it
- Dragging the volume slider in the live controls popover now updates pad volume in real time while dragging
- Layer volume changes are applied live during drag and only saved to the project when you release the slider
- Replaced the scene-level fade toolbar with per-pad live control popovers accessible via right-click
- Added skip-back navigation for sequential and shuffled layers, allowing you to jump to the previous sound in a chain
- Removed the Fade and Crossfade toolbar buttons; fade controls are now accessed directly from each pad's context menu
- Fixed the multi-fade control pill layout so it renders centered within the scene view rather than using absolute positioning.
- Right-clicking a pad now toggles the context menu closed if it's already open, instead of forcing it open again
- Layer volume changes made in the live controls panel are now saved to the project and stay in sync with the pad configuration dialog
- Layer volume sliders now correctly show each layer's configured volume as the starting value instead of always defaulting to 100%
- Clicking "Synchronized Fades" on a pad now correctly closes the pad popover after entering multi-fade mode
- Multi-fade execution now applies the correct per-pad fade levels to each selected pad and resets the multi-fade state afterward
- Skipping backward through a sequential layer with cycle mode enabled now correctly updates the cycle position
- Fade execution button now triggers more reliably when clicked
- Executing a multi-pad fade now uses a single shared code path, reducing the chance of inconsistent behavior between keyboard shortcut and button-triggered fades.
- Added mobile support for pad live controls — on small screens, controls now appear in a drawer instead of a popover
- Multi-fade mode now automatically cancels when edit mode is enabled or a dialog/overlay is opened, preventing conflicting UI states
- Fixed a visual bug where the fade volume slider could show stale values when a pad starts or stops playing
- Improved internal fade control logic so volume slider thumbs stay accurately in sync during playback
- Fixed stale layer state not being cleared when the live control popover closes or resets
- Added keyboard shortcuts in the scene view: press **Escape** to cancel a multi-fade operation and **Enter** to execute it.
- Fading multiple pads at once now shows an error notification if any individual pad's fade fails during execution.
- Added live pad control popover with Start/Stop buttons that reflect current playback state
- Fade In/Fade Out button dynamically updates based on whether the pad is currently playing
- Fade slider automatically syncs its current-volume thumb to the pad's actual volume when playback starts
- Added comprehensive test suite for the multi-fade store, covering pad selection, volume level tracking, fade lifecycle (enter/cancel/reset), and state isolation.
- No user-facing changes in this update — internal test coverage was added for audio playback reliability (fade transitions, layer stop behavior, retrigger modes).
- Live volume fader now stays in sync with the pad's actual volume while the pad is playing
- Pad live controls now manage their own popover state internally, removing the need for the scene to coordinate popover reopening after multi-fade mode exits
- The live controls popover now automatically closes when multi-fade mode is activated
- Multi-fade mode startup logic moved from the pad button into the live controls panel itself, simplifying the component interface
- Fixed a bug where skipping back in a non-cycle-mode layer incorrectly set the cycle index, causing potential playback position tracking issues
- Fixed an issue where pads could remain stuck in an active state after being stopped, ensuring proper cleanup after playback ends.
- Fixed a bug where fade levels were applied in the wrong order, causing fades to go the wrong direction
- Added internal test coverage for layer volume tracking in the playback state (no user-facing changes)
- Added multi-fade mode UI pill that shows how many pads are selected for a fade operation, with Execute and Cancel controls
- Right-clicking a pad now opens a live controls popover for quick adjustments without entering edit mode
- Pads selected during multi-fade mode display a visual selection ring to indicate their inclusion
- Clicking a pad while multi-fade mode is active toggles it in/out of the fade selection instead of triggering playback
- The playback pulse animation is suppressed on pads while multi-fade mode is active to reduce visual noise
- The live controls popover is blocked from opening in edit mode or during multi-fade mode to prevent conflicts
- Layer volume control now clamps to a valid 0–100% range, preventing audio distortion from out-of-bounds values
- Added live layer volume control, allowing per-layer volume to be adjusted during playback
- Added skip forward/back controls for sequential pad layers, enabling navigation through a layer's sound sequence while playing
- Added comprehensive test coverage for the multi-pad fade mode feature, validating selection management, execution, and cancellation behavior.
- Live volume control is now tracked per-layer, enabling real-time visual feedback for individual layer volume adjustments during playback.
- Multi-fade mode state is now managed in a dedicated store, improving reliability and eliminating potential state sync issues between components
- Pad buttons no longer require multi-fade state to be passed down as props, simplifying the component interface
- Multi-fade fade levels now correctly initialize based on whether a pad is actively playing at the moment of selection
- Layer volume sliders in the pad live controls popover now update independently — each layer subscribes to its own volume instead of re-rendering all layers together, reducing unnecessary UI updates.
- Pad fade controls now automatically detect whether a pad is playing or stopped, removing the need to track playback state separately when applying fade in/out
- Fixed an issue where volume sliders on pad controls could get stuck in a dragging state if the mouse was released outside the slider bounds.
- Performance improvement: pad volume is now read more efficiently during fade operations, reducing unnecessary re-renders
- Added multi-pad fade mode: select multiple pads and fade them in or out simultaneously with configurable volume levels
- Fade levels are independently adjustable per pad before executing the fade
- Press Enter to execute the fade or Escape to cancel; the mode also auto-cancels when edit mode activates or any overlay opens
- Fixed an issue where the volume slider in the pad live control popover could show a stale value after stopping and restarting playback
- Added a live control popover for pads, letting you start/stop playback, fade in/out with adjustable start and end volume levels, and control individual layers — all without leaving the pad grid
- Each layer in the popover shows its active state and has its own volume slider, plus skip forward/back controls for sequential and shuffled layers
- Added a "Synchronized Fades" option to initiate a synchronized fade across multiple pads at once
- The popover adapts to screen size, appearing as a bottom drawer on smaller screens and a floating popover on desktop
- Added live volume control for individual pad layers during playback
- Added ability to trigger or stop a single layer independently without affecting other layers on the same pad
- Added skip forward/back controls for sequential and shuffled sound arrangements within a layer
- Right-clicking a pad now opens a live controls popover with quick access to fade and other per-pad actions
- A new multi-fade mode lets you select multiple pads and execute a fade across all of them simultaneously
- Selected pads in multi-fade mode show a volume range slider overlay to set start/end fade levels
- A floating pill appears at the bottom of the scene while multi-fade mode is active, showing selection count with Execute and Cancel buttons
- Pads visually indicate their multi-fade selection state with colored highlight rings (amber for playing, teal for stopped)
- Added internal filesystem capability to support file metadata operations
- Added a search bar to the Sound Library panel that filters sounds, folders, and sets by name in real time
- When searching, results span all sounds across the library (not limited to the selected folder/set), with tag-name matching included
- A clear button (×) appears in the search bar to quickly reset the filter
- Fading out a playing pad now uses its current live gain as the fade-out start point, rather than the configured high-level value, resulting in smoother fade transitions with no audible jump.
- You can now delete sets from the sound library — a new "Delete Set" button appears when a set is selected, with a confirmation dialog to prevent accidental deletions
- Deleting a set only removes the set itself; sounds within it are preserved in your library
- You can now create a new set directly from the "Add to Set" dialog by typing a name and selecting "Create" — no need to create sets separately first.
- The set selector now shows even when no sets exist, replacing the previous "No sets yet" dead end.
- Fixed tooltip rendering in the fade volume slider by moving `TooltipProvider` to a higher level in the component tree
- Added a two-handle volume slider to the Fade toolbar, letting you set custom start and end volume levels when fading pads in or out
- Fade operations now respect the slider values instead of always fading between silence and full volume
- Canceling fade mode resets the volume slider back to its defaults (0%–100%)

## v1.4.4

This release includes internal infrastructure improvements only — no changes to app functionality or user-facing features.

- Internal release infrastructure refactored; no changes to app functionality or user-facing features.

## v1.4.3

Developers can now build installer artifacts locally using the new `scripts/build-local.sh` script, mirroring the CI release workflow without needing to push a tag.

- Added a local release build script (`scripts/build-local.sh`) that lets developers build installer artifacts locally without CI.

## v1.4.0

This release overhauls how the app handles missing and deleted sounds — pads now visually indicate when sounds are unavailable, stale references are automatically cleaned up on load, and delete confirmations show exactly which pads and layers will be affected before you confirm. You can also delete sound folders and files directly from the Sounds panel, open folders in Explorer from both the panel and Settings, and manage recent projects from the Start screen with new remove and delete options.

- Fixed a bug where missing-sound warnings and cleanup could fire multiple times for the same project after edits
- Added tests verifying that delete confirmation dialogs show which pads will be affected when deleting sounds or folders referenced by the current project.
- Added tests confirming the impact section is hidden when no pads reference the sounds being deleted.
- When deleting a sound folder or sounds from disk, the confirmation dialog now shows which pads and layers in your current project will be affected by the deletion.
- Fixed missing sound names in layer warnings to show the sound ID instead of "Unknown" when the sound name cannot be found
- Layers with missing or empty sounds now show a warning icon in the pad config drawer, with a tooltip explaining which sounds are missing or that no sounds are assigned
- Pads with missing sounds can now be selected as crossfade targets in fade mode (previously they were fully disabled and unclickable)
- The missing-sound warning icon on pads is now slightly larger (16px instead of 12px) for better visibility
- Pads with missing sound files are now visually disabled (dimmed, unclickable) when all assigned sounds are unavailable
- Pads with only some missing sounds show a warning icon; hovering it explains which sounds need attention
- Fixed a bug where orphan sound cleanup could run repeatedly when the sound library changed, improving stability on project load
- Stale sound references are now automatically removed from pads when a project loads or the sound library is reconciled, keeping project data consistent with the available library.
- Pads with no assigned layers are now correctly recognized as disabled
- Pads now track sound health state — each pad reports "ok", "partial", or "disabled" based on whether its assigned sounds exist in the library
- Orphaned sound references are automatically cleaned from pad layers when sounds are removed from the library
- The app can now identify which pads and layers are affected when specific sounds go missing
- Pads with missing sounds now appear dimmed and unclickable, preventing accidental triggers
- A warning icon appears on pads and individual layers when some (but not all) sounds are missing
- Orphaned sound references are automatically cleaned up when a project loads or the sound library refreshes
- Delete confirmation dialogs now show which pads and layers will be affected before you confirm
- Added visual warning indicators on pads when assigned sounds are missing from disk, so broken pads are immediately visible without needing to trigger them
- Pads where all assigned sounds are missing are now automatically disabled to prevent silent playback failures
- Delete confirmation dialogs now show which pads and layers will be affected before you confirm a deletion
- Stale sound references are automatically cleaned up when loading a project or refreshing the library
- Per-layer warnings in the pad config drawer identify exactly which sounds are missing or unassigned
- You can now delete sound folders and individual sound files directly from disk via the Sounds panel, with confirmation dialogs to prevent accidents
- Folders assigned as download or import destinations are protected from deletion, with clear tooltips explaining why
- Added "Open in Explorer" buttons to sound folders in both the Sounds panel and Settings, letting you quickly browse folder contents in your file manager
- Recent projects on the Start screen now have buttons to remove entries from the recent list or permanently delete the project folder from disk
- "Remove missing folders" now skips any folders assigned as download/import destinations and reports how many were skipped

## v1.3.4

This release delivers a major visual overhaul to pad playback feedback — active pads now glow with yellow borders and drop-shadows, animate with a 3D card flip in edit mode, and transition colors and volume indicators smoothly — alongside several bug fixes resolving stale progress bar states, audio playback failures from incorrect CORS settings, and performance improvements through memoized gesture handlers.

- Playing pad indicator now includes a yellow drop-shadow glow on the entire button, and the pulse ring follows the pad's 3D tilt animation when pressed
- Pad buttons now display a more prominent glowing border animation when playing (thicker, extends slightly beyond the button edge)
- Active pads turn black with white text while playing, with a smooth 0.7s color transition
- Playing pad borders highlight in yellow instead of black
- Playback progress bar changed from dark overlay to a subtle white overlay
- Progress bar now resets to 0 when a pad retriggers to the next sound, instead of briefly showing the previous sound's position
- Fixed a bug where the progress bar could display stale progress during the moment between stopping one sound and loading the next
- Pad volume display now fades out smoothly after release instead of disappearing abruptly
- Fixed a one-frame volume jump when the volume indicator transitions from live to lingering display
- Drag-and-drop pad reordering now works in both normal and edit mode (previously disabled outside edit mode)
- Fixed audio playback compatibility issue that could cause errors when playing sounds through the Web Audio API
- Pads now flip with a 3D card animation when entering edit mode, revealing controls on the back face
- Download queue items animate in and out smoothly when added or removed
- Scene tabs animate when added or removed from the tab bar
- The fade/crossfade toolbar slides in and out when toggling edit mode
- Status indicators throughout the UI (download state icons, volume display, fade status label) now transition with subtle fade and scale animations
- Fixed an audio playback bug where sounds could fail to play due to an unnecessary `crossOrigin = "anonymous"` setting on local audio files
- Pad button gesture handlers are now memoized, preventing unnecessary re-renders and improving performance when interacting with pads.
- Pad buttons with an "invalid" fade state are now non-interactive (pointer events disabled), preventing accidental clicks
- Fixed a performance issue where fade state and handlers were being recalculated on every render instead of only when their dependencies change

## v1.3.3

This release brings meaningful reliability improvements to audio playback and the sound library: gain node memory leaks are fixed, missing files are now detected and flagged during playback, and errors surface as toast notifications instead of silent failures. The sound library also gains automatic rescanning on startup, an on-demand Refresh button, and smarter folder scanning that skips inaccessible locations gracefully while preserving any custom tags, names, or sets you've already added.

- Minor visual styling update to the cancel download button in the Download Manager
- Fixed audio engine memory leak: gain nodes are now properly disconnected from the audio graph when pads are stopped or the project is closed, preventing accumulation of orphaned audio nodes.
- Refactored the Fade/Crossfade toolbar into a standalone `FadeToolbar` component for improved code organization (no user-visible behavior change)
- Fix committed: `e7043b8` — replaced `console.error` with `toast.error` in fade handlers
- Tests committed: `acaae66` — added `MissingFileError` coverage for `startLayerSound`
- When a sound file is missing during playback, the app now detects and marks it as missing in the library — keeping the UI in sync without a manual rescan
- Audio playback errors now display as toast notifications instead of being silently logged to the console, so you'll see clear error messages when a sound fails to play.
- Added smooth volume fade animation support for pads, enabling fade-in and fade-out effects during playback
- Fixed a crash/hang when scanning sound library folders located outside the app's permitted file system locations — inaccessible folders are now skipped gracefully
- Added a warning notification when folders can't be scanned, listing the affected folder names and suggesting valid locations (Music, Documents, Downloads, or Desktop)
- Corrected the allowed folder scope from `$MUSIC` to `$AUDIO` for file access permissions
- New sounds added to your library folders are now picked up automatically without overwriting any edits (tags, sets, custom names) you made during the scan
- Missing file indicators in the sound library now always reflect the current state of your filesystem, even when no new sounds were found
- Fixed a race condition where rapidly rescanning the sound library could cause unsaved changes to be lost
- Added a **Refresh** button to the sound library panel that rescans your folders for new or removed audio files on demand
- The sound library now automatically rescans your folders when the app loads, so newly added files appear without manual intervention
- The app now clearly communicates that project save locations and watched folders must be within Music, Documents, Downloads, or Desktop — hints appear in the Save Project dialog, Settings, sound library empty state, and missing file/folder resolution dialogs.
- Tightened file system and folder-open permissions to scope app data access to the SoundsBored folder only, rather than your entire home directory and app data root.

## v1.3.2

Fade and crossfade operations are now significantly more reliable — hold-mode pads are correctly excluded, tapping a fading-out pad reverses it instead of doing nothing, and the audio engine now independently tracks pad state for more consistent behavior. This release also hardens security by validating sound file paths against directory traversal attacks and tightening shell permissions to the minimum required.

- Tightened shell permissions: removed broad `shell:allow-execute` and `shell:default` capabilities, keeping only the minimum required (`allow-spawn`, `allow-kill`)
- Sound file paths and folder paths are now validated to block path traversal attacks (e.g., `../../etc/passwd`), preventing malicious project files from accessing files outside their intended directories.
- Fixed a bug where crossfade selection incorrectly tracked the target pad as volume-transitioning after completing a crossfade
- Improved fade mode behavior: non-fadeable pads (hold-mode pads, mixed-mode pads) now explicitly show as "invalid" when selected during crossfade, making their ineligibility clearer
- Pads set to "hold" mode are now correctly excluded from fade and crossfade operations, preventing unintended audio behavior when triggering fades on hold-mode pads.
- Mixed-mode pads (containing both hold and non-hold layers) are also excluded from fade operations for consistent, predictable behavior.
- Pads using "hold" playback mode are now correctly excluded from fade and crossfade operations — tapping a hold or mixed-mode pad during a fade does nothing instead of triggering undefined audio behavior.
- Fade duration now correctly reads the global fade setting when triggering fades and crossfades, rather than ignoring it
This diff is purely internal test infrastructure — wrapping renders in a `TooltipProvider`. No user-facing changes occurred.

There are no customer-facing changelog entries to write for this diff.
- Fade and crossfade controls now correctly detect whether a pad is playing or stopped internally, eliminating edge cases where the wrong action (fade in vs. fade out) could be triggered
- Tapping a pad that is already fading out now reverses the fade instead of ignoring the tap
- Crossfade mode no longer requires the UI to track which pads are playing — the audio engine handles this automatically for more reliable behavior

## v1.3.1

This release adds Cycle Mode for sequential and shuffled layers — letting each pad trigger advance through sounds one at a time instead of all at once — along with rich tooltips and context-sensitive helper text throughout the pad configuration drawer to make every setting self-explanatory. Under the hood, significant reliability and performance improvements land as well: drag-to-reorder and layer auto-open work more consistently, pad volume dragging feels more responsive, and the audio engine is more stable with fixes for edge cases that could cause sounds to incorrectly restart or fail to stop.

- Added informational tooltips to all layer config controls (Sound Selection, Arrangement, Playback Mode, Retrigger Mode, Fade Duration) so hovering the info icon explains what each setting does
- Added context-sensitive helper text below each control that updates dynamically based on your current settings combination (e.g. "All 3 assigned sounds play together on each trigger")
- Improved tag mode helper text: now shows a prompt to select tags when none are chosen, a no-match warning when tags don't match any sounds, and a count with mode context when sounds do match
- Added a helper note in Set mode explaining that sounds are drawn at trigger time and membership is managed in the Library panel
- Fade Duration now shows distinct helper text for global default vs. pad-specific override
- Added **Cycle Mode** for sequential and shuffled layers: each pad trigger now plays one sound at a time, advancing through the sequence step-by-step instead of playing the full chain at once
- In Cycle Mode, loop and hold playback modes loop the current sound in the sequence rather than chaining through all sounds
- Switching a layer's arrangement back to simultaneous automatically disables Cycle Mode
- Stopping a pad or all pads resets the cycle position, so the next trigger starts from the beginning of the sequence
- Fixed a bug where stopping one voice on a pad would incorrectly mark the entire pad as inactive when other voices were still playing
- Fixed a potential crash caused by re-entrant `onended` callbacks firing synchronously during layer stop — maps are now cleared before calling `stop()` so duplicate cleanup is safely ignored
- Improved audio engine reliability by consolidating all voice tracking into a single module, preventing edge cases where sounds could incorrectly restart after being stopped
- The "Stop All" button now more reliably halts all active sounds and previews
- Internal audio engine refactored for better reliability: runtime state (gain nodes, fade tracking, chain queues) is now isolated in a dedicated module, reducing the risk of edge-case bugs during complex playback scenarios.
- Fixed an edge case where rapidly stopping all pads while a layer trigger was in-flight could cause sounds to restart unexpectedly.
- Pad volume drag now pre-accumulates sensitivity during the hold phase, so dragging immediately after a long press responds with full (or near-full) sensitivity instead of starting sluggish.
- The fade duration slider in Settings now debounces saves — settings are written to disk only after you stop adjusting, not on every tick
- Pending slider changes are flushed to disk immediately if the Settings dialog is closed before the debounce fires, preventing data loss
- Improved performance of crossfade mode: the "can execute" check and status label now update only when relevant state changes, reducing unnecessary re-renders.
- Pad buttons now re-render less often during playback, improving performance when many sounds are playing simultaneously
- The crossfade button now correctly enables/disables based on whether any pads are currently playing
- Opening the pad edit drawer is more reliable due to internal callback stability improvements
- No user-facing changes; internal test infrastructure updated to support new pad activity state tracking.
- No user-facing changes in this release (internal code cleanup only).
- Fixed a subtle timing bug in pad volume drag gesture where time-based sensitivity ramping could behave incorrectly in certain conditions
- No user-facing changes in this commit.
- Fixed a performance issue where the active scene was being recalculated on every auto-save; it now only re-evaluates when the scene list or active scene actually changes.
- Fixed a bug where dragging a scene or pad to the last position in the list would fail silently, leaving the order unchanged.
- Improved internal code quality in layer reordering tests (no user-facing behavior changes)
- Improved stability of the layer list in pad configuration — newly added layers now open automatically and scroll into view more reliably
- Fixed an edge case where the open layer could become desynced after a form reset
- Drag-to-reorder layers in pad configuration is more efficient and less prone to unnecessary re-renders
- Pad colors are now validated to require a proper 6-digit hex format (e.g. `#FF5500`), preventing invalid color values from being saved to a project.
- Improved internal performance: pad volume transition tracking now uses a Set for O(1) lookups instead of an array, reducing redundant state updates during fade/crossfade operations
- Improved internal playback tracking to use a more efficient data structure, resulting in more reliable pad state detection and faster "is playing" lookups across the app.

## v1.3.0

- Fixed a bug where holding a pad with mixed playback modes would use the wrong starting volume for some layers
- Added a comprehensive manual test suite (`docs/manual-tests/`) covering 18 scenarios including audio playback, pad/scene deletion, sound import, yt-dlp downloads, mute groups, and retrigger modes
- Test docs confirm fixes for issues #1–#10, including Stop All chain-queue clearing, audio cleanup on pad/scene deletion, loop/mode changes mid-playback, and hold-volume accuracy on mixed pads
- Fixed a bug where pressing a pad with mixed hold + one-shot layers would incorrectly inherit a stale near-zero volume from a fading one-shot voice, causing the hold layer to trigger at the wrong volume instead of full volume.
- When editing a pad's configuration while it is playing, a notice now appears informing you that sound selection changes will take effect on the next trigger.
- Sound selection changes made while a pad is playing are now applied correctly at the next chain step — the current sound plays to completion without interruption.
- Loop restarts now use the latest sound selection from the store, so mid-playback changes to which sounds are assigned take effect at each loop boundary.
- The "Stop All" button in the sound library panel now also stops any actively previewing sound, not just playing pads
- The "Stop All" button is now enabled while a sound preview is playing, even if no pads are active
- Fixed a bug where retriggering a pad in "continue" mode could cause the playback progress bar to disappear for streaming (large-file) audio.
- Fixed a bug where triggering a pad with multiple simultaneous layers using large audio files could cause only the most recently started element to be tracked, leading to incorrect playback progress and potential audio element leaks
- Playback progress bar for multi-layer pads now correctly reflects the longest-duration active audio element rather than whichever started last
- Pad config saves now sync all layer audio settings (playback mode and arrangement) in a single unified update, replacing two separate sync calls.
- Internal audio engine code was simplified by consolidating `liveArrangement` and `livePlaybackMode` helper functions into one generic helper.
- Changing a layer's arrangement type (e.g. sequential → simultaneous) while a pad is actively playing now takes effect correctly without requiring a retrigger.
- Switching between chained arrangements (sequential ↔ shuffled) mid-playback rebuilds the playback queue so the current sound plays out and the new sequence follows.
- Switching from a chained arrangement to simultaneous mid-playback lets the current sound finish, then resumes with all sounds playing together as expected.
- Looping behavior after arrangement changes is now consistent — the engine reads the live arrangement from the project when a chain exhausts, so loop restarts reflect the updated config.
- Fixed an issue where saving pad configuration could include unexpected extra fields in layer data
- Added internal design spec and implementation plan for the `fix-github-issue` skill, which automates researching and fixing GitHub issues using parallel AI agents with a built-in code review cycle.
- Fixed a bug where deleting or reordering layers in the pad config drawer could reassign layer IDs, causing incorrect playback behavior for loops and retrigger tracking.
- Fixed a bug where switching playback mode from "chained" to "loop" mid-playback would not properly restart the loop chain at the next boundary
- Fixed a crash/hang that could occur when the project was cleared while audio was still playing
- When you switch a pad's playback mode to **loop** while it's already playing a sequential chain, the change now takes effect at the next natural sound boundary — no need to retrigger the pad.
- Changing a pad layer's playback mode (e.g., loop → one-shot) while audio is playing now takes effect immediately without requiring a retrigger.
- Looping sounds correctly stop looping when playback mode is switched to one-shot or hold mid-playback.
- Sequential looping chains are cancelled when switching away from a looping mode, preventing sounds from restarting unexpectedly after the current playback ends.
- Deleting a pad now stops any audio it's currently playing, preventing sounds from continuing after the pad is removed.
- Deleting a scene now automatically stops any audio playing from that scene's pads
- Deleting a pad now stops any audio it is playing before removing it, preventing sounds from continuing after a pad is deleted.
- Fixed the Stop All button to properly stop all playing sounds through the audio engine instead of only updating store state
- Fixed an internal audio ordering issue where simultaneous and sequential playback modes now correctly share the same sound ordering logic, improving consistency when triggering pads.
- Improved UI rendering performance by replacing inline overlay state selectors with stable selector factories, preventing unnecessary re-renders when overlay state changes
- Temporary project folder cleanup failures are now handled silently instead of logging a warning
- Failed sound file copies during import are silently skipped; callers determine success by inspecting the returned file list
- Added inline comments clarifying why migration-related `console.warn` calls are intentional diagnostic output, not bugs
- Refactored internal pad configuration code to eliminate duplicate default layer definitions (no user-facing behavior change)
- No user-facing changes in this release.

## v1.2.1

This release introduces **Export to ZIP** — a fully async export that packages your project and all referenced sounds into a portable archive with cancellation support and a real-time progress dialog. It also brings significant pad interaction polish (3D tilt effects, animated pulse rings, smarter fade-freeze and fade-reversal behavior, color-coded fade states), a new Any/All tag filter toggle with live match counts, and the `Ctrl+Shift+E` / `Ctrl+Shift+S` keyboard shortcuts for Export and Save As.

- Export dialog no longer close when clicking outside (fixes accidental dismissal)
- The Export keyboard shortcut changed from `Ctrl+X` to `Ctrl+Shift+E`
- Added `Ctrl+Shift+S` keyboard shortcut for Save As
- Canceling an in-progress export now shows a confirmation prompt instead of canceling immediately
- Pressing Escape or clicking outside the export dialog now triggers the cancel confirmation (instead of doing nothing)
- Added a progress dialog for project export showing real-time status (preparing, zipping, complete, or error) with a cancel button
- Export now runs asynchronously with cancellation support — you can cancel mid-export without leaving a partial zip file
- Export now includes sounds referenced via tags and sets, not just directly assigned sounds
- Export destination folder is selected upfront, and the resulting zip includes a `sound-map.json` for portability
- No user-facing changes in this commit (internal test improvements only)
- Added **Export to ZIP** — you can now export your project as a self-contained zip archive from the menu (saves first, then packages all referenced sounds and project files)
- **Save As** menu button now works correctly, opening the Save As dialog
- Export button is disabled while an export is in progress to prevent duplicate exports
- Pressing a pad that is currently fading out now freezes the audio at its current volume instead of restarting playback, giving you a smoother way to cancel a fade mid-animation.
- Folder nodes in the sound library tree now animate open and closed when expanded or collapsed.
- Pad buttons now have a more subtle hover tilt effect (reduced from 8° to 4° rotation)
- Starting a fad on a fading-out pad now reverses the fade, smoothly bringing it back to full volume instead of stopping it
- Pad buttons now have a subtle 3D tilt effect that responds to mouse movement
- Playing pads display an animated pulse ring indicator
- Pads and layers animate in smoothly when added or when switching scenes
- Layer accordion sections now animate open/close with a smooth expand/collapse transition
- Newly added layers automatically scroll into view and expand when created
- Volume indicators on pads now linger briefly after a fade completes, so you can see the final volume level before the display disappears.
- Pads now show color-coded visual states when entering fade mode: currently playing pads highlight in amber (fading out) and non-playing pads highlight in green (fading in), making it clearer which pads will be affected by a fade action.
- Tag-based sound selection now supports an **Any/All toggle** — choose whether a sound must match any one tag (OR) or all selected tags (AND)
- The sound selector now shows a **live match count** (e.g. "2 sounds match") when tags are selected in tag mode
- Saving a pad config now **validates tag and set selections** upfront — shows an error if no sounds in the library match the chosen tags or set
- Updated README with comprehensive documentation covering architecture, setup, development workflow, and contributing guidelines
- Added a new user-facing guide (`README.user.md`) with instructions for installation, scene/pad management, sound library, fade/crossfade, and keyboard shortcuts
- Volume fill bar on pads now animates smoothly during fades and drag-to-adjust gestures, accurately reflecting real-time volume changes
- Focus outlines have been removed from buttons and interactive elements for a cleaner visual appearance
- Fade-in and fade-out transitions now animate the volume bar from start to finish rather than jumping immediately to the target value
- The volume bar correctly disappears after a gesture or fade completes, and no longer briefly flickers when quickly tapping a pad
- Fixed the set selector in pad configuration so the selected set name displays correctly instead of showing blank or the raw ID.
- Improved visual consistency across dialogs, menus, and buttons with refined styling and spacing
- Unused fonts (Dimitri Regular, Gladiator) removed, reducing app size
- Tab controls in pad configuration now stretch to fill available width for a cleaner layout
- Save Project dialog now uses the standard styled input and label components
- Download queue cancel button and status icons updated with improved styling
- Added a loading screen that displays while critical background images preload, preventing layout flashes on startup
- Preloads all background and decorative images in the background for smoother visual transitions

## v1.1.8

Version 1.1.7 introduces comprehensive fade controls, including individual pad fade-in/out (F key), one-click crossfade between pads (X key), per-pad configurable fade durations, and a global default fade duration setting in App Settings. This release also fixes audio issues where hold-mode pads could start at reduced volume after release, and improves the volume adjustment display to show pad name and volume simultaneously.

- Added support for a global fade duration setting (in milliseconds) for audio playback control
- Pad crossfade duration now correctly persists when editing pad settings
- Fixed a bug where hold-mode pads could start at reduced volume after being released — gain now resets to full on pointer up or cancel.
- Updated app to version 1.1.7
- Pads can now be faded in or out individually using a new **Fade** button (or `F` hotkey) in the scene toolbar
- A new **Crossfade** button (or `X` hotkey) lets you simultaneously fade out playing pads and fade in silent ones with a single gesture
- Each pad now has a configurable **Fade Duration** slider in its config drawer, with a "Reset to default" option
- A new **Playback** tab in App Settings lets you set a global default fade duration (0.1s–10s, default 2s)
- Pad name and volume percentage are now shown together during volume adjustment instead of toggling between them

## v1.1.7

Scenes and pads can now be drag-and-dropped to reorder them in edit mode, with a movement threshold that prevents accidental drags on click. Volume drag has been significantly improved — it now uses a smooth sensitivity ramp and curved response for more precise control, with visual jitter and unexpected jumps eliminated.

- Version bumped to 1.1.5
- Updated Tauri dialog and file system plugins to latest versions
- Volume drag now uses a smooth time-based sensitivity ramp instead of a power curve — sensitivity starts at zero when drag begins and reaches full within 150ms, preventing accidental jumps
- The volume fill bar no longer animates with a CSS transition while actively dragging, eliminating visual jitter
- Drag gestures are now properly cancelled (e.g. when the pointer leaves the window), cleaning up fill bar state and stopping sounds that were triggered at near-zero volume
- Improved repository hygiene by excluding worktree directories from version control
- Added a design spec for fixing pad volume drag behavior: sensitivity now ramps up over 150ms from drag start instead of using a distance-based power curve, making rapid gestures feel more responsive
- Fixed a visual stutter issue where the volume fill bar would jerk during fast drags; the CSS transition is now disabled while actively dragging and re-enabled on release
- Dragging the volume control on a pad no longer jumps unexpectedly when you hold the button still before dragging — mouse drift during the press-and-hold window is now ignored correctly.
- Volume drag now uses a curved response, making small adjustments near the current volume easier and more precise while still covering the full range with a large drag.
- The yellow volume fill bar now animates smoothly into view when you press and hold a pad, instead of popping in abruptly.
- Fixed a bug where drag-and-drop pad reordering could crash or behave incorrectly in certain scenarios
- Dragging scenes and pads to reorder them is now more reliable — drag now requires a small movement threshold before activating, preventing accidental drags on click
- Pad drag-and-drop is now disabled when not in edit mode, matching existing scene tab behavior
- Fixed edge cases where reordering scenes or pads with invalid positions could corrupt order or mark the project as changed unexpectedly
- Scenes can now be drag-and-dropped to reorder them in the tab bar (available in edit mode)
- Pads can now be drag-and-dropped to reorder them within a scene (available in edit mode)

## v1.1.4

No user-facing changes in this release.

- No user-facing changes in this release.

## v1.1.3

Fixed release pipeline to pull the latest changelog from the master branch before extracting release notes, preventing stale or missing changelog entries in releases.

- Fixed release pipeline to pull the latest changelog from the master branch before extracting release notes, preventing stale or missing changelog entries in releases.

## v1.1.2

Changelog generation now focuses on customer-facing improvements rather than internal developer details, and section detection has been made more reliable using precise regex matching to prevent false positives on embedded text.

- Changelog generation prompts updated to focus on customer-facing changes rather than developer-facing details
- Removed debug logging statements from the pre-commit hook and changelog-entry script
- Fixed changelog section detection to use regex with multiline anchors (`^## Current Changes$`) instead of plain `indexOf`, preventing false matches on embedded text

## v1.1.0

Release notes are now automatically generated by Claude and stamped into `CHANGELOG.md` via git hooks, keeping your changelog accurate with zero manual effort. The release workflow has been updated to publish these notes directly to GitHub releases, with separate full and summary variants for different contexts.

- Added a `pre-push` git hook that auto-stamps `CHANGELOG.md` with the version heading, Claude-generated release summary, and bullet points when pushing a version tag
- Updated the release workflow to prefer the pre-stamped version section in `CHANGELOG.md` over `## v1.1.1`, with a fallback if the hook didn't run
- Release workflow now exposes two separate env vars: `RELEASE_NOTES_FULL` (all bullets) for the GitHub release body, and `RELEASE_NOTES_SUMMARY` (intro paragraph) for the updater release notes
- `package.json` `prepare` script updated to also `chmod +x` the new `pre-push` hook
- Added a pre-commit hook that auto-generates changelog entries using Claude CLI and inserts them under a `## Current Changes` section in `CHANGELOG.md`
- Release workflow now extracts `## Current Changes` as release notes, stamps the section with the version number, and publishes notes to GitHub releases on both repos
- Release artifact downloads and uploads now filter to specific file patterns (`*.exe`, `*.msi`, `*.sig`, `*.json`) instead of grabbing everything
- Added a `prepare` npm script to auto-configure the git hooks path and set executable permissions on install
