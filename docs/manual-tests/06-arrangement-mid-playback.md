# Manual Test: Arrangement change mid-playback applies to the chain queue silently

**Issue:** #6 — Arrangement changes saved mid-playback do not flush the live chain queue  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`, `src/lib/audio/padPlayer.ts` (`syncLayerConfig` → `syncLayerArrangement`)  
**Risk area:** Any change to `syncLayerArrangement`, `layerChainQueue` handling, or `PadConfigDrawer.onSubmit`

---

## Background

When arrangement changes on a playing layer, `syncLayerArrangement` rebuilds or clears the active chain queue. No toast or notice is shown to the user — changes take effect immediately in the chain queue. The current sound plays to completion under the new arrangement logic.

Note: the notice banner *"Sound selection changes will apply on the next trigger"* visible in the drawer while a pad plays is **only** shown for sound selection changes, not arrangement changes.

---

## Setup

1. Create a pad with a **Sequential** layer containing at least 3 sounds (Sound A, Sound B, Sound C).
2. Save the pad.

## Steps — Change arrangement while chain is active

1. Trigger the pad — Sound A plays, then Sound B chains, then Sound C, etc.
2. While the chain is mid-sequence (Sound A is playing), open the pad config drawer.
3. Change **Arrangement** from **Sequential** to **Simultaneous**.
4. Click **Save**.

## Expected Result

- No toast or notice appears for the arrangement change.
- The chain queue is cleared immediately: after Sound A finishes, no further sounds chain.
- On the **next** trigger, all 3 sounds play simultaneously.

## Failure Indicators

- The chain continues in sequential order even after arrangement was changed to simultaneous.
- An unexpected toast or notice appears for the arrangement change.
- Clicking Save while mid-chain causes an audio error or silent failure.

---

## Steps — Change from Simultaneous to Sequential

1. Create a pad with a **Simultaneous** layer, 3 sounds.
2. Trigger the pad — all 3 play at once.
3. While playing, open config, change to **Sequential**, Save.

**Expected:** No toast. The chain queue is rebuilt; on next trigger, sounds play one at a time in sequence.

---

## Steps — Change from Sequential to Shuffled

1. Sequential layer with 4+ sounds.
2. Trigger, let it sequence to the 2nd or 3rd sound.
3. Open config, change to **Shuffled**, Save.

**Expected:** No toast. Chain queue rebuilt in a new random order. Current sound plays to completion. Next trigger plays in shuffled order.
