import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayerConfigDialog } from "./LayerConfigDialog";
import { syncLayerVolume, syncLayerConfig } from "@/lib/audio/padPlayer";
import type { Layer } from "@/lib/schemas";

vi.mock("./SoundSelector", () => ({
  SoundSelector: () => <div data-testid="sound-selector" />,
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  syncLayerVolume: vi.fn(),
  syncLayerConfig: vi.fn(),
}));

function renderDialog(props: {
  padId?: string;
  sceneId?: string;
  layerIndex?: number;
  onClose?: () => void;
  layer?: Layer;
} = {}) {
  const layer = props.layer ?? createMockLayer({
    id: "layer-1",
    selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 100 }] },
  });
  const pad = createMockPad({ id: props.padId ?? "pad-1", name: "Test Pad", layers: [layer] });
  const scene = createMockScene({ id: props.sceneId ?? "scene-1", pads: [pad] });
  useProjectStore.getState().loadProject(
    createMockHistoryEntry(),
    createMockProject({ scenes: [scene] }),
    false,
  );

  return render(
    <TooltipProvider>
      <LayerConfigDialog
        pad={pad}
        sceneId={props.sceneId ?? "scene-1"}
        layerIndex={props.layerIndex ?? 0}
        onClose={props.onClose ?? vi.fn()}
      />
    </TooltipProvider>
  );
}

function openDialog() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
  });
}

describe("LayerConfigDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    useLibraryStore.setState({ ...initialLibraryState });
  });

  it("renders 'Edit Layer' title when overlay is open", () => {
    renderDialog();
    openDialog();
    expect(screen.getByText(/edit layer/i)).toBeInTheDocument();
  });

  it("calls updatePad and onClose when Save Layer is clicked", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /save layer/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const pads = useProjectStore.getState().project?.scenes[0].pads;
    expect(pads).toBeDefined();
    expect(pads![0].id).toBe("pad-1");
  });

  it("calls onClose without calling updatePad when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const updatePadSpy = vi.spyOn(useProjectStore.getState(), "updatePad");

    renderDialog({ onClose });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(updatePadSpy).not.toHaveBeenCalled();
  });

  it("overlay is open while component is mounted with open state", () => {
    renderDialog();
    openDialog();

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG)).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render dialog when layer at layerIndex does not exist", () => {
    renderDialog({ layerIndex: 99 });
    openDialog();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes overlay after Save Layer", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /save layer/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG)).toBe(false);
  });

  it("closes overlay after Cancel", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG)).toBe(false);
  });

  it("renders layer-specific content (sound selector) when opened with an assigned layer", () => {
    renderDialog();
    openDialog();

    expect(screen.getByTestId("sound-selector")).toBeInTheDocument();
  });

  it("calls syncLayerVolume and syncLayerConfig after a successful save", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /save layer/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(vi.mocked(syncLayerVolume)).toHaveBeenCalled();
    expect(vi.mocked(syncLayerConfig)).toHaveBeenCalled();
  });

  it("shows validation error and does not call updatePad when tag selection matches no sounds", async () => {
    const onClose = vi.fn();
    const updatePadSpy = vi.spyOn(useProjectStore.getState(), "updatePad");

    const tagLayer = createMockLayer({
      id: "layer-1",
      selection: { type: "tag", tagIds: ["some-tag"], matchMode: "any", defaultVolume: 100 },
    });
    renderDialog({ onClose, layer: tagLayer });
    openDialog();

    await userEvent.click(screen.getByRole("button", { name: /save layer/i }));

    await waitFor(() => {
      expect(screen.getByText(/no sounds in library match these tags/i)).toBeInTheDocument();
    });
    expect(updatePadSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
