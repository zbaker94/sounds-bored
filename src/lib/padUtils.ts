import type { Pad } from "@/lib/schemas";

/**
 * Returns true if a pad is eligible for fade/crossfade operations.
 *
 * A pad is NOT fadeable if:
 * - It has no layers (nothing to fade)
 * - Any layer uses "hold" playback mode
 *
 * Hold-mode layers require the pad button to be held down to sustain audio;
 * they are released on pointer-up rather than fading out. Applying a fade to
 * such a pad would race with the hold-release mechanism and produce undefined
 * audio behavior. A pad with even one hold-mode layer is therefore excluded
 * entirely, because the pad's overall intent is hold-based interaction.
 *
 * Mixed-mode pads (some hold, some non-hold layers) are also excluded for the
 * same reason — the hold layer's release-on-pointer-up behavior takes
 * precedence over the non-hold layers.
 */
export function isFadeablePad(pad: Pad): boolean {
  return (
    pad.layers.length > 0 &&
    !pad.layers.some((l) => l.playbackMode === "hold")
  );
}
