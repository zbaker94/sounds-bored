# Manual Test: Changing playbackMode stops the active loop

**Issue:** #4 — Changing playbackMode from loop to one-shot on a playing pad has no effect  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`, `src/lib/audio/padPlayer.ts` (`syncLayerConfig`)  
**Risk area:** Any change to `syncLayerConfig`, `PadConfigDrawer.onSubmit`, or playback mode handling

---

## Setup

1. Create a pad with **playbackMode: Loop** and a short sound (1–3 seconds works best so you can hear the loop).
2. Save the pad.

## Steps — Loop to One-shot

1. Trigger the pad — it should loop continuously.
2. Open the pad config drawer (edit icon in Edit Mode, or direct edit).
3. Change **Playback Mode** from **Loop** to **One-shot**.
4. Click **Save**.

## Expected Result

- Playback stops immediately.
- A toast appears: *"Playback stopped to apply loop mode change."* (or similar)
- Clicking the pad again plays the sound once and stops.

## Failure Indicators

- The pad continues looping after Save.
- The store shows `one-shot` but the audio source still loops.

---

## Steps — Loop to Hold

1. Trigger a loop pad.
2. Open config drawer, change mode to **Hold**, and Save.

**Expected:** Audio stops. Clicking and holding the pad plays while held; release stops it.

---

## Steps — Hold to Loop

1. Configure a pad as **Hold** mode.
2. Press and hold the pad so it plays.
3. While holding, open config and change to **Loop**.
4. Save (or release pointer first, then open config).

**Expected:** Mode change noted. On next trigger the pad loops continuously without requiring hold.
