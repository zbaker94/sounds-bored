# Manual Test: Sound import — file picker and drag-and-drop

**Feature area:** `src/lib/import.ts`, `src/hooks/useImportSounds.ts`  
**Risk area:** Any change to import logic, library reconciliation, or the "Imported" tag assignment

---

## Setup

Have a folder with a mix of files: some valid audio files (`.mp3`, `.wav`, `.ogg`, `.flac`), one `.txt` file, and one `.jpg` file.

---

## Test A: Import via file picker

1. In the Sounds panel, click the **Import** button.
2. Select 2–3 audio files from the file picker.
3. Click Open/Confirm.

**Expected:**
- New sounds appear in the library list immediately.
- Each sound's name defaults to the filename without extension.
- All new sounds have the **Imported** tag applied automatically.
- The audio files are copied into the project's `sounds/` folder (verify in file explorer).
- Original source files are not moved or deleted.

---

## Test B: Non-audio files are filtered

1. Open the import dialog.
2. Attempt to select a `.txt` or `.jpg` file.

**Expected:**
- The file picker only shows/allows audio file types (or the import silently ignores non-audio files if multi-select includes them).
- No error toast for the non-audio files; they are simply skipped.
- Only valid audio files are added to the library.

---

## Test C: Importing duplicate files is idempotent

1. Import `kick.wav` — it appears in the library.
2. Import `kick.wav` again (same file, same name).

**Expected:**
- The file is not duplicated in the library.
- A toast or silent skip indicates the file already exists.
- The `sounds/` folder contains exactly one copy.

---

## Test D: Drag-and-drop import

1. Open the Sounds panel.
2. Drag one or more audio files from your file explorer onto the Sounds panel or the main editor area.
3. Drop the files.

**Expected:**
- Same behavior as file picker import: files copied to `sounds/`, added to library with the **Imported** tag.
- Non-audio files dragged in are ignored.

---

## Test E: Case-insensitive extension handling

1. Rename a sound file to have an uppercase extension: `BOOM.WAV` or `FX.MP3`.
2. Import it via the file picker or drag-and-drop.

**Expected:**
- File is recognized as a valid audio file.
- Appears in the library with name `BOOM` or `FX`.

---

## Test F: Import persists across project reload

1. Import a sound.
2. Close the project (with auto-save or manual save).
3. Re-open the project.

**Expected:**
- The imported sound is still in the library.
- The **Imported** tag is still applied.
- The sound file exists in the project's `sounds/` folder.

---

## Test G: "Imported" tag is created if it doesn't exist

1. Start with a fresh project that has no tags.
2. Import any sound.

**Expected:**
- The **Imported** system tag is created automatically.
- The new sound is tagged with it.
- The tag appears in the tag filter/list in the Sounds panel.
