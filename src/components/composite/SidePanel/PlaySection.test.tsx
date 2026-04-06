import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaySection } from "./PlaySection";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

vi.mock("@/lib/audio/padPlayer", () => ({
  stopAllPads: vi.fn(),
}));

vi.mock("@/lib/audio/preview", () => ({
  stopPreview: vi.fn(),
}));

import { stopAllPads } from "@/lib/audio/padPlayer";
import { stopPreview } from "@/lib/audio/preview";

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

  it("calls stopAllPads (not stopAll) when clicked", () => {
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    fireEvent.click(screen.getByRole("button"));
    expect(stopAllPads).toHaveBeenCalledTimes(1);
  });

  it("calls stopPreview when clicked", () => {
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    fireEvent.click(screen.getByRole("button"));
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it("calls stopPreview and stopAllPads when only preview is playing", () => {
    usePlaybackStore.setState({ isPreviewPlaying: true });
    render(<PlaySection />);
    fireEvent.click(screen.getByRole("button"));
    expect(stopAllPads).toHaveBeenCalledTimes(1);
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it("does not call the store stopAll directly", () => {
    const storeSpy = vi.spyOn(usePlaybackStore.getState(), "stopAll");
    usePlaybackStore.setState({ playingPadIds: new Set(["pad-1"]) });
    render(<PlaySection />);
    fireEvent.click(screen.getByRole("button"));
    // stopAll should not be called directly — only via stopAllPads internals
    expect(storeSpy).not.toHaveBeenCalled();
    storeSpy.mockRestore();
  });
});
