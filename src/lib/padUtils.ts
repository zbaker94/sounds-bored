import type { Layer, Pad, PadConfig, Scene } from "@/lib/schemas";

/** Avoids the O(scenes × pads) cost of scenes.flatMap(...).find(...) inside per-pad loops. */
export function buildPadMap(scenes: Scene[]): Map<string, Pad> {
  const map = new Map<string, Pad>();
  for (const scene of scenes) {
    for (const pad of scene.pads) {
      map.set(pad.id, pad);
    }
  }
  return map;
}

/** Internal cache for getPadMapForScenes — exposed for test introspection only. */
export const _padMapCache: { scenes: Scene[] | null; map: Map<string, Pad> } = {
  scenes: null,
  map: new Map(),
};

/**
 * Returns a cached O(1) padId → Pad lookup map for the given scenes array.
 *
 * The map is rebuilt only when the `scenes` array reference changes. Immer's
 * structural sharing guarantees the reference is stable when unrelated
 * projectStore fields (e.g. `isDirty`) change, so callers reading this map per
 * frame avoid rebuilding it on every unrelated store update.
 *
 * Designed for the single-active-project case; the cache holds one entry.
 */
export function getPadMapForScenes(scenes: Scene[] | null): Map<string, Pad> {
  if (scenes !== _padMapCache.scenes) {
    _padMapCache.scenes = scenes;
    _padMapCache.map = buildPadMap(scenes ?? []);
  }
  return _padMapCache.map;
}

/**
 * Find a pad by id, returning both the pad and its parent scene in a single
 * pass. Returns null when no pad with the given id exists across all scenes.
 */
export function findPadAndScene(scenes: Scene[], padId: string): { scene: Scene; pad: Pad } | null {
  for (const scene of scenes) {
    const pad = scene.pads.find((p) => p.id === padId);
    if (pad) return { scene, pad };
  }
  return null;
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
