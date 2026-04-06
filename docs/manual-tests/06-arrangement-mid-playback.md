# Manual Test: Arrangement change mid-playback shows toast and applies on next trigger

**Issue:** #6 — Arrangement changes saved mid-playback do not flush the live chain queue  
**File changed:** `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`, `src/lib/audio/padPlayer.ts` (`syncLayerConfig`)  
**Risk area:** Any change to `syncLayerConfig`, `layerChainQueue` handling, or `PadConfigDrawer.onSubmit`

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

- A toast notification appears: *"Arrangement changes will apply on the next trigger."*
- The current chain plays out naturally (Sound A finishes, then the chain stops without advancing to B — OR the chain plays to completion, depending on `syncLayerConfig` behavior).
- On the **next** trigger, all 3 sounds play simultaneously.

## Failure Indicators

- No toast is shown.
- The chain continues in sequential order even after arrangement was changed to simultaneous.
- Clicking Save while mid-chain causes an audio error or silent failure.

---

## Steps — Change from Simultaneous to Sequential

1. Create a pad with a **Simultaneous** layer, 3 sounds.
2. Trigger the pad — all 3 play at once.
3. While playing, open config, change to **Sequential**, Save.

**Expected:** Toast shown. On next trigger, sounds play one at a time in sequence.

---

## Steps — Change from Sequential to Shuffled

1. Sequential layer with 4+ sounds.
2. Trigger, let it sequence to the 2nd or 3rd sound.
3. Open config, change to **Shuffled**, Save.

**Expected:** Toast shown. Current chain finishes or stops. Next trigger plays in a random order.
