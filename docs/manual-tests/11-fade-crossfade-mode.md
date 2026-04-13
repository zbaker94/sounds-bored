# Manual Test: Fade and Synchronized Fades

**Feature area:** `PadControlContent.tsx` (fade popover), `useMultiFadeMode.ts`, `multiFadeStore.ts`, `padPlayer.ts` (`fadePadWithLevels`)  
**Risk area:** Any change to fade level controls, fade duration, multi-fade store, or the Synchronized Fades flow

---

## Background

Each pad's control popover (click the pad name/card) contains a **Fade In / Fade Out** section with:
- A **fade level range slider** — the two thumbs set from-volume and to-volume (0–100%)
- A **Fade Duration slider** — per-pad override (100 ms – 10 s); when unset, uses the global default from Settings
- A **Reset to default** link — clears the per-pad duration override
- A **Fade In** (pad stopped) or **Fade Out** (pad playing) execute button

**Synchronized Fades** button in the same popover enters a multi-pad mode where multiple pads can be faded simultaneously. Hotkeys in this mode: **Enter** to execute, **Escape** to cancel.

---

## Test A: Single-pad Fade Out (pad is playing)

1. Trigger a pad so it plays.
2. Click the pad to open its control popover.
3. Adjust the fade level slider if needed (default: 100% → 0% for a fade-out).
4. Click **Fade Out**.

**Expected:**
- The pad fades out over the configured fade duration.
- After the fade completes, the pad is no longer playing.

---

## Test B: Single-pad Fade In (pad is stopped)

1. Ensure a pad is not playing.
2. Open its control popover.
3. Set the fade level slider start thumb to 0% and end thumb to 100%.
4. Click **Fade In**.

**Expected:**
- The pad starts at near-silence and fades up to full volume over the fade duration.
- The pad continues playing (at full volume) after the fade-in completes.

---

## Test C: Per-pad fade duration override

1. Open a pad's popover — note the current fade duration shown.
2. Drag the **Fade Duration** slider to a very short value (e.g., 0.1 s).
3. Execute a Fade Out.

**Expected:** Fade completes in ~0.1 s — noticeably faster than the global default.

4. Click **Reset to default**.

**Expected:** The per-pad override is removed; the slider shows the global default duration.

---

## Test D: Fade level slider — partial fade

1. Set the fade level slider to **50% → 0%** while the pad is playing.
2. Execute Fade Out.

**Expected:** The pad fades from 50% down to silence (not from 100%). The start volume jump to 50% is audible before the fade begins.

---

## Test E: Synchronized Fades — multi-pad fade

1. Trigger two pads so both are playing.
2. Open one pad's popover and click **Synchronized Fades**.
3. The popover closes and the scene enters multi-fade mode (a pill/banner appears at the bottom of the scene).
4. Click the second playing pad — it joins the fade selection (both pads are now highlighted).
5. Press **Enter** (or use the execute button in the multi-fade pill).

**Expected:**
- Both pads fade out simultaneously over their respective fade durations.
- Multi-fade mode exits after execution.

---

## Test F: Synchronized Fades — cancel with Escape

1. Enter multi-fade mode (click Synchronized Fades on a pad).
2. Optionally select additional pads.
3. Press **Escape**.

**Expected:** Multi-fade mode cancelled. No pads are faded. All visual states return to normal.

---

## Test G: Synchronized Fades — auto-cancel on edit mode

1. Enter multi-fade mode.
2. Toggle edit mode (Mod+E or the edit button).

**Expected:** Multi-fade mode exits automatically. No fade is executed.

---

## Test H: Synchronized Fades — auto-cancel on overlay open

1. Enter multi-fade mode.
2. Open any overlay (e.g., Settings dialog).

**Expected:** Multi-fade mode cancels automatically when the overlay opens.
