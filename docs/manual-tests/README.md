# Manual Test Suite — SoundsBored

These documents describe manual verification steps for behaviors that were introduced as fixes to reported issues. Run these after making changes to the audio engine, pad management, or playback controls to confirm nothing regressed.

## Index

| Doc | Issue | Area | Summary |
|-----|-------|------|---------|
| [01-stop-all-chain-queue.md](01-stop-all-chain-queue.md) | #1 | Audio / PlaySection | Stop All clears the chain queue before stopping voices |
| [02-delete-pad-audio-cleanup.md](02-delete-pad-audio-cleanup.md) | #2 | Pad management | Deleting a playing pad stops its audio |
| [03-delete-scene-audio-cleanup.md](03-delete-scene-audio-cleanup.md) | #3 | Scene management | Deleting a scene stops all its playing pads |
| [04-playback-mode-change.md](04-playback-mode-change.md) | #4 | PadConfigDrawer | Changing loop→one-shot lets current buffer finish then stops; no restart |
| [05-layer-id-stability.md](05-layer-id-stability.md) | #5 | PadConfigDrawer | Deleting/reordering layers preserves correct IDs |
| [06-arrangement-mid-playback.md](06-arrangement-mid-playback.md) | #6 | PadConfigDrawer | Arrangement change silently rebuilds chain queue; no toast shown |
| [07-multi-layer-streaming.md](07-multi-layer-streaming.md) | #7 | Audio / padPlayer | Multi-layer streaming pads track all voices correctly |
| [08-stop-all-stops-preview.md](08-stop-all-stops-preview.md) | #8 | Audio / PlaySection | Stop All also stops any active sound preview |
| [09-sound-selection-notice.md](09-sound-selection-notice.md) | #9 | PadConfigDrawer | Sound selection change notice shown while pad is playing |
| [10-mixed-pad-hold-volume.md](10-mixed-pad-hold-volume.md) | #10 | usePadGesture | Hold gesture on mixed pad starts at correct volume |

### Additional coverage (not tied to a specific issue)

| Doc | Area | Summary |
|-----|------|---------|
| [11-fade-crossfade-mode.md](11-fade-crossfade-mode.md) | Fade / Synchronized Fades | Per-pad fade popover (levels, duration, execute); multi-pad synchronized fades |
| [12-retrigger-modes.md](12-retrigger-modes.md) | Audio engine | All four retrigger modes: restart, continue, stop, next |
| [13-mute-groups.md](13-mute-groups.md) | Audio engine | Exclusive mute (hi-hat style) and directional mute |
| [14-missing-sound-resolution.md](14-missing-sound-resolution.md) | File management | Resolve individual or all missing sounds; name mismatch and duplicate flows |
| [15-project-lifecycle.md](15-project-lifecycle.md) | Project I/O | New (0 scenes, auto-named), save as, auto-save, unsaved changes dialog, close and reload |
| [16-sound-import.md](16-sound-import.md) | Sound library | File picker and drag-and-drop import; dedup, extension filter, Imported tag |
| [17-ytdlp-download.md](17-ytdlp-download.md) | yt-dlp | Download, stream-while-downloading, cancel, error handling |
| [18-sound-preview-playback.md](18-sound-preview-playback.md) | Sound library | Preview toggle, sound switching, missing file error, project close cleanup |
| [19-pad-control-popover.md](19-pad-control-popover.md) | SceneView / PadControlContent | Per-pad popover: start/stop, duplicate, delete, per-layer play, skip, sound list |
| [20-keyboard-shortcuts.md](20-keyboard-shortcuts.md) | Global hotkeys | All keyboard shortcuts: Esc, Ctrl+S/Shift+S, Mod+E, arrows, number keys, multi-fade |

## Prerequisites

- Tauri dev build running (`npm run tauri dev`)
- A project loaded with at least one scene
- At least one audio file imported into the sound library (a short `.wav` or `.mp3` works)

## Conventions

- **Pass** — behavior matches the expected result exactly
- **Fail** — behavior does not match, or audio does not stop when expected
- **N/A** — precondition could not be met (note why)
