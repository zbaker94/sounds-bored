import { describe, it, expect, beforeEach } from "vitest";
import { applyProjectSoundReconcile } from "./reconcileProject";
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
