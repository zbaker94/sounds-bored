import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLayer, createMockPad, createMockSound } from "@/test/factories";
import { clearAllSizeCache } from "./streamingCache";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCtx = {
  currentTime: 0,
  createBufferSource: vi.fn(),
  createGain: vi.fn(),
  createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
};

vi.mock("./audioContext", () => ({
  ensureResumed: vi.fn(() => Promise.resolve(mockCtx)),
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

const mockLoadBuffer = vi.fn();
vi.mock("./bufferCache", () => ({
  loadBuffer: (...args: unknown[]) => mockLoadBuffer(...args),
  MissingFileError: class MissingFileError extends Error {},
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false), // default: small file → buffer path
  evictSizeCache: vi.fn(),
  clearAllSizeCache: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: () => ({ settings: null }) },
}));

// ── Audio global mock (streaming path) ───────────────────────────────────────

const mockAudioInstances: Array<{
  src: string;
  currentTime: number;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  onended: ((ev: Event) => any) | null;
}> = [];

vi.stubGlobal("Audio", vi.fn().mockImplementation(function (this: any, src?: string) {
  this.src = src ?? "";
  this.currentTime = 0;
  this.pause = vi.fn();
  this.play = vi.fn().mockResolvedValue(undefined);
  this.onended = null;
  mockAudioInstances.push(this);
}));

// ── Source factory ─────────────────────────────────────────────────────────────

/**
 * A mock AudioBufferSourceNode.
 * stop() fires onended synchronously (matching real Web Audio API behaviour).
 */
function makeMockSource() {
  let endedCb: (() => void) | null = null;
  const source = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn().mockImplementation(() => {
      endedCb?.();
    }),
    get onended() { return endedCb; },
    set onended(cb: (() => void) | null) { endedCb = cb; },
    /** Fire the ended callback manually (simulates natural playback completion). */
    simulateEnd() { endedCb?.(); },
    loop: false,
  };
  return source;
}

type MockSource = ReturnType<typeof makeMockSource>;

function makeMockGain() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const createdSources: MockSource[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  createdSources.length = 0;
  // Clear chain queue before stopAll so old onended callbacks don't chain
  const { clearAllLayerChains, clearAllLayerGains, clearAllPadGains } = await import("./padPlayer");
  clearAllLayerChains();
  clearAllLayerGains();
  clearAllPadGains();
  usePlaybackStore.getState().stopAll();
  usePlaybackStore.setState({
    masterVolume: 100,
    playingPadIds: [],
    padVolumes: {},
  });
  useLibraryStore.setState({
    sounds: [],
    tags: [],
    sets: [],
    isDirty: false,
    missingSoundIds: [],
    missingFolderIds: [],
  } as Parameters<typeof useLibraryStore.setState>[0]);

  mockAudioInstances.length = 0;
  (global.Audio as ReturnType<typeof vi.fn>).mockClear();
  mockCtx.createMediaElementSource.mockClear();
  clearAllSizeCache();

  mockCtx.createGain.mockImplementation(() => makeMockGain());
  mockCtx.createBufferSource.mockImplementation(() => {
    const s = makeMockSource();
    createdSources.push(s);
    return s;
  });
  mockLoadBuffer.mockResolvedValue({ duration: 1.0 } as AudioBuffer);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance one tick so async loadBuffer calls resolve. */
async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}

function setSounds(sounds: ReturnType<typeof createMockSound>[]) {
  useLibraryStore.setState({
    sounds,
  } as Parameters<typeof useLibraryStore.setState>[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("simultaneous arrangement", () => {
  it("starts all sounds at once on a single trigger", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);

    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    const loadedIds = mockLoadBuffer.mock.calls.map((c) => c[0].id);
    expect(loadedIds.sort()).toEqual(sounds.map((s) => s.id).sort());
  });

  it("initializes voiceGain from SoundInstance.volume (0-1) for assigned selection", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 0.6 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    const gains: ReturnType<typeof makeMockGain>[] = [];
    mockCtx.createGain.mockImplementation(() => {
      const g = makeMockGain();
      gains.push(g);
      return g;
    });

    await triggerPad(pad);
    await tick();

    // Gains created in order: padGain (0), layerGain (1), voiceGain (2)
    expect(gains).toHaveLength(3);
    expect(gains[2].gain.value).toBe(0.6);
  });

  it("initializes layerGain from layer.volume / 100", async () => {
    const { triggerPad, clearAllPadGains } = await import("./padPlayer");
    clearAllPadGains();
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      volume: 80,
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1.0 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // Collect gain mocks in order
    const gains: ReturnType<typeof makeMockGain>[] = [];
    mockCtx.createGain.mockImplementation(() => {
      const g = makeMockGain();
      gains.push(g);
      return g;
    });

    await triggerPad(pad);
    await tick();

    // Gains created in order: padGain (index 0), layerGain (index 1), voiceGain (index 2)
    // layerGain is gains[1], initialized to layer.volume / 100 = 0.8
    expect(gains[1].gain.value).toBe(0.8);
  });
});

describe("sequential arrangement", () => {
  it("plays all sounds in order automatically after a single trigger", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);

    // First sound starts immediately
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);

    // First sound ends → second starts
    createdSources[0].simulateEnd();
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(mockLoadBuffer.mock.calls[1][0].id).toBe(sounds[1].id);

    // Second ends → third starts
    createdSources[1].simulateEnd();
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[2].id);
  });

  it("chain stops after the last sound completes", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    createdSources[0].simulateEnd();
    await tick();
    createdSources[1].simulateEnd();
    await tick();

    // No more sounds loaded after chain completes
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
  });
});

describe("shuffled arrangement", () => {
  it("plays all sounds exactly once in a chain after a single trigger", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "shuffled",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    createdSources[0].simulateEnd();
    await tick();
    createdSources[1].simulateEnd();
    await tick();

    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    const playedIds = mockLoadBuffer.mock.calls.map((c) => c[0].id).sort();
    expect(playedIds).toEqual(sounds.map((s) => s.id).sort());
  });
});

describe("retrigger modes", () => {
  it("stop: halts the chain and does not play when triggered while active", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "stop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // First trigger: starts chain (sound[0] playing)
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Second trigger while chain is active: stops everything, does NOT chain
    await triggerPad(pad);
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1); // no new sounds loaded
    expect(usePlaybackStore.getState().isLayerActive(layer.id)).toBe(false);
  });

  it("restart: stops the current chain and restarts from the beginning", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Start chain, advance to sound[1]
    await triggerPad(pad); // plays sound[0]
    createdSources[0].simulateEnd();
    await tick(); // auto-chains to sound[1]
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);

    // Retrigger while sound[1] is playing: should restart from sound[0]
    await triggerPad(pad);
    expect(mockLoadBuffer.mock.calls.at(-1)![0].id).toBe(sounds[0].id);
  });

  it("continue: ignores the retrigger and lets the chain finish", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "continue",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Start chain
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Retrigger while active: ignored
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1); // still only 1 load
  });

  it("next: skips the current sound and immediately chains to the next", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "next",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Start chain: sound[0] playing
    await triggerPad(pad);
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);

    // Retrigger with "next": should skip sound[0], chain immediately to sound[1]
    await triggerPad(pad);
    await tick();
    expect(mockLoadBuffer.mock.calls.at(-1)![0].id).toBe(sounds[1].id);
  });
});

describe("stopAllPads", () => {
  it("does not restart a sequential chain after stopping", async () => {
    const { triggerPad, stopAllPads } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad); // starts sound[0], queues sound[1]
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    stopAllPads(); // should clear queue + stop all voices
    await tick(); // give any queued microtasks time to run

    // sound[1] must NOT have started
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(usePlaybackStore.getState().isLayerActive(layer.id)).toBe(false);
  });
});

// ── Streaming path tests ─────────────────────────────────────────────────────

describe("streaming path (large files)", () => {
  let checkIsLargeFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("./streamingCache");
    checkIsLargeFile = mod.checkIsLargeFile as ReturnType<typeof vi.fn>;
    checkIsLargeFile.mockResolvedValue(true); // treat all sounds as large
  });

  afterEach(() => {
    checkIsLargeFile.mockResolvedValue(false); // restore default
  });

  it("plays a large sound via createMediaElementSource instead of createBufferSource", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [createMockSound({ filePath: "ambient.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);

    expect(mockCtx.createMediaElementSource).toHaveBeenCalledOnce();
    expect(mockCtx.createBufferSource).not.toHaveBeenCalled();
    expect(mockLoadBuffer).not.toHaveBeenCalled();
  });

  it("marks the pad as active after triggering a large sound", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [createMockSound({ filePath: "ambient.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);

    expect(usePlaybackStore.getState().isLayerActive(layer.id)).toBe(true);
  });

  it("streaming retrigger restart: stops old audio and starts a new one", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [createMockSound({ filePath: "ambient.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad); // first trigger
    await triggerPad(pad); // restart

    // Two Audio instances created, two createMediaElementSource calls
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
  });

  it("streaming chains via onended for sequential arrangement", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    // First Audio created and playing
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(1);

    // Simulate first audio ending naturally
    const firstAudio = (global.Audio as ReturnType<typeof vi.fn>).mock.results[0].value;
    firstAudio.onended?.(new Event("ended"));
    await tick();

    // Second Audio created for the chained sound
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
  });
});
