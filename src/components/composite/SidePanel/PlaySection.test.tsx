import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaySection } from "./PlaySection";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

vi.mock("@/lib/audio/padPlayer", () => ({
  stopAllPads: vi.fn(),
}));

vi.mock("@/lib/audio/preview", () => ({
  stopPreview: vi.fn(),
}));

import { stopAllPads, stopPreview } from "@/lib/audio";

describe("PlaySection", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    vi.clearAllMocks();
  });

  it("renders a Stop All button", () => {
    render(<PlaySection />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("button is disabled when nothing is playing", () => {
    render(<PlaySection />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("button is enabled when a pad is playing", () => {
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("button is enabled when a preview is playing (no pads)", () => {
    usePlaybackStore.setState({ isPreviewPlaying: true });
    render(<PlaySection />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("calls stopAllPads when clicked", async () => {
    const user = userEvent.setup();
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    await user.click(screen.getByRole("button"));
    expect(stopAllPads).toHaveBeenCalledTimes(1);
  });

  it("calls stopPreview when clicked", async () => {
    const user = userEvent.setup();
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    await user.click(screen.getByRole("button"));
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it("calls stopPreview and stopAllPads when only preview is playing", async () => {
    const user = userEvent.setup();
    usePlaybackStore.setState({ isPreviewPlaying: true });
    render(<PlaySection />);
    await user.click(screen.getByRole("button"));
    expect(stopAllPads).toHaveBeenCalledTimes(1);
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });
});
