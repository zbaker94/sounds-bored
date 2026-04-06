# Manual Test: Stop All also stops the active sound preview

**Issue:** #8 — Stop All button does not stop sound previews  
**File changed:** `src/components/composite/SidePanel/PlaySection.tsx` (added `stopPreview()` call)  
**Risk area:** Any change to `PlaySection`, `stopPreview`, or `useSoundPreview`

---

## Setup

1. Import at least one audio file into the sound library.
2. Open the **Sounds panel** (right side panel).

## Steps

1. Click the **play/preview** button on a sound in the Sounds panel — it should start playing.
2. While the preview is playing, click the **Stop All** button in the side panel.

## Expected Result

- The sound preview stops immediately.
- The preview play button shows its "not playing" state.
- The Stop All button becomes disabled (nothing playing).

## Failure Indicators

- The preview continues playing after Stop All.
- The Stop All button state updates (disabled) but audio still plays.

---

## Variant: Stop All with both pad and preview playing

1. Trigger a loop pad so it's playing.
2. Start a sound preview in the Sounds panel.
3. Both audio streams are now active simultaneously.
4. Click Stop All.

**Expected:** Both the pad audio and the preview stop immediately.

---

## Variant: Stop All enabled when only preview is playing (no pads)

1. Do not trigger any pads.
2. Start a sound preview.

**Expected:** The Stop All button is **enabled** (not disabled) even though no pads are playing. Clicking it stops the preview.
