# Manual Test: Missing sound resolution dialogs

**Feature area:** `src/components/modals/ResolveMissingDialog.tsx`, `ResolveMissingFolderDialog.tsx`  
**Risk area:** Any change to missing-file detection, sound library persistence, or resolve dialogs

---

## Background

When a project is loaded and a sound file is not found at its stored path, it gets a runtime `missing: true` flag. The user can resolve individual sounds via a file-picker dialog, or re-point the entire sounds folder.

---

## Setup

1. Create a project with at least 2 sounds imported.
2. Save the project.
3. Close the project.
4. In your file explorer, **rename or move one of the audio files** in the project's `sounds/` folder (e.g., rename `kick.wav` to `kick_backup.wav`).
5. Re-open the project.

---

## Test A: Missing sound indicator appears

**Expected after re-opening:**
- The sound appears in the library with a missing indicator (warning icon or strikethrough).
- A toast notification mentions the missing sound(s).
- Pads that use the missing sound still appear in the scene but trigger silently or show a warning.

---

## Test B: Resolve individual missing sound — same filename

1. Click the resolve button / warning icon on the missing sound.
2. In the file picker, navigate to the renamed file and select `kick_backup.wav`.

**Expected:**
- The sound's `filePath` is updated in the library.
- The missing indicator disappears.
- Previewing the sound plays audio correctly.
- The library is saved to disk (confirmed by closing and re-opening — sound is still resolved).

---

## Test C: Resolve with a file that has a different name

1. The renamed file (`kick_backup.wav`) has a different basename than the original (`kick.wav`).
2. Open the resolve dialog and select the new file.

**Expected:**
- A "name mismatch" step appears in the dialog, showing the old basename vs. the new one.
- Confirming the name mismatch updates the sound name in the library.
- Cancelling at this step leaves the sound unresolved.

---

## Test D: Remove a missing sound from the library

1. Open the resolve dialog for a missing sound.
2. Click **Remove from Library** (instead of locating a file).

**Expected:**
- The sound is removed from the library.
- Any pads that referenced it still exist, but the layer's sound assignment is cleared or shows an empty state.
- The library is saved to disk.

---

## Test E: Re-pointing the entire sounds folder

**Setup:** Move the entire `sounds/` subfolder to a different location on disk.

1. Re-open the project — all sounds show as missing.
2. Use **Resolve Folder** (the option to re-point all sounds at once).
3. Select the new location of the `sounds/` folder.

**Expected:**
- All sounds that exist in the new folder are resolved in one step.
- Any sounds not found in the new folder remain missing.
- Resolved sounds are playable.
