# Manual Test: Fade and Crossfade mode

**Feature area:** `useFadeMode.ts`, `PadButton.tsx` (fade visuals), `useGlobalHotkeys.ts`  
**Risk area:** Any change to fade mode state, keyboard shortcuts, or pad button visual classes

---

## Background

Fade mode (F key) lets you fade a playing pad out over a configured duration. Crossfade mode (X key) simultaneously fades one pad out and another in. These modes are activated by hotkeys and require a playing pad to be meaningful.

---

## Setup

1. Load a project with at least 2 pads, each with a looping sound.
2. Open **Settings** and confirm a fade duration is set (e.g., 2 seconds).

---

## Test A: Basic Fade

1. Trigger a pad so it loops.
2. Press **F** to enter fade mode.
3. Click the playing pad.

**Expected:**
- The pad fades out over the configured fade duration.
- The pad button visual changes (amber border) during the fade.
- After fade completes, the pad is no longer playing.

---

## Test B: Fade cancellation

1. Enter fade mode (F).
2. Press **Escape** before clicking any pad.

**Expected:** Fade mode exits. No pads are affected. All visual states return to normal.

---

## Test C: Crossfade between two pads

1. Trigger Pad A so it loops.
2. Press **X** to enter crossfade mode.
3. Click Pad A (the playing one — it becomes the "fade out" pad, amber border).
4. Click Pad B (non-playing — it becomes the "fade in" pad, green border).
5. Press **Enter** (or click the execute button) to execute the crossfade.

**Expected:**
- Pad A fades out over the fade duration.
- Pad B starts playing and fades in simultaneously.
- After the crossfade, only Pad B is playing.

---

## Test D: Invalid pad in crossfade mode

1. Enter crossfade mode (X).
2. Attempt to click a pad that has only hold-mode layers or no sounds.

**Expected:** The pad is grayed out (opacity-40) and non-interactive during crossfade mode.

---

## Test E: Fade mode with non-default fade duration

1. Open **Settings**, set fade duration to **0.5 seconds**.
2. Trigger a pad, press F, click the pad.

**Expected:** Fade completes in about half a second — noticeably fast compared to the default.

---

## Test F: Crossfade mode exits on Escape

1. Enter crossfade mode (X), select the fade-out pad (amber).
2. Press **Escape** before selecting the fade-in pad.

**Expected:** Crossfade mode cancelled. No pads are faded or started.
