# Changelog

## Current Changes
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
