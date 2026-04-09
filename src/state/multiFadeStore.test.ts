import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMultiFadeStore, type SelectedPadFade } from "@/state/multiFadeStore";

describe("multiFadeStore", () => {
  beforeEach(() => {
    useMultiFadeStore.setState({
      active: false,
      originPadId: null,
      selectedPads: new Map<string, SelectedPadFade>(),
      reopenPadId: null,
    });
    vi.clearAllMocks();
  });

  describe("enterMultiFade", () => {
    it("should set active to true and initialize originPadId", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", true, 0.8);

      const state = useMultiFadeStore.getState();
      expect(state.active).toBe(true);
      expect(state.originPadId).toBe("pad-1");
    });

    it("should clear selectedPads and reopenPadId", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([["pad-2", { padId: "pad-2", levels: [0, 50] as [number, number] }]]),
        reopenPadId: "pad-3",
      });

      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", true, 0.5);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(1);
      expect(state.selectedPads.has("pad-1")).toBe(true);
      expect(state.reopenPadId).toBeNull();
    });

    it("should add originPadId to selectedPads with correct levels when playing", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", true, 0.75);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry).toBeDefined();
      expect(padEntry?.levels).toEqual([0, 75]); // Math.round(0.75 * 100)
    });

    it("should add originPadId with [0, 100] levels when not playing", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", false, 0.5);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry).toBeDefined();
      expect(padEntry?.levels).toEqual([0, 100]);
    });

    it("should use default initialVolume of 1.0 when not provided", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", true);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels).toEqual([0, 100]); // Math.round(1.0 * 100)
    });

    it("should use default initialVolume even when playing is false", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", false);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels).toEqual([0, 100]);
    });

    it("should round volume correctly when playing", () => {
      const { enterMultiFade } = useMultiFadeStore.getState();
      enterMultiFade("pad-1", true, 0.555);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels[1]).toBe(56); // Math.round(0.555 * 100) = 56
    });
  });

  describe("toggleMultiFadePad", () => {
    it("should add a pad to selectedPads when it does not exist", () => {
      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.8);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.has("pad-1")).toBe(true);
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.padId).toBe("pad-1");
      expect(padEntry?.levels).toEqual([0, 80]);
    });

    it("should remove a pad from selectedPads when it already exists (toggle)", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }]]),
      });

      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.8);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.has("pad-1")).toBe(false);
    });

    it("should use [0, 100] levels when not playing", () => {
      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", false, 0.5);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels).toEqual([0, 100]);
    });

    it("should use [0, Math.round(vol * 100)] levels when playing", () => {
      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.65);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels).toEqual([0, 65]);
    });

    it("should allow toggling multiple pads independently", () => {
      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.8);
      toggleMultiFadePad("pad-2", false, 0.5);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(2);
      expect(state.selectedPads.has("pad-1")).toBe(true);
      expect(state.selectedPads.has("pad-2")).toBe(true);
    });

    it("should toggle different pads without affecting others", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([
          ["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }],
          ["pad-2", { padId: "pad-2", levels: [0, 50] as [number, number] }],
        ]),
      });

      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.8);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(1);
      expect(state.selectedPads.has("pad-1")).toBe(false);
      expect(state.selectedPads.has("pad-2")).toBe(true);
    });
  });

  describe("setMultiFadeLevels", () => {
    it("should update levels for an existing pad", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 50] as [number, number] }]]),
      });

      const { setMultiFadeLevels } = useMultiFadeStore.getState();
      setMultiFadeLevels("pad-1", [10, 90]);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.levels).toEqual([10, 90]);
    });

    it("should not modify state for a non-existent pad", () => {
      const initialPads = new Map<string, SelectedPadFade>([
        ["pad-1", { padId: "pad-1", levels: [0, 50] as [number, number] }],
      ]);
      useMultiFadeStore.setState({ selectedPads: initialPads });

      const { setMultiFadeLevels } = useMultiFadeStore.getState();
      setMultiFadeLevels("pad-2", [10, 90]);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(1);
      expect(state.selectedPads.get("pad-1")).toEqual({ padId: "pad-1", levels: [0, 50] });
    });

    it("should update only the specified pad when multiple exist", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([
          ["pad-1", { padId: "pad-1", levels: [0, 50] as [number, number] }],
          ["pad-2", { padId: "pad-2", levels: [0, 75] as [number, number] }],
        ]),
      });

      const { setMultiFadeLevels } = useMultiFadeStore.getState();
      setMultiFadeLevels("pad-1", [20, 80]);

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.get("pad-1")?.levels).toEqual([20, 80]);
      expect(state.selectedPads.get("pad-2")?.levels).toEqual([0, 75]);
    });

    it("should preserve padId when updating levels", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 50] as [number, number] }]]),
      });

      const { setMultiFadeLevels } = useMultiFadeStore.getState();
      setMultiFadeLevels("pad-1", [30, 70]);

      const state = useMultiFadeStore.getState();
      const padEntry = state.selectedPads.get("pad-1");
      expect(padEntry?.padId).toBe("pad-1");
      expect(padEntry?.levels).toEqual([30, 70]);
    });
  });

  describe("cancelMultiFade", () => {
    it("should set active to false", () => {
      useMultiFadeStore.setState({ active: true, originPadId: "pad-1" });

      const { cancelMultiFade } = useMultiFadeStore.getState();
      cancelMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.active).toBe(false);
    });

    it("should set reopenPadId to the current originPadId", () => {
      useMultiFadeStore.setState({ originPadId: "pad-1", active: true });

      const { cancelMultiFade } = useMultiFadeStore.getState();
      cancelMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.reopenPadId).toBe("pad-1");
    });

    it("should clear originPadId to null", () => {
      useMultiFadeStore.setState({ originPadId: "pad-1", active: true });

      const { cancelMultiFade } = useMultiFadeStore.getState();
      cancelMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.originPadId).toBeNull();
    });

    it("should clear selectedPads to empty", () => {
      useMultiFadeStore.setState({
        active: true,
        originPadId: "pad-1",
        selectedPads: new Map<string, SelectedPadFade>([
          ["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }],
          ["pad-2", { padId: "pad-2", levels: [0, 50] as [number, number] }],
        ]),
      });

      const { cancelMultiFade } = useMultiFadeStore.getState();
      cancelMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(0);
    });

    it("should set reopenPadId to null if originPadId is null", () => {
      useMultiFadeStore.setState({
        active: true,
        originPadId: null,
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }]]),
      });

      const { cancelMultiFade } = useMultiFadeStore.getState();
      cancelMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.reopenPadId).toBeNull();
    });
  });

  describe("resetMultiFade", () => {
    it("should reset all state to initial values", () => {
      useMultiFadeStore.setState({
        active: true,
        originPadId: "pad-1",
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }]]),
        reopenPadId: "pad-2",
      });

      const { resetMultiFade } = useMultiFadeStore.getState();
      resetMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.active).toBe(false);
      expect(state.originPadId).toBeNull();
      expect(state.selectedPads.size).toBe(0);
      expect(state.reopenPadId).toBeNull();
    });

    it("should clear selectedPads completely", () => {
      useMultiFadeStore.setState({
        selectedPads: new Map<string, SelectedPadFade>([
          ["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }],
          ["pad-2", { padId: "pad-2", levels: [0, 50] as [number, number] }],
          ["pad-3", { padId: "pad-3", levels: [0, 100] as [number, number] }],
        ]),
      });

      const { resetMultiFade } = useMultiFadeStore.getState();
      resetMultiFade();

      const state = useMultiFadeStore.getState();
      expect(state.selectedPads.size).toBe(0);
    });
  });

  describe("clearMultiFadeReopenPadId", () => {
    it("should set reopenPadId to null", () => {
      useMultiFadeStore.setState({ reopenPadId: "pad-1" });

      const { clearMultiFadeReopenPadId } = useMultiFadeStore.getState();
      clearMultiFadeReopenPadId();

      const state = useMultiFadeStore.getState();
      expect(state.reopenPadId).toBeNull();
    });

    it("should not affect other state", () => {
      useMultiFadeStore.setState({
        active: true,
        originPadId: "pad-1",
        selectedPads: new Map<string, SelectedPadFade>([["pad-1", { padId: "pad-1", levels: [0, 80] as [number, number] }]]),
        reopenPadId: "pad-2",
      });

      const { clearMultiFadeReopenPadId } = useMultiFadeStore.getState();
      clearMultiFadeReopenPadId();

      const state = useMultiFadeStore.getState();
      expect(state.active).toBe(true);
      expect(state.originPadId).toBe("pad-1");
      expect(state.selectedPads.size).toBe(1);
      expect(state.reopenPadId).toBeNull();
    });

    it("should be idempotent when reopenPadId is already null", () => {
      useMultiFadeStore.setState({ reopenPadId: null });

      const { clearMultiFadeReopenPadId } = useMultiFadeStore.getState();
      clearMultiFadeReopenPadId();

      const state = useMultiFadeStore.getState();
      expect(state.reopenPadId).toBeNull();
    });
  });

  describe("state isolation", () => {
    it("should not share selectedPads Map between store instances", () => {
      const { enterMultiFade: enter1 } = useMultiFadeStore.getState();
      enter1("pad-1", true, 0.8);

      const state1 = useMultiFadeStore.getState();
      expect(state1.selectedPads.get("pad-1")).toBeDefined();

      // Reset and verify Map is new
      useMultiFadeStore.setState({
        active: false,
        originPadId: null,
        selectedPads: new Map<string, SelectedPadFade>(),
        reopenPadId: null,
      });

      const state2 = useMultiFadeStore.getState();
      expect(state2.selectedPads.size).toBe(0);
      expect(state1.selectedPads.size).toBe(1);
    });

    it("should create new Map instances on toggleMultiFadePad", () => {
      const { toggleMultiFadePad } = useMultiFadeStore.getState();
      toggleMultiFadePad("pad-1", true, 0.8);

      const state1 = useMultiFadeStore.getState();
      const map1 = state1.selectedPads;

      toggleMultiFadePad("pad-2", true, 0.5);

      const state2 = useMultiFadeStore.getState();
      const map2 = state2.selectedPads;

      expect(map1).not.toBe(map2);
      expect(map1.size).toBe(1);
      expect(map2.size).toBe(2);
    });
  });
});
