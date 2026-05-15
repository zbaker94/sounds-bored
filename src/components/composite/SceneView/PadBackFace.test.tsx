import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { usePadMetricsStore, initialPadMetricsState } from "@/state/padMetricsStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import type { Pad } from "@/lib/schemas";
import { PadBackFace } from "./PadBackFace";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  executeFadeTap: vi.fn(),
  reverseFade: vi.fn(),
  stopFade: vi.fn(),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audio/gainManager", () => ({
  setLayerVolume: vi.fn(),
  setPadVolume: vi.fn(),
  syncLayerVolume: vi.fn(),
  resetPadGain: vi.fn(),
  clampGain01: (v: number) => Math.max(0, Math.min(1, v)),
}));

vi.mock("@/lib/audio/layerTrigger", () => ({
  stopLayerWithRamp: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
  syncLayerConfig: vi.fn(),
  syncLayerArrangement: vi.fn(),
  syncLayerPlaybackMode: vi.fn(),
  syncLayerSelection: vi.fn(),
  selectionsEqual: vi.fn(),
  getLayerNormalizedVolume: vi.fn().mockReturnValue(1),
}));

vi.mock("../PadConfigDrawer/LayerConfigDialog", () => ({
  LayerConfigDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="layer-config-dialog">
      <button onClick={onClose}>Close Dialog</button>
    </div>
  ),
}));

function loadPad(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const project = createMockProject({ scenes: [scene] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, project, false);
  return { pad, layer };
}

function renderBackFace(pad: Pad) {
  render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
}

function expectFadeButton(label: "in" | "out" | "disabled") {
  if (label === "disabled") {
    const btn = screen.getByRole("button", { name: /^fade$/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
    return;
  }
  const present = label === "in" ? /fade in/i : /fade out/i;
  const absent = label === "in" ? /fade out/i : /fade in/i;
  expect(screen.getByRole("button", { name: present })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: absent })).not.toBeInTheDocument();
}

describe("PadBackFace", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    usePlaybackStore.setState({ ...initialPlaybackState });
    usePadMetricsStore.setState({ ...initialPadMetricsState });
  });

  it("renders pad name in an input", () => {
    const { pad } = loadPad();
    renderBackFace(pad);
    expect(screen.getByDisplayValue("Kick")).toBeInTheDocument();
  });

  it("saves name on blur", async () => {
    const { pad } = loadPad();
    renderBackFace(pad);

    const input = screen.getByDisplayValue("Kick");
    await userEvent.clear(input);
    await userEvent.type(input, "Snare");
    fireEvent.blur(input);

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.name).toBe("Snare");
    });
  });

  it("restores original name when blurred with empty value", async () => {
    const { pad } = loadPad();
    renderBackFace(pad);

    const input = screen.getByDisplayValue("Kick");
    await userEvent.clear(input);
    fireEvent.blur(input);

    expect(screen.getByDisplayValue("Kick")).toBeInTheDocument();
    const storedPad = useProjectStore.getState().project!.scenes[0].pads[0];
    expect(storedPad.name).toBe("Kick");
  });

  it("renders a layer row for each layer", () => {
    const { pad } = loadPad();
    renderBackFace(pad);
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
  });

  it("opens LayerConfigDialog when a layer's edit button is clicked", async () => {
    const { pad } = loadPad();
    renderBackFace(pad);

    await userEvent.click(screen.getByRole("button", { name: /edit layer 1/i }));
    expect(screen.getByTestId("layer-config-dialog")).toBeInTheDocument();
  });

  it("adds a new layer when Add Layer is clicked", async () => {
    const { pad } = loadPad();
    renderBackFace(pad);

    await userEvent.click(screen.getByRole("button", { name: /add layer/i }));

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.layers).toHaveLength(2);
    });
  });

  it("removes a layer when remove is clicked (disabled if only 1 layer)", async () => {
    const layer1 = createMockLayer({ id: "layer-1" });
    const layer2 = createMockLayer({ id: "layer-2" });
    const { pad } = loadPad({ layers: [layer1, layer2] });
    renderBackFace(pad);

    await userEvent.click(screen.getByRole("button", { name: /remove layer 1/i }));

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.layers).toHaveLength(1);
      expect(updatedPad.layers[0].id).toBe("layer-2");
    });
  });

  it("disables remove layer button when only 1 layer", () => {
    const { pad } = loadPad();
    renderBackFace(pad);
    expect(screen.getByRole("button", { name: /remove layer 1/i })).toBeDisabled();
  });

  it("renders Fade target and Duration labels always; hides Current volume when not playing", () => {
    const { pad } = loadPad();
    renderBackFace(pad);
    expect(screen.queryByText("Current volume")).not.toBeInTheDocument();
    expect(screen.getByText("Fade target")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
  });

  it("shows Current volume label and percentage when pad is playing", () => {
    const { pad } = loadPad();
    usePlaybackStore.getState().addPlayingPad(pad.id);
    renderBackFace(pad);
    expect(screen.getByText("Current volume")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("displays explicit pad volume (when playing) and fadeTargetVol values", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    renderBackFace(pad);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("shows Fade In when pad is not playing and target > 0", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    renderBackFace(pad);
    expectFadeButton("in");
  });

  it("shows disabled Fade when pad is not playing and target is 0", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 0 });
    renderBackFace(pad);
    expectFadeButton("disabled");
  });

  it("shows Fade Out when pad is playing and target < current volume", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    renderBackFace(pad);
    expectFadeButton("out");
  });

  it("shows Fade In when pad is playing and target >= current volume", () => {
    const { pad } = loadPad({ volume: 50, fadeTargetVol: 80 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    renderBackFace(pad);
    expectFadeButton("in");
  });

  it("shows disabled Fade when pad is playing and live volume equals target", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 50 });
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set([pad.id]) });
    usePadMetricsStore.getState().setPadMetrics({ padVolumes: { [pad.id]: 0.5 } });
    renderBackFace(pad);
    expectFadeButton("disabled");
  });

  it("does not show Reverse button when pad is not fading", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    renderBackFace(pad);
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("shows Stop Fade button and Reverse button when pad is fading", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
    });
    renderBackFace(pad);
    expect(screen.getByRole("button", { name: /stop fade/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fade out/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reverse/i })).toBeInTheDocument();
  });

  it("hides Reverse button while reversal is in progress", () => {
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
      reversingPadIds: new Set([pad.id]),
    });
    renderBackFace(pad);
    expect(screen.getByRole("button", { name: /stop fade/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("calls reverseFade when Reverse button is clicked", async () => {
    const { reverseFade } = await import("@/lib/audio/padPlayer");
    const { pad } = loadPad({ volume: 80, fadeTargetVol: 20 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
    });
    renderBackFace(pad);
    await userEvent.click(screen.getByRole("button", { name: /reverse/i }));
    expect(reverseFade).toHaveBeenCalled();
  });

  describe("scene move/copy controls", () => {
    function loadPadMultiScene() {
      const layer = createMockLayer({ id: "layer-1" });
      const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
      const scene1 = createMockScene({ id: "scene-1", name: "Scene A", pads: [pad] });
      const scene2 = createMockScene({ id: "scene-2", name: "Scene B", pads: [] });
      const scene3 = createMockScene({ id: "scene-3", name: "Scene C", pads: [] });
      const project = createMockProject({ scenes: [scene1, scene2, scene3] });
      useProjectStore.getState().loadProject(createMockHistoryEntry(), project, false);
      return { pad };
    }

    it("shows scene selector with other scenes, excluding current scene", () => {
      const { pad } = loadPadMultiScene();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
      expect(screen.getByLabelText("Target scene")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Scene B" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Scene C" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Scene A" })).not.toBeInTheDocument();
    });

    it("defaults to first other scene as initial selection", () => {
      const { pad } = loadPadMultiScene();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
      const select = screen.getByLabelText("Target scene") as HTMLSelectElement;
      expect(select.value).toBe("scene-2");
    });

    it("does not show scene selector when project has only one scene", () => {
      const { pad } = loadPad();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
      expect(screen.queryByLabelText("Target scene")).not.toBeInTheDocument();
    });

    it("resets selection to first available scene when current target is removed", async () => {
      const { pad } = loadPadMultiScene();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

      const select = screen.getByLabelText("Target scene") as HTMLSelectElement;
      await userEvent.selectOptions(select, "scene-3");
      expect(select.value).toBe("scene-3");

      useProjectStore.setState((s) => ({
        project: s.project
          ? { ...s.project, scenes: s.project.scenes.filter((sc) => sc.id !== "scene-3") }
          : null,
      }));

      await waitFor(() => {
        expect(select.value).toBe("scene-2");
      });
    });

    it("moves pad to selected scene when Move is clicked", async () => {
      const { pad } = loadPadMultiScene();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /move pad to selected scene/i }));
      const state = useProjectStore.getState().project!;
      expect(state.scenes.find((s) => s.id === "scene-1")?.pads).toHaveLength(0);
      expect(state.scenes.find((s) => s.id === "scene-2")?.pads).toHaveLength(1);
    });

    it("copies pad to selected scene when Copy is clicked", async () => {
      const { pad } = loadPadMultiScene();
      render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: /copy pad to selected scene/i }));
      const state = useProjectStore.getState().project!;
      expect(state.scenes.find((s) => s.id === "scene-1")?.pads).toHaveLength(1);
      expect(state.scenes.find((s) => s.id === "scene-2")?.pads).toHaveLength(1);
    });
  });
});
