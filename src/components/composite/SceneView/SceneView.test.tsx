import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import {
  createMockHistoryEntry,
  createMockProject,
  createMockScene,
  createMockPad,
  createMockLayer,
  createMockSound,
  createMockSoundInstance,
} from "@/test/factories";
import { LARGE_FILE_THRESHOLD_BYTES } from "@/lib/audio/streamingCache";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SceneView } from "./SceneView";

vi.mock("@/lib/audio/streamingCache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audio/streamingCache")>(
    "@/lib/audio/streamingCache",
  );
  return {
    ...actual,
    preloadStreamingAudio: vi.fn(),
  };
});

// Imported after vi.mock so we get the mocked function reference.
import { preloadStreamingAudio } from "@/lib/audio/streamingCache";

function renderSceneView() {
  return render(<TooltipProvider><SceneView /></TooltipProvider>);
}

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  getPadProgress: vi.fn().mockReturnValue(null),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  rectSortingStrategy: {},
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: { toString: () => undefined },
  },
}));

describe("SceneView", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    useLibraryStore.setState({ ...initialLibraryState });
    vi.mocked(preloadStreamingAudio).mockClear();

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1", name: "Scene 1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("renders the Add Pad button when scene has no pads", () => {
    renderSceneView();
    expect(screen.getByRole("button", { name: /add pad/i })).toBeInTheDocument();
  });

  it("clicking Add Pad sets editingPadId in uiStore and adds a pad", async () => {
    renderSceneView();

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    expect(useUiStore.getState().editingPadId).not.toBeNull();
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(1);
  });

  it("clicking Add Pad immediately adds a pad to the store", async () => {
    renderSceneView();

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(1);
  });

  describe("activeScene derivation", () => {
    it("renders scene content when activeSceneId matches a scene", () => {
      const pad = createMockPad({ id: "pad-1", name: "Pad 1" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      useUiStore.setState({ activeSceneId: "scene-1" });

      renderSceneView();

      expect(screen.queryByText(/no scenes yet/i)).not.toBeInTheDocument();
    });

    it("renders empty state when activeSceneId does not match any scene", () => {
      const scene = createMockScene({ id: "scene-1" });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      // Bypass setActiveSceneId validation to test the defensive fallback in SceneView
      useUiStore.setState({ activeSceneId: "non-existent-id" });

      renderSceneView();

      expect(screen.getByText(/no scenes yet/i)).toBeInTheDocument();
    });
  });

  describe("reorderPads", () => {
    it("reorders pads in the store when reorderPads is called", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      const padC = createMockPad({ id: "pad-c", name: "Pad C" });
      const scene = createMockScene({ id: "scene-1", pads: [padA, padB, padC] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      useProjectStore.getState().reorderPads("scene-1", 0, 2);

      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads[0].id).toBe("pad-b");
      expect(pads[1].id).toBe("pad-c");
      expect(pads[2].id).toBe("pad-a");
    });

    it("marks the project as dirty after reorder", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      const scene = createMockScene({ id: "scene-1", pads: [padA, padB] });
      const entry = createMockHistoryEntry();
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      // clearDirtyFlag to ensure we start clean
      useProjectStore.getState().clearDirtyFlag();
      expect(useProjectStore.getState().isDirty).toBe(false);

      useProjectStore.getState().reorderPads("scene-1", 0, 1);

      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe("streaming preload guard", () => {
    function buildSceneWithLargeSound(soundId = "large-sound-1") {
      const largeSound = createMockSound({
        id: soundId,
        filePath: `sounds/${soundId}.mp3`,
        fileSizeBytes: LARGE_FILE_THRESHOLD_BYTES + 1,
      });
      const layer = createMockLayer({
        id: `layer-${soundId}`,
        selection: {
          type: "assigned",
          instances: [createMockSoundInstance({ soundId: largeSound.id })],
        },
      });
      const pad = createMockPad({ id: `pad-${soundId}`, layers: [layer] });
      return { largeSound, layer, pad };
    }

    it("calls preloadStreamingAudio for large sounds on initial render", () => {
      const { largeSound, pad } = buildSceneWithLargeSound();
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({ ...initialLibraryState, sounds: [largeSound] });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      renderSceneView();

      expect(preloadStreamingAudio).toHaveBeenCalledTimes(1);
      expect(preloadStreamingAudio).toHaveBeenCalledWith(
        expect.objectContaining({ id: largeSound.id }),
      );
    });

    it("skips (does not preload) sounds below the size threshold", () => {
      const smallSound = createMockSound({
        id: "small-sound",
        filePath: "sounds/small.mp3",
        fileSizeBytes: 1024,
      });
      const layer = createMockLayer({
        selection: {
          type: "assigned",
          instances: [createMockSoundInstance({ soundId: smallSound.id })],
        },
      });
      const pad = createMockPad({ layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({ ...initialLibraryState, sounds: [smallSound] });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      renderSceneView();

      expect(preloadStreamingAudio).not.toHaveBeenCalled();
    });

    it("does NOT re-call preloadStreamingAudio when a mutation doesn't change the large-sound set", () => {
      const { largeSound, pad } = buildSceneWithLargeSound();
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({ ...initialLibraryState, sounds: [largeSound] });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      const { rerender } = renderSceneView();
      expect(preloadStreamingAudio).toHaveBeenCalledTimes(1);
      vi.mocked(preloadStreamingAudio).mockClear();

      // Mutate the project in a way that replaces the scenes array reference
      // (Immer) but does NOT change the set of large sounds referenced by the
      // active scene. setPadFadeDuration is a cheap mutation that does exactly
      // this.
      useProjectStore.getState().setPadFadeDuration("scene-1", pad.id, 1234);

      rerender(<TooltipProvider><SceneView /></TooltipProvider>);

      expect(preloadStreamingAudio).not.toHaveBeenCalled();
    });

    it("re-calls preloadStreamingAudio when a large sound is swapped (same count, different ID)", () => {
      const { largeSound: largeA, pad: padA } = buildSceneWithLargeSound("large-a");
      const { largeSound: largeB, layer: layerB } = buildSceneWithLargeSound("large-b");
      const scene = createMockScene({ id: "scene-1", pads: [padA] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [largeA, largeB],
      });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      const { rerender } = renderSceneView();
      expect(preloadStreamingAudio).toHaveBeenCalledTimes(1);
      expect(preloadStreamingAudio).toHaveBeenCalledWith(
        expect.objectContaining({ id: largeA.id }),
      );
      vi.mocked(preloadStreamingAudio).mockClear();

      // Swap the pad's layers so it now references largeB instead of largeA.
      // Same count (1), different ID — this exercises the membership loop
      // inside the guard (size check alone would pass).
      useProjectStore.getState().updatePad("scene-1", padA.id, {
        name: padA.name,
        layers: [layerB],
        muteTargetPadIds: padA.muteTargetPadIds,
        muteGroupId: padA.muteGroupId,
        color: padA.color,
        icon: padA.icon,
        fadeDurationMs: padA.fadeDurationMs,
      });

      rerender(<TooltipProvider><SceneView /></TooltipProvider>);

      expect(preloadStreamingAudio).toHaveBeenCalled();
      const calledIds = vi.mocked(preloadStreamingAudio).mock.calls.map((c) => c[0].id);
      expect(calledIds).toContain(largeB.id);
    });

    it("re-calls preloadStreamingAudio when a new large sound is added to the scene", () => {
      const { largeSound: largeA, pad: padA } = buildSceneWithLargeSound("large-a");
      const scene = createMockScene({ id: "scene-1", pads: [padA] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({ ...initialLibraryState, sounds: [largeA] });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

      const { rerender } = renderSceneView();
      expect(preloadStreamingAudio).toHaveBeenCalledTimes(1);
      vi.mocked(preloadStreamingAudio).mockClear();

      // Add a brand-new large sound referenced by a new pad.
      const { largeSound: largeB, pad: padB } = buildSceneWithLargeSound("large-b");
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [largeA, largeB],
      });
      useProjectStore.getState().addPad("scene-1", {
        name: padB.name,
        layers: padB.layers,
        muteTargetPadIds: padB.muteTargetPadIds,
      });

      rerender(<TooltipProvider><SceneView /></TooltipProvider>);

      // Only the newly-added large sound needs preloading; the previous one was
      // already in the guard's ref set. But the current implementation preloads
      // all currently-referenced large sounds when the set changes — and
      // preloadStreamingAudio itself is internally cached, so redundant calls
      // are harmless. Assert that the effect fired again (at least once) and
      // that the new sound is among the calls.
      expect(preloadStreamingAudio).toHaveBeenCalled();
      const calledIds = vi.mocked(preloadStreamingAudio).mock.calls.map((c) => c[0].id);
      expect(calledIds).toContain(largeB.id);
    });
  });
});
