import type { LayerSelection, Arrangement, PlaybackMode, RetriggerMode } from "@/lib/schemas";

export const SELECTION_TAB_TOOLTIPS: Record<LayerSelection["type"], string> = {
  assigned: "Pick specific sounds from your library.",
  tag: "Sounds matching the selected tags are eligible at trigger time.",
  set: "Sounds belonging to the selected set are eligible at trigger time.",
};

export const ARRANGEMENT_TAB_TOOLTIPS: Record<Arrangement, string> = {
  simultaneous: "All sounds start at the same time.",
  sequential: "One sound plays at a time, in the order they were added. The next starts after the current one finishes.",
  shuffled: "One sound plays at a time in a random order. The next starts after the current one finishes.",
};

export const CYCLE_MODE_TAB_TOOLTIPS: Record<"continuous" | "cycle", string> = {
  continuous: "The full sequence plays through automatically on each trigger. Sounds chain one into the next without further input.",
  cycle: "Each trigger plays one sound, advancing to the next position. The cursor is remembered between triggers.",
};

export const PLAYBACK_MODE_TAB_TOOLTIPS: Record<PlaybackMode, string> = {
  "one-shot": "The sound plays once from start to finish, then stops.",
  hold: "The sound plays while the pad is held. Releasing the pad stops it.",
  loop: "The sound repeats continuously. Trigger the pad again (or use Retrigger > Stop) to stop it.",
};

export const RETRIGGER_TAB_TOOLTIPS: Record<RetriggerMode, string> = {
  restart: "Stops the current sound and starts it again from the beginning.",
  continue: "Trigger is ignored — the sound keeps playing uninterrupted.",
  stop: "Stops the sound. If not playing, triggers it normally.",
  next: "Skips to the next sound in the sequence. If not playing, triggers normally. (Sequential and Shuffled only.)",
};

export function getArrangementHelper(
  selectionType: LayerSelection["type"],
  arrangement: Arrangement,
  cycleMode: boolean,
  instanceCount: number,
): string | null {
  if (arrangement === "simultaneous") {
    if (selectionType !== "assigned") return "All matched sounds play together at trigger time.";
    if (instanceCount < 1) return null;
    if (instanceCount === 1) return "The assigned sound plays on each trigger.";
    return `All ${instanceCount} assigned sounds play together on each trigger.`;
  }

  if (selectionType === "assigned") {
    if (instanceCount === 1) return "Only one sound assigned — arrangement has no effect with a single sound.";
    if (cycleMode) {
      return arrangement === "sequential"
        ? "Each trigger plays the next sound in order."
        : `Each trigger plays a random sound from the ${instanceCount} assigned.`;
    }
    return arrangement === "sequential"
      ? `All ${instanceCount} sounds chain automatically on each trigger. The first plays immediately; the rest follow in sequence.`
      : `All ${instanceCount} sounds chain automatically on each trigger in a new random order.`;
  }

  if (cycleMode) {
    return arrangement === "sequential"
      ? "Each trigger plays the next sound from the matched pool."
      : "Each trigger plays a random sound from the matched pool.";
  }
  return "All matched sounds chain automatically on each trigger.";
}

export function getCycleModeHelper(
  arrangement: Arrangement,
  cycleMode: boolean,
  playbackMode: PlaybackMode,
): string {
  if (arrangement === "sequential") {
    if (!cycleMode) {
      return playbackMode === "one-shot"
        ? "The full sequence plays through once and stops. Each new trigger restarts it from the first sound."
        : "The sequence loops indefinitely — when the last sound finishes, it starts again from the first.";
    }
    return playbackMode === "one-shot"
      ? "Each trigger plays the next sound in order. After the last, the position resets to the first."
      : "Each trigger advances to the next sound, which then loops until the pad is triggered again.";
  }

  if (!cycleMode) {
    return playbackMode === "one-shot"
      ? "A new random order is played through once on each trigger, then stops."
      : "A random order plays through, then reshuffles and loops indefinitely.";
  }
  return playbackMode === "one-shot"
    ? "Each trigger plays a random sound. After all have played, the pool reshuffles."
    : "Each trigger plays a random sound, which loops until the pad is triggered again.";
}

export function getPlaybackModeHelper(
  playbackMode: PlaybackMode,
  retriggerMode: RetriggerMode,
): string {
  if (playbackMode === "hold")
    return "Plays while the pad is held. Releasing the pad stops the sound.";

  if (playbackMode === "one-shot") {
    const map: Record<RetriggerMode, string> = {
      restart: "Plays once. Triggering while it's playing restarts it from the beginning.",
      continue: "Plays once. Triggering while it's playing is ignored.",
      stop: "Plays once. Triggering while it's playing stops it without restarting.",
      next: "Plays once. Triggering while it's playing skips to the next sound in the sequence.",
    };
    return map[retriggerMode];
  }

  const map: Record<RetriggerMode, string> = {
    restart: "Loops continuously. Triggering again restarts the loop from the beginning.",
    continue: "Loops continuously. Retriggering while looping has no effect.",
    stop: "Loops continuously. Triggering again stops it — trigger once more to start.",
    next: "Loops through the sequence. Triggering again skips to the next sound without restarting.",
  };
  return map[retriggerMode];
}

export function getRetriggerHelper(
  retriggerMode: RetriggerMode,
  playbackMode: PlaybackMode,
  arrangement: Arrangement,
  cycleMode: boolean,
): string {
  if (retriggerMode === "next") {
    if (arrangement === "sequential") {
      return cycleMode
        ? "Triggering while playing advances the cycle cursor to the next sound."
        : "Triggering while playing skips to the next queued sound in the chain.";
    }
    return cycleMode
      ? "Triggering while playing advances to the next random position in the cycle."
      : "Triggering while playing skips to the next randomly-ordered sound in the chain.";
  }

  const helpers: Record<Exclude<RetriggerMode, "next">, Record<PlaybackMode, string>> = {
    restart: {
      "one-shot": "Each retrigger stops the current sound and plays it from the beginning.",
      hold: "Re-pressing the pad while held stops and restarts the sound.",
      loop: "Each retrigger stops the loop and restarts from the beginning.",
    },
    continue: {
      "one-shot": "Triggering while the sound plays is ignored — it plays to completion.",
      hold: "Re-pressing while held is ignored.",
      loop: "Once looping, subsequent triggers have no effect.",
    },
    stop: {
      "one-shot": "Triggering while playing stops the sound. Trigger again to play.",
      hold: "Re-pressing while held stops the sound.",
      loop: "Triggering while looping stops the loop. Trigger again to restart.",
    },
  };

  return helpers[retriggerMode][playbackMode];
}
