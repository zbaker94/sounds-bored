import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer, createMockSound } from "@/test/factories";
import { PadConfigDrawer } from "./PadConfigDrawer";

vi.mock("@/lib/audio/padPlayer", () => ({
  syncLayerVolume: vi.fn(),
  syncLayerConfig: vi.fn(),
}));

function renderDrawer(props: { sceneId?: string; padId?: string } = {}) {
  return render(<PadConfigDrawer sceneId={props.sceneId ?? "scene-1"} padId={props.padId} />);
}

function openDrawer() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  });
}

describe("PadConfigDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    useLibraryStore.setState({ ...initialLibraryState });
    usePlaybackStore.setState({ ...initialPlaybackState });

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("is not visible when overlay is closed", () => {
    renderDrawer();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is visible when overlay is open", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the pad name input", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByLabelText(/pad name/i)).toBeInTheDocument();
  });

  it("shows at least one layer item", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByText(/layer 1/i)).toBeInTheDocument();
  });

  it("shows Add Layer button", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });

  describe("playing pad notice", () => {
    it("shows notice when editing a currently playing pad", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: ["pad-1"] });

      render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} />);
      openDrawer();

      expect(screen.getByText(/sound selection changes will apply on the next trigger/i)).toBeInTheDocument();
    });

    it("does not show notice when the pad is not playing", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} />);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("does not show notice in create mode even if other pads are playing", () => {
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: ["some-other-pad"] });

      renderDrawer();
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("does not show notice in edit mode when a different pad is playing", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: ["pad-999"] });

      render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} />);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("hides notice dynamically when pad stops playing while drawer is open", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: ["pad-1"] });

      render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} />);
      openDrawer();

      expect(screen.getByText(/sound selection changes will apply on the next trigger/i)).toBeInTheDocument();

      act(() => {
        usePlaybackStore.setState({ playingPadIds: [] });
      });

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("shows notice dynamically when pad starts playing while drawer is open", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} />);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();

      act(() => {
        usePlaybackStore.setState({ playingPadIds: ["pad-1"] });
      });

      expect(screen.getByText(/sound selection changes will apply on the next trigger/i)).toBeInTheDocument();
    });
  });

  it("shows a validation error when name is empty and Save is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("create mode: calls addPad and closes overlay on valid submit", async () => {
    const sound = createMockSound({ id: "sound-1", name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    renderDrawer();
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");

    // Layer 1 starts expanded — select a sound directly
    const checkbox = await screen.findByRole("checkbox", { name: /kick/i });
    await userEvent.click(checkbox);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads).toHaveLength(1);
      expect(pads![0].name).toBe("Kick");
      expect(pads![0].layers).toHaveLength(1);
    });

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
  });

  it("edit mode: calls updatePad when padId is provided", async () => {
    const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
    const pad = createMockPad({ id: "pad-1", name: "Original", layers: [layer] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

    render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Original", layers: [layer], muteTargetPadIds: [] }} />);
    openDrawer();

    const nameInput = screen.getByLabelText(/pad name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Updated");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads![0].name).toBe("Updated");
    });
  });

  it("closes overlay without saving when Cancel is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });

  it("clicking Add Layer adds a second layer item", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /add layer/i }));
    expect(screen.getByText(/layer 2/i)).toBeInTheDocument();
  });

  describe("layer ID stability on save", () => {
    async function renderEditDrawerWithLayers(layers: ReturnType<typeof createMockLayer>[]) {
      const sound = createMockSound({ id: "s1", name: "FX Sound" });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      const pad = createMockPad({ id: "pad-1", name: "FX", layers });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(
        createMockHistoryEntry(),
        createMockProject({ scenes: [scene] }),
        false,
      );

      render(
        <PadConfigDrawer
          sceneId="scene-1"
          padId="pad-1"
          initialConfig={{ name: "FX", layers, muteTargetPadIds: [] }}
        />,
      );
      openDrawer();
    }

    it("preserves remaining layer ID when first layer is deleted", async () => {
      const layer1 = createMockLayer({ id: "layer-uuid-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const layer2 = createMockLayer({ id: "layer-uuid-2", selection: { type: "assigned", instances: [{ id: "inst-2", soundId: "s1", volume: 1 }] } });
      await renderEditDrawerWithLayers([layer1, layer2]);

      const removeButtons = await screen.findAllByRole("button", { name: /remove layer/i });
      await userEvent.click(removeButtons[0]);

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        const layers = useProjectStore.getState().project?.scenes[0].pads[0].layers;
        expect(layers).toHaveLength(1);
        expect(layers![0].id).toBe("layer-uuid-2");
      });
    });

    it("preserves surrounding layer IDs when middle layer is deleted", async () => {
      const layer1 = createMockLayer({ id: "layer-uuid-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const layer2 = createMockLayer({ id: "layer-uuid-2", selection: { type: "assigned", instances: [{ id: "inst-2", soundId: "s1", volume: 1 }] } });
      const layer3 = createMockLayer({ id: "layer-uuid-3", selection: { type: "assigned", instances: [{ id: "inst-3", soundId: "s1", volume: 1 }] } });
      await renderEditDrawerWithLayers([layer1, layer2, layer3]);

      const removeButtons = await screen.findAllByRole("button", { name: /remove layer/i });
      await userEvent.click(removeButtons[1]);

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        const layers = useProjectStore.getState().project?.scenes[0].pads[0].layers;
        expect(layers).toHaveLength(2);
        expect(layers![0].id).toBe("layer-uuid-1");
        expect(layers![1].id).toBe("layer-uuid-3");
      });
    });
  });

  describe("syncLayerConfig on save", () => {
    async function renderEditDrawerWithLayer(layerOverrides: Parameters<typeof createMockLayer>[0] = {}) {
      const { syncLayerConfig } = await import("@/lib/audio/padPlayer");
      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] },
        ...layerOverrides,
      });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(
        createMockHistoryEntry(),
        createMockProject({ scenes: [scene] }),
        false,
      );
      const sound = createMockSound({ id: "s1", name: "FX Sound" });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      render(
        <PadConfigDrawer
          sceneId="scene-1"
          padId="pad-1"
          initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
        />,
      );
      openDrawer();
      return { layer, syncLayerConfig };
    }

    it("calls syncLayerConfig with the updated and original layer when playbackMode changes", async () => {
      const { syncLayerConfig } = await renderEditDrawerWithLayer({ playbackMode: "loop" });

      await userEvent.click(screen.getByRole("tab", { name: /one-shot/i }));
      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(syncLayerConfig).toHaveBeenCalledWith(
          expect.objectContaining({ id: "layer-1", playbackMode: "one-shot" }),
          expect.objectContaining({ id: "layer-1", playbackMode: "loop" }),
        );
      });
    });

    it("calls syncLayerConfig with the updated and original layer when arrangement changes", async () => {
      const { syncLayerConfig } = await renderEditDrawerWithLayer({ arrangement: "sequential" });

      await userEvent.click(screen.getByRole("tab", { name: /simultaneous/i }));
      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(syncLayerConfig).toHaveBeenCalledWith(
          expect.objectContaining({ id: "layer-1", arrangement: "simultaneous" }),
          expect.objectContaining({ id: "layer-1", arrangement: "sequential" }),
        );
      });
    });

    it("calls syncLayerConfig with matching new and original layer when nothing changes on save", async () => {
      const { layer, syncLayerConfig } = await renderEditDrawerWithLayer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].name).toBe("FX");
      });
      // syncLayerConfig is always called for existing layers; it's a no-op internally
      // when playbackMode and arrangement are unchanged.
      expect(syncLayerConfig).toHaveBeenCalledWith(
        expect.objectContaining({ id: "layer-1" }),
        expect.objectContaining({ id: "layer-1" }),
      );
      const [newLayer, origLayer] = (syncLayerConfig as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(newLayer.playbackMode).toBe(origLayer.playbackMode);
      expect(newLayer.arrangement).toBe(origLayer.arrangement);
    });
  });
});
