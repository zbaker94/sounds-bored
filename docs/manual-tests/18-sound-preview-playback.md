# Manual Test: Sound preview playback in the Sounds panel

**Feature area:** `src/hooks/useSoundPreview.ts`, `src/lib/audio/preview.ts`, `src/components/composite/SidePanel/PlaySection.tsx`  
**Risk area:** Any change to `useSoundPreview`, `stopPreview`, `preview.ts`, or the Sounds panel play controls

---

## Setup

Import at least 2 audio files into the sound library. One short (< 3 s), one longer (> 5 s).

---

## Test A: Basic preview playback

1. Click the **play** icon on a sound in the Sounds panel.

**Expected:**
- Sound plays immediately.
- A visual indicator (play/pause state) shows the sound is active.
- After the sound ends, the indicator returns to "not playing" state.

---

## Test B: Toggle preview off by clicking the same sound again

1. Click play on a sound — it starts.
2. Click the same play button again while it's playing.

**Expected:**
- Playback stops immediately.
- The indicator returns to "not playing" state.

---

## Test C: Switching preview to a different sound

1. Click play on Sound A — it starts.
2. Click play on Sound B (different sound, same panel).

**Expected:**
- Sound A stops immediately.
- Sound B starts playing.
- Only Sound B shows the active state.

---

## Test D: Volume control affects preview level

1. Start a preview.
2. Adjust the **Volume** slider in the VolumeSection of the Sounds panel.

**Expected:**
- The preview volume changes in real time to match the slider.
- The slider position is persisted and applies to the next preview playback.

---

## Test E: Preview a missing sound shows an error

1. Mark a sound as missing (rename its file on disk, reload the project).
2. Click the play button on the missing sound.

**Expected:**
- An error toast appears (e.g., *"File not found"* or similar).
- No audio plays.
- The preview indicator does not get stuck in "playing" state.

---

## Test F: Preview stops when project is closed

1. Start a preview.
2. Close the project (return to Start Screen) while the preview is still playing.

**Expected:**
- Preview audio stops when the project closes.
- No audio plays on the Start Screen.

---

## Test G: Preview and pad playback are independent

1. Start a sound preview.
2. While preview is playing, trigger a pad.

**Expected:**
- Both play simultaneously without interfering.
- Stopping the pad (retrigger stop or Stop All) does not affect the preview (unless Stop All is used — see test doc #08).
- The preview indicator correctly reflects whether the preview is active.
