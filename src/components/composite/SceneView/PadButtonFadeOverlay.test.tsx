import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadButtonFadeOverlay } from "./PadButtonFadeOverlay";
import { setPadVolume } from "@/lib/audio";

vi.mock("@/lib/audio/padPlayer", () => ({}));

vi.mock("@/lib/audio/gainManager", () => ({
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  clampGain01: (v: number) => Math.max(0, Math.min(1, v)),
  setLayerVolume: vi.fn(),
  syncLayerVolume: vi.fn(),
}));

const PAD_ID = "pad-1";
const SCENE_ID = "scene-1";

function makePad(overrides = {}) {
  return createMockPad({ id: PAD_ID, layers: [createMockLayer()], ...overrides });
}

function loadPadInProjectStore(pad: ReturnType<typeof makePad>) {
  const scene = createMockScene({ id: SCENE_ID, pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.setState({ ...initialPlaybackState });
  useProjectStore.setState({ ...initialProjectState });
  useMultiFadeStore.setState({
    active: false,
    originPadId: null,
    selectedPads: new Map(),
    reopenPadId: null,
  });
});

describe("PadButtonFadeOverlay", () => {
  it("renders nothing when multi-fade is not active", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    const { container } = render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when multi-fade is active but this pad is not selected", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map(),
      reopenPadId: null,
    });
    const { container } = render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the slider overlay when this pad is selected in multi-fade mode", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // "fade" label is always present in the overlay
    expect(screen.getByText("fade")).toBeInTheDocument();
  });

  it("shows 'volume' and 'target' labels (two separate sliders)", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set() });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [100, 0] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    expect(screen.getByText("volume")).toBeInTheDocument();
    expect(screen.getByText("target")).toBeInTheDocument();
  });

  it("stops pointer events from propagating (prevents pad trigger on slider interaction)", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />
      </div>
    );
    // The overlay div should stopPropagation on pointer-down — use the "fade" label
    // as an anchor to find it (more robust than querying by Tailwind class name).
    const fadeLabel = screen.getByText("fade");
    // eslint-disable-next-line testing-library/no-node-access
    const overlay = fadeLabel.closest("[class*='bg-black']") as HTMLElement;
    fireEvent.pointerDown(overlay);
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("calls setPadFadeDuration when the duration slider value is committed", () => {
    const pad = makePad({ fadeDurationMs: 2000 });
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [100, 0] }]]),
      reopenPadId: null,
    });
    const mockSetFadeDuration = vi.fn();
    useProjectStore.setState((s) => ({ ...s, setPadFadeDuration: mockSetFadeDuration }));
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    const sliders = screen.getAllByRole("slider");
    const durationThumb = sliders[sliders.length - 1];
    // Radix calls onValueCommit synchronously after each keydown — keyboard users
    // now correctly persist the value (was broken with onPointerUp).
    act(() => {
      durationThumb.focus();
      fireEvent.keyDown(durationThumb, { key: "ArrowRight" });
    });
    expect(mockSetFadeDuration).toHaveBeenCalledWith(SCENE_ID, PAD_ID, expect.any(Number));
  });

  it("calls setMultiFadeLevels when the volume slider changes", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    const mockSetLevels = vi.fn();
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [100, 0] }]]),
      reopenPadId: null,
      setMultiFadeLevels: mockSetLevels,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // First slider is the volume slider (single thumb)
    const sliders = screen.getAllByRole("slider");
    const volumeThumb = sliders[0];
    act(() => {
      volumeThumb.focus();
      fireEvent.keyDown(volumeThumb, { key: "ArrowLeft" });
    });
    expect(mockSetLevels).toHaveBeenCalledWith(PAD_ID, expect.any(Array));
  });

  it("calls setMultiFadeLevels when the target slider changes", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    const mockSetLevels = vi.fn();
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [100, 0] }]]),
      reopenPadId: null,
      setMultiFadeLevels: mockSetLevels,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // Second slider is the target slider (single thumb)
    const sliders = screen.getAllByRole("slider");
    const targetThumb = sliders[1];
    act(() => {
      targetThumb.focus();
      fireEvent.keyDown(targetThumb, { key: "ArrowRight" });
    });
    expect(mockSetLevels).toHaveBeenCalledWith(PAD_ID, expect.any(Array));
  });

  it("calls setPadVolume when playing and the volume slider changes", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set([PAD_ID]) });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [80, 0] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // Volume slider is the first slider; arrow keys change its value, which should trigger setPadVolume when playing.
    const sliders = screen.getAllByRole("slider");
    const volumeThumb = sliders[0];
    act(() => {
      volumeThumb.focus();
      fireEvent.keyDown(volumeThumb, { key: "ArrowRight" });
    });
    expect(setPadVolume).toHaveBeenCalledWith(PAD_ID, expect.any(Number));
  });

  it("displays the resolved fade duration from pad config", () => {
    const pad = makePad({ fadeDurationMs: 3000 });
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // 3000ms should display as "3.0s"
    expect(screen.getByText("3.0s")).toBeInTheDocument();
  });
});
