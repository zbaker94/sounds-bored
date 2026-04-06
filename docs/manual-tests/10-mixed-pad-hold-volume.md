# Manual Test: Mixed pad hold gesture starts at correct volume

**Issue:** #10 — usePadGesture uses isPadActive instead of per-hold-layer check for startVolume on mixed pads  
**File changed:** `src/hooks/usePadGesture.ts`  
**Risk area:** Any change to `usePadGesture`, `isLayerActive`, `isPadActive`, or volume drag logic

---

## Background

A "mixed pad" has at least one **Hold** layer and at least one **One-shot** layer. The bug: if the one-shot layer is still fading out (active in `voiceMap`), pressing the pad again would read the hold layer's `startVolume` from the near-zero padVolume leftover from a previous drag, causing the hold to start nearly silent.

---

## Setup

1. Create a pad with **two layers**:
   - **Layer 1**: One-shot, long sound (5+ seconds, or a looping sound you'll manually stop)
   - **Layer 2**: Hold mode, a different sound
2. Save the pad.
3. (Optional but helpful) Use the **volume drag** to drag the pad's volume down to ~0% at least once, then release — this leaves a near-zero `padVolume` in the store.

## Steps

1. Trigger the pad — the one-shot starts playing, and if you hold, the hold layer plays too.
2. Release quickly (one-shot only scenario): the one-shot sound is now in its tail (still active/fading).
3. **Immediately** press and hold the pad again while the one-shot is still finishing.

## Expected Result

- The hold layer starts at **full volume (100%)**, not at the near-zero residual padVolume.
- The hold audio is clearly audible at normal level from the moment you press.
- The volume drag bar (yellow bar on the pad) shows starting from near-full, not near-zero.

## Failure Indicators

- The hold layer starts nearly silent (the pre-fix behavior).
- You have to drag the volume up from near-zero to hear the hold sound.

---

## Variant: Re-press while hold layer itself is active

1. Press and hold the pad — hold layer is playing at full volume.
2. While still holding, release and quickly press again (re-trigger while hold is active).

**Expected:** The hold layer continues at the current volume (not restarting from 0 or 100%). The retrigger mode (restart/continue/stop/next) governs what happens to the sound, but volume should carry over.

---

## Variant: Volume drag then re-press

1. Trigger the pad and drag the volume down to ~20% using the hold gesture.
2. Release — padVolume is now 0.2 in the store.
3. Immediately press again while the one-shot tail is still active.

**Expected:** Hold layer starts at **100%** (fresh hold-layer trigger), not at 20%. The volume bar shows starting from ~100%.
