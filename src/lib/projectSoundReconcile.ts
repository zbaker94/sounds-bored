import type { Pad, Project, Sound } from "@/lib/schemas";

// ── reconcileProjectSounds ────────────────────────────────────────────────────

export type ReconcileResult = {
  project: Project;
  removedCount: number;
};

/**
 * Removes any soundId in assigned layers that no longer exists in the library.
 * Leaves empty layers in place — callers decide whether to surface them as warnings.
 * Pure function: no side effects, no Zustand access.
 */
export function reconcileProjectSounds(project: Project, sounds: Sound[]): ReconcileResult {
  const soundIdSet = new globalThis.Set(sounds.map((s) => s.id));
  let removedCount = 0;

  const cleanedScenes = project.scenes.map((scene) => ({
    ...scene,
    pads: scene.pads.map((pad) => ({
      ...pad,
      layers: pad.layers.map((layer) => {
        if (layer.selection.type !== "assigned") return layer;
        const before = layer.selection.instances.length;
        const cleaned = layer.selection.instances.filter((inst) => soundIdSet.has(inst.soundId));
        removedCount += before - cleaned.length;
        if (cleaned.length === before) return layer; // nothing changed — return same ref
        return { ...layer, selection: { ...layer.selection, instances: cleaned } };
      }),
    })),
  }));

  return { project: { ...project, scenes: cleanedScenes }, removedCount };
}

// ── getPadSoundState ──────────────────────────────────────────────────────────

export type PadSoundState = "ok" | "partial" | "disabled";

/**
 * Derives the sound health of a pad relative to the current missing-sound set.
 * - "ok":       all assigned sounds are playable (or pad has tag/set layers)
 * - "partial":  at least one assigned soundId is missing, but pad still has playable sources
 * - "disabled": no playable sources — all assigned sounds are missing or instances are empty,
 *               AND there are no tag/set layers to fall back on
 */
export function getPadSoundState(pad: Pad, missingSoundIds: globalThis.Set<string>): PadSoundState {
  let hasNonAssignedLayer = false;
  let hasMissingSound = false;
  let hasPlayableSound = false;

  for (const layer of pad.layers) {
    if (layer.selection.type !== "assigned") {
      hasNonAssignedLayer = true;
      continue;
    }
    for (const inst of layer.selection.instances) {
      if (missingSoundIds.has(inst.soundId)) {
        hasMissingSound = true;
      } else {
        hasPlayableSound = true;
      }
    }
  }

  if (hasPlayableSound || hasNonAssignedLayer) {
    return hasMissingSound ? "partial" : "ok";
  }
  return "disabled";
}

// ── getAffectedPads ───────────────────────────────────────────────────────────

export type AffectedPad = {
  padName: string;
  sceneName: string;
  layerIndices: number[]; // 1-based for display
};

/**
 * Returns which pads and layers in the project reference any of the given soundIds.
 * Only checks assigned layers — tag/set layers resolve dynamically and are not included.
 */
export function getAffectedPads(project: Project, soundIds: globalThis.Set<string>): AffectedPad[] {
  const result: AffectedPad[] = [];
  for (const scene of project.scenes) {
    for (const pad of scene.pads) {
      const affectedLayers: number[] = [];
      pad.layers.forEach((layer, i) => {
        if (layer.selection.type !== "assigned") return;
        if (layer.selection.instances.some((inst) => soundIds.has(inst.soundId))) {
          affectedLayers.push(i + 1);
        }
      });
      if (affectedLayers.length > 0) {
        result.push({ padName: pad.name, sceneName: scene.name, layerIndices: affectedLayers });
      }
    }
  }
  return result;
}
