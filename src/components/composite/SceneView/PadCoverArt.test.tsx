import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { usePadDisplayStore, initialPadDisplayState } from "@/state/padDisplayStore";
import { PadCoverArt } from "./PadCoverArt";

const PAD_ID = "pad-1";

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
});

describe("PadCoverArt", () => {
  it("renders nothing when no voice is active", () => {
    const { container } = render(<PadCoverArt padId={PAD_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when voice has no cover art", () => {
    render(<PadCoverArt padId={PAD_ID} />);
    setVoice(undefined);
    expect(screen.queryByTestId("pad-cover-art-bg")).not.toBeInTheDocument();
  });

  it("renders the blurred background when voice has cover art", async () => {
    render(<PadCoverArt padId={PAD_ID} />);
    await setVoice("data:image/jpeg;base64,abc123");
    const bg = screen.getByTestId("pad-cover-art-bg") as HTMLElement;
    expect(bg).toBeInTheDocument();
    expect(bg.style.backgroundImage).toContain("data:image/jpeg;base64,abc123");
  });

  it("shows background after voice with no art transitions to one with art", async () => {
    render(<PadCoverArt padId={PAD_ID} />);
    await setVoice(undefined);
    expect(screen.queryByTestId("pad-cover-art-bg")).not.toBeInTheDocument();
    await setVoice("data:image/jpeg;base64,newart", 2);
    expect(screen.getByTestId("pad-cover-art-bg")).toBeInTheDocument();
  });
});
