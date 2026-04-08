import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSound } from "@/test/factories";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCtx = {
  createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
  })),
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  ensureResumed: vi.fn(() => Promise.resolve(mockCtx)),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("./bufferCache", () => ({
  loadBuffer: vi.fn().mockResolvedValue({} as AudioBuffer),
  MissingFileError: class MissingFileError extends Error {},
}));

vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

const mockSetIsPreviewPlaying = vi.fn();
vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: {
    getState: vi.fn(() => ({ setIsPreviewPlaying: mockSetIsPreviewPlaying })),
  },
}));

// ── Audio global mock ─────────────────────────────────────────────────────────

const mockAudioInstances: Array<{
  src: string;
  crossOrigin: string;
  crossOriginSetter: ReturnType<typeof vi.fn>;
  currentTime: number;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  onended: ((ev: Event) => any) | null;
}> = [];

vi.stubGlobal("Audio", vi.fn().mockImplementation(function (this: any) {
  this.src = "";
  let _crossOrigin = "";
  const crossOriginSetter = vi.fn((val: string) => { _crossOrigin = val; });
  Object.defineProperty(this, "crossOrigin", {
    get: () => _crossOrigin,
    set: crossOriginSetter,
    configurable: true,
  });
  this.crossOriginSetter = crossOriginSetter;
  this.currentTime = 0;
  this.pause = vi.fn();
  this.play = vi.fn().mockResolvedValue(undefined);
  this.onended = null;
  mockAudioInstances.push(this);
}));

// ── Tests — streaming path (the only path that ever used crossOrigin) ─────────

describe("preview — streaming path (large files)", () => {
  beforeEach(async () => {
    mockAudioInstances.length = 0;
    mockCtx.createMediaElementSource.mockClear();
    mockSetIsPreviewPlaying.mockClear();
    // Force the streaming branch (large file)
    const mod = await import("./streamingCache");
    (mod.checkIsLargeFile as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // Reset module-level currentStreamingAudio / currentSource by stopping any prior preview
    const { stopPreview } = await import("./preview");
    stopPreview();
    mockAudioInstances.length = 0; // clear the stop-triggered instance if any
  });

  it("sets crossOrigin='anonymous' on the Audio element before src for Web Audio compatibility", async () => {
    const { playPreview } = await import("./preview");
    const sound = createMockSound({ filePath: "ambient.wav" });

    await playPreview(sound);

    expect(mockAudioInstances).toHaveLength(1);
    expect(mockAudioInstances[0].crossOriginSetter).toHaveBeenCalledWith('anonymous');
  });

  it("creates a MediaElementSource and plays the audio", async () => {
    const { playPreview } = await import("./preview");
    const sound = createMockSound({ filePath: "ambient.wav" });

    await playPreview(sound);

    expect(mockCtx.createMediaElementSource).toHaveBeenCalledOnce();
    expect(mockAudioInstances[0].play).toHaveBeenCalledOnce();
  });
});
