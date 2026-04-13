# Manual Test: Changing playbackMode stops the active loop

**Issue:** #4 — Changing playbackMode from loop to one-shot on a playing pad has no effect  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`, `src/lib/audio/padPlayer.ts` (`syncLayerConfig`)  
**Risk area:** Any change to `syncLayerConfig`, `syncLayerPlaybackMode`, `PadConfigDrawer.onSubmit`, or playback mode handling

---

## Setup

1. Create a pad with **playbackMode: Loop** and a short sound (1–3 seconds works best so you can hear the loop).
2. Save the pad.

## Steps — Loop to One-shot

1. Trigger the pad — it should loop continuously.
2. Open the pad control popover and click the edit icon to open the pad config drawer.
3. Change **Playback Mode** from **Loop** to **One-shot**.
4. Click **Save**.

## Expected Result

- No toast or notification is shown.
- For a **non-chained** (simultaneous) layer: the sound plays to the end of its current buffer iteration, then stops — it does **not** restart. The stop is not immediate; it happens at the natural end of the current loop point.
- For a **chained** (sequential/shuffled) layer: the chain queue is cleared; the current sound plays to completion and the next sound in the chain does not start.
- Clicking the pad again plays the sound once and stops.

## Failure Indicators

- The pad continues looping indefinitely after Save.
- The store shows `one-shot` but the audio source still loops on the next trigger.

---

## Steps — Loop to Hold

1. Trigger a loop pad.
2. Open config drawer, change mode to **Hold**, and Save.

**Expected:** The loop flag is cleared. The current sound plays to the end of its buffer then stops. Clicking and holding the pad plays while held; release stops it.

---

## Steps — Hold to Loop

1. Configure a pad as **Hold** mode.
2. Press and hold the pad so it plays.
3. While holding, open the config drawer and change to **Loop**.
4. Save (or release pointer first, then open config).

**Expected:** No toast shown. On the next trigger the pad loops continuously without requiring hold.
