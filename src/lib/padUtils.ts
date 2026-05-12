import type { Layer, Pad, PadConfig, Scene } from "@/lib/schemas";

/**
 * Build an O(1) lookup map of padId → Pad across all scenes. Avoids the
 * O(scenes × pads) cost of scenes.flatMap(...).find(...) inside per-pad loops.
 */
export function buildPadMap(scenes: Scene[]): Map<string, Pad> {
  const map = new Map<string, Pad>();
  for (const scene of scenes) {
    for (const pad of scene.pads) {
      map.set(pad.id, pad);
    }
  }
  return map;
}

export function padToConfig(pad: Pad, layers?: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers: layers ?? pad.layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    volume: pad.volume ?? 100,
    fadeTargetVol: pad.fadeTargetVol ?? 0,
  };
}

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
