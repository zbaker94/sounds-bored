# Manual Test: Deleting a scene stops all playing pads

**Issue:** #3 — Deleting a scene with playing pads leaks all pad audio  
**File changed:** `src/components/composite/SceneTabBar/SceneTabBar.tsx` (delete confirm handler)  
**Risk area:** Any change to `ConfirmDeleteSceneDialog`, `stopScene`, or scene deletion flow

---

## Setup

1. Create a scene with **2 or more pads**, each with a loop-mode sound.
2. Save the project.

## Steps

1. Trigger both pads so they are both looping — audio from both should be audible.
2. Right-click (or use the delete icon) on the active scene tab to open the delete dialog.
3. Confirm deletion by clicking **Delete**.

## Expected Result

- All audio from both pads stops immediately on confirmation.
- The scene tab is removed.
- No audio plays after deletion (confirm by waiting 5+ seconds).
- If other scenes exist, the next scene becomes active with no audio playing.

## Failure Indicators

- One or both pads continue playing after the scene is deleted.
- Audio continues indefinitely — the only way to stop it is to close the app.

---

## Variant: Sequential/chained pad in deleted scene

1. Create a pad with a sequential arrangement and 3+ sounds.
2. Trigger it so the chain is advancing.
3. Delete the scene while the chain is mid-sequence.

**Expected:** Chain stops advancing. No additional sounds play after deletion.
