import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLayerMetricsStore, initialLayerMetricsState } from "@/state/layerMetricsStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockPad, createMockLayer } from "@/test/factories";
import { BackFaceLayerRow } from "./BackFaceLayerRow";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerLayer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audio/gainManager", () => ({
  setLayerVolume: vi.fn(),
  syncLayerVolume: vi.fn(),
  setPadVolume: vi.fn(),
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

const LAYER = createMockLayer({ id: "layer-1" });
const PAD = createMockPad({ id: "pad-1", layers: [LAYER] });

function renderRow() {
  return render(
    <BackFaceLayerRow
      pad={PAD}
      layer={LAYER}
      index={0}
      onEditLayer={vi.fn()}
      onRemoveLayer={vi.fn()}
    />,
  );
}

beforeEach(() => {
  useLayerMetricsStore.setState({ ...initialLayerMetricsState });
  useProjectStore.setState({ ...initialProjectState });
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("BackFaceLayerRow progress bar", () => {
  it("does not render the progress bar when layer is inactive", () => {
    renderRow();
    expect(screen.queryByTestId("back-face-layer-progress-bar")).not.toBeInTheDocument();
  });

  it("renders the progress bar at 50% when layer is active with progress 0.5", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: { [LAYER.id]: 0.5 },
    });
    renderRow();
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("50%");
  });

  it("defaults to 0% width when layer is active but has no progress entry", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: {},
    });
    renderRow();
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("0%");
  });

  it("renders the progress bar at 100% when progress is 1.0", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: { [LAYER.id]: 1.0 },
    });
    renderRow();
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("100%");
  });
});
