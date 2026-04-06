# Manual Test: Sound selection change notice shown while pad is playing

**Issue:** #9 — Sound selection changes saved to a playing pad do not affect currently active voices  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` (playing pad notice)  
**Risk area:** Any change to `PadConfigDrawer`, `isPlaying` detection, or the notice banner

---

## Background

Active voices are not interrupted when you change sound assignments mid-playback — the current sounds play to completion. The fix adds a notice banner in the drawer to set user expectations.

---

## Setup

1. Create a pad with a **loop** layer and one sound assigned.
2. Save the pad.

## Steps — Notice appears while playing

1. Trigger the pad so it loops.
2. Enter **Edit Mode** and click the edit icon on the playing pad to open its config drawer.

## Expected Result

- A notice is visible near the top of the drawer: *"Sound selection changes will apply on the next trigger."* (or similar wording)
- The notice is **not shown** in the drawer title or blocking the form.

## Failure Indicators

- No notice is shown while the pad is playing.
- The notice is shown even when the pad is not playing.

---

## Steps — Notice disappears when pad stops

1. With the drawer open and the pad looping (notice visible), click **Stop All**.

**Expected:** The notice disappears while the drawer remains open. The sounds panel is still editable.

---

## Steps — Notice appears dynamically when pad starts

1. Open the config drawer for a **stopped** pad — no notice should be visible.
2. Without closing the drawer, trigger the pad from the scene view.

**Expected:** The notice appears in the drawer while the pad is now playing, without closing or reopening the drawer.

---

## Steps — Notice not shown in create mode

1. Click **Add Pad** to open the drawer in create mode (no padId).
2. Even if other pads are playing, no notice should appear.

**Expected:** No notice banner in the create pad drawer.
