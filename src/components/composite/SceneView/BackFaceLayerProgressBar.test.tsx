import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLayerMetricsStore, initialLayerMetricsState } from "@/state/layerMetricsStore";
import { BackFaceLayerProgressBar } from "./BackFaceLayerProgressBar";

beforeEach(() => {
  useLayerMetricsStore.setState({ ...initialLayerMetricsState });
});

describe("BackFaceLayerProgressBar", () => {
  it("renders nothing when layer is inactive", () => {
    render(<BackFaceLayerProgressBar layerId="layer-1" />);
    expect(screen.queryByTestId("back-face-layer-progress-bar")).not.toBeInTheDocument();
  });

  it("renders at 0% when active but no progress entry", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set(["layer-1"]),
      layerProgress: {},
    });
    render(<BackFaceLayerProgressBar layerId="layer-1" />);
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("renders at 50% when active with progress 0.5", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set(["layer-1"]),
      layerProgress: { "layer-1": 0.5 },
    });
    render(<BackFaceLayerProgressBar layerId="layer-1" />);
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });

  it("renders at 100% when active with progress 1.0", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set(["layer-1"]),
      layerProgress: { "layer-1": 1.0 },
    });
    render(<BackFaceLayerProgressBar layerId="layer-1" />);
    const bar = screen.getByTestId("back-face-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("renders nothing for a different layerId than the active one", () => {
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set(["layer-2"]),
      layerProgress: { "layer-2": 0.5 },
    });
    render(<BackFaceLayerProgressBar layerId="layer-1" />);
    expect(screen.queryByTestId("back-face-layer-progress-bar")).not.toBeInTheDocument();
  });
});
