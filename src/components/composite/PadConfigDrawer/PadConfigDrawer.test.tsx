import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer, createMockSound, createMockAppSettings } from "@/test/factories";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PadConfigDrawer } from "./PadConfigDrawer";

vi.mock("@/lib/audio/padPlayer", () => ({
  syncLayerVolume: vi.fn(),
  syncLayerConfig: vi.fn(),
}));

function renderDrawer(props: { sceneId?: string; padId?: string } = {}) {
  return render(
    <TooltipProvider>
      <PadConfigDrawer sceneId={props.sceneId ?? "scene-1"} padId={props.padId} />
    </TooltipProvider>
  );
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
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });

      render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
      openDrawer();

      expect(screen.getByText(/sound selection changes will apply on the next trigger/i)).toBeInTheDocument();
    });

    it("does not show notice when the pad is not playing", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("does not show notice in create mode even if other pads are playing", () => {
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["some-other-pad"]) });

      renderDrawer();
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("does not show notice in edit mode when a different pad is playing", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-999"]) });

      render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("hides notice dynamically when pad stops playing while drawer is open", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set(["pad-1"]) });

      render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
      openDrawer();

      expect(screen.getByText(/sound selection changes will apply on the next trigger/i)).toBeInTheDocument();

      act(() => {
        usePlaybackStore.setState({ playingPadIds: new Set() });
      });

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();
    });

    it("shows notice dynamically when pad starts playing while drawer is open", () => {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
      openDrawer();

      expect(screen.queryByText(/sound selection changes will apply on the next trigger/i)).not.toBeInTheDocument();

      act(() => {
        usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
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

    render(<TooltipProvider><PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Original", layers: [layer], muteTargetPadIds: [] }} /></TooltipProvider>);
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

  describe("muteGroupId and color round-trip on edit submit", () => {
    async function renderEditDrawerWithPad(padOverrides: Partial<Parameters<typeof createMockPad>[0]> = {}) {
      const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer], ...padOverrides });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      const sound = createMockSound({ id: "s1", name: "FX Sound" });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });
      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: pad.name, layers: pad.layers, muteTargetPadIds: pad.muteTargetPadIds, muteGroupId: pad.muteGroupId, color: pad.color, icon: pad.icon }}
          />
        </TooltipProvider>,
      );
      openDrawer();
    }

    it("preserves muteGroupId through a save cycle", async () => {
      await renderEditDrawerWithPad({ muteGroupId: "group-A" });
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].muteGroupId).toBe("group-A");
      });
    });

    it("preserves color through a save cycle", async () => {
      await renderEditDrawerWithPad({ color: "#ff5500" });
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].color).toBe("#ff5500");
      });
    });

    it("preserves both muteGroupId and color simultaneously", async () => {
      await renderEditDrawerWithPad({ muteGroupId: "group-B", color: "#001122" });
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        const pad = useProjectStore.getState().project?.scenes[0].pads[0];
        expect(pad?.muteGroupId).toBe("group-B");
        expect(pad?.color).toBe("#001122");
      });
    });

    it("preserves icon through a save cycle", async () => {
      await renderEditDrawerWithPad({ icon: "Speaker01Icon" });
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].icon).toBe("Speaker01Icon");
      });
    });

    it("clears muteGroupId when initialConfig omits it (regression for #172)", async () => {
      // Pad starts with muteGroupId set; a caller that cleared it would omit it from initialConfig.
      // The bug: if muteGroupId is absent from config, Object.assign silently preserves "group-A".
      const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer], muteGroupId: "group-A" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      useLibraryStore.setState({ sounds: [createMockSound({ id: "s1", name: "FX Sound" })], tags: [], sets: [], isDirty: false });
      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].muteGroupId).toBeUndefined();
      });
    });

    it("clears color when initialConfig omits it (regression for #172)", async () => {
      // Same regression scenario for color.
      const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer], color: "#ff5500" });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      useLibraryStore.setState({ sounds: [createMockSound({ id: "s1", name: "FX Sound" })], tags: [], sets: [], isDirty: false });
      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();
      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => {
        expect(useProjectStore.getState().project?.scenes[0].pads[0].color).toBeUndefined();
      });
    });
  });

  describe("selection validation on save", () => {
    it("shows tag-match error when no library sounds match the selected tags", async () => {
      // Library contains one sound with tag "tag-other" — does not match the layer's "tag-missing".
      const sound = createMockSound({ id: "s1", name: "FX Sound", filePath: "fx.mp3", tags: ["tag-other"] });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "tag", tagIds: ["tag-missing"], matchMode: "any", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(await screen.findByText(/no sounds in library match these tags/i)).toBeInTheDocument();
      // Drawer remains open because submit failed.
      expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(true);
    });

    it("shows set-match error when no library sounds match the selected set", async () => {
      // Library contains one sound in a different set, so the layer's "set-missing" has no matches.
      const sound = createMockSound({ id: "s1", name: "FX Sound", filePath: "fx.mp3", sets: ["set-other"] });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "set", setId: "set-missing", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(await screen.findByText(/no sounds in library match this set/i)).toBeInTheDocument();
      // Drawer remains open because submit failed.
      expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(true);
    });

    it("saves successfully when tag selection matches at least one library sound", async () => {
      // Library contains a sound tagged "tag-match" that satisfies the layer's tag filter.
      const sound = createMockSound({ id: "s1", name: "FX Sound", filePath: "fx.mp3", tags: ["tag-match"] });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "tag", tagIds: ["tag-match"], matchMode: "any", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
      });
      expect(screen.queryByText(/no sounds in library match these tags/i)).not.toBeInTheDocument();
    });

    it("saves successfully when set selection matches at least one library sound", async () => {
      // Library contains a sound in the selected set with a file path — the layer's set has matches.
      const sound = createMockSound({ id: "s1", name: "FX Sound", filePath: "fx.mp3", sets: ["set-match"] });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      const layer = createMockLayer({
        id: "layer-1",
        selection: { type: "set", setId: "set-match", defaultVolume: 100 },
      });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
      );
      openDrawer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
      });
      expect(screen.queryByText(/no sounds in library match this set/i)).not.toBeInTheDocument();
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
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers, muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
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
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }}
          />
        </TooltipProvider>,
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
      const { syncLayerConfig } = await renderEditDrawerWithLayer();

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

  describe("syncLayerVolume on save", () => {
    it("calls syncLayerVolume with volume divided by 100 (schema [0,100] → normalized [0,1])", async () => {
      const { syncLayerVolume } = await import("@/lib/audio/padPlayer");
      const layer = createMockLayer({
        id: "layer-1",
        volume: 80,
        selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] },
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
        <TooltipProvider>
          <PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [] }} />
        </TooltipProvider>,
      );
      openDrawer();

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(syncLayerVolume).toHaveBeenCalledWith("layer-1", 80 / 100);
      });
    });
  });

  describe("FadeLevelsField", () => {
    it("renders a Fade Levels label", () => {
      renderDrawer();
      openDrawer();
      expect(screen.getByText("Fade Levels")).toBeInTheDocument();
    });

    it("preserves fadeLowVol through a save cycle", async () => {
      const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const pad = createMockPad({ id: "pad-1", name: "FX", layers: [layer], fadeLowVol: 0.2, fadeHighVol: 0.8 });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);
      useLibraryStore.setState({ sounds: [createMockSound({ id: "s1", name: "FX Sound" })], tags: [], sets: [], isDirty: false });

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "FX", layers: [layer], muteTargetPadIds: [], fadeLowVol: 0.2, fadeHighVol: 0.8 }}
          />
        </TooltipProvider>,
      );
      openDrawer();
      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        const saved = useProjectStore.getState().project?.scenes[0].pads[0];
        expect(saved?.fadeLowVol).toBeCloseTo(0.2, 2);
        expect(saved?.fadeHighVol).toBeCloseTo(0.8, 2);
      });
    });

    it("saves default fade levels (0 and 1) when no initialConfig levels are provided", async () => {
      const sound = createMockSound({ id: "sound-1", name: "Kick" });
      useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

      renderDrawer();
      openDrawer();

      await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");

      const checkbox = await screen.findByRole("checkbox", { name: /kick/i });
      await userEvent.click(checkbox);

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        const saved = useProjectStore.getState().project?.scenes[0].pads[0];
        expect(saved?.fadeLowVol).toBe(0);
        expect(saved?.fadeHighVol).toBe(1);
      });
    });
  });

  describe("FadeDurationField", () => {
    it("renders a Fade Duration info icon tooltip", () => {
      renderDrawer();
      openDrawer();
      expect(screen.getByText("Fade Duration")).toBeInTheDocument();
      // The info icon button is adjacent to the label
      const fadeLabel = screen.getByText("Fade Duration");
      const infoButton = fadeLabel.parentElement?.querySelector("button[tabindex='-1']");
      expect(infoButton).toBeInTheDocument();
    });

    it("shows global default helper text when no custom fade is set", () => {
      useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
      renderDrawer();
      openDrawer();
      expect(screen.getByText(/Using the global default \(2\.0s\)/)).toBeInTheDocument();
    });

    it("shows custom fade helper text when a pad-specific fade is set", () => {
      useAppSettingsStore.setState({ settings: createMockAppSettings({ globalFadeDurationMs: 2000 }) });
      const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene = createMockScene({ id: "scene-1", pads: [pad] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), createMockProject({ scenes: [scene] }), false);

      render(
        <TooltipProvider>
          <PadConfigDrawer
            sceneId="scene-1"
            padId="pad-1"
            initialConfig={{ name: "Kick", layers: [layer], muteTargetPadIds: [], fadeDurationMs: 3000 }}
          />
        </TooltipProvider>
      );
      openDrawer();
      expect(screen.getByText(/Custom fade for this pad/)).toBeInTheDocument();
    });
  });
});
