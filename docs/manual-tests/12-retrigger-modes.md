# Manual Test: Retrigger modes (restart / continue / stop / next)

**Feature area:** `src/lib/audio/padPlayer.ts` — retrigger logic per layer  
**Risk area:** Any change to `triggerPad`, retrigger handling, or `layerChainQueue` management

---

## Background

RetriggerMode controls what happens when a pad is triggered while it is already playing. Set per layer in the pad config under Advanced / Retrigger. The four modes are: **Restart**, **Continue**, **Stop**, and **Next**.

---

## Setup for each test

Create a pad with a **single layer**, one sound assigned, and the specified retrigger mode. Use a sound that is at least 3 seconds long so there is time to retrigger before it ends.

---

## Test A: Restart mode

**Mode:** Restart

1. Click the pad — sound starts playing from the beginning.
2. While still playing (e.g., 1 second in), click the pad again.

**Expected:** Sound immediately restarts from 0:00. No double-voice overlap (old voice stops cleanly before or simultaneously with new voice starting).

---

## Test B: Continue mode

**Mode:** Continue

1. Click the pad — sound starts.
2. While playing (~1 second in), click the pad again.

**Expected:** Sound continues from its current position without interruption. No restart, no additional voice layered on top.

---

## Test C: Stop mode

**Mode:** Stop

1. Click the pad — sound starts.
2. While playing, click the pad again.

**Expected:** Sound stops (with a short fade-out to avoid a pop). Clicking a third time starts the sound again from the beginning.

---

## Test D: Next mode (sequential layer)

**Mode:** Next  
**Layer arrangement:** Sequential, 3+ sounds assigned

1. Trigger the pad — first sound plays.
2. Before the first sound finishes, click the pad again.

**Expected:** Playback skips to the next sound in the sequence immediately. Each subsequent click advances to the next sound in order.

---

## Test E: Retrigger during a fade

**Mode:** Restart  

1. Trigger a pad.
2. Press **F** (fade mode) and click the pad to begin a fade-out.
3. While the pad is fading, click the pad directly (not through fade mode).

**Expected:** The retrigger mode (Restart) takes effect — the sound restarts from the beginning at full volume, cancelling the fade. The fade visual clears.
