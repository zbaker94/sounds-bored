# Manual Test: Project lifecycle — new, save, load, unsaved changes

**Feature area:** `src/hooks/useProjectLifecycle.ts`, `src/hooks/useWindowCloseHandler.ts`, `src/components/modals/ConfirmCloseDialog.tsx`  
**Risk area:** Any change to project save/load/close flow, dirty state tracking, or the unsaved changes dialog

---

## Test A: New project creation

1. From the Start Screen, click **Create New Project**.

**Expected:**
- Main editor opens immediately with **no scenes** ("No scenes yet" prompt and an **Add Scene** button are shown).
- The project is given an auto-generated name (`Untitled_XXXXXX_<timestamp>`); no name-entry dialog appears.
- Project is marked as **temporary** (no permanent file path yet — toolbar shows the unsaved indicator).

---

## Test B: Save As — temporary project becomes permanent

1. Create a new temporary project.
2. Add a pad or scene change so the project is dirty.
3. Click **Save As** (or the save button while temporary).
4. Choose a folder and confirm.

**Expected:**
- File dialog opens for folder selection.
- After saving, the project is no longer temporary.
- The `sounds/` subfolder is created inside the chosen folder.
- Re-opening the app shows this project in the recent list.

---

## Test C: Auto-save on dirty state

1. Open a permanent project.
2. Make a change (rename a pad, add a scene).
3. Wait for auto-save interval (check `useAutoSave.ts` for the interval — typically a few seconds).

**Expected:**
- No manual action required — changes persist to disk.
- No error toast.
- Reloading the project shows the changes.

---

## Test D: Unsaved changes dialog on window close

1. Open a permanent project.
2. Make a change (dirty state = true).
3. Close the app window (X button).

**Expected:**
- A dialog appears: *"You have unsaved changes. Save, Discard, or Cancel?"*
- **Save** persists changes and closes.
- **Discard** closes without saving (changes lost).
- **Cancel** returns to the app with the project still open.

---

## Test E: Window close on temporary project

1. Create a new temporary project (never saved to a real location).
2. Add some pads.
3. Close the app window.

**Expected:**
- Dialog warns that the project has never been saved.
- Discarding removes the temp project folder from disk (`$APPLOCALDATA/SoundsBored/temp_*/`).
- The Start Screen is shown on next launch with no orphaned temp project.

---

## Test F: Load recent project from Start Screen

1. Close the current project.
2. Return to the Start Screen.
3. Click a project in the **Recent Projects** list.

**Expected:**
- Project loads correctly with all scenes and pads intact.
- Sound library is correct.
- Active scene is the first scene.

---

## Test G: Load project via folder picker

1. From Start Screen, use **Open Folder** to browse to an existing project folder.
2. Select a folder containing `project.json`.

**Expected:**
- Project loads.
- If sounds are missing, a toast indicates how many.
- Recent projects list is updated.

---

## Test H: Close project mid-edit returns to Start Screen

1. Open a project.
2. Use the menu to close the project (without closing the app).

**Expected:**
- If dirty: unsaved changes dialog appears first.
- After close: Start Screen is shown.
- All audio stops before the project is unloaded.
