# Changelog

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
