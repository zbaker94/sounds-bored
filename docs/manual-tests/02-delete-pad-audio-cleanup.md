# Manual Test: Deleting a playing pad stops its audio

**Issue:** #2 — Deleting a playing pad leaks audio indefinitely  
**File changed:** `src/components/composite/SceneView/PadButton.tsx`  
**Risk area:** Any change to `PadButton` delete flow, `stopPad`, or `padPlayer`

---

## Setup

1. Create a pad with a **loop** playback mode layer and at least one sound.
2. Save the pad.

## Steps

1. Click the pad to start looping playback — audio should loop continuously.
2. Enter **Edit Mode** (toggle the edit mode button in the toolbar).
3. Click the **Delete** (trash) icon on the playing pad.
4. Confirm deletion in the dialog by clicking **Delete**.

## Expected Result

- Audio stops immediately when the dialog is confirmed.
- The pad is removed from the scene grid.
- No audio plays after deletion (confirm by waiting 5+ seconds).

## Failure Indicators

- Audio continues playing after the pad is deleted.
- The sound loops indefinitely with no way to stop it (Stop All is the only rescue).

---

## Variant: One-shot pad deletion mid-playback

1. Create a pad with a long one-shot sound (e.g., 10+ second ambient track).
2. Trigger the pad to start playback.
3. While the sound is playing (before it ends), enter Edit Mode and delete the pad.

**Expected:** Sound stops immediately on delete confirmation.
