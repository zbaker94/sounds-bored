import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadBackFace } from "./PadBackFace";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
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
});
