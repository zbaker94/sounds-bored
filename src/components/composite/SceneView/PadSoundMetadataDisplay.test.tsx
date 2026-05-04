import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { usePadDisplayStore, initialPadDisplayState } from "@/state/padDisplayStore";
import { PadSoundMetadataDisplay } from "./PadSoundMetadataDisplay";

const PAD_ID = "pad-1";

function makeVoice(overrides: Partial<import("@/state/padDisplayStore").PadVoiceInfo> = {}) {
  return act(() => {
    usePadDisplayStore.setState({
      currentVoice: {
        [PAD_ID]: {
          soundName: "Kick",
          layerName: "Layer 1",
          playbackMode: "one-shot" as const,
          durationMs: 2000,
          seq: 1,
          ...overrides,
        },
      },
      voiceQueue: {},
    });
  });
}

describe("PadSoundMetadataDisplay", () => {
  // Capture original shiftVoice once so each test can restore it after spying.
  // vi.restoreAllMocks does not reliably restore methods on Zustand state objects
  // because setState creates new state objects via Object.assign, and the spy's
  // restoration target may be stale.
  const originalShiftVoice = usePadDisplayStore.getState().shiftVoice;

  beforeEach(() => {
    vi.useFakeTimers();
    usePadDisplayStore.setState({ ...initialPadDisplayState, shiftVoice: originalShiftVoice });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Belt-and-braces: reinstate the original shiftVoice in case restoreAllMocks failed.
    usePadDisplayStore.setState({ shiftVoice: originalShiftVoice });
  });

  it("renders nothing when no current voice is set", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    expect(screen.queryByTestId("sound-name")).toBeNull();
    expect(screen.queryByTestId("layer-info")).toBeNull();
    expect(screen.queryByTestId("duration")).toBeNull();
  });

  it("shows the sound name when a voice is set", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice();
    expect(screen.getByTestId("sound-name")).toHaveTextContent("Kick");
  });

  it("shows layer info combining layerName and playbackMode", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice();
    expect(screen.getByTestId("layer-info")).toHaveTextContent("Layer 1 • one-shot");
  });

  it("shows the formatted duration when durationMs is defined", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice();
    expect(screen.getByTestId("duration")).toHaveTextContent("0:02");
  });

  it("omits the duration element when durationMs is undefined", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ playbackMode: "loop", durationMs: undefined });
    expect(screen.getByTestId("sound-name")).toHaveTextContent("Kick");
    expect(screen.queryByTestId("duration")).toBeNull();
  });

  it("renders layer-info without prefix when layerName is undefined", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ soundName: "Snare", layerName: undefined, playbackMode: "hold", durationMs: undefined });
    expect(screen.getByTestId("layer-info")).toHaveTextContent("hold");
    expect(screen.getByTestId("layer-info").textContent).not.toContain("•");
  });

  it("auto-advances after min(2500ms, durationMs)", () => {
    const shiftSpy = vi.spyOn(usePadDisplayStore.getState(), "shiftVoice").mockImplementation(() => {});
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ durationMs: 5000 }); // longer than max — capped at 2500
    expect(shiftSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(shiftSpy).toHaveBeenCalledWith(PAD_ID);
  });

  it("auto-advances at durationMs when shorter than 2500ms", () => {
    const shiftSpy = vi.spyOn(usePadDisplayStore.getState(), "shiftVoice").mockImplementation(() => {});
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ soundName: "Tick", layerName: undefined, durationMs: 800 });
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(shiftSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(shiftSpy).toHaveBeenCalledWith(PAD_ID);
  });

  it("cancels the auto-advance timer when the component unmounts while a voice is showing", () => {
    const shiftSpy = vi.spyOn(usePadDisplayStore.getState(), "shiftVoice").mockImplementation(() => {});
    const { unmount } = render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ durationMs: 5000, playbackMode: "one-shot" });
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(shiftSpy).not.toHaveBeenCalled();
  });

  it("renders only its own pad's voice when multiple instances are mounted", () => {
    render(
      <>
        <PadSoundMetadataDisplay padId="pad-1" />
        <PadSoundMetadataDisplay padId="pad-2" />
      </>,
    );
    act(() => {
      usePadDisplayStore.setState({
        currentVoice: { "pad-1": { soundName: "Kick", layerName: "Layer 1", playbackMode: "one-shot", durationMs: 2000, seq: 1 }, "pad-2": null },
        voiceQueue: {},
      });
    });
    const names = screen.getAllByTestId("sound-name");
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveTextContent("Kick");
  });

  it("does not auto-advance for loop playback mode", () => {
    const shiftSpy = vi.spyOn(usePadDisplayStore.getState(), "shiftVoice").mockImplementation(() => {});
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ playbackMode: "loop", durationMs: 1000 });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(shiftSpy).not.toHaveBeenCalled();
  });

  it("renders cover art thumbnail when voice has coverArtDataUrl", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ coverArtDataUrl: "data:image/jpeg;base64,abc123" });
    const img = screen.getByTestId("cover-art-thumbnail");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "data:image/jpeg;base64,abc123");
  });

  it("does not render cover art thumbnail when voice has no coverArtDataUrl", () => {
    render(<PadSoundMetadataDisplay padId={PAD_ID} />);
    makeVoice({ coverArtDataUrl: undefined });
    expect(screen.queryByTestId("cover-art-thumbnail")).not.toBeInTheDocument();
  });
});
