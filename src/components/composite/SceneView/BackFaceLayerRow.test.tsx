import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockPad, createMockLayer } from "@/test/factories";
import { BackFaceLayerRow } from "./BackFaceLayerRow";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
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
  usePlaybackStore.setState({ ...initialPlaybackState });
  useProjectStore.setState({ ...initialProjectState });
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("BackFaceLayerRow progress bar", () => {
  it("does not render the progress bar when layer is inactive", () => {
    const { container } = renderRow();
    // eslint-disable-next-line testing-library/no-node-access
    const bar = container.querySelector("[style*='width']");
    expect(bar).toBeNull();
  });

  it("renders the progress bar at 50% when layer is active with progress 0.5", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: { [LAYER.id]: 0.5 },
    });
    const { container } = renderRow();
    // eslint-disable-next-line testing-library/no-node-access
    const bar = container.querySelector("[style*='width']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("50%");
  });

  it("defaults to 0% width when layer is active but has no progress entry", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: {},
    });
    const { container } = renderRow();
    // eslint-disable-next-line testing-library/no-node-access
    const bar = container.querySelector("[style*='width']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("0%");
  });

  it("renders the progress bar at 100% when progress is 1.0", () => {
    usePlaybackStore.setState({
      ...initialPlaybackState,
      activeLayerIds: new Set([LAYER.id]),
      layerProgress: { [LAYER.id]: 1.0 },
    });
    const { container } = renderRow();
    // eslint-disable-next-line testing-library/no-node-access
    const bar = container.querySelector("[style*='width']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("100%");
  });
});
