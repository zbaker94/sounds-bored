import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
import { LARGE_FILE_THRESHOLD_BYTES } from "@/lib/audio";
import { PADS_PER_PAGE } from "@/lib/constants";
import { TooltipProvider } from "@/components/ui/tooltip";
// Namespace import required so vi.spyOn can intercept the named export via the live module binding.
import * as reconcile from "@/lib/project.reconcile";
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
import { preloadStreamingAudio } from "@/lib/audio";

function renderSceneView() {
  return render(<TooltipProvider><SceneView /></TooltipProvider>);
}

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audio/gainManager", () => ({
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  setLayerVolume: vi.fn(),
  syncLayerVolume: vi.fn(),
  clampGain01: (v: number) => Math.max(0, Math.min(1, v)),
}));

vi.mock("@/lib/audio/audioState", () => ({
  getPadProgress: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/audio/voiceRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/voiceRegistry")>();
  return { ...actual, isPadActive: vi.fn().mockReturnValue(false), onLayerVoiceSetChanged: vi.fn().mockReturnValue(() => {}) };
});

vi.mock("@/lib/audio/fadeCoordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/fadeCoordinator")>();
  return { ...actual, isPadFading: vi.fn().mockReturnValue(false) };
});

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
  function loadScene(pads: ReturnType<typeof createMockPad>[] = []) {
    const scene = createMockScene({ id: "scene-1", pads });
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  }

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

  it("clicking Add Pad sets editingPadId to the new pad's id in uiStore", async () => {
    renderSceneView();

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));
    // setEditingPadId is deferred via setTimeout(0) so the pad mounts unflipped first
    // and the CSS flip transition plays. Flush it before asserting.
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });

    const pads = useProjectStore.getState().project?.scenes[0].pads;
    expect(pads).toHaveLength(1);
    expect(useUiStore.getState().editingPadId).toBe(pads![0].id);
  });

  describe("Add Pad pagination", () => {
    it("navigates to next page when Add Pad is clicked on a full page", async () => {
      const pads = Array.from({ length: PADS_PER_PAGE }, (_, i) =>
        createMockPad({ id: `pad-${i}`, name: `Pad ${i}` }),
      );
      loadScene(pads);

      renderSceneView();

      await userEvent.click(screen.getByRole("button", { name: /add pad/i }));
      await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });

      const updatedPads = useProjectStore.getState().project?.scenes[0].pads;
      expect(updatedPads).toHaveLength(PADS_PER_PAGE + 1);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(1);
    });

    it("stays on page 0 when Add Pad is clicked and the page is not full", async () => {
      const pads = Array.from({ length: PADS_PER_PAGE - 1 }, (_, i) =>
        createMockPad({ id: `pad-${i}`, name: `Pad ${i}` }),
      );
      loadScene(pads);

      renderSceneView();

      await userEvent.click(screen.getByRole("button", { name: /add pad/i }));
      await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });

      const updatedPads = useProjectStore.getState().project?.scenes[0].pads;
      expect(updatedPads).toHaveLength(PADS_PER_PAGE);
      expect(useUiStore.getState().pageByScene["scene-1"] ?? 0).toBe(0);
    });
  });

  describe("activeScene derivation", () => {
    it("renders scene content when activeSceneId matches a scene", () => {
      const pad = createMockPad({ id: "pad-1", name: "Pad 1" });
      loadScene([pad]);
      useProjectStore.setState({ activeSceneId: "scene-1" });

      renderSceneView();

      expect(screen.queryByText(/no scenes yet/i)).not.toBeInTheDocument();
    });

    it("renders empty state when activeSceneId does not match any scene", () => {
      loadScene();
      // Bypass setActiveSceneId validation to test the defensive fallback in SceneView
      useProjectStore.setState({ activeSceneId: "non-existent-id" });

      renderSceneView();

      expect(screen.getByText(/no scenes yet/i)).toBeInTheDocument();
    });
  });

  describe("reorderPads", () => {
    it("reorders pads in the store when reorderPads is called", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      const padC = createMockPad({ id: "pad-c", name: "Pad C" });
      loadScene([padA, padB, padC]);

      useProjectStore.getState().reorderPads("scene-1", 0, 2);

      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads[0].id).toBe("pad-b");
      expect(pads[1].id).toBe("pad-c");
      expect(pads[2].id).toBe("pad-a");
    });

    it("marks the project as dirty after reorder", () => {
      const padA = createMockPad({ id: "pad-a", name: "Pad A" });
      const padB = createMockPad({ id: "pad-b", name: "Pad B" });
      loadScene([padA, padB]);

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

    function setupLargeSoundScene(soundId?: string) {
      const { largeSound, pad } = buildSceneWithLargeSound(soundId);
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      const entry = createMockHistoryEntry();
      useLibraryStore.setState({ ...initialLibraryState, sounds: [largeSound] });
      useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
      return { largeSound, pad };
    }

    it("calls preloadStreamingAudio for large sounds on initial render", () => {
      const { largeSound } = setupLargeSoundScene();

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
      const { pad } = setupLargeSoundScene();

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
      const { largeSound: largeA, pad: padA } = setupLargeSoundScene("large-a");
      const { largeSound: largeB, layer: layerB } = buildSceneWithLargeSound("large-b");
      useLibraryStore.setState({
        ...initialLibraryState,
        sounds: [largeA, largeB],
      });

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
      const { largeSound: largeA } = setupLargeSoundScene("large-a");

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

  describe("padSoundState propagation", () => {
    it("passes partial padSoundState to PadButton when a sound is missing", () => {
      // Full chain: useLibraryStore.missingSoundIds → buildPadSoundStateMap →
      // padSoundState prop on PadButton → partial-warning DOM.
      // Pad needs BOTH a missing sound AND a playable source → "partial".
      const missingId = "snd-missing";
      const okId = "snd-ok";
      const okInst = createMockSoundInstance({ soundId: okId });
      const missingInst = createMockSoundInstance({ soundId: missingId });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [okInst, missingInst] },
      });
      const pad = createMockPad({ id: "pad-test", name: "Test", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(
        createMockHistoryEntry(),
        createMockProject({ scenes: [scene] }),
        false,
      );
      useLibraryStore.setState({ ...initialLibraryState, missingSoundIds: new Set([missingId]) });

      render(<TooltipProvider><SceneView /></TooltipProvider>);

      // The partial-warning amber icon should appear.
      expect(screen.getByTestId("pad-partial-warning")).toBeInTheDocument();
    });

    it("updates padSoundState when missingSoundIds changes", () => {
      // Pad has one playable and one not-yet-missing assigned sound → "ok" initially.
      // Marking the second sound as missing flips state to "partial" and surfaces the warning.
      const okId = "snd-ok";
      const otherId = "snd-other";
      const okInst = createMockSoundInstance({ soundId: okId });
      const otherInst = createMockSoundInstance({ soundId: otherId });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [okInst, otherInst] },
      });
      const pad = createMockPad({ id: "pad-2", name: "Snare", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(
        createMockHistoryEntry(),
        createMockProject({ scenes: [scene] }),
        false,
      );

      render(<TooltipProvider><SceneView /></TooltipProvider>);
      expect(screen.queryByTestId("pad-partial-warning")).not.toBeInTheDocument();

      act(() => {
        useLibraryStore.setState({ ...initialLibraryState, missingSoundIds: new Set([otherId]) });
      });

      expect(screen.getByTestId("pad-partial-warning")).toBeInTheDocument();
    });

    it("does not recompute padSoundStateMap on re-render when pads and missingSoundIds are unchanged", () => {
      // Verifies that useMemo([pads, missingSoundIds]) actually caches: forcing a
      // re-render without changing either dep must not call buildPadSoundStateMap again.
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [createMockLayer()] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(
        createMockHistoryEntry(),
        createMockProject({ scenes: [scene] }),
        false,
      );

      const spy = vi.spyOn(reconcile, "buildPadSoundStateMap");
      const { rerender } = render(<TooltipProvider><SceneView /></TooltipProvider>);
      const callsAfterMount = spy.mock.calls.length;
      // Self-validate the spy is intercepting — fails immediately if vi.spyOn didn't hook in.
      expect(spy).toHaveBeenCalled();

      // Re-render without changing pads or missingSoundIds — useMemo must return cached result.
      rerender(<TooltipProvider><SceneView /></TooltipProvider>);

      expect(spy.mock.calls.length).toBe(callsAfterMount);
    });
  });
});
