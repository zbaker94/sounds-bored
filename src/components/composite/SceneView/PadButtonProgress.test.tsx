import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLayerMetricsStore, initialLayerMetricsState } from "@/state/layerMetricsStore";
import { PadButtonProgress, arePropsEqual } from "./PadButtonProgress";

const PAD_ID = "pad-1";
const LAYER_A_ID = "layer-a";
const LAYER_B_ID = "layer-b";
const LAYER_IDS = [LAYER_A_ID, LAYER_B_ID];

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
  useLayerMetricsStore.setState({ ...initialLayerMetricsState });
});

describe("PadButtonProgress", () => {
  it("renders nothing when pad is not playing", () => {
    const { container } = render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
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
    const { container } = render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when playing but layerIds is empty", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A_ID]),
    });
    const { container } = render(<PadButtonProgress padId={PAD_ID} layerIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one progress bar per active layer", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A_ID, LAYER_B_ID]),
      layerProgress: { [LAYER_A_ID]: 0.25, [LAYER_B_ID]: 0.75 },
    });
    render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
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
      activeLayerIds: new Set([LAYER_A_ID]),
      layerProgress: { [LAYER_A_ID]: 0.5 },
    });
    render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
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
      activeLayerIds: new Set([LAYER_A_ID]),
      layerProgress: {},
    });
    render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
    const bar = screen.getByTestId("pad-layer-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("only renders bars for active layers, not all layers", () => {
    // Only LAYER_A_ID is active; LAYER_B_ID is in the list but not active
    usePlaybackStore.setState({
      ...initialPlaybackState,
      playingPadIds: new Set([PAD_ID]),
    });
    useLayerMetricsStore.setState({
      ...initialLayerMetricsState,
      activeLayerIds: new Set([LAYER_A_ID]),
      layerProgress: { [LAYER_A_ID]: 0.3, [LAYER_B_ID]: 0.6 },
    });
    render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
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
      activeLayerIds: new Set([LAYER_A_ID]),
    });
    const { container } = render(<PadButtonProgress padId={PAD_ID} layerIds={LAYER_IDS} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("PadButtonProgress — React.memo", () => {
  it("uses arePropsEqual as the memoization comparator", () => {
    // arePropsEqual unit tests (below) prove the re-render-prevention contract.
    expect((PadButtonProgress as unknown as { compare: unknown }).compare).toBe(arePropsEqual);
  });
});

describe("arePropsEqual", () => {
  it("returns true for identical props", () => {
    const props = { padId: PAD_ID, layerIds: LAYER_IDS };
    expect(arePropsEqual(props, props)).toBe(true);
  });

  it(
    "returns true when layerIds array reference changes but values match (regression guard for issue #238)",
    () => {
      const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
      const next = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
      // Precondition: different references — this is the exact scenario that caused unnecessary re-renders.
      expect(prev.layerIds).not.toBe(next.layerIds);
      expect(arePropsEqual(prev, next)).toBe(true);
    },
  );

  it("returns true via reference short-circuit when layerIds is the same array", () => {
    const layerIds = [LAYER_A_ID, LAYER_B_ID];
    expect(arePropsEqual({ padId: PAD_ID, layerIds }, { padId: PAD_ID, layerIds })).toBe(true);
  });

  it("returns true for empty layerIds arrays", () => {
    const prev = { padId: PAD_ID, layerIds: [] };
    const next = { padId: PAD_ID, layerIds: [] };
    expect(arePropsEqual(prev, next)).toBe(true);
  });

  it("returns true for single-element layerIds with same value", () => {
    const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID] };
    const next = { padId: PAD_ID, layerIds: [LAYER_A_ID] };
    expect(arePropsEqual(prev, next)).toBe(true);
  });

  it("returns false when padId changes", () => {
    const prev = { padId: PAD_ID, layerIds: LAYER_IDS };
    const next = { padId: "other-pad", layerIds: LAYER_IDS };
    expect(arePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when padId changes regardless of layerIds", () => {
    const prev = { padId: PAD_ID, layerIds: [] };
    const next = { padId: "other-pad", layerIds: [] };
    expect(arePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when layerIds length changes", () => {
    const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
    const next = { padId: PAD_ID, layerIds: [LAYER_A_ID] };
    expect(arePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when a layer ID changes at the last position", () => {
    const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
    const next = { padId: PAD_ID, layerIds: [LAYER_A_ID, "layer-c"] };
    expect(arePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when a layer ID changes at the first position", () => {
    const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
    const next = { padId: PAD_ID, layerIds: ["layer-c", LAYER_B_ID] };
    expect(arePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when layer IDs are reordered", () => {
    const prev = { padId: PAD_ID, layerIds: [LAYER_A_ID, LAYER_B_ID] };
    const next = { padId: PAD_ID, layerIds: [LAYER_B_ID, LAYER_A_ID] };
    expect(arePropsEqual(prev, next)).toBe(false);
  });
});
