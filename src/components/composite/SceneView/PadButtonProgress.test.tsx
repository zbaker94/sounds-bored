import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLayerMetricsStore, initialLayerMetricsState } from "@/state/layerMetricsStore";
import { createMockLayer } from "@/test/factories";
import { PadButtonProgress } from "./PadButtonProgress";

const PAD_ID = "pad-1";
const LAYER_A = createMockLayer({ id: "layer-a" });
const LAYER_B = createMockLayer({ id: "layer-b" });
const LAYERS = [LAYER_A, LAYER_B];

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
  useLayerMetricsStore.setState({ ...initialLayerMetricsState });
});

describe("PadButtonProgress", () => {
  it("renders nothing when pad is not playing", () => {
    const { container } = render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when pad is playing but no layers are active", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set(),
    });
    const { container } = render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one progress bar per active layer", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A.id, LAYER_B.id]),
      layerProgress: { [LAYER_A.id]: 0.25, [LAYER_B.id]: 0.75 },
    });
    render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    // One progress bar div per active layer
    const bars = screen.getAllByTestId("pad-layer-progress-bar");
    expect(bars).toHaveLength(2);
  });

  it("sets bar width proportional to layer progress", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A.id]),
      layerProgress: { [LAYER_A.id]: 0.5 },
    });
    render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    const bar = screen.getByTestId("pad-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("50%");
  });

  it("defaults to 0% width when layer has no progress entry", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A.id]),
      layerProgress: {},
    });
    render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    const bar = screen.getByTestId("pad-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("only renders bars for active layers, not all layers", () => {
    // Only LAYER_A is active; LAYER_B is in the layers list but not active
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A.id]),
      layerProgress: { [LAYER_A.id]: 0.3, [LAYER_B.id]: 0.6 },
    });
    render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    const bars = screen.getAllByTestId("pad-layer-progress-bar");
    expect(bars).toHaveLength(1);
  });

  it("does not render bars for a different pad's playing state", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set(["other-pad"]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A.id]),
    });
    const { container } = render(<PadButtonProgress padId={PAD_ID} layers={LAYERS} />);
    expect(container.firstChild).toBeNull();
  });
});
