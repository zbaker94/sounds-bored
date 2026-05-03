import { describe, it, expect, beforeEach } from "vitest";
import { usePlaybackStore, initialPlaybackState } from "./playbackStore";

beforeEach(() => {
  usePlaybackStore.setState({ ...initialPlaybackState });
});

describe("addPlayingPad / removePlayingPad / clearAllPlayingPads", () => {
  it("addPlayingPad adds to playingPadIds", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.has("pad-1")).toBe(true);
  });

  it("addPlayingPad is idempotent", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().addPlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(1);
  });

  it("removePlayingPad removes from playingPadIds", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().removePlayingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.has("pad-1")).toBe(false);
  });

  it("clearAllPlayingPads clears all", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    usePlaybackStore.getState().addPlayingPad("pad-2");
    usePlaybackStore.getState().clearAllPlayingPads();
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });
});

describe("addFadingOutPad / removeFadingOutPad", () => {
  it("adds to fadingOutPadIds", () => {
    usePlaybackStore.getState().addFadingOutPad("pad-1");
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-1")).toBe(true);
  });

  it("is idempotent", () => {
    usePlaybackStore.getState().addFadingOutPad("pad-1");
    usePlaybackStore.getState().addFadingOutPad("pad-1");
    expect(usePlaybackStore.getState().fadingOutPadIds.size).toBe(1);
  });

  it("removes from fadingOutPadIds", () => {
    usePlaybackStore.getState().addFadingOutPad("pad-1");
    usePlaybackStore.getState().removeFadingOutPad("pad-1");
    expect(usePlaybackStore.getState().fadingOutPadIds.has("pad-1")).toBe(false);
  });

  it("remove is a no-op for absent id", () => {
    usePlaybackStore.getState().removeFadingOutPad("pad-x");
    expect(usePlaybackStore.getState().fadingOutPadIds.size).toBe(0);
  });
});

describe("addFadingPad / removeFadingPad", () => {
  it("adds to fadingPadIds", () => {
    usePlaybackStore.getState().addFadingPad("pad-1");
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-1")).toBe(true);
  });

  it("is idempotent", () => {
    usePlaybackStore.getState().addFadingPad("pad-1");
    usePlaybackStore.getState().addFadingPad("pad-1");
    expect(usePlaybackStore.getState().fadingPadIds.size).toBe(1);
  });

  it("removes from fadingPadIds", () => {
    usePlaybackStore.getState().addFadingPad("pad-1");
    usePlaybackStore.getState().removeFadingPad("pad-1");
    expect(usePlaybackStore.getState().fadingPadIds.has("pad-1")).toBe(false);
  });

  it("remove is a no-op for absent id", () => {
    usePlaybackStore.getState().removeFadingPad("pad-x");
    expect(usePlaybackStore.getState().fadingPadIds.size).toBe(0);
  });
});

describe("addReversingPad / removeReversingPad", () => {
  it("adds to reversingPadIds", () => {
    usePlaybackStore.getState().addReversingPad("pad-1");
    expect(usePlaybackStore.getState().reversingPadIds.has("pad-1")).toBe(true);
  });

  it("is idempotent", () => {
    usePlaybackStore.getState().addReversingPad("pad-1");
    usePlaybackStore.getState().addReversingPad("pad-1");
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(1);
  });

  it("removes from reversingPadIds", () => {
    usePlaybackStore.getState().addReversingPad("pad-1");
    usePlaybackStore.getState().removeReversingPad("pad-1");
    expect(usePlaybackStore.getState().reversingPadIds.has("pad-1")).toBe(false);
  });

  it("remove is a no-op for absent id", () => {
    usePlaybackStore.getState().removeReversingPad("pad-x");
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(0);
  });
});

describe("cross-field isolation", () => {
  it("addPlayingPad does not affect other Set fields", () => {
    usePlaybackStore.getState().addPlayingPad("pad-1");
    expect(usePlaybackStore.getState().fadingOutPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().fadingPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(0);
  });

  it("addFadingOutPad does not affect other Set fields", () => {
    usePlaybackStore.getState().addFadingOutPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().fadingPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(0);
  });

  it("addFadingPad does not affect other Set fields", () => {
    usePlaybackStore.getState().addFadingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().fadingOutPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().reversingPadIds.size).toBe(0);
  });

  it("addReversingPad does not affect other Set fields", () => {
    usePlaybackStore.getState().addReversingPad("pad-1");
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().fadingOutPadIds.size).toBe(0);
    expect(usePlaybackStore.getState().fadingPadIds.size).toBe(0);
  });
});

