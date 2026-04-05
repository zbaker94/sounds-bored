import type { Arrangement, Sound } from "@/lib/schemas";

/** Fisher-Yates shuffle — returns a new array, does not mutate input. */
export function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Returns the order in which sounds should be played for a single pad trigger.
 * - simultaneous: all sounds (played at the same time)
 * - sequential: sounds in their defined order (chained one after another)
 * - shuffled: sounds in a randomized order (chained one after another)
 */
export function buildPlayOrder(arrangement: Arrangement, sounds: Sound[]): Sound[] {
  switch (arrangement) {
    case "simultaneous":
    case "sequential":
      // Both return sounds in their defined order — the distinction between
      // firing all at once vs. chaining one after another is handled by
      // isChained() at the call site in padPlayer.ts.
      return [...sounds];
    case "shuffled":
      return shuffleArray(sounds);
  }
}

/**
 * Returns true if this arrangement plays sounds as a chain
 * (one finishes, the next starts automatically) rather than all at once.
 */
export function isChained(arrangement: Arrangement): boolean {
  return arrangement === "sequential" || arrangement === "shuffled";
}
