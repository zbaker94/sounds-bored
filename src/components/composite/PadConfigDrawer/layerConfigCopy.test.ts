import { describe, it, expect } from "vitest";
import {
  SELECTION_TAB_TOOLTIPS,
  ARRANGEMENT_TAB_TOOLTIPS,
  CYCLE_MODE_TAB_TOOLTIPS,
  PLAYBACK_MODE_TAB_TOOLTIPS,
  RETRIGGER_TAB_TOOLTIPS,
  getArrangementHelper,
  getCycleModeHelper,
  getPlaybackModeHelper,
  getRetriggerHelper,
} from "./layerConfigCopy";

describe("layerConfigCopy", () => {
  describe("tooltip dictionaries", () => {
    it("SELECTION_TAB_TOOLTIPS", () => {
      expect(SELECTION_TAB_TOOLTIPS.assigned).toBe("Pick specific sounds from your library.");
      expect(SELECTION_TAB_TOOLTIPS.tag).toBe("Sounds matching the selected tags are eligible at trigger time.");
      expect(SELECTION_TAB_TOOLTIPS.set).toBe("Sounds belonging to the selected set are eligible at trigger time.");
    });

    it("ARRANGEMENT_TAB_TOOLTIPS", () => {
      expect(ARRANGEMENT_TAB_TOOLTIPS.simultaneous).toBe("All sounds start at the same time.");
      expect(ARRANGEMENT_TAB_TOOLTIPS.sequential).toBe(
        "One sound plays at a time, in the order they were added. The next starts after the current one finishes.",
      );
      expect(ARRANGEMENT_TAB_TOOLTIPS.shuffled).toBe(
        "One sound plays at a time in a random order. The next starts after the current one finishes.",
      );
    });

    it("CYCLE_MODE_TAB_TOOLTIPS", () => {
      expect(CYCLE_MODE_TAB_TOOLTIPS.continuous).toBe(
        "The full sequence plays through automatically on each trigger. Sounds chain one into the next without further input.",
      );
      expect(CYCLE_MODE_TAB_TOOLTIPS.cycle).toBe(
        "Each trigger plays one sound, advancing to the next position. The cursor is remembered between triggers.",
      );
    });

    it("PLAYBACK_MODE_TAB_TOOLTIPS", () => {
      expect(PLAYBACK_MODE_TAB_TOOLTIPS["one-shot"]).toBe("The sound plays once from start to finish, then stops.");
      expect(PLAYBACK_MODE_TAB_TOOLTIPS.hold).toBe("The sound plays while the pad is held. Releasing the pad stops it.");
      expect(PLAYBACK_MODE_TAB_TOOLTIPS.loop).toBe(
        "The sound repeats continuously. Trigger the pad again (or use Retrigger > Stop) to stop it.",
      );
    });

    it("RETRIGGER_TAB_TOOLTIPS", () => {
      expect(RETRIGGER_TAB_TOOLTIPS.restart).toBe("Stops the current sound and starts it again from the beginning.");
      expect(RETRIGGER_TAB_TOOLTIPS.continue).toBe("Trigger is ignored — the sound keeps playing uninterrupted.");
      expect(RETRIGGER_TAB_TOOLTIPS.stop).toBe("Stops the sound. If not playing, triggers it normally.");
      expect(RETRIGGER_TAB_TOOLTIPS.next).toBe(
        "Skips to the next sound in the sequence. If not playing, triggers normally. (Sequential and Shuffled only.)",
      );
    });
  });

  describe("getArrangementHelper", () => {
    it("simultaneous + 0 assigned → null", () => {
      expect(getArrangementHelper("assigned", "simultaneous", false, 0)).toBeNull();
    });

    it("simultaneous + 1 assigned", () => {
      expect(getArrangementHelper("assigned", "simultaneous", false, 1)).toBe(
        "The assigned sound plays on each trigger.",
      );
    });

    it("simultaneous + 3 assigned", () => {
      expect(getArrangementHelper("assigned", "simultaneous", false, 3)).toBe(
        "All 3 assigned sounds play together on each trigger.",
      );
    });

    it("simultaneous + tag selection", () => {
      expect(getArrangementHelper("tag", "simultaneous", false, 0)).toBe(
        "All matched sounds play together at trigger time.",
      );
    });

    it("sequential + 1 assigned", () => {
      expect(getArrangementHelper("assigned", "sequential", false, 1)).toBe(
        "Only one sound assigned — arrangement has no effect with a single sound.",
      );
    });

    it("sequential + 2 assigned + continuous", () => {
      expect(getArrangementHelper("assigned", "sequential", false, 2)).toMatch(
        /All 2 sounds chain automatically/,
      );
    });

    it("sequential + 2 assigned + cycle", () => {
      expect(getArrangementHelper("assigned", "sequential", true, 2)).toBe(
        "Each trigger plays the next sound in order.",
      );
    });

    it("shuffled + 3 assigned + continuous", () => {
      expect(getArrangementHelper("assigned", "shuffled", false, 3)).toMatch(
        /All 3 sounds chain automatically.*random order/,
      );
    });

    it("shuffled + 2 assigned + cycle", () => {
      expect(getArrangementHelper("assigned", "shuffled", true, 2)).toBe(
        "Each trigger plays a random sound from the 2 assigned.",
      );
    });

    it("sequential + tag + cycle", () => {
      expect(getArrangementHelper("tag", "sequential", true, 0)).toBe(
        "Each trigger plays the next sound from the matched pool.",
      );
    });

    it("shuffled + tag + cycle", () => {
      expect(getArrangementHelper("tag", "shuffled", true, 0)).toBe(
        "Each trigger plays a random sound from the matched pool.",
      );
    });

    it("shuffled + set + continuous", () => {
      expect(getArrangementHelper("set", "shuffled", false, 0)).toBe(
        "All matched sounds chain automatically on each trigger.",
      );
    });
  });

  describe("getCycleModeHelper", () => {
    it("sequential + continuous + one-shot", () => {
      expect(getCycleModeHelper("sequential", false, "one-shot")).toMatch(
        /The full sequence plays through once and stops/,
      );
    });

    it("sequential + continuous + loop", () => {
      expect(getCycleModeHelper("sequential", false, "loop")).toMatch(/The sequence loops indefinitely/);
    });

    it("sequential + cycle + one-shot", () => {
      expect(getCycleModeHelper("sequential", true, "one-shot")).toMatch(
        /Each trigger plays the next sound in order. After the last/,
      );
    });

    it("sequential + cycle + loop", () => {
      expect(getCycleModeHelper("sequential", true, "loop")).toMatch(
        /Each trigger advances to the next sound, which then loops/,
      );
    });

    it("shuffled + continuous + one-shot", () => {
      expect(getCycleModeHelper("shuffled", false, "one-shot")).toMatch(
        /A new random order is played through once/,
      );
    });

    it("shuffled + continuous + loop", () => {
      expect(getCycleModeHelper("shuffled", false, "loop")).toBe(
        "A random order plays through, then reshuffles and loops indefinitely.",
      );
    });

    it("shuffled + cycle + one-shot", () => {
      expect(getCycleModeHelper("shuffled", true, "one-shot")).toBe(
        "Each trigger plays a random sound. After all have played, the pool reshuffles.",
      );
    });

    it("shuffled + cycle + loop", () => {
      expect(getCycleModeHelper("shuffled", true, "loop")).toMatch(
        /Each trigger plays a random sound, which loops until/,
      );
    });
  });

  describe("getPlaybackModeHelper", () => {
    it("one-shot + restart", () => {
      expect(getPlaybackModeHelper("one-shot", "restart")).toMatch(
        /Plays once. Triggering while it's playing restarts/,
      );
    });

    it("one-shot + continue", () => {
      expect(getPlaybackModeHelper("one-shot", "continue")).toMatch(
        /Plays once. Triggering while it's playing is ignored/,
      );
    });

    it("one-shot + stop", () => {
      expect(getPlaybackModeHelper("one-shot", "stop")).toMatch(
        /Plays once. Triggering while it's playing stops it/,
      );
    });

    it("one-shot + next", () => {
      expect(getPlaybackModeHelper("one-shot", "next")).toMatch(/skips to the next sound/);
    });

    it("hold", () => {
      expect(getPlaybackModeHelper("hold", "restart")).toBe(
        "Plays while the pad is held. Releasing the pad stops the sound.",
      );
    });

    it("loop + restart", () => {
      expect(getPlaybackModeHelper("loop", "restart")).toMatch(/restarts the loop from the beginning/);
    });

    it("loop + continue", () => {
      expect(getPlaybackModeHelper("loop", "continue")).toMatch(
        /Loops continuously. Retriggering while looping has no effect/,
      );
    });

    it("loop + stop", () => {
      expect(getPlaybackModeHelper("loop", "stop")).toMatch(/Loops continuously. Triggering again stops it/);
    });

    it("loop + next", () => {
      expect(getPlaybackModeHelper("loop", "next")).toMatch(/skips to the next sound without restarting/);
    });
  });

  describe("getRetriggerHelper", () => {
    it("restart + one-shot", () => {
      expect(getRetriggerHelper("restart", "one-shot", "simultaneous", false)).toMatch(
        /Each retrigger stops the current sound and plays it/,
      );
    });

    it("restart + hold", () => {
      expect(getRetriggerHelper("restart", "hold", "simultaneous", false)).toBe(
        "Re-pressing the pad while held stops and restarts the sound.",
      );
    });

    it("restart + loop", () => {
      expect(getRetriggerHelper("restart", "loop", "simultaneous", false)).toMatch(
        /Each retrigger stops the loop and restarts/,
      );
    });

    it("continue + one-shot", () => {
      expect(getRetriggerHelper("continue", "one-shot", "simultaneous", false)).toMatch(
        /plays is ignored.*plays to completion/,
      );
    });

    it("continue + hold", () => {
      expect(getRetriggerHelper("continue", "hold", "simultaneous", false)).toBe(
        "Re-pressing while held is ignored.",
      );
    });

    it("continue + loop", () => {
      expect(getRetriggerHelper("continue", "loop", "simultaneous", false)).toBe(
        "Once looping, subsequent triggers have no effect.",
      );
    });

    it("stop + one-shot", () => {
      expect(getRetriggerHelper("stop", "one-shot", "simultaneous", false)).toBe(
        "Triggering while playing stops the sound. Trigger again to play.",
      );
    });

    it("stop + hold", () => {
      expect(getRetriggerHelper("stop", "hold", "simultaneous", false)).toBe(
        "Re-pressing while held stops the sound.",
      );
    });

    it("stop + loop", () => {
      expect(getRetriggerHelper("stop", "loop", "simultaneous", false)).toMatch(
        /Triggering while looping stops the loop/,
      );
    });

    it("next + sequential + continuous", () => {
      expect(getRetriggerHelper("next", "one-shot", "sequential", false)).toBe(
        "Triggering while playing skips to the next queued sound in the chain.",
      );
    });

    it("next + sequential + cycle", () => {
      expect(getRetriggerHelper("next", "one-shot", "sequential", true)).toBe(
        "Triggering while playing advances the cycle cursor to the next sound.",
      );
    });

    it("next + shuffled + continuous", () => {
      expect(getRetriggerHelper("next", "one-shot", "shuffled", false)).toBe(
        "Triggering while playing skips to the next randomly-ordered sound in the chain.",
      );
    });

    it("next + shuffled + cycle", () => {
      expect(getRetriggerHelper("next", "one-shot", "shuffled", true)).toBe(
        "Triggering while playing advances to the next random position in the cycle.",
      );
    });
  });
});
