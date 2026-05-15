import { describe, it, expect, beforeEach } from "vitest";
import {
  reconcileProjectSounds,
  getPadSoundState,
  buildPadSoundStateMap,
  getAffectedPads,
  applyProjectSoundReconcile,
} from "./project.reconcile";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import {
  createMockProject,
  createMockScene,
  createMockPad,
  createMockLayer,
  createMockSound,
  createMockSoundInstance,
  createMockHistoryEntry,
} from "@/test/factories";

// ── reconcileProjectSounds ────────────────────────────────────────────────────

describe("reconcileProjectSounds", () => {
  it("returns project unchanged when all soundIds exist in library", () => {
    const sound = createMockSound({ id: "sound-1" });
    const inst = createMockSoundInstance({ soundId: "sound-1" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const scene = createMockScene({ pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, [sound]);

    expect(removedCount).toBe(0);
    expect(cleaned.scenes[0].pads[0].layers[0].selection).toEqual(layer.selection);
  });

  it("removes orphan soundId from instances and reports count", () => {
    const inst = createMockSoundInstance({ soundId: "orphan-id" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const scene = createMockScene({ pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, []); // empty library

    expect(removedCount).toBe(1);
    const cleanedInstances = (cleaned.scenes[0].pads[0].layers[0].selection as { type: "assigned"; instances: unknown[] }).instances;
    expect(cleanedInstances).toHaveLength(0);
  });

  it("leaves the layer in place when instances becomes empty", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const { project: cleaned } = reconcileProjectSounds(project, []);

    expect(cleaned.scenes[0].pads[0].layers).toHaveLength(1);
  });

  it("does not touch tag or set layers", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const setLayer = createMockLayer({ selection: { type: "set", setId: "s1", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [tagLayer, setLayer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const { removedCount } = reconcileProjectSounds(project, []);

    expect(removedCount).toBe(0);
  });

  it("keeps valid instances when only some are orphaned", () => {
    const valid = createMockSoundInstance({ soundId: "good" });
    const orphan = createMockSoundInstance({ soundId: "gone" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [valid, orphan] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });
    const sound = createMockSound({ id: "good" });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, [sound]);

    expect(removedCount).toBe(1);
    const cleanedInstances = (cleaned.scenes[0].pads[0].layers[0].selection as { type: "assigned"; instances: { soundId: string }[] }).instances;
    expect(cleanedInstances).toHaveLength(1);
    expect(cleanedInstances[0].soundId).toBe("good");
  });
});

// ── getPadSoundState ──────────────────────────────────────────────────────────

describe("getPadSoundState", () => {
  it("returns 'ok' when no assigned sounds are missing", () => {
    const inst = createMockSoundInstance({ soundId: "s1" });
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [inst] } })] });

    expect(getPadSoundState(pad, new Set())).toBe("ok");
  });

  it("returns 'partial' when some assigned sounds are missing", () => {
    const good = createMockSoundInstance({ soundId: "good" });
    const bad = createMockSoundInstance({ soundId: "bad" });
    const pad = createMockPad({
      layers: [createMockLayer({ selection: { type: "assigned", instances: [good, bad] } })],
    });

    expect(getPadSoundState(pad, new Set(["bad"]))).toBe("partial");
  });

  it("returns 'disabled' when all assigned sounds are missing", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [inst] } })] });

    expect(getPadSoundState(pad, new Set(["gone"]))).toBe("disabled");
  });

  it("returns 'disabled' when all assigned layers have empty instances", () => {
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [] } })] });

    expect(getPadSoundState(pad, new Set())).toBe("disabled");
  });

  it("returns 'ok' when pad has a tag layer (even if assigned layers are empty)", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const emptyAssigned = createMockLayer({ selection: { type: "assigned", instances: [] } });
    const pad = createMockPad({ layers: [emptyAssigned, tagLayer] });

    expect(getPadSoundState(pad, new Set())).toBe("ok");
  });

  it("returns 'partial' when pad has missing assigned sounds but also a tag layer", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const assigned = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [assigned, tagLayer] });

    expect(getPadSoundState(pad, new Set(["gone"]))).toBe("partial");
  });

  it("returns 'disabled' when pad has no layers", () => {
    const pad = createMockPad({ layers: [] });
    expect(getPadSoundState(pad, new Set())).toBe("disabled");
  });
});

describe("buildPadSoundStateMap", () => {
  it("returns empty map for empty pads array", () => {
    const result = buildPadSoundStateMap([], new Set());
    expect(result.size).toBe(0);
  });

  it("maps each pad id to its PadSoundState", () => {
    const inst1 = createMockSoundInstance({ soundId: "s1" });
    const inst2 = createMockSoundInstance({ soundId: "s2" });
    const pad1 = createMockPad({ id: "pad-1", layers: [createMockLayer({ selection: { type: "assigned", instances: [inst1] } })] });
    const pad2 = createMockPad({ id: "pad-2", layers: [createMockLayer({ selection: { type: "assigned", instances: [inst2] } })] });

    const result = buildPadSoundStateMap([pad1, pad2], new Set(["s2"]));

    expect(result.get("pad-1")).toBe("ok");
    expect(result.get("pad-2")).toBe("disabled");
  });

  it("returns 'partial' for a pad with mixed missing/ok sounds", () => {
    const okInst = createMockSoundInstance({ soundId: "ok" });
    const missingInst = createMockSoundInstance({ soundId: "missing" });
    const pad = createMockPad({
      id: "pad-1",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [okInst, missingInst] } })],
    });

    const result = buildPadSoundStateMap([pad], new Set(["missing"]));

    expect(result.get("pad-1")).toBe("partial");
  });
});

// ── getAffectedPads ───────────────────────────────────────────────────────────

describe("getAffectedPads", () => {
  it("returns empty array when no pads reference the given soundIds", () => {
    const project = createMockProject({ scenes: [] });
    expect(getAffectedPads(project, new Set(["s1"]))).toEqual([]);
  });

  it("returns affected pad with correct scene name and 1-based layer indices", () => {
    const inst = createMockSoundInstance({ soundId: "target" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ name: "Kick", layers: [layer] });
    const scene = createMockScene({ name: "Scene 1", pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const result = getAffectedPads(project, new Set(["target"]));

    expect(result).toHaveLength(1);
    expect(result[0].padName).toBe("Kick");
    expect(result[0].sceneName).toBe("Scene 1");
    expect(result[0].layerIndices).toEqual([1]);
  });

  it("reports only affected layers when pad has a mix", () => {
    const inst1 = createMockSoundInstance({ soundId: "target" });
    const inst2 = createMockSoundInstance({ soundId: "safe" });
    const l1 = createMockLayer({ selection: { type: "assigned", instances: [inst1] } });
    const l2 = createMockLayer({ selection: { type: "assigned", instances: [inst2] } });
    const pad = createMockPad({ name: "Mixed", layers: [l1, l2] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const result = getAffectedPads(project, new Set(["target"]));

    expect(result[0].layerIndices).toEqual([1]);
  });

  it("does not report tag or set layers", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["target"], matchMode: "any", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [tagLayer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    expect(getAffectedPads(project, new Set(["target"]))).toEqual([]);
  });
});

// ── applyProjectSoundReconcile ────────────────────────────────────────────────

describe("applyProjectSoundReconcile", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useLibraryStore.setState({ ...initialLibraryState });
  });

  it("is a no-op when no project is loaded", () => {
    applyProjectSoundReconcile();

    expect(useProjectStore.getState().project).toBeNull();
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("does not call updateProject when no orphaned sounds exist (removedCount === 0)", () => {
    const sound = createMockSound({ id: "sound-1" });
    const inst = createMockSoundInstance({ soundId: "sound-1" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    useProjectStore.setState({ project, historyEntry: createMockHistoryEntry() });
    useLibraryStore.setState({ sounds: [sound] });

    applyProjectSoundReconcile();

    expect(useProjectStore.getState().isDirty).toBe(false);
    const instances = (
      useProjectStore.getState().project!.scenes[0].pads[0].layers[0].selection as {
        type: "assigned";
        instances: { soundId: string }[];
      }
    ).instances;
    expect(instances).toHaveLength(1);
    expect(instances[0].soundId).toBe("sound-1");
  });

  it("calls updateProject with cleaned project when orphaned sounds exist (removedCount > 0)", () => {
    const inst = createMockSoundInstance({ soundId: "orphan-id" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    useProjectStore.setState({ project, historyEntry: createMockHistoryEntry() });
    useLibraryStore.setState({ sounds: [] }); // orphan-id not in library

    applyProjectSoundReconcile();

    expect(useProjectStore.getState().isDirty).toBe(true);
    const instances = (
      useProjectStore.getState().project!.scenes[0].pads[0].layers[0].selection as {
        type: "assigned";
        instances: unknown[];
      }
    ).instances;
    expect(instances).toHaveLength(0);
  });

  it("removes only orphaned instances and preserves valid ones", () => {
    const validSound = createMockSound({ id: "valid-id" });
    const validInst = createMockSoundInstance({ soundId: "valid-id" });
    const orphanInst = createMockSoundInstance({ soundId: "orphan-id" });
    const layer = createMockLayer({
      selection: { type: "assigned", instances: [validInst, orphanInst] },
    });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    useProjectStore.setState({ project, historyEntry: createMockHistoryEntry() });
    useLibraryStore.setState({ sounds: [validSound] });

    applyProjectSoundReconcile();

    expect(useProjectStore.getState().isDirty).toBe(true);
    const instances = (
      useProjectStore.getState().project!.scenes[0].pads[0].layers[0].selection as {
        type: "assigned";
        instances: { soundId: string }[];
      }
    ).instances;
    expect(instances).toHaveLength(1);
    expect(instances[0].soundId).toBe("valid-id");
  });

  it("does not call updateProject when project has no scenes (removedCount === 0)", () => {
    const project = createMockProject({ scenes: [] });

    useProjectStore.setState({ project, historyEntry: createMockHistoryEntry() });

    applyProjectSoundReconcile();

    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("does not modify tag or set layers when orphan removal runs", () => {
    const orphanInst = createMockSoundInstance({ soundId: "orphan-id" });
    const assignedLayer = createMockLayer({
      selection: { type: "assigned", instances: [orphanInst] },
    });
    const tagLayer = createMockLayer({
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
    });
    const pad = createMockPad({ layers: [assignedLayer, tagLayer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    useProjectStore.setState({ project, historyEntry: createMockHistoryEntry() });
    useLibraryStore.setState({ sounds: [] });

    applyProjectSoundReconcile();

    const layers = useProjectStore.getState().project!.scenes[0].pads[0].layers;
    expect(layers).toHaveLength(2);
    expect(layers[1].selection.type).toBe("tag");
  });
});
