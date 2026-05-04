import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, waitForElementToBeRemoved } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { usePadDisplayStore, initialPadDisplayState } from "@/state/padDisplayStore";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";
import { PadCoverArt } from "./PadCoverArt";

const PAD_ID = "pad-1";

function renderCoverArt() {
  return render(
    <MotionConfig reducedMotion="always">
      <PadCoverArt padId={PAD_ID} />
    </MotionConfig>,
  );
}

function setPlaying(playing: boolean) {
  return act(() => {
    usePlaybackStore.setState({
      playingPadIds: playing ? new Set([PAD_ID]) : new Set(),
    });
  });
}

function setVoice(coverArtDataUrl: string | undefined, seq = 1) {
  return act(() => {
    usePadDisplayStore.setState({
      currentVoice: {
        [PAD_ID]: coverArtDataUrl !== undefined
          ? { soundName: "Kick", layerName: undefined, playbackMode: "one-shot", durationMs: 1000, coverArtDataUrl, seq }
          : null,
      },
      voiceQueue: {},
    });
  });
}

beforeEach(() => {
  usePadDisplayStore.setState({ ...initialPadDisplayState });
  usePlaybackStore.setState({ ...initialPlaybackState });
});

describe("PadCoverArt", () => {
  it("renders nothing when pad is not playing", () => {
    const { container } = renderCoverArt();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when voice has no cover art", async () => {
    renderCoverArt();
    await setVoice(undefined);
    await setPlaying(true);
    expect(screen.queryByTestId("pad-cover-art-bg")).not.toBeInTheDocument();
  });

  it("renders the blurred background when playing with cover art", async () => {
    renderCoverArt();
    await setVoice("data:image/jpeg;base64,abc123");
    await setPlaying(true);
    const bg = screen.getByTestId("pad-cover-art-bg") as HTMLElement;
    expect(bg).toBeInTheDocument();
    expect(bg.style.backgroundImage).toContain("data:image/jpeg;base64,abc123");
  });

  it("persists cover art after currentVoice clears while pad is still playing", async () => {
    renderCoverArt();
    await setVoice("data:image/jpeg;base64,abc123");
    await setPlaying(true);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();

    // Metadata display auto-advances — currentVoice clears, but audio keeps playing
    await setVoice(undefined);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();
  });

  it("hides cover art when pad stops playing", async () => {
    renderCoverArt();
    await setVoice("data:image/jpeg;base64,abc123");
    await setPlaying(true);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();

    await setPlaying(false);
    await waitForElementToBeRemoved(() => screen.queryByTestId("pad-cover-art-bg"), { timeout: 1000 });
  });

  it("shows background after voice with no art transitions to one with art", async () => {
    renderCoverArt();
    await setVoice(undefined);
    await setPlaying(true);
    expect(screen.queryByTestId("pad-cover-art-bg")).not.toBeInTheDocument();
    await setVoice("data:image/jpeg;base64,newart", 2);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();
  });

  it("hides cover art when a new voice with no art starts", async () => {
    renderCoverArt();
    await setVoice("data:image/jpeg;base64,abc123");
    await setPlaying(true);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();

    // New voice (seq=2) with empty-string coverArtDataUrl (sentinel: checked, no art found)
    await setVoice("", 2);
    await waitForElementToBeRemoved(() => screen.queryByTestId("pad-cover-art-bg"), { timeout: 1000 });
  });
});
