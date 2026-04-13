import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSound } from "@/test/factories";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSourceNode = { connect: vi.fn(), disconnect: vi.fn() };

const mockCtx = {
  createMediaElementSource: vi.fn(() => mockSourceNode),
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

function makeDefaultAudioStub() {
  return vi.fn().mockImplementation(function (this: any) {
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
  });
}

vi.stubGlobal("Audio", makeDefaultAudioStub());

// ── Tests — streaming path (the only path that ever used crossOrigin) ─────────

describe("preview — streaming path (large files)", () => {
  beforeEach(async () => {
    mockAudioInstances.length = 0;
    mockCtx.createMediaElementSource.mockClear();
    mockSourceNode.connect.mockClear();
    mockSourceNode.disconnect.mockClear();
    mockSetIsPreviewPlaying.mockClear();
    // Restore default happy-path Audio stub so tests that replace it don't bleed into siblings
    vi.stubGlobal("Audio", makeDefaultAudioStub());
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

  it("disconnects sourceNode, clears state, and re-throws when audio.play() rejects (#167)", async () => {
    const playError = new Error("NotAllowedError: autoplay blocked");
    vi.stubGlobal("Audio", vi.fn().mockImplementation(function (this: any) {
      this.src = "";
      let _crossOrigin = "";
      Object.defineProperty(this, "crossOrigin", {
        get: () => _crossOrigin,
        set: vi.fn((v: string) => { _crossOrigin = v; }),
        configurable: true,
      });
      this.crossOriginSetter = vi.fn();
      this.currentTime = 0;
      this.pause = vi.fn();
      this.play = vi.fn().mockRejectedValue(playError);
      this.onended = null;
      mockAudioInstances.push(this);
    }));

    const { playPreview } = await import("./preview");
    const sound = createMockSound({ filePath: "ambient.wav" });

    await expect(playPreview(sound)).rejects.toThrow("NotAllowedError");

    expect(mockSourceNode.disconnect).toHaveBeenCalledOnce();
    expect(mockSetIsPreviewPlaying).toHaveBeenCalledWith(false);
  });

  it("does not disconnect sourceNode on successful play", async () => {
    const { playPreview } = await import("./preview");
    const sound = createMockSound({ filePath: "ambient.wav" });

    await playPreview(sound);

    expect(mockSourceNode.disconnect).not.toHaveBeenCalled();
  });
});

// ── Tests — buffer path ───────────────────────────────────────────────────────

describe("preview — buffer path (small files)", () => {
  beforeEach(async () => {
    mockSetIsPreviewPlaying.mockClear();
    // Force the buffer branch (not a large file)
    const mod = await import("./streamingCache");
    (mod.checkIsLargeFile as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    // Reset module-level state
    const { stopPreview } = await import("./preview");
    stopPreview();
  });

  it("resets isPreviewPlaying when loadBuffer rejects (#167 buffer path)", async () => {
    const { loadBuffer } = await import("./bufferCache");
    (loadBuffer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fetch failed"));
    const { playPreview } = await import("./preview");

    await expect(playPreview(createMockSound({ filePath: "kick.wav" }))).rejects.toThrow("fetch failed");

    expect(mockSetIsPreviewPlaying).toHaveBeenCalledWith(false);
  });
});
