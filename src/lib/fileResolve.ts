import { basename as tauriBasename } from "@tauri-apps/api/path";
import type { Sound } from "@/lib/schemas";

export type AudioFileClassification =
  | { kind: "name-mismatch"; newBasename: string }
  | { kind: "duplicate"; newBasename: string; duplicate: Sound }
  | { kind: "ok"; newBasename: string };

export async function classifyPickedAudioFile({
  pickedPath,
  existingSound,
  allSounds,
}: {
  pickedPath: string;
  existingSound: Sound;
  allSounds: Sound[];
}): Promise<AudioFileClassification> {
  const newBasename = await tauriBasename(pickedPath);
  const oldBasename = existingSound.filePath ? await tauriBasename(existingSound.filePath) : "";

  if (newBasename !== oldBasename) {
    return { kind: "name-mismatch", newBasename };
  }

  const duplicate = allSounds.find((s) => s.id !== existingSound.id && s.filePath === pickedPath);
  if (duplicate) {
    return { kind: "duplicate", newBasename, duplicate };
  }

  return { kind: "ok", newBasename };
}

export function findDuplicateByPath(
  pickedPath: string,
  excludeId: string,
  allSounds: Sound[],
): Sound | undefined {
  return allSounds.find((s) => s.id !== excludeId && s.filePath === pickedPath);
}
