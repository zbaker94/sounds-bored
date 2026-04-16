import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLayer, createMockPad, createMockScene, createMockProject, createMockHistoryEntry, createMockSound } from "@/test/factories";
import { clearAllSizeCache } from "./streamingCache";
import { isLayerActive, isPadFading, isLayerPending } from "./audioState";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";

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

vi.mock("./audioTick", () => ({
  startAudioTick: vi.fn(),
  stopAudioTick: vi.fn(),
}));

const mockLoadBuffer = vi.fn();
vi.mock("./bufferCache", () => ({
  loadBuffer: (...args: unknown[]) => mockLoadBuffer(...args),
  clearAllBuffers: vi.fn(),
  MissingFileError: class MissingFileError extends Error {},
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const mockEmitAudioError = vi.fn();
vi.mock("./audioEvents", () => ({
  emitAudioError: (...args: unknown[]) => mockEmitAudioError(...args),
  setAudioErrorHandler: vi.fn(),
}));

// Streaming element cache shared by the mock — simulates the real cache's
// behavior so tests can verify reuse vs. fresh-element creation.
const mockStreamingElements = new Map<string, { audio: any; sourceNode: any }>();

vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false), // default: small file → buffer path
  evictSizeCache: vi.fn(),
  clearAllSizeCache: vi.fn(),
  preloadStreamingAudio: vi.fn(),
  getOrCreateStreamingElement: vi.fn().mockImplementation((sound: any, ctx: any) => {
    if (mockStreamingElements.has(sound.id)) return mockStreamingElements.get(sound.id)!;
    const audio = new (globalThis.Audio as any)();
    audio.crossOrigin = "anonymous";
    audio.src = `asset://localhost/${sound.filePath ?? ""}`;
    const sourceNode = { ...ctx.createMediaElementSource(audio), disconnect: vi.fn() };
    const entry = { audio, sourceNode };
    mockStreamingElements.set(sound.id, entry);
    return entry;
  }),
  evictStreamingElement: vi.fn().mockImplementation((soundId: string) => {
    mockStreamingElements.delete(soundId);
  }),
  clearAllStreamingElements: vi.fn().mockImplementation(() => {
    mockStreamingElements.clear();
  }),
  LARGE_FILE_THRESHOLD_BYTES: 20 * 1024 * 1024,
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
const mockGetAppSettings = vi.fn(() => ({ settings: null as unknown }));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: () => mockGetAppSettings() },
}));

const mockRefreshMissingState = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/library.reconcile", () => ({
  refreshMissingState: (...args: unknown[]) => mockRefreshMissingState(...args),
}));

// ── Audio global mock (streaming path) ───────────────────────────────────────

const mockAudioInstances: Array<{
  src: string;
  crossOrigin: string;
  crossOriginSetter: ReturnType<typeof vi.fn>;
  currentTime: number;
  loop: boolean;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  onended: ((ev: Event) => any) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: (e: Event) => boolean;
}> = [];

vi.stubGlobal("Audio", vi.fn().mockImplementation(function (this: any, src?: string) {
  this.src = src ?? "";
  let _crossOrigin = "";
  const crossOriginSetter = vi.fn((val: string) => { _crossOrigin = val; });
  Object.defineProperty(this, "crossOrigin", {
    get: () => _crossOrigin,
    set: crossOriginSetter,
    configurable: true,
  });
  this.crossOriginSetter = crossOriginSetter;
  this.currentTime = 0;
  this.loop = false;
  this.pause = vi.fn();
  this.play = vi.fn().mockResolvedValue(undefined);
  this.onended = null;
  // Store event listeners so loadedmetadata can be simulated in tests
  const _listeners = new Map<string, Array<() => void>>();
  this.addEventListener = vi.fn((event: string, cb: () => void) => {
    const arr = _listeners.get(event) ?? [];
    arr.push(cb);
    _listeners.set(event, arr);
  });
  this.dispatchEvent = vi.fn((e: Event) => {
    for (const cb of _listeners.get(e.type) ?? []) (cb as (ev: Event) => void)(e);
    return true;
  });
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
    disconnect: vi.fn(),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const createdSources: MockSource[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  createdSources.length = 0;
  // Clear chain queue before stopAll so old onended callbacks don't chain
  const { clearAllLayerChains, clearAllLayerGains, clearAllPadGains, clearAllFadeTracking } = await import("./padPlayer");
  const { clearAllStreamingAudio, clearAllPadProgressInfo, clearAllLayerPending, clearAllVoices } = await import("./audioState");
  clearAllLayerChains();
  clearAllLayerGains();
  clearAllPadGains();
  clearAllFadeTracking();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerPending();
  clearAllVoices();
  usePlaybackStore.setState({
    masterVolume: 100,
    playingPadIds: new Set<string>(),
    padVolumes: {},
  });
  useProjectStore.setState({ ...initialProjectState });
  useLibraryStore.setState({
    sounds: [],
    tags: [],
    sets: [],
    isDirty: false,
    missingSoundIds: new Set<string>(),
    missingFolderIds: new Set<string>(),
  } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

  mockAudioInstances.length = 0;
  mockStreamingElements.clear();
  (globalThis.Audio as unknown as ReturnType<typeof vi.fn>).mockClear();
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
  } as unknown as Parameters<typeof useLibraryStore.setState>[0]);
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

  it("initializes voiceGain from SoundInstance.volume / 100 for assigned selection", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 60 }] },
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

    // Second trigger while chain is active: initiates ramp-stop, does NOT chain
    vi.useFakeTimers();
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1); // no new sounds loaded
    // Layer is cleaned up after ramp completes
    vi.advanceTimersByTime(35);
    vi.useRealTimers();
    expect(isLayerActive(layer.id)).toBe(false);
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
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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
    await vi.runAllTimersAsync();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    stopAllPads(); // should clear queue + ramp-stop all voices
    await vi.runAllTimersAsync(); // let ramp timeout fire

    // sound[1] must NOT have started
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(isLayerActive(layer.id)).toBe(false);
  });
});

describe("loop playback mode", () => {
  it("simultaneous+loop: sets source.loop = true on buffer source", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(true);
  });

  it("sequential+loop: restarts chain from beginning when exhausted", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Sound A playing; advance chain: A ends → B starts
    createdSources[0].simulateEnd();
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);

    // B ends — chain exhausted — should restart from A (loop)
    createdSources[1].simulateEnd();
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[0].id);
  });

  it("hold mode: simultaneous+hold sets source.loop = true", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "hold",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(true);
  });

  it("sequential+hold: restarts chain when exhausted while held", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "hold",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    createdSources[0].simulateEnd(); // A ends → B
    await tick();
    createdSources[1].simulateEnd(); // B ends → chain exhausted → restart from A
    await tick();

    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[0].id);
  });

  it("streaming path: simultaneous+loop sets audio.loop = true", async () => {
    const mod = await import("./streamingCache");
    const checkIsLargeFile = mod.checkIsLargeFile as ReturnType<typeof vi.fn>;
    checkIsLargeFile.mockResolvedValue(true);

    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "big.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    checkIsLargeFile.mockResolvedValue(false);

    const audioInstance = mockAudioInstances[0];
    expect(audioInstance).toBeDefined();
    expect(audioInstance.loop).toBe(true);
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

    expect(isLayerActive(layer.id)).toBe(true);
  });

  it("streaming retrigger restart: reuses cached element — one createMediaElementSource, play called twice", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [createMockSound({ filePath: "ambient.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad); // first trigger — creates element + sourceNode
    await triggerPad(pad); // restart — reuses cached element

    // Only one Audio element and one createMediaElementSource call (element is reused)
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(mockAudioInstances).toHaveLength(1);
    expect(mockAudioInstances[0].play).toHaveBeenCalledTimes(2);
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
    const firstAudio = (globalThis.Audio as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    firstAudio.onended?.(new Event("ended"));
    await tick();

    // Second Audio created for the chained sound
    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
  });

  it("multi-layer simultaneous streaming: both elements tracked, neither leaked", async () => {
    const { triggerPad, isPadStreaming } = await import("./padPlayer");
    const soundA = createMockSound({ filePath: "a.wav" });
    const soundB = createMockSound({ filePath: "b.wav" });
    setSounds([soundA, soundB]);

    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: soundA.id, soundId: soundA.id, volume: 1 }] },
    });
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: soundB.id, soundId: soundB.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    await triggerPad(pad);

    expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(isPadStreaming(pad.id)).toBe(true);

    // First element ends — second is still active, pad still streaming
    mockAudioInstances[0].onended?.(new Event("ended"));
    await tick();
    expect(isPadStreaming(pad.id)).toBe(true);

    // Second element ends — both gone, pad no longer streaming
    mockAudioInstances[1].onended?.(new Event("ended"));
    await tick();
    expect(isPadStreaming(pad.id)).toBe(false);
  });

  it("getPadProgress picks the element with the longest duration", async () => {
    const { triggerPad, getPadProgress } = await import("./padPlayer");
    const soundA = createMockSound({ filePath: "a.wav" });
    const soundB = createMockSound({ filePath: "b.wav" });
    setSounds([soundA, soundB]);

    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: soundA.id, soundId: soundA.id, volume: 1 }] },
    });
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: soundB.id, soundId: soundB.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    await triggerPad(pad);

    // short sound: 10 s, 5 s elapsed → 0.5 progress
    Object.defineProperty(mockAudioInstances[0], "duration", { value: 10, configurable: true });
    mockAudioInstances[0].currentTime = 5;
    // Simulate loadedmetadata so the best-element cache is re-evaluated
    mockAudioInstances[0].dispatchEvent(new Event("loadedmetadata"));

    // long sound: 20 s, 5 s elapsed → 0.25 progress
    Object.defineProperty(mockAudioInstances[1], "duration", { value: 20, configurable: true });
    mockAudioInstances[1].currentTime = 5;
    mockAudioInstances[1].dispatchEvent(new Event("loadedmetadata"));

    // Progress should reflect the longest-duration element (20 s) = 5/20 = 0.25
    expect(getPadProgress(pad.id)).toBeCloseTo(0.25);
  });

  it("continue-mode retrigger preserves streaming progress tracking", async () => {
    const { triggerPad, isPadStreaming } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "ambient.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "continue",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    expect(isPadStreaming(pad.id)).toBe(true);

    // Retrigger with continue — the layer skips (already playing), tracking must survive
    await triggerPad(pad);
    expect(isPadStreaming(pad.id)).toBe(true);
  });

  it("sets crossOrigin='anonymous' on the Audio element before src for Web Audio compatibility", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "ambient.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);

    expect(mockAudioInstances).toHaveLength(1);
    expect(mockAudioInstances[0].crossOriginSetter).toHaveBeenCalledWith('anonymous');
  });
});

describe("retrigger next", () => {
  it("advances to the next sound in the chain immediately", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      retriggerMode: "next",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();
    // Sound A is playing
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);

    // Retrigger with "next" — should stop A and start B directly
    await triggerPad(pad);
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(mockLoadBuffer.mock.calls[1][0].id).toBe(sounds[1].id);
  });

  it("wraps back to the beginning when queue is exhausted on a loop layer", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      retriggerMode: "next",
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger → A plays; retrigger → B plays; retrigger again → should wrap to A
    await triggerPad(pad);
    await tick();

    await triggerPad(pad);
    await tick();

    await triggerPad(pad);
    await tick();

    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[0].id);
  });

  it("sets padProgressInfo for the new sound after retrigger", async () => {
    const { triggerPad } = await import("./padPlayer");
    const { getPadProgressInfo } = await import("./audioState");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      retriggerMode: "next",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();
    expect(getPadProgressInfo(pad.id)).not.toBeUndefined();

    await triggerPad(pad); // A → B
    await tick();
    // padProgressInfo must be set (non-null) so the progress bar can advance
    expect(getPadProgressInfo(pad.id)).not.toBeUndefined();
  });

  it("stops without restart on a one-shot layer when queue is exhausted", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      retriggerMode: "next",
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();
    await triggerPad(pad); // A→B
    await tick();
    await triggerPad(pad); // B→exhaust (one-shot: stop, don't restart)
    await tick();

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
  });
});

describe("stopAllPads — ramped", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("ramps padGain to 0 before stopping voices", async () => {
    const { triggerPad, stopAllPads, getPadGain } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);
    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(1);

    stopAllPads();
    // Source not yet stopped — ramp in progress
    expect(createdSources[0].stop).not.toHaveBeenCalled();
    const padGain = getPadGain(pad.id);
    expect(padGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));

    vi.advanceTimersByTime(35);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    expect(createdSources[0].stop).toHaveBeenCalledOnce();
  });
});

describe("releasePadHoldLayers", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stops only hold-mode layers, not one-shot layers", async () => {
    const { triggerPad, releasePadHoldLayers } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const holdLayer = createMockLayer({
      playbackMode: "hold",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const oneShotLayer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [holdLayer, oneShotLayer] });
    mockLoadBuffer.mockResolvedValue({ duration: 2.0 } as AudioBuffer);

    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(2);

    releasePadHoldLayers(pad);
    vi.advanceTimersByTime(35);

    // playbackStore should have cleared the hold layer's voice but not the one-shot's
    expect(isLayerActive(oneShotLayer.id)).toBe(true);
    expect(isLayerActive(holdLayer.id)).toBe(false);
  });

  it("clears the chain queue for hold layers on release", async () => {
    const { triggerPad, releasePadHoldLayers } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const holdLayer = createMockLayer({
      playbackMode: "hold",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [holdLayer] });

    await triggerPad(pad);
    await vi.runAllTimersAsync();

    // A is playing, B is queued — release should clear queue and stop
    releasePadHoldLayers(pad);
    vi.advanceTimersByTime(35);

    // After release, B should NOT start (queue was cleared)
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
  });
});

describe("retrigger stop — ramped stop", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("retrigger stop: does not immediately stop source (ramp in progress)", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "simultaneous",
      retriggerMode: "stop",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(1);

    // Retrigger with "stop" — should start ramp, not hard-stop
    await triggerPad(pad);
    // Source stop not called synchronously
    expect(createdSources[0].stop).not.toHaveBeenCalled();

    // After ramp completes
    vi.advanceTimersByTime(35);
    expect(createdSources[0].stop).toHaveBeenCalledOnce();
  });

  it("retrigger stop: pad is no longer playing after ramp", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      retriggerMode: "stop",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await vi.runAllTimersAsync();

    await triggerPad(pad);
    vi.advanceTimersByTime(35);

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("retrigger stop: ramps all voices when layer has multiple simultaneous sounds", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      retriggerMode: "stop",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(2);

    await triggerPad(pad);
    // Neither source should be stopped synchronously
    expect(createdSources[0].stop).not.toHaveBeenCalled();
    expect(createdSources[1].stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(35);
    expect(createdSources[0].stop).toHaveBeenCalledOnce();
    expect(createdSources[1].stop).toHaveBeenCalledOnce();
  });
});

// ─── Fade functions ───────────────────────────────────────────────────────────

describe("resolveFadeDuration", () => {
  it("returns pad-level fadeDurationMs when set", async () => {
    const { resolveFadeDuration } = await import("./padPlayer");
    const pad = createMockPad({ fadeDurationMs: 1500 });
    expect(resolveFadeDuration(pad, 3000)).toBe(1500);
  });

  it("falls back to globalFadeDurationMs when pad has none", async () => {
    const { resolveFadeDuration } = await import("./padPlayer");
    const pad = createMockPad({ fadeDurationMs: undefined });
    expect(resolveFadeDuration(pad, 3000)).toBe(3000);
  });

  it("falls back to 2000ms when neither pad nor global setting is provided", async () => {
    const { resolveFadeDuration } = await import("./padPlayer");
    const pad = createMockPad({ fadeDurationMs: undefined });
    expect(resolveFadeDuration(pad, undefined)).toBe(2000);
  });
});

describe("fadePadOut", () => {
  it("schedules a gain ramp to 0 on the pad gain node", async () => {
    const { fadePadOut, getPadGain, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-pad" });

    fadePadOut(pad, 1000);

    const gain = getPadGain(pad.id);
    expect(gain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    clearAllFadeTracking();
  });

  it("calls stopPad and resetPadGain after the fade duration", async () => {
    vi.useFakeTimers();
    const { fadePadOut, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-timer-pad" });

    usePlaybackStore.setState({ playingPadIds: new Set([pad.id]) });

    fadePadOut(pad, 500);
    vi.advanceTimersByTime(510);

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    clearAllFadeTracking();
    vi.useRealTimers();
  });

  it("does not stop the pad when toVolume is non-zero", async () => {
    vi.useFakeTimers();
    const { fadePadOut, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-nonzero-pad" });

    usePlaybackStore.setState({ playingPadIds: new Set([pad.id]) });

    fadePadOut(pad, 500, undefined, 0.3);
    vi.advanceTimersByTime(510);

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
    clearAllFadeTracking();
    vi.useRealTimers();
  });

  it("marks pad as fading when fade starts", async () => {
    const { fadePadOut, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-vol-pad" });

    fadePadOut(pad, 1000);

    expect(isPadFading(pad.id)).toBe(true);
    clearAllFadeTracking();
  });

  it("clears fading state after the fade duration", async () => {
    vi.useFakeTimers();
    const { fadePadOut, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-clear-pad" });

    fadePadOut(pad, 500);
    expect(isPadFading(pad.id)).toBe(true);

    vi.advanceTimersByTime(510);
    expect(isPadFading(pad.id)).toBe(false);
    clearAllFadeTracking();
    vi.useRealTimers();
  });
});

describe("freezePadAtCurrentVolume", () => {
  it("captures current gain value and re-applies it after cancelling fade", async () => {
    const { freezePadAtCurrentVolume, getPadGain } = await import("./padPlayer");
    const gain = getPadGain("pad-1");
    gain.gain.value = 0.6;

    freezePadAtCurrentVolume("pad-1");

    expect(gain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.6, expect.any(Number));
    // Tick reads the frozen gain value automatically — padVolumes not directly updated.
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBeUndefined();
  });
});

describe("resetPadGain", () => {
  it("resets gain to 1.0 via the gain node", async () => {
    const { resetPadGain, getPadGain } = await import("./padPlayer");
    const gain = getPadGain("pad-1");
    gain.gain.value = 0.3;

    resetPadGain("pad-1");

    expect(gain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    // Tick reads the reset gain value automatically — padVolumes not directly updated.
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBeUndefined();
  });
});

describe("fadePadIn", () => {
  it("triggers the pad at volume 0, ramps to 1, and shows volume transition", async () => {
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);

    const source = makeMockSource();
    mockCtx.createBufferSource.mockReturnValue(source);
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { fadePadIn, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fade-in-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await fadePadIn(pad, 1000);

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    expect(isPadFading(pad.id)).toBe(true);
    clearAllFadeTracking();
  });
});

describe("crossfadePads", () => {
  it("starts volume transitions on fading-out and fading-in pads", async () => {
    const { crossfadePads, clearAllFadeTracking } = await import("./padPlayer");
    const padOut = createMockPad({ id: "xfade-out" });
    const padIn = createMockPad({ id: "xfade-in", layers: [createMockLayer()] });

    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);
    const source = makeMockSource();
    mockCtx.createBufferSource.mockReturnValue(source);
    mockCtx.createGain.mockReturnValue(makeMockGain());
    useLibraryStore.setState({ sounds: [], tags: [], sets: [] } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    crossfadePads([padOut], [padIn]);

    expect(isPadFading(padOut.id)).toBe(true);
    clearAllFadeTracking();
  });
});

// ─── executeFadeTap ───────────────────────────────────────────────────────────

describe("executeFadeTap", () => {
  it("fades out when pad has active voices and is not fading out", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { triggerPad, executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-out-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);
    executeFadeTap(pad);

    expect(isPadFading(pad.id)).toBe(true);
    clearAllFadeTracking();
  });

  it("reverses fade-out when pad has active voices and is already fading out", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { triggerPad, executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-reverse-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);
    // First tap: starts fade-out
    executeFadeTap(pad);
    expect(isPadFading(pad.id)).toBe(true);

    // Second tap: reverses the fade-out
    executeFadeTap(pad);

    expect(isPadFading(pad.id)).toBe(true);
    clearAllFadeTracking();
  });

  it("fades in when pad has no active voices", async () => {
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-in-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    executeFadeTap(pad);

    await vi.waitFor(() => {
      expect(isPadFading(pad.id)).toBe(true);
    });
    clearAllFadeTracking();
  });

  it("is a no-op for a hold-mode pad", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    const { executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-hold-pad",
      layers: [createMockLayer({ playbackMode: "hold", selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });

    executeFadeTap(pad);
    // Let microtasks settle — if the guard had not fired, fadePadIn would have loaded the buffer
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLoadBuffer).not.toHaveBeenCalled();
    clearAllFadeTracking();
  });

  it("is a no-op for a mixed-mode pad (hold + non-hold layers)", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    const { executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-mixed-pad",
      layers: [
        createMockLayer({ playbackMode: "one-shot", selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } }),
        createMockLayer({ playbackMode: "hold", selection: { type: "assigned", instances: [{ id: "si-2", soundId: "s1", volume: 100 }] } }),
      ],
    });

    executeFadeTap(pad);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLoadBuffer).not.toHaveBeenCalled();
    clearAllFadeTracking();
  });
});

// ─── executeCrossfadeSelection ────────────────────────────────────────────────

describe("executeCrossfadeSelection", () => {
  it("fades out pads with active voices and fades in pads without", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    const { triggerPad, executeCrossfadeSelection, clearAllFadeTracking } = await import("./padPlayer");
    const padOut = createMockPad({
      id: "xfade-sel-out",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    const padIn = createMockPad({
      id: "xfade-sel-in",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-2", soundId: "s1", volume: 100 }] } })],
    });

    await triggerPad(padOut);
    executeCrossfadeSelection([padOut, padIn]);

    expect(isPadFading(padOut.id)).toBe(true);
    await vi.waitFor(() => {
      expect(isPadFading(padIn.id)).toBe(true);
    });
    clearAllFadeTracking();
  });

  it("does not fade out pads with no active voices", async () => {
    const { executeCrossfadeSelection, clearAllFadeTracking } = await import("./padPlayer");
    const padA = createMockPad({ id: "xfade-inactive-a", layers: [createMockLayer()] });
    const padB = createMockPad({ id: "xfade-inactive-b", layers: [createMockLayer()] });

    // Neither pad has active voices — both would be treated as fade-in targets
    executeCrossfadeSelection([padA, padB]);

    expect(isPadFading(padA.id)).toBe(false);
    expect(isPadFading(padB.id)).toBe(false);
    clearAllFadeTracking();
  });

  it("ignores hold-mode pads passed directly", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    const { executeCrossfadeSelection, clearAllFadeTracking } = await import("./padPlayer");
    const holdPad = createMockPad({
      id: "xfade-hold",
      layers: [createMockLayer({ playbackMode: "hold", selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });

    executeCrossfadeSelection([holdPad]);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLoadBuffer).not.toHaveBeenCalled();
    clearAllFadeTracking();
  });

  it("filters out mixed-mode pads from the selection, processing only fadeable pads", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    const { triggerPad, executeCrossfadeSelection, clearAllFadeTracking } = await import("./padPlayer");
    const fadeablePad = createMockPad({
      id: "xfade-fadeable",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    const mixedPad = createMockPad({
      id: "xfade-mixed",
      layers: [
        createMockLayer({ playbackMode: "one-shot", selection: { type: "assigned", instances: [{ id: "si-2", soundId: "s1", volume: 100 }] } }),
        createMockLayer({ playbackMode: "hold", selection: { type: "assigned", instances: [{ id: "si-3", soundId: "s1", volume: 100 }] } }),
      ],
    });

    await triggerPad(fadeablePad);
    executeCrossfadeSelection([fadeablePad, mixedPad]);

    // fadeablePad is active — it should be faded out
    expect(isPadFading(fadeablePad.id)).toBe(true);
    // mixedPad is filtered by isFadeablePad — it should not be crossfaded
    expect(isPadFading(mixedPad.id)).toBe(false);
    clearAllFadeTracking();
  });
});

describe("syncLayerPlaybackMode", () => {
  it("is a no-op when the layer has no active voices", async () => {
    const { syncLayerPlaybackMode } = await import("./padPlayer");
    const layer = createMockLayer({ id: "inactive-layer", playbackMode: "one-shot", arrangement: "simultaneous" });
    // No voices recorded — should not throw
    expect(() => syncLayerPlaybackMode(layer)).not.toThrow();
    expect(createdSources).toHaveLength(0);
  });

  it("sets source.loop = false on active buffer voices when new playbackMode is one-shot", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(true);

    // Simulate saving with playbackMode changed to one-shot
    syncLayerPlaybackMode({ ...layer, playbackMode: "one-shot" });

    expect(createdSources[0].loop).toBe(false);
  });

  it("sets source.loop = true on active buffer voices when new playbackMode is loop", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(false);

    syncLayerPlaybackMode({ ...layer, playbackMode: "loop" });

    expect(createdSources[0].loop).toBe(true);
  });

  it("sets source.loop = true on active buffer voices when new playbackMode is hold → loop", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "hold",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // hold already sets loop=true; verify setLoop(true) is a safe no-op
    expect(createdSources[0].loop).toBe(true);
    syncLayerPlaybackMode({ ...layer, playbackMode: "loop" });
    expect(createdSources[0].loop).toBe(true);
  });

  it("sets source.loop = false on active buffer voices when new playbackMode is hold → one-shot", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      playbackMode: "hold",
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(true);

    syncLayerPlaybackMode({ ...layer, playbackMode: "one-shot" });

    expect(createdSources[0].loop).toBe(false);
  });

  it("clears chain queue for sequential+loop → one-shot so onended does not restart", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Change to one-shot — chain queue should be cleared
    syncLayerPlaybackMode({ ...layer, playbackMode: "one-shot" });

    // Simulate current voice ending — should NOT restart (remaining === undefined)
    createdSources[0].simulateEnd();
    await tick();

    // Only the original source was created; no new chain restart
    expect(createdSources).toHaveLength(1);
  });

  it("does not clear chain queue for sequential+loop when staying in loop", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Sync with same playbackMode — chain queue should remain intact
    syncLayerPlaybackMode({ ...layer, playbackMode: "loop" });

    // Voice A ends → Voice B starts (chain still active)
    createdSources[0].simulateEnd();
    await tick();

    expect(createdSources).toHaveLength(2);
  });

  it("sequential+one-shot → loop: chain restarts after all sounds play through", async () => {
    const { triggerPad, syncLayerPlaybackMode } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Simulate updatePad: store now reflects the new playbackMode
    const updatedLayer = { ...layer, playbackMode: "loop" as const };
    const scene = createMockScene({ pads: [{ ...pad, layers: [updatedLayer] }] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );
    syncLayerPlaybackMode(updatedLayer);

    // Sound A ends → advances to B (remaining was non-empty)
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(2);

    // Sound B ends → chain exhausted → live lookup returns "loop" → restarts
    createdSources[1].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(3);
  });
});

describe("syncLayerArrangement", () => {
  it("is a no-op when the layer has no active voices", async () => {
    const { syncLayerArrangement } = await import("./padPlayer");
    const layer = createMockLayer({ id: "inactive-layer", arrangement: "sequential" });
    expect(() => syncLayerArrangement(layer)).not.toThrow();
    expect(createdSources).toHaveLength(0);
  });

  it("sequential → simultaneous: clears chain so onended does not chain", async () => {
    const { triggerPad, syncLayerArrangement } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    syncLayerArrangement({ ...layer, arrangement: "simultaneous" });

    createdSources[0].simulateEnd();
    await tick();

    expect(createdSources).toHaveLength(1);
  });

  it("sequential → simultaneous + loop: current voice plays out, then all sounds restart simultaneously with loop", async () => {
    const { triggerPad, syncLayerArrangement } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Simulate updatePad: store reflects the new simultaneous+loop arrangement
    const updatedLayer = { ...layer, arrangement: "simultaneous" as const };
    const scene = createMockScene({ pads: [{ ...pad, layers: [updatedLayer] }] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    await triggerPad(pad);
    await tick();

    // Chained loop — source.loop stays false (chain handles looping)
    expect(createdSources[0].loop).toBe(false);

    syncLayerArrangement(updatedLayer);

    // source.loop is still false — current voice plays out naturally, not looping
    expect(createdSources[0].loop).toBe(false);

    // Current voice ends — onended reads liveArrangement="simultaneous", liveMode="loop"
    // and starts all sounds simultaneously with source.loop=true
    createdSources[0].simulateEnd();
    await tick();

    // Both sounds started simultaneously (2 new sources)
    expect(createdSources).toHaveLength(3);
    expect(createdSources[1].loop).toBe(true);
    expect(createdSources[2].loop).toBe(true);
  });

  it("shuffled → sequential: rebuilds chain with new arrangement so onended continues", async () => {
    const { triggerPad, syncLayerArrangement } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "shuffled",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Rebuild queue with sequential arrangement
    syncLayerArrangement({ ...layer, arrangement: "sequential" });

    // Current voice ends — onended should advance to the next sound in the new queue
    createdSources[0].simulateEnd();
    await tick();

    expect(createdSources).toHaveLength(2);
  });

  it("sequential → shuffled + loop: chain rebuilds after exhaustion using live playbackMode", async () => {
    const { triggerPad, syncLayerArrangement } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      playbackMode: "loop",
      arrangement: "sequential",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Simulate updatePad: store now reflects the new arrangement
    const updatedLayer = { ...layer, arrangement: "shuffled" as const };
    const scene = createMockScene({ pads: [{ ...pad, layers: [updatedLayer] }] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    syncLayerArrangement(updatedLayer);

    // First voice ends → advances into the rebuilt queue
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(2);

    // Second voice ends → chain exhausted → loop restarts
    createdSources[1].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(3);
  });
});

describe("syncLayerSelection", () => {
  it("is a no-op when the layer has no active voices", async () => {
    const { syncLayerSelection } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    const layer = createMockLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: "inst-1", soundId: sound.id, volume: 100 }] },
    });
    expect(() => syncLayerSelection(layer)).not.toThrow();
    expect(createdSources).toHaveLength(0);
  });

  it("sequential: rebuilds chain queue so new sounds play instead of stale queued sounds", async () => {
    const { triggerPad, syncLayerSelection } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    const soundC = createMockSound({ id: "sound-c", filePath: "c.wav" });
    setSounds([soundA, soundB, soundC]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // A is playing; B is stale in queue. Replace selection with [C].
    const newLayer = {
      ...layer,
      selection: {
        type: "assigned" as const,
        instances: [{ id: "inst-c", soundId: soundC.id, volume: 100 }],
      },
    };
    syncLayerSelection(newLayer);

    // Current voice (A) must not be interrupted
    expect(createdSources[0].stop).not.toHaveBeenCalled();

    createdSources[0].simulateEnd();
    await tick();

    // C should play — B was replaced in the queue
    expect(createdSources).toHaveLength(2);
    const loadedIds = mockLoadBuffer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(loadedIds[1]).toBe(soundC.id);
  });

  it("shuffled: rebuilds chain queue with new sounds so stale queued sounds are replaced", async () => {
    const { triggerPad, syncLayerSelection } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    const soundC = createMockSound({ id: "sound-c", filePath: "c.wav" });
    setSounds([soundA, soundB, soundC]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "shuffled",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // One of A/B is playing; the other is in the stale queue. Replace selection with [C].
    const newLayer = {
      ...layer,
      selection: {
        type: "assigned" as const,
        instances: [{ id: "inst-c", soundId: soundC.id, volume: 100 }],
      },
    };
    syncLayerSelection(newLayer);

    // Current voice must not be interrupted
    expect(createdSources[0].stop).not.toHaveBeenCalled();

    createdSources[0].simulateEnd();
    await tick();

    // C should play (from rebuilt shuffled queue), B is gone
    expect(createdSources).toHaveLength(2);
    const loadedIds = mockLoadBuffer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(loadedIds[1]).toBe(soundC.id);
  });

  it("sequential: deletes chain queue when new selection resolves to empty, current voice plays out cleanly", async () => {
    const { triggerPad, syncLayerSelection } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    setSounds([soundA, soundB]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // A is playing, B is in queue. Remove all sounds from selection.
    const emptyLayer = {
      ...layer,
      selection: { type: "assigned" as const, instances: [] },
    };
    syncLayerSelection(emptyLayer);

    // A must not be interrupted
    expect(createdSources[0].stop).not.toHaveBeenCalled();

    // A ends — chain queue was deleted, so nothing more should play
    createdSources[0].simulateEnd();
    await tick();

    expect(createdSources).toHaveLength(1);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("sequential + loop: loop restart reads live selection from store when chain exhausts", async () => {
    const { triggerPad } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    setSounds([soundA, soundB]);

    const layer = createMockLayer({
      id: "layer-sel-loop",
      playbackMode: "loop",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [{ id: "inst-a", soundId: soundA.id, volume: 100 }],
      },
    });
    const pad = createMockPad({ id: "pad-sel-loop", layers: [layer] });
    await triggerPad(pad);
    await tick();

    // A is playing, queue is empty (only one sound). Change selection to [B] in the store.
    const newLayer = {
      ...layer,
      selection: {
        type: "assigned" as const,
        instances: [{ id: "inst-b", soundId: soundB.id, volume: 100 }],
      },
    };
    const scene = createMockScene({ pads: [{ ...pad, layers: [newLayer] }] });
    useProjectStore.getState().loadProject(
      createMockHistoryEntry(),
      createMockProject({ scenes: [scene] }),
      false,
    );

    // A ends → chain exhausted → loop restart re-resolves from store → B plays
    createdSources[0].simulateEnd();
    await tick();

    expect(createdSources).toHaveLength(2);
    const loadedIds = mockLoadBuffer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(loadedIds[1]).toBe(soundB.id);
  });
});

describe("syncLayerConfig", () => {
  it("only playbackMode changes: selection queue not rebuilt, B still plays after A", async () => {
    const { triggerPad, syncLayerConfig } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    setSounds([soundA, soundB]);

    // Start in one-shot so playbackMode change to "loop" does not clear the queue.
    // (loop → one-shot clears via syncLayerPlaybackMode; one-shot → loop does not.)
    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Change only playbackMode: one-shot → loop. syncLayerSelection must NOT run —
    // if it did, A would be placed back in the queue and play a second time (3 sources).
    const updated = { ...layer, playbackMode: "loop" as const };
    syncLayerConfig(updated, layer);

    // B is still in the queue — A ends → B plays (exactly 2 sources, not 3)
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(2);
  });

  it("only arrangement changes: rebuilds queue with new arrangement, skips redundant selection sync", async () => {
    const { triggerPad, syncLayerConfig } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    setSounds([soundA, soundB]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Change only arrangement: sequential → simultaneous (clears chain queue)
    const updated = { ...layer, arrangement: "simultaneous" as const };
    syncLayerConfig(updated, layer);

    // Queue cleared by syncLayerArrangement — A ends, no chain → stops cleanly
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(1);
  });

  it("arrangement + selection both change: new sounds are used (no double-rebuild corruption)", async () => {
    const { triggerPad, syncLayerConfig } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    const soundC = createMockSound({ id: "sound-c", filePath: "c.wav" });
    setSounds([soundA, soundB, soundC]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "shuffled",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Change both arrangement (→ sequential) and selection (→ [C])
    const updated = {
      ...layer,
      arrangement: "sequential" as const,
      selection: {
        type: "assigned" as const,
        instances: [{ id: "inst-c", soundId: soundC.id, volume: 100 }],
      },
    };
    syncLayerConfig(updated, layer);

    // Current voice plays out, then C plays from rebuilt queue
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(2);
    const loadedIds = mockLoadBuffer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(loadedIds[1]).toBe(soundC.id);
  });
});

describe("selectionsEqual", () => {
  it("returns true for identical assigned selections", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const sel = {
      type: "assigned" as const,
      instances: [
        { id: "i1", soundId: "s1", volume: 80 },
        { id: "i2", soundId: "s2", volume: 100 },
      ],
    };
    expect(selectionsEqual(sel, { ...sel, instances: [...sel.instances] })).toBe(true);
  });

  it("returns false when assigned instance soundIds differ", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }] };
    const b = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s2", volume: 100 }] };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when assigned instance lists differ in length", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }] };
    const b = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }, { id: "i2", soundId: "s2", volume: 100 }] };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when assigned instance volume differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 80 }] };
    const b = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }] };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when assigned instance startOffsetMs differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100, startOffsetMs: 500 }] };
    const b = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }] };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns true for identical tag selections", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const sel = { type: "tag" as const, tagIds: ["t1", "t2"], matchMode: "any" as const, defaultVolume: 80 };
    expect(selectionsEqual(sel, { ...sel })).toBe(true);
  });

  it("returns false when tag matchMode differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "tag" as const, tagIds: ["t1"], matchMode: "any" as const, defaultVolume: 80 };
    const b = { type: "tag" as const, tagIds: ["t1"], matchMode: "all" as const, defaultVolume: 80 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when tag tagIds differ", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "tag" as const, tagIds: ["t1"], matchMode: "any" as const, defaultVolume: 80 };
    const b = { type: "tag" as const, tagIds: ["t2"], matchMode: "any" as const, defaultVolume: 80 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when tag defaultVolume differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "tag" as const, tagIds: ["t1"], matchMode: "any" as const, defaultVolume: 80 };
    const b = { type: "tag" as const, tagIds: ["t1"], matchMode: "any" as const, defaultVolume: 100 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns true for identical set selections", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const sel = { type: "set" as const, setId: "set-1", defaultVolume: 80 };
    expect(selectionsEqual(sel, { ...sel })).toBe(true);
  });

  it("returns false when set setId differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "set" as const, setId: "set-1", defaultVolume: 80 };
    const b = { type: "set" as const, setId: "set-2", defaultVolume: 80 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when set defaultVolume differs", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "set" as const, setId: "set-1", defaultVolume: 80 };
    const b = { type: "set" as const, setId: "set-1", defaultVolume: 100 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when assigned instances are the same but in different order", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const inst1 = { id: "i1", soundId: "s1", volume: 100 };
    const inst2 = { id: "i2", soundId: "s2", volume: 100 };
    const a = { type: "assigned" as const, instances: [inst1, inst2] };
    const b = { type: "assigned" as const, instances: [inst2, inst1] };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when tag tagIds are same but in different order", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "tag" as const, tagIds: ["t1", "t2"], matchMode: "any" as const, defaultVolume: 80 };
    const b = { type: "tag" as const, tagIds: ["t2", "t1"], matchMode: "any" as const, defaultVolume: 80 };
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it("returns false when selection types differ", async () => {
    const { selectionsEqual } = await import("./padPlayer");
    const a = { type: "assigned" as const, instances: [{ id: "i1", soundId: "s1", volume: 100 }] };
    const b = { type: "set" as const, setId: "set-1", defaultVolume: 100 };
    expect(selectionsEqual(a, b)).toBe(false);
  });
});

describe("syncLayerConfig — selection-only change", () => {
  it("selection changes only: rebuilds queue with new sounds", async () => {
    const { triggerPad, syncLayerConfig } = await import("./padPlayer");
    const soundA = createMockSound({ id: "sound-a", filePath: "a.wav" });
    const soundB = createMockSound({ id: "sound-b", filePath: "b.wav" });
    const soundC = createMockSound({ id: "sound-c", filePath: "c.wav" });
    setSounds([soundA, soundB, soundC]);

    const layer = createMockLayer({
      playbackMode: "one-shot",
      arrangement: "sequential",
      selection: {
        type: "assigned",
        instances: [
          { id: "inst-a", soundId: soundA.id, volume: 100 },
          { id: "inst-b", soundId: soundB.id, volume: 100 },
        ],
      },
    });
    const pad = createMockPad({ layers: [layer] });
    await triggerPad(pad);
    await tick();

    // Change only selection: [A, B] → [C] — arrangement stays sequential
    const updated = {
      ...layer,
      selection: {
        type: "assigned" as const,
        instances: [{ id: "inst-c", soundId: soundC.id, volume: 100 }],
      },
    };
    syncLayerConfig(updated, layer);

    // A is still playing; chain queue is now [C]. A ends → C plays.
    createdSources[0].simulateEnd();
    await tick();
    expect(createdSources).toHaveLength(2);
    const loadedIds = mockLoadBuffer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(loadedIds[1]).toBe(soundC.id);
  });
});

describe("stopAllPads clears fade tracking", () => {
  it("cancels pending fade timeouts so cleanup callbacks do not fire", async () => {
    vi.useFakeTimers();
    const { fadePadOut, stopAllPads, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "timeout-cancel-pad" });
    usePlaybackStore.setState({ playingPadIds: new Set([pad.id]) });

    fadePadOut(pad, 500);
    stopAllPads();
    vi.advanceTimersByTime(600);

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    clearAllFadeTracking();
    vi.useRealTimers();
  });

  it("clears fading state when stopAllPads is called mid-fade", async () => {
    vi.useFakeTimers();
    const { fadePadOut, stopAllPads, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "stop-mid-fade-pad" });

    fadePadOut(pad, 500);
    expect(isPadFading(pad.id)).toBe(true);

    stopAllPads();
    expect(isPadFading(pad.id)).toBe(false);

    clearAllFadeTracking();
    vi.useRealTimers();
  });
});

// ─── Cycle mode tests ────────────────────────────────────────────────────────

describe("cycle mode — sequential", () => {
  it("plays only one sound per trigger, advancing through the sequence", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger 1: plays sound[0]
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);

    // Let sound[0] end naturally
    createdSources[0].simulateEnd();
    await tick();

    // No auto-chain — still only 1 load
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Trigger 2: plays sound[1]
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(mockLoadBuffer.mock.calls[1][0].id).toBe(sounds[1].id);

    createdSources[1].simulateEnd();
    await tick();

    // Trigger 3: plays sound[2]
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[2].id);
  });

  it("wraps back to the first sound after exhausting the sequence (one-shot)", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Play A, B
    await triggerPad(pad);
    createdSources[0].simulateEnd();
    await tick();
    await triggerPad(pad);
    createdSources[1].simulateEnd();
    await tick();

    // Next trigger wraps to A (one-shot resets cursor after exhaustion)
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[0].id);
  });

  it("does not auto-chain to the next sound when a cycle sound ends", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Sound ends naturally — should NOT chain to sound[1]
    createdSources[0].simulateEnd();
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(isLayerActive(layer.id)).toBe(false);
  });
});

describe("cycle mode — loop/hold", () => {
  it("sets source.loop = true for loop+cycle (loops same sound, not chain)", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "loop",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    // source.loop should be true (loops the single sound, like simultaneous)
    expect(createdSources[0].loop).toBe(true);
  });

  it("hold+cycle: sets source.loop = true", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "hold",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    expect(createdSources[0].loop).toBe(true);
  });

  it("loop+cycle: each retrigger advances to the next sound and loops it", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "loop",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger 1: plays sound[0] looping
    await triggerPad(pad);
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);
    expect(createdSources[0].loop).toBe(true);

    // Trigger 2 (restart): stops sound[0], replays sound[0] (cursor does not advance)
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(mockLoadBuffer.mock.calls[1][0].id).toBe(sounds[0].id);

    // Trigger 3 (restart): still sound[0]
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[0].id);
  });
});

describe("cycle mode — shuffled", () => {
  it("plays one sound per trigger with shuffled arrangement", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "shuffled",
      cycleMode: true,
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger 1
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    createdSources[0].simulateEnd();
    await tick();

    // No auto-chain
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Trigger 2
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
  });
});

describe("cycle mode — retrigger interactions", () => {
  it("continue: skips retrigger if cycle sound is still playing", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "continue",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Retrigger while sound[0] still playing: ignored (continue mode)
    await triggerPad(pad);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
  });

  it("stop: stops the playing cycle sound without advancing", async () => {
    vi.useFakeTimers();
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "stop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // First trigger: plays sound[0]
    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Second trigger while playing: stops (does not advance)
    await triggerPad(pad);
    vi.advanceTimersByTime(35);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
    expect(isLayerActive(layer.id)).toBe(false);
    vi.useRealTimers();
  });

  it("next+cycle: stops current sound and plays the next in cycle", async () => {
    const { triggerPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "next",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger 1: plays sound[0]
    await triggerPad(pad);
    expect(mockLoadBuffer.mock.calls[0][0].id).toBe(sounds[0].id);

    // Retrigger with next: stops sound[0], advances cursor, plays sound[1]
    await triggerPad(pad);
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(mockLoadBuffer.mock.calls[1][0].id).toBe(sounds[1].id);

    // Retrigger again: plays sound[2]
    await triggerPad(pad);
    await tick();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(3);
    expect(mockLoadBuffer.mock.calls[2][0].id).toBe(sounds[2].id);
  });
});

describe("cycle mode — stopAllPads resets cycle cursor", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stopAllPads clears the cycle index so the next trigger starts from 0", async () => {
    const { triggerPad, stopAllPads } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger 1: plays sound[0], cursor advances to 1
    await triggerPad(pad);
    await vi.runAllTimersAsync();

    // Stop all pads (resets cursor)
    stopAllPads();
    await vi.runAllTimersAsync();

    // Next trigger should start from sound[0] again (cursor reset)
    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(mockLoadBuffer.mock.calls.at(-1)![0].id).toBe(sounds[0].id);
  });
});

describe("cycle mode — stopPad resets cycle cursor", () => {
  it("stopPad clears the cycle index for that pad's layers", async () => {
    const { triggerPad, stopPad } = await import("./padPlayer");
    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      cycleMode: true,
      retriggerMode: "restart",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 1 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger: plays sound[0], cursor advances to 1
    await triggerPad(pad);

    // Stop pad (resets cursor)
    stopPad(pad);
    await tick();

    // Next trigger should start from sound[0] again
    await triggerPad(pad);
    expect(mockLoadBuffer.mock.calls.at(-1)![0].id).toBe(sounds[0].id);
  });
});

// ─── Error handling — toast instead of console.error ─────────────────────────

describe("crossfadePads error handling", () => {
  it("emits audio error when fadePadIn rejects", async () => {
    const { crossfadePads, clearAllFadeTracking } = await import("./padPlayer");
    const padIn = createMockPad({
      id: "xfade-err-in",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    setSounds([createMockSound({ id: "s1", filePath: "sounds/test.wav" })]);
    mockLoadBuffer.mockRejectedValue(new Error("AudioContext suspended"));
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    crossfadePads([], [padIn]);
    await tick();

    // The audio engine now emits errors via the bus rather than calling toast directly.
    expect(mockEmitAudioError).toHaveBeenCalledWith(expect.any(Error), expect.any(Object));
    clearAllFadeTracking();
  });
});

describe("executeFadeTap error handling", () => {
  it("emits audio error when fadePadIn rejects on inactive pad", async () => {
    const { executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-err-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    setSounds([createMockSound({ id: "s1", filePath: "sounds/test.wav" })]);
    mockLoadBuffer.mockRejectedValue(new Error("AudioContext suspended"));
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    executeFadeTap(pad);
    await tick();

    // The audio engine now emits errors via the bus rather than calling toast directly.
    expect(mockEmitAudioError).toHaveBeenCalledWith(expect.any(Error), expect.any(Object));
    clearAllFadeTracking();
  });
});

describe("startLayerSound error handling", () => {
  it("emits audio error for generic playback errors without console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error");
    const { triggerPad } = await import("./padPlayer");
    const pad = createMockPad({
      id: "generic-err-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    setSounds([createMockSound({ id: "s1", filePath: "sounds/test.wav" })]);
    mockLoadBuffer.mockRejectedValue(new Error("decode failed"));
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    await triggerPad(pad);

    // The audio engine now emits errors via the bus rather than calling toast directly.
    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "decode failed" }),
      expect.objectContaining({ isMissingFile: false }),
    );
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("startLayerSound MissingFileError handling", () => {
  it("emits isMissingFile:true error via audio bus on MissingFileError", async () => {
    const { MissingFileError } = await import("./bufferCache");
    const { triggerPad } = await import("./padPlayer");
    const sound = createMockSound({ id: "s1", name: "kick", filePath: "sounds/kick.wav" });
    setSounds([sound]);
    mockLoadBuffer.mockRejectedValue(new MissingFileError("not found"));
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());
    const pad = createMockPad({
      id: "missing-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });

    await triggerPad(pad);
    await tick();

    // The audio engine emits via the error bus; the UI-layer handler (useAudioErrorHandler)
    // is responsible for calling toast.error and refreshMissingState.
    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.any(MissingFileError),
      expect.objectContaining({ isMissingFile: true, soundName: "kick" }),
    );
  });
});

// ─── fadePadOut — custom volumes ─────────────────────────────────────────────

describe("fadePadOut — custom fromVolume and toVolume", () => {
  it("ramps to custom toVolume instead of 0 when provided", async () => {
    const { fadePadOut, getPadGain, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-custom-to-pad" });

    fadePadOut(pad, 1000, undefined, 0.3);

    const gain = getPadGain(pad.id);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, expect.any(Number));
    clearAllFadeTracking();
  });

  it("sets gain to custom fromVolume before ramping when provided", async () => {
    const { fadePadOut, getPadGain, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-custom-from-pad" });

    fadePadOut(pad, 1000, 0.8, 0.0);

    const gain = getPadGain(pad.id);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.8, expect.any(Number));
    clearAllFadeTracking();
  });
});

// ─── fadePadIn — custom volumes ───────────────────────────────────────────────

describe("fadePadIn — custom fromVolume and toVolume", () => {
  it("ramps to custom toVolume instead of 1.0 when provided", async () => {
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { fadePadIn, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fade-in-custom-to-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await fadePadIn(pad, 1000, undefined, 0.7);

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, expect.any(Number));
    clearAllFadeTracking();
  });

  it("starts from custom fromVolume instead of 0 when provided", async () => {
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { fadePadIn, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fade-in-custom-from-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await fadePadIn(pad, 1000, 0.4, 1.0);

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.4, expect.any(Number));
    clearAllFadeTracking();
  });
});

// ─── executeFadeTap — custom volumes ─────────────────────────────────────────

describe("executeFadeTap — custom fromVolume and toVolume", () => {
  it("fades out to custom toVolume when pad is active", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { triggerPad, executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-custom-out-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);
    executeFadeTap(pad, undefined, 1.0, 0.2);

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, expect.any(Number));
    clearAllFadeTracking();
  });

  it("fades in to custom toVolume when pad is not active", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { executeFadeTap, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "tap-custom-in-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    executeFadeTap(pad, undefined, 0.0, 0.7);
    await tick();

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, expect.any(Number));
    clearAllFadeTracking();
  });
});

// ─── setLayerVolume ───────────────────────────────────────────────────────────

describe("setLayerVolume", () => {
  it("updates stores even when the layer has no active gain node", async () => {
    const { setLayerVolume } = await import("./padPlayer");
    // No pad triggered, so no gain node exists for this layer
    setLayerVolume("non-existent-layer", 0.5);
    // Playback store is still updated (runtime display)
    expect(usePlaybackStore.getState().layerVolumes["non-existent-layer"]).toBe(0.5);
  });

  it("updates the gain node (not layerVolumes) when the layer gain node exists", async () => {
    const { triggerPad, setLayerVolume } = await import("./padPlayer");
    const { getLayerGain } = await import("./audioState");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    setLayerVolume(layer.id, 0.5);

    // When layer is playing, tick manages layerVolumes — setLayerVolume only sets the gain node.
    expect(usePlaybackStore.getState().layerVolumes[layer.id]).toBeUndefined();
    expect(getLayerGain(layer.id)?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
  });

  it("updates the gain node value when the layer gain node exists", async () => {
    const { triggerPad, setLayerVolume } = await import("./padPlayer");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const gains: ReturnType<typeof makeMockGain>[] = [];
    mockCtx.createGain.mockImplementation(() => {
      const g = makeMockGain();
      gains.push(g);
      return g;
    });

    const layer = createMockLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    setLayerVolume(layer.id, 0.75);

    // gains[0] = padGain, gains[1] = layerGain, gains[2] = voiceGain
    // The layerGain (gains[1]) should have linearRampToValueAtTime called with 0.75
    const layerGain = gains[1];
    expect(layerGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, expect.any(Number));
  });

  it("clamps volume to [0, 1] range", async () => {
    const { triggerPad, setLayerVolume } = await import("./padPlayer");
    const { getLayerGain } = await import("./audioState");
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    const layerGain = getLayerGain(layer.id);
    expect(layerGain).not.toBeNull();

    // Test clamping values greater than 1 — gain node is clamped, tick manages store
    setLayerVolume(layer.id, 1.5);
    expect(layerGain?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));

    // Test clamping values less than 0
    setLayerVolume(layer.id, -0.5);
    expect(layerGain?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0, expect.any(Number));

    // Test that values within range are passed through unchanged
    setLayerVolume(layer.id, 0.5);
    expect(layerGain?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));

    // Tick manages layerVolumes for playing layers — store is NOT directly updated
    expect(usePlaybackStore.getState().layerVolumes[layer.id]).toBeUndefined();
  });
});

// ─── skipLayerForward ─────────────────────────────────────────────────────────

describe("skipLayerForward", () => {
  it("does nothing when the layer does not exist on the pad", async () => {
    const { skipLayerForward } = await import("./padPlayer");
    const pad = createMockPad({ layers: [] });
    // Should not throw
    expect(() => skipLayerForward(pad, "ghost-layer")).not.toThrow();
  });

  it("does nothing for simultaneous arrangement", async () => {
    const { skipLayerForward } = await import("./padPlayer");
    const layer = createMockLayer({ arrangement: "simultaneous" });
    const pad = createMockPad({ layers: [layer] });
    // Should not throw and playingPadIds should remain empty
    skipLayerForward(pad, layer.id);
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });

  it("does nothing when chain queue is empty (already at end)", async () => {
    const { skipLayerForward } = await import("./padPlayer");
    const { setLayerChain } = await import("./audioState");

    const layer = createMockLayer({ arrangement: "sequential" });
    const pad = createMockPad({ layers: [layer] });

    // Chain is empty — already at end
    setLayerChain(layer.id, []);
    skipLayerForward(pad, layer.id);

    // No new playing pads should be added
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });

  it("advances to next sound in chain and updates chain state", async () => {
    const { triggerPad, skipLayerForward } = await import("./padPlayer");
    const { getLayerChain } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger to start playback — first sound plays, chain has remaining 2
    await triggerPad(pad);
    await tick();

    const chainBefore = getLayerChain(layer.id);
    expect(chainBefore?.length).toBe(2);

    // Skip forward: should consume first item from chain
    skipLayerForward(pad, layer.id);
    await tick();

    const chainAfter = getLayerChain(layer.id);
    // Chain should have advanced by 1 (one item consumed)
    expect(chainAfter?.length).toBe(1);
  });

  it("advances cycleIndex in cycle mode instead of using chain queue", async () => {
    const { skipLayerForward } = await import("./padPlayer");
    const { getLayerCycleIndex, setLayerCycleIndex, setLayerPlayOrder } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Simulate: soundA (index 0) is playing. After trigger, cycleIndex was advanced to 1.
    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 1); // cursor points to B (next after A)

    skipLayerForward(pad, layer.id);
    await tick();

    // Should advance to soundB (index 1 = curCycleIdx % n).
    // New cycleIndex should be 2 so next trigger plays soundC.
    expect(getLayerCycleIndex(layer.id)).toBe(2);
  });

  it("preserves playOrder after skip so subsequent skip back works", async () => {
    const { triggerPad, skipLayerForward } = await import("./padPlayer");
    const { getLayerPlayOrder } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    skipLayerForward(pad, layer.id);
    await tick();

    // playOrder must be preserved after skip forward so a subsequent skip back can use it
    expect(getLayerPlayOrder(layer.id)).toHaveLength(3);
  });

  it("cancels an in-progress fade-out before starting the skip voice (chain mode)", async () => {
    const { triggerPad, skipLayerForward, fadePadOut } = await import("./padPlayer");
    const { isPadFadingOut } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    // Start a fade-out — pad is now fading
    fadePadOut(pad, 2000);
    expect(isPadFadingOut(pad.id)).toBe(true);

    // Skip forward — should cancel the fade so the cleanup timeout cannot kill the new voice
    skipLayerForward(pad, layer.id);
    await tick();

    // Fade should be cancelled
    expect(isPadFadingOut(pad.id)).toBe(false);
  });

  it("cancels an in-progress fade-out before starting the skip voice (cycle mode)", async () => {
    const { skipLayerForward, fadePadOut } = await import("./padPlayer");
    const { isPadFadingOut, setLayerPlayOrder, setLayerCycleIndex } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 0);

    fadePadOut(pad, 2000);
    expect(isPadFadingOut(pad.id)).toBe(true);

    skipLayerForward(pad, layer.id);
    await tick();

    expect(isPadFadingOut(pad.id)).toBe(false);
  });

  // Note: a fake-timer "voice survives" test (as in PR #248's triggerPad analog) is
  // not included here because skipLayerForward is synchronous — its internal async
  // chain (ensureResumed → loadBuffer → createBufferSource) has multiple microtask
  // hops that cannot be awaited externally. The isPadFadingOut assertions above prove
  // cancelPadFade() is called, which by definition clears the stale setTimeout via
  // clearTimeout(). The cancelPadFade unit tests in audioState.test.ts verify that
  // behaviour directly.

  it("reports an error via emitAudioError when ensureResumed rejects during skip (chained mode)", async () => {
    const { ensureResumed } = await import("./audioContext");
    vi.mocked(ensureResumed).mockRejectedValueOnce(new Error("audio context unavailable"));

    const { skipLayerForward } = await import("./padPlayer");
    const { setLayerPlayOrder, setLayerChain } = await import("./audioState");

    const sounds = [createMockSound({ filePath: "a.wav" }), createMockSound({ filePath: "b.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    setLayerPlayOrder(layer.id, sounds);
    setLayerChain(layer.id, [sounds[1]]);

    skipLayerForward(pad, layer.id);
    await tick();

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "audio context unavailable" }),
    );
  });

  it("reports an error via emitAudioError when ensureResumed rejects during skip (cycleMode)", async () => {
    const { ensureResumed } = await import("./audioContext");
    vi.mocked(ensureResumed).mockRejectedValueOnce(new Error("audio context unavailable"));

    const { skipLayerForward } = await import("./padPlayer");
    const { setLayerPlayOrder, setLayerCycleIndex } = await import("./audioState");

    const sounds = [createMockSound({ filePath: "a.wav" }), createMockSound({ filePath: "b.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 1); // cursor points to B (next after A)

    skipLayerForward(pad, layer.id);
    await tick();

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "audio context unavailable" }),
    );
  });
});


// ─── skipLayerBack ────────────────────────────────────────────────────────────

describe("skipLayerBack", () => {
  it("does nothing when the layer does not exist on the pad", async () => {
    const { skipLayerBack } = await import("./padPlayer");
    const pad = createMockPad({ layers: [] });
    expect(() => skipLayerBack(pad, "ghost-layer")).not.toThrow();
  });

  it("does nothing for simultaneous arrangement", async () => {
    const { skipLayerBack } = await import("./padPlayer");
    const layer = createMockLayer({ arrangement: "simultaneous" });
    const pad = createMockPad({ layers: [layer] });
    skipLayerBack(pad, layer.id);
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });

  it("does nothing when playOrder is not set", async () => {
    const { skipLayerBack } = await import("./padPlayer");
    const layer = createMockLayer({ arrangement: "sequential" });
    const pad = createMockPad({ layers: [layer] });
    // No playOrder set, no chain set
    skipLayerBack(pad, layer.id);
    expect(usePlaybackStore.getState().playingPadIds.size).toBe(0);
  });

  it("stays at position 0 when already at start of play order", async () => {
    const { triggerPad, skipLayerBack } = await import("./padPlayer");
    const { getLayerCycleIndex, getLayerChain } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Trigger: first sound plays, chain = [soundB, soundC]
    await triggerPad(pad);
    await tick();

    // We're at position 0 (playing soundA). Skip back should keep us at 0.
    skipLayerBack(pad, layer.id);
    await tick();

    // cycleIndex should not be set (non-cycle-mode layer), chain rebuilt from index 0 onward
    expect(getLayerCycleIndex(layer.id)).toBeUndefined();
    const chain = getLayerChain(layer.id);
    expect(chain?.length).toBe(2); // [soundB, soundC]
  });

  it("goes back one position when in the middle of play order", async () => {
    const { skipLayerBack } = await import("./padPlayer");
    const { getLayerCycleIndex, getLayerChain, setLayerChain, setLayerPlayOrder } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Simulate state at position 1: soundB is playing, chain has [soundC] remaining
    // playOrder = [soundA, soundB, soundC], chain = [soundC]
    setLayerPlayOrder(layer.id, sounds);
    setLayerChain(layer.id, [sounds[2]]); // [soundC]

    // Skip back: currentPos = 3 - 1 - 1 = 1, prevIndex = max(0, 1-1) = 0
    // Should go to position 0 (soundA), chain = [soundB, soundC]
    skipLayerBack(pad, layer.id);
    await tick();

    expect(getLayerCycleIndex(layer.id)).toBeUndefined();
    const chain = getLayerChain(layer.id);
    expect(chain?.length).toBe(2); // [soundB, soundC]
  });

  it("uses cycleIndex (not chain) to determine position in cycle mode", async () => {
    const { skipLayerBack } = await import("./padPlayer");
    const { getLayerCycleIndex, setLayerCycleIndex, setLayerPlayOrder } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    // Simulate: soundB (index 1) is playing. After trigger, cycleIndex was advanced to 2.
    // No chain is set — cycle mode never uses it.
    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 2); // cursor points to C (next after B)

    skipLayerBack(pad, layer.id);
    await tick();

    // Should go back to soundA (index 0 = cycleIndex-2 = 0).
    // New cycleIndex should be 1 so next trigger replays soundB.
    expect(getLayerCycleIndex(layer.id)).toBe(1);
  });

  it("preserves playOrder after skip so subsequent skip back works", async () => {
    const { triggerPad, skipLayerBack } = await import("./padPlayer");
    const { getLayerChain, getLayerPlayOrder } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    // Skip forward to soundB
    const { skipLayerForward } = await import("./padPlayer");
    skipLayerForward(pad, layer.id);
    await tick();

    // Now skip back — playOrder must have been preserved for this to work correctly.
    skipLayerBack(pad, layer.id);
    await tick();

    // playOrder should still be available and chain should be rebuilt from position 0
    expect(getLayerPlayOrder(layer.id)).toHaveLength(3);
    const chain = getLayerChain(layer.id);
    expect(chain?.length).toBe(2); // [soundB, soundC] — went back to soundA
  });

  it("cancels an in-progress fade-out before starting the skip voice (chain mode)", async () => {
    const { triggerPad, skipLayerBack, fadePadOut } = await import("./padPlayer");
    const { isPadFadingOut } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerPad(pad);
    await tick();

    // Start a fade-out — pad is now fading
    fadePadOut(pad, 2000);
    expect(isPadFadingOut(pad.id)).toBe(true);

    // Skip back — should cancel the fade so the cleanup timeout cannot kill the new voice
    skipLayerBack(pad, layer.id);
    await tick();

    // Fade should be cancelled
    expect(isPadFadingOut(pad.id)).toBe(false);
  });

  it("cancels an in-progress fade-out before starting the skip voice (cycle mode)", async () => {
    const { skipLayerBack, fadePadOut } = await import("./padPlayer");
    const { isPadFadingOut, setLayerPlayOrder, setLayerCycleIndex } = await import("./audioState");

    const sounds = [
      createMockSound({ filePath: "a.wav" }),
      createMockSound({ filePath: "b.wav" }),
      createMockSound({ filePath: "c.wav" }),
    ];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });

    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 2); // cursor at index 2 (C playing, next would be A)

    fadePadOut(pad, 2000);
    expect(isPadFadingOut(pad.id)).toBe(true);

    skipLayerBack(pad, layer.id);
    await tick();

    expect(isPadFadingOut(pad.id)).toBe(false);
  });

  // Note: a fake-timer "voice survives" test is not included — same reasoning as
  // the equivalent comment in skipLayerForward above. The isPadFadingOut assertions
  // prove cancelPadFade() is invoked; audioState.test.ts verifies it clears the timeout.

  it("reports an error via emitAudioError when ensureResumed rejects during skip (chained mode)", async () => {
    const { ensureResumed } = await import("./audioContext");
    vi.mocked(ensureResumed).mockRejectedValueOnce(new Error("audio context unavailable"));

    const { skipLayerBack } = await import("./padPlayer");
    const { setLayerPlayOrder, setLayerChain } = await import("./audioState");

    const sounds = [createMockSound({ filePath: "a.wav" }), createMockSound({ filePath: "b.wav" }), createMockSound({ filePath: "c.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    setLayerPlayOrder(layer.id, sounds);
    setLayerChain(layer.id, [sounds[2]]); // soundC remaining (soundB was playing)

    skipLayerBack(pad, layer.id);
    await tick();

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "audio context unavailable" }),
    );
  });

  it("reports an error via emitAudioError when ensureResumed rejects during skip (cycleMode)", async () => {
    const { ensureResumed } = await import("./audioContext");
    vi.mocked(ensureResumed).mockRejectedValueOnce(new Error("audio context unavailable"));

    const { skipLayerBack } = await import("./padPlayer");
    const { setLayerPlayOrder, setLayerCycleIndex } = await import("./audioState");

    const sounds = [createMockSound({ filePath: "a.wav" }), createMockSound({ filePath: "b.wav" }), createMockSound({ filePath: "c.wav" })];
    setSounds(sounds);

    const layer = createMockLayer({
      arrangement: "sequential",
      playbackMode: "loop",
      cycleMode: true,
      selection: { type: "assigned", instances: sounds.map((s) => ({ id: s.id, soundId: s.id, volume: 100 })) },
    });
    const pad = createMockPad({ layers: [layer] });
    setLayerPlayOrder(layer.id, sounds);
    setLayerCycleIndex(layer.id, 2); // cursor at C (B was playing, A is previous)

    skipLayerBack(pad, layer.id);
    await tick();

    expect(mockEmitAudioError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "audio context unavailable" }),
    );
  });
});


// ─── fadePadWithLevels ────────────────────────────────────────────────────────

describe("fadePadWithLevels", () => {
  it("calls fadePadOut (volume transition) with SWAPPED levels when pad is playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { triggerPad, fadePadWithLevels, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fpl-playing-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);

    // fadePadWithLevels(pad, 1000, fromLevel=0.2, toLevel=0.8)
    // Since pad is playing, should call fadePadOut with swapped args:
    //   fadePadOut(pad, 1000, fromVolume=0.8, toVolume=0.2)
    // This ramps the gain from 0.8 down to 0.2.
    const gain = (await import("./padPlayer")).getPadGain(pad.id);
    fadePadWithLevels(pad, 1000, 0.2, 0.8);

    // fadePadOut schedules a ramp — verify the ramp was called with the toVolume=0.2 (swapped fromLevel)
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, expect.any(Number));
    clearAllFadeTracking();
  });

  it("shows volume transition when pad is playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { triggerPad, fadePadWithLevels, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fpl-transition-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);
    fadePadWithLevels(pad, 1000, 0.0, 1.0);

    expect(isPadFading(pad.id)).toBe(true);
    clearAllFadeTracking();
  });

  it("returns a resolved promise for playing path", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { triggerPad, fadePadWithLevels, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fpl-promise-playing-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    await triggerPad(pad);
    const result = fadePadWithLevels(pad, 1000, 0.0, 1.0);

    // Playing path returns Promise.resolve()
    await expect(result).resolves.toBeUndefined();
    clearAllFadeTracking();
  });

  it("fades in (ramps gain up) when pad is not playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const { fadePadWithLevels, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fpl-not-playing-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    // Pad is NOT playing — fadePadWithLevels should call fadePadIn(pad, 1000, 0.0, 0.8)
    // fadePadIn triggers the pad then ramps gain up to toLevel=0.8
    const resultPromise = fadePadWithLevels(pad, 1000, 0.0, 0.8);

    // fadePadIn path triggers the pad and starts a volume transition
    await vi.waitFor(() => {
      expect(isPadFading(pad.id)).toBe(true);
    });
    await expect(resultPromise).resolves.toBeUndefined();
    clearAllFadeTracking();
  });

  it("ramps gain to toLevel (not 1.0) when pad is not playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    const mockGain = makeMockGain();
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(mockGain);

    const { fadePadWithLevels, clearAllFadeTracking } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fpl-ramp-level-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    } as unknown as Parameters<typeof useLibraryStore.setState>[0]);

    // fromLevel=0.0, toLevel=0.6 — fadePadIn should ramp to 0.6, not 1.0
    fadePadWithLevels(pad, 1000, 0.0, 0.6);

    await vi.waitFor(() => {
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.6, expect.any(Number));
    });
    clearAllFadeTracking();
  });
});

// ─── stopLayerWithRamp ────────────────────────────────────────────────────────

describe("stopLayerWithRamp", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is a no-op when layer id doesn't exist on the pad", async () => {
    const { stopLayerWithRamp } = await import("./padPlayer");
    const pad = createMockPad();
    expect(() => stopLayerWithRamp(pad, "nonexistent-layer")).not.toThrow();
  });

  it("is a no-op when the layer has no active voices", async () => {
    const { stopLayerWithRamp } = await import("./padPlayer");
    const layer = createMockLayer({ arrangement: "simultaneous" });
    const pad = createMockPad({ layers: [layer] });

    // layer has no voices — should not throw or call source.stop
    expect(() => stopLayerWithRamp(pad, layer.id)).not.toThrow();
    vi.advanceTimersByTime(35);
    // No sources were created, nothing to verify beyond no-throw
  });

  it("removes pad from playingPadIds after ramp when no layers remain active", async () => {
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    const { triggerPad, stopLayerWithRamp } = await import("./padPlayer");

    await triggerPad(pad);
    await vi.runAllTimersAsync();

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    stopLayerWithRamp(pad, layer.id);

    // During the ramp, pad should still appear playing
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    // After ramp completes
    vi.advanceTimersByTime(35);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("does not remove pad from playingPadIds when another layer is still active", async () => {
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    const { triggerPad, stopLayerWithRamp } = await import("./padPlayer");

    await triggerPad(pad);
    await vi.runAllTimersAsync();

    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    // Stop only layer1 — layer2 is still active
    stopLayerWithRamp(pad, layer1.id);
    vi.advanceTimersByTime(35);

    // Pad should still be playing because layer2 is active
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
  });

  it("ramps the source gain to 0 before stopping", async () => {
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    const { triggerPad, stopLayerWithRamp } = await import("./padPlayer");

    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(1);

    stopLayerWithRamp(pad, layer.id);
    // Source not stopped synchronously — ramp in progress
    expect(createdSources[0].stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(35);
    expect(createdSources[0].stop).toHaveBeenCalledOnce();
  });

  it("cleanup timeout does not remove pad from playingPadIds when clearAllAudioState fires before it runs", async () => {
    // Regression guard for issue #137: the post-ramp removePlayingPad check must be
    // cancelled by clearAllAudioState so it cannot interfere with a new session that
    // reuses the same pad ID.
    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 1 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    const { triggerPad, stopLayerWithRamp } = await import("./padPlayer");
    const { clearAllAudioState } = await import("./audioState");

    await triggerPad(pad);
    await vi.runAllTimersAsync();
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    stopLayerWithRamp(pad, layer.id);

    // Simulate project close before the ramp timeout fires
    clearAllAudioState();

    // Simulate new session: manually re-add the pad to playingPadIds as if it's now
    // playing in the new project, then advance time to where the old timeout would fire
    usePlaybackStore.getState().addPlayingPad(pad.id);
    vi.advanceTimersByTime(35);

    // The stale cleanup timeout must NOT have removed the pad from the new session's state
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
  });
});

// ─── triggerLayer ─────────────────────────────────────────────────────────────

describe("triggerLayer", () => {
  it("is a no-op when no sounds are resolved for the layer", async () => {
    const { triggerLayer } = await import("./padPlayer");
    // No sounds in library — resolved will be empty
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: "si-1", soundId: "nonexistent", volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerLayer(pad, layer);

    expect(mockLoadBuffer).not.toHaveBeenCalled();
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
  });

  it("starts playback and marks pad as playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const sound = createMockSound({ id: "s1", filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerLayer(pad, layer);

    expect(mockLoadBuffer).toHaveBeenCalledOnce();
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
  });

  it("retriggerMode stop: stops the layer when active and does not restart", async () => {
    vi.useFakeTimers();
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "stop",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // First trigger — starts playback
    await triggerLayer(pad, layer);
    await vi.runAllTimersAsync();
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Second trigger while active with stop mode — stops, does NOT play again
    await triggerLayer(pad, layer);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1); // no new loads

    // After ramp completes, layer is no longer active
    vi.advanceTimersByTime(35);
    const { isLayerActive: checkLayerActive } = await import("./audioState");
    expect(checkLayerActive(layer.id)).toBe(false);
    vi.useRealTimers();
  });

  it("retriggerMode stop: removes pad from playingPadIds after ramp", async () => {
    vi.useFakeTimers();
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "stop",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerLayer(pad, layer);
    await vi.runAllTimersAsync();
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    // Second trigger stops it
    await triggerLayer(pad, layer);
    vi.advanceTimersByTime(35);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(false);
    vi.useRealTimers();
  });

  it("retriggerMode stop: afterStopCleanup timeout does not fire after clearAllAudioState", async () => {
    // Regression guard for issue #137: the afterStopCleanup timeout scheduled by
    // triggerLayer (retriggerMode: "stop") must be cancelled by clearAllAudioState
    // so it cannot call removePlayingPad in a new session reusing the same pad ID.
    vi.useFakeTimers();
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const { clearAllAudioState } = await import("./audioState");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "stop",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // First trigger — starts playback
    await triggerLayer(pad, layer);
    await vi.runAllTimersAsync();
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);

    // Second trigger with retriggerMode stop — schedules afterStopCleanup timeout
    await triggerLayer(pad, layer);

    // Simulate project close before the cleanup timeout fires
    clearAllAudioState();

    // Simulate new session: re-add the same pad ID as if it is now playing in a new project
    usePlaybackStore.getState().addPlayingPad(pad.id);

    // Advance time past where the stale cleanup timeout would have fired
    vi.advanceTimersByTime(35);

    // The stale cleanup timeout must NOT have removed the pad from the new session's state
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
    vi.useRealTimers();
  });

  it("retriggerMode continue: ignores retrigger when already playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockReturnValue(makeMockSource());
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "continue",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerLayer(pad, layer);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Retrigger while active: should be ignored
    await triggerLayer(pad, layer);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
  });

  it("retriggerMode restart: stops and restarts when already playing", async () => {
    mockLoadBuffer.mockResolvedValue({ duration: 1.0, numberOfChannels: 1, sampleRate: 44100 });
    mockCtx.createBufferSource.mockImplementation(() => {
      const s = makeMockSource();
      createdSources.push(s);
      return s;
    });
    mockCtx.createGain.mockReturnValue(makeMockGain());

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const { triggerLayer } = await import("./padPlayer");
    const layer = createMockLayer({
      arrangement: "simultaneous",
      retriggerMode: "restart",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await triggerLayer(pad, layer);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);

    // Retrigger with restart: should restart playback
    await triggerLayer(pad, layer);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
    expect(usePlaybackStore.getState().playingPadIds.has(pad.id)).toBe(true);
  });
});

// ── Pending leak guards ───────────────────────────────────────────────────────

describe("pending leak guards", () => {
  it("clears layer pending when ensureResumed throws inside triggerLayer", async () => {
    const audioCtx = await import("./audioContext");
    (audioCtx.ensureResumed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("audio context failed"),
    );

    const { triggerLayer } = await import("./padPlayer");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);
    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // Error should propagate, but pending must be cleared
    await expect(triggerLayer(pad, layer)).rejects.toThrow("audio context failed");
    expect(isLayerPending(layer.id)).toBe(false);
  });

  it("clears layer pending when applyRetriggerMode throws inside triggerLayer", async () => {
    // Make getOrCreateLayerGain throw by rejecting createGain on the layer gain call
    // padGain is created first (call 1), layerGain second (call 2 — throws)
    let createGainCallCount = 0;
    mockCtx.createGain.mockImplementation(() => {
      createGainCallCount++;
      if (createGainCallCount >= 2) throw new Error("createGain failed");
      return makeMockGain();
    });

    const { triggerLayer } = await import("./padPlayer");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);
    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    await expect(triggerLayer(pad, layer)).rejects.toThrow("createGain failed");
    expect(isLayerPending(layer.id)).toBe(false);
  });

  it("cancels in-progress fade-out when pad is re-triggered (clears both flag and timeout)", async () => {
    vi.useFakeTimers();
    const { addFadingOutPad, isPadFadingOut, isPadFading, setFadePadTimeout } = await import("./audioState");
    const { triggerPad } = await import("./padPlayer");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);
    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // Put pad into fading-out state with a live timeout (as if fadePadOut was called previously)
    addFadingOutPad(pad.id);
    const timeoutId = setTimeout(() => {}, 10000);
    setFadePadTimeout(pad.id, timeoutId);
    expect(isPadFadingOut(pad.id)).toBe(true);
    expect(isPadFading(pad.id)).toBe(true);

    await triggerPad(pad);

    // triggerPad should cancel the in-progress fade (both flag and timeout cleared)
    expect(isPadFadingOut(pad.id)).toBe(false);
    expect(isPadFading(pad.id)).toBe(false);
    vi.useRealTimers();
  });

  it("voices started after re-trigger survive the stale fade cleanup timeout", async () => {
    vi.useFakeTimers();
    const { fadePadOut } = await import("./fadeMixer");
    const { triggerPad } = await import("./padPlayer");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);
    const layer = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer] });

    // Start a fade-out (schedules a 500ms cleanup timeout)
    fadePadOut(pad, 500);

    // Re-trigger during the fade window — triggerPad should cancel the stale cleanup
    await triggerPad(pad);

    // Capture the newly-started voice
    const newVoice = createdSources[createdSources.length - 1];
    expect(newVoice).toBeDefined();

    // Advance past the original fade cleanup window
    vi.advanceTimersByTime(600);

    // The new voice must NOT have been stopped by the stale cleanup timeout
    expect(newVoice.stop).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("starts all simultaneous layers — both layers become active after triggerPad with a 2-layer pad", async () => {
    const { triggerPad } = await import("./padPlayer");
    const { isLayerActive } = await import("./audioState");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    await triggerPad(pad);

    // Both layers must be active — neither is blocked waiting for the other.
    // True parallelism (both layers in-flight simultaneously) is observable only via
    // microtask interleaving, which is covered by the pending-flag pre-pass test below.
    expect(isLayerActive(layer1.id)).toBe(true);
    expect(isLayerActive(layer2.id)).toBe(true);
  });

  it("sets pending for all layers in a synchronous pre-pass before any layer's async work starts", async () => {
    // Regression guard for the pre-pass pattern: with the old sequential for-await loop,
    // layer 2's pending flag was set only after layer 1's entire async chain completed.
    // With the pre-pass + Promise.all, both flags are set before any applyRetriggerMode await.
    const { triggerPad } = await import("./padPlayer");
    const { isLayerPending } = await import("./audioState");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    // Start triggerPad without awaiting. The function yields at `await ensureResumed()` first.
    const promise = triggerPad(pad);

    // Flush the ensureResumed() microtask — this causes triggerPad to resume and run the
    // synchronous pre-pass (setting both pending flags) before reaching Promise.all.
    await Promise.resolve();

    // Both flags must be set: the pre-pass ran synchronously in the single microtask above.
    // The async layer callbacks have yielded at their first `await` but have not cleared yet.
    expect(isLayerPending(layer1.id)).toBe(true);
    expect(isLayerPending(layer2.id)).toBe(true);

    await promise;
  });

  it("clears pending for a layer that throws in the triggerPad loop, allowing other layers to proceed", async () => {
    const { triggerPad } = await import("./padPlayer");

    const sound = createMockSound({ filePath: "a.wav" });
    setSounds([sound]);

    // Layer 1 will throw (createGain fails on its layer gain call)
    const layer1 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    // Layer 2 should still succeed
    const layer2 = createMockLayer({
      arrangement: "simultaneous",
      selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 100 }] },
    });
    const pad = createMockPad({ layers: [layer1, layer2] });

    let createGainCallCount = 0;
    mockCtx.createGain.mockImplementation(() => {
      createGainCallCount++;
      // Call 1: padGain (ok), Call 2: layer1 gain (throws), Call 3+: layer2 gain (ok)
      if (createGainCallCount === 2) throw new Error("layer1 createGain failed");
      return makeMockGain();
    });

    // triggerPad should resolve (error per layer is swallowed, not propagated)
    await triggerPad(pad);

    // Layer 1's pending must be cleared despite the throw
    expect(isLayerPending(layer1.id)).toBe(false);
    // Layer 2 should still have been triggered (other layers proceed)
    expect(isLayerActive(layer2.id)).toBe(true);
  });
});
