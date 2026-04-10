# Changelog

## Current Changes
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
