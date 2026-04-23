import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadBackFace } from "./PadBackFace";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  executeFadeTap: vi.fn(),
  reverseFade: vi.fn(),
  stopFade: vi.fn(),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  setPadVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
  syncLayerConfig: vi.fn(),
  syncLayerVolume: vi.fn(),
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

describe("PadBackFace", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("renders pad name in an input", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByDisplayValue("Kick")).toBeInTheDocument();
  });

  it("saves name on blur", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

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
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    const input = screen.getByDisplayValue("Kick");
    await userEvent.clear(input);
    fireEvent.blur(input);

    expect(screen.getByDisplayValue("Kick")).toBeInTheDocument();
    const storedPad = useProjectStore.getState().project!.scenes[0].pads[0];
    expect(storedPad.name).toBe("Kick");
  });

  it("renders a layer row for each layer", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
  });

  it("opens LayerConfigDialog when a layer's edit button is clicked", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /edit layer 1/i }));
    expect(screen.getByTestId("layer-config-dialog")).toBeInTheDocument();
  });

  it("adds a new layer when Add Layer is clicked", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

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
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /remove layer 1/i }));

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.layers).toHaveLength(1);
      expect(updatedPad.layers[0].id).toBe("layer-2");
    });
  });

  it("disables remove layer button when only 1 layer", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /remove layer 1/i })).toBeDisabled();
  });

  it("renders Fade target and Duration labels always; hides Current volume when not playing", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.queryByText("Current volume")).not.toBeInTheDocument();
    expect(screen.getByText("Fade target")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
  });

  it("shows Current volume label and percentage when pad is playing", () => {
    const { pad } = loadPad();
    usePlaybackStore.getState().addPlayingPad(pad.id);
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByText("Current volume")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("displays explicit pad volume (when playing) and fadeTargetVol values", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("shows Fade In when pad is not playing and target > 0", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fade out/i })).not.toBeInTheDocument();
  });

  it("shows disabled Fade when pad is not playing and target is 0", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0 });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /^fade$/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("shows Fade Out when pad is playing and target < current volume", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /fade out/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fade in/i })).not.toBeInTheDocument();
  });

  it("shows Fade In when pad is playing and target >= current volume", () => {
    const { pad } = loadPad({ volume: 0.5, fadeTargetVol: 0.8 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /fade in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fade out/i })).not.toBeInTheDocument();
  });

  it("shows disabled Fade when pad is playing and live volume equals target", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.5 });
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set([pad.id]), padVolumes: { [pad.id]: 0.5 } });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /^fade$/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("does not show Reverse button when pad is not fading", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.getState().addPlayingPad(pad.id);
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("shows Stop Fade button and Reverse button when pad is fading", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
    });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /stop fade/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fade out/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reverse/i })).toBeInTheDocument();
  });

  it("hides Reverse button while reversal is in progress", () => {
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
      reversingPadIds: new Set([pad.id]),
    });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByRole("button", { name: /stop fade/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("calls reverseFade when Reverse button is clicked", async () => {
    const { reverseFade } = await import("@/lib/audio/padPlayer");
    const { pad } = loadPad({ volume: 0.8, fadeTargetVol: 0.2 });
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([pad.id]),
      fadingPadIds: new Set([pad.id]),
    });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /reverse/i }));
    expect(reverseFade).toHaveBeenCalled();
  });
});
