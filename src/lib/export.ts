import type { Project, Sound } from "@/lib/schemas";
import { hasFilePath } from "@/lib/schemas";
import { resolveLayerSounds } from "@/lib/audio";
import { basename } from "@/lib/utils";

function getReferencedIds(project: Project, sounds: Sound[]): Set<string> {
  const ids = new Set<string>();
  for (const scene of project.scenes) {
    for (const pad of scene.pads) {
      for (const layer of pad.layers) {
        for (const sound of resolveLayerSounds(layer, sounds)) {
          ids.add(sound.id);
        }
      }
    }
  }
  return ids;
}

/**
 * Collects all sounds referenced by any layer in the project that have a file path.
 * Deduplicates by sound ID across all scenes/pads/layers.
 */
export function resolveReferencedSounds(project: Project, sounds: Sound[]): (Sound & { filePath: string })[] {
  const ids = getReferencedIds(project, sounds);
  return sounds.filter((s): s is Sound & { filePath: string } => ids.has(s.id) && hasFilePath(s));
}

/**
 * Counts referenced sounds whose files are missing (no filePath).
 * Used to warn the user that some referenced sounds cannot be included in an export.
 */
export function countMissingReferencedSounds(project: Project, sounds: Sound[]): number {
  const ids = getReferencedIds(project, sounds);
  return ids.size - sounds.filter((s) => ids.has(s.id) && hasFilePath(s)).length;
}

/**
 * Builds the soundmap JSON string mapping each sound's ID to its export-relative path.
 * Also reports any basename collisions so the caller can warn the user that some audio
 * files would overwrite each other in the flat export `sounds/` folder.
 */
export function buildSoundMapJson(sounds: (Sound & { filePath: string })[]): {
  json: string;
  collisions: string[];
} {
  const entries: Record<string, string> = {};
  const seen = new Map<string, string>();
  const collisions: string[] = [];

  for (const sound of sounds) {
    const name = basename(sound.filePath, sound.filePath);
    if (seen.has(name)) {
      collisions.push(name);
    } else {
      seen.set(name, sound.id);
    }
    entries[sound.id] = `sounds/${name}`;
  }

  return {
    json: JSON.stringify({ version: "1", soundMap: entries }, null, 2),
    collisions,
  };
}
