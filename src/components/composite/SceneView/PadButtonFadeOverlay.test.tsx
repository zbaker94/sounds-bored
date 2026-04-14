import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadButtonFadeOverlay } from "./PadButtonFadeOverlay";
import { setPadVolume } from "@/lib/audio/padPlayer";

vi.mock("@/lib/audio/padPlayer", () => ({
  setPadVolume: vi.fn(),
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

  it("shows 'start'/'end' labels when pad is not playing", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set() });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    expect(screen.getByText("start")).toBeInTheDocument();
    expect(screen.getByText("end")).toBeInTheDocument();
  });

  it("shows 'end'/'start' labels when pad is playing (labels swap)", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set([PAD_ID]) });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // When playing, labels are "end" (left) and "start" (right)
    const labels = screen.getAllByText(/^(start|end)$/);
    expect(labels[0]).toHaveTextContent("end");
    expect(labels[1]).toHaveTextContent("start");
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

  it("calls setPadFadeDuration when the duration slider is released", () => {
    const pad = makePad({ fadeDurationMs: 2000 });
    loadPadInProjectStore(pad);
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
    });
    const mockSetFadeDuration = vi.fn();
    useProjectStore.setState((s) => ({ ...s, setPadFadeDuration: mockSetFadeDuration }));
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // Find the duration slider (second slider in the overlay) and fire pointerUp
    const sliders = screen.getAllByRole("slider");
    // The duration slider is the last one (level slider comes first)
    const durationSlider = sliders[sliders.length - 1];
    fireEvent.pointerUp(durationSlider);
    expect(mockSetFadeDuration).toHaveBeenCalledWith(SCENE_ID, PAD_ID, 2000);
  });

  it("calls setMultiFadeLevels when level slider changes", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    const mockSetLevels = vi.fn();
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 100] }]]),
      reopenPadId: null,
      setMultiFadeLevels: mockSetLevels,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // The first slider is the level slider — change its value via the first thumb
    const sliders = screen.getAllByRole("slider");
    const levelThumb = sliders[0];
    // Simulate value change via keyboard (ArrowRight increments by step=1)
    act(() => {
      fireEvent.keyDown(levelThumb, { key: "ArrowRight" });
    });
    expect(mockSetLevels).toHaveBeenCalledWith(PAD_ID, expect.any(Array));
  });

  it("calls setPadVolume when playing and the upper level slider changes", () => {
    const pad = makePad();
    loadPadInProjectStore(pad);
    usePlaybackStore.setState({ ...initialPlaybackState, playingPadIds: new Set([PAD_ID]) });
    useMultiFadeStore.setState({
      active: true,
      originPadId: "other-pad",
      selectedPads: new Map([[PAD_ID, { padId: PAD_ID, levels: [0, 80] }]]),
      reopenPadId: null,
    });
    render(<PadButtonFadeOverlay pad={pad} sceneId={SCENE_ID} />);
    // The second thumb (index 1) of the level slider controls the upper bound.
    // Focus it first so Radix registers keyboard events for that thumb,
    // then press ArrowRight to increment v[1] from 80→81, triggering setPadVolume.
    const sliders = screen.getAllByRole("slider");
    const upperLevelThumb = sliders[1]; // level slider has 2 thumbs; index 1 = upper
    act(() => {
      upperLevelThumb.focus();
      fireEvent.keyDown(upperLevelThumb, { key: "ArrowRight" });
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
