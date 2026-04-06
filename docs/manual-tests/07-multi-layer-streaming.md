# Manual Test: Multi-layer streaming pad — no voice leaks

**Issue:** #7 — padStreamingAudio only tracks one streaming element per pad; multi-layer streaming pads leak earlier voices  
**File changed:** `src/lib/audio/padPlayer.ts` (`padStreamingAudio` changed to `Map<string, Set<HTMLAudioElement>>`)  
**Risk area:** Any change to `padPlayer.ts` streaming path, `stopAllPads`, or `isPadStreaming`

---

## Background

The streaming path is taken for audio files **≥ 20 MB**. This test requires large audio files. If you don't have files that large, skip to the Variant below.

---

## Setup

1. Import **2 large audio files** (≥ 20 MB each) into the sound library.
2. Create a pad with a **Simultaneous** layer containing both large files.
3. Set **Playback Mode** to **One-shot**.
4. Save the pad.

## Steps

1. Trigger the pad — both large sounds begin streaming simultaneously.
2. Let both files play for 5–10 seconds.
3. Click **Stop All**.

## Expected Result

- Both streaming sounds stop immediately on Stop All.
- No audio continues after Stop All.
- Memory is not growing unboundedly (open DevTools → Memory tab before/after; should stabilize).

## Failure Indicators

- Only one of the two streaming sounds stops; the other continues.
- After multiple trigger/stop cycles, memory continues to climb (audio elements leaking).

---

## Variant: Stop All during multi-layer streaming in loop mode

1. Same setup with 2 large files, but **Playback Mode: Loop**.
2. Trigger the pad.
3. After 5 seconds, click Stop All.

**Expected:** Both streams stop. No audio replays after Stop All.

---

## Variant (without large files): Observe progress bar accuracy

For pads with 2+ simultaneous one-shot sounds, the progress bar in the pad button should reflect the **longest-running** sound:

1. Create a simultaneous pad with a short sound (1 s) and a longer sound (5 s).
2. Trigger the pad.
3. After ~1.5 s, the short sound finishes — the progress bar should continue advancing for the longer sound.

**Expected:** Progress bar fills to 100% at ~5 s, not at ~1 s.
