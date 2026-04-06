# Manual Test: Stop All clears chain queue before stopping voices

**Issue:** #1 — Stop All button bypasses chain queue clear, causing sounds to restart  
**File changed:** `src/components/composite/SidePanel/PlaySection.tsx`  
**Risk area:** Any change to `PlaySection`, `padPlayer.stopAllPads`, or `playbackStore.stopAll`

---

## Setup

1. Create a pad with a single layer.
2. Set the layer **Arrangement** to **Sequential**.
3. Assign at least 2 sounds to that layer.
4. Save the pad.

## Steps

1. Click the pad to start playback — the first sound plays, then the second will chain.
2. While the first sound is still playing, click **Stop All** in the side panel.

## Expected Result

- All audio stops immediately.
- The second sound in the chain **does not** start playing.
- The Stop All button becomes disabled (no audio playing).

## Failure Indicators

- A second sound begins playing immediately after Stop All is clicked.
- The Stop All button remains enabled after clicking.

---

## Variant: Stop All during an active loop chain

1. Create a pad with a sequential layer, 2+ sounds, **playbackMode: loop**.
2. Trigger the pad — it will chain through sounds repeatedly.
3. Click Stop All.

**Expected:** All audio stops. The chain does not advance to the next sound.
