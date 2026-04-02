# Streaming Audio Dual-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route large audio files (≥ 20 MB compressed) through an `HTMLAudioElement` streaming path so they play with near-zero memory overhead, while keeping short files on the existing fully-decoded `AudioBuffer` path for instant retrigger and simultaneous playback.

**Architecture:** A new `AudioVoice` interface wraps both `AudioBufferSourceNode` and `HTMLAudioElement` with a uniform `start/stop/setOnEnded` API. A `streamingCache` module checks file size via a `HEAD` request (result cached per sound ID) before each sound starts, and routes accordingly. `playbackStore` switches its internal voice maps from `AudioBufferSourceNode[]` to `AudioVoice[]` — the `stop()` call works identically for both. `padPlayer` and `preview` branch at `startLayerSound`/`playPreview` level.

**Tech Stack:** Web Audio API (`AudioContext`, `AudioBufferSourceNode`, `createMediaElementSource`), `HTMLAudioElement`, TypeScript strict, Vitest, `@tauri-apps/api/core` (`convertFileSrc`)

---

## File Map

| File | Change |
|------|--------|
| `src/lib/audio/audioVoice.ts` | **Create** — `AudioVoice` interface + `wrapBufferSource()` + `wrapStreamingElement()` |
| `src/lib/audio/audioVoice.test.ts` | **Create** — unit tests for both wrappers |
| `src/lib/audio/streamingCache.ts` | **Create** — `checkIsLargeFile()` (HEAD + size cache) + `evictSizeCache()` + `clearAllSizeCache()` |
| `src/lib/audio/streamingCache.test.ts` | **Create** — unit tests for size check and cache |
| `src/state/playbackStore.ts` | **Modify** — change `AudioBufferSourceNode` → `AudioVoice` in maps and method signatures |
| `src/state/playbackStore.test.ts` | **Modify** — update mock voices to satisfy `AudioVoice` interface |
| `src/lib/audio/padPlayer.ts` | **Modify** — dual path in `startLayerSound`, import new modules |
| `src/lib/audio/padPlayer.test.ts` | **Modify** — add `streamingCache` mock; add streaming-path tests |
| `src/lib/audio/preview.ts` | **Modify** — dual path in `playPreview`, handle both in `stopPreview` |

---

## Task 1: `audioVoice.ts` — shared interface + wrapper factories

**Files:**
- Create: `src/lib/audio/audioVoice.ts`
- Create: `src/lib/audio/audioVoice.test.ts`

- [ ] **Step 1: Write the failing tests** in `src/lib/audio/audioVoice.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockSource() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    get onended() { return endedCb; },
    set onended(cb: ((ev: Event) => any) | null) { endedCb = cb; },
  };
}

function makeMockAudio() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    get onended() { return endedCb; },
    set onended(cb: ((ev: Event) => any) | null) { endedCb = cb; },
    /** Simulate natural end of playback (fires onended). */
    simulateEnd() { endedCb?.(new Event("ended")); },
  };
}

// ── wrapBufferSource ──────────────────────────────────────────────────────────

describe("wrapBufferSource", () => {
  it("start() calls source.start()", async () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    await voice.start();
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stop() calls source.stop()", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    voice.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("stop() does not throw if source.stop() throws (already ended)", () => {
    const source = makeMockSource();
    source.stop.mockImplementation(() => { throw new Error("already ended"); });
    const voice = wrapBufferSource(source as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("setOnEnded wires callback to source.onended", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) clears callback", () => {
    const source = makeMockSource();
    const voice = wrapBufferSource(source as any);
    voice.setOnEnded(vi.fn());
    voice.setOnEnded(null);
    expect(source.onended).toBeNull();
  });
});

// ── wrapStreamingElement ──────────────────────────────────────────────────────

describe("wrapStreamingElement", () => {
  it("start() calls audio.play()", async () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    await voice.start();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("stop() pauses the audio element", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    voice.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it("stop() seeks audio back to 0", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    audio.currentTime = 42;
    voice.stop();
    expect(audio.currentTime).toBe(0);
  });

  it("stop() fires the onended callback synchronously", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() does not throw when no onended callback is set", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("stop() fires onended exactly once — not again on natural end after stop", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    audio.simulateEnd(); // natural end after stop should be a no-op
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("natural audio end fires the onended callback", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) removes the callback — natural end is a no-op", () => {
    const audio = makeMockAudio();
    const voice = wrapStreamingElement(audio as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.setOnEnded(null);
    audio.simulateEnd();
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/lib/audio/audioVoice.test.ts
```

Expected: FAIL — `Cannot find module './audioVoice'`

- [ ] **Step 3: Create `src/lib/audio/audioVoice.ts`**

```typescript
/**
 * Shared abstraction over the two voice implementations:
 *   - AudioBufferSourceNode  (short files: fully decoded, cached in RAM)
 *   - HTMLAudioElement        (large files: browser-managed streaming)
 *
 * Both satisfy this interface so padPlayer and playbackStore can treat
 * them uniformly without knowing which path was taken.
 */
export interface AudioVoice {
  /** Begin playback. Always returns Promise<void> for consistent awaiting. */
  start(): Promise<void>;
  /** Stop playback immediately. For streaming voices, also fires any pending
   *  onended callback synchronously so retrigger chains can advance. */
  stop(): void;
  /** Register (or clear) the callback to run when playback ends. */
  setOnEnded(cb: (() => void) | null): void;
}

export function wrapBufferSource(source: AudioBufferSourceNode): AudioVoice {
  return {
    async start() {
      source.start();
    },
    stop() {
      try {
        source.stop();
      } catch {
        // Already ended — safe to ignore.
      }
    },
    setOnEnded(cb) {
      source.onended = cb;
    },
  };
}

export function wrapStreamingElement(audio: HTMLAudioElement): AudioVoice {
  // Kept outside the object literal so stop() can clear it before firing.
  let endedCb: (() => void) | null = null;

  return {
    start() {
      return audio.play();
    },
    stop() {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      const cb = endedCb;
      endedCb = null;
      cb?.(); // fire synchronously so "next" retrigger chains advance
    },
    setOnEnded(cb) {
      endedCb = cb;
      audio.onended = cb
        ? () => {
            endedCb = null;
            cb();
          }
        : null;
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/lib/audio/audioVoice.test.ts
```

Expected: all 14 tests pass.

---

## Task 2: `streamingCache.ts` — file size check + cache

**Files:**
- Create: `src/lib/audio/streamingCache.ts`
- Create: `src/lib/audio/streamingCache.test.ts`

- [ ] **Step 1: Write the failing tests** in `src/lib/audio/streamingCache.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkIsLargeFile, evictSizeCache, clearAllSizeCache, LARGE_FILE_THRESHOLD_BYTES } from "./streamingCache";
import { createMockSound } from "@/test/factories";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function headResponse(contentLength: number | null) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" && contentLength !== null
          ? String(contentLength)
          : null,
    },
  };
}

const SMALL = LARGE_FILE_THRESHOLD_BYTES - 1;
const LARGE = LARGE_FILE_THRESHOLD_BYTES;

describe("checkIsLargeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSizeCache();
  });

  it("returns false for a file below the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "small.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("returns true for a file at the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(LARGE));
    const sound = createMockSound({ filePath: "big.wav" });
    expect(await checkIsLargeFile(sound)).toBe(true);
  });

  it("returns true for a file above the threshold", async () => {
    mockFetch.mockResolvedValue(headResponse(LARGE + 1024));
    const sound = createMockSound({ filePath: "huge.wav" });
    expect(await checkIsLargeFile(sound)).toBe(true);
  });

  it("returns false when Content-Length header is absent", async () => {
    mockFetch.mockResolvedValue(headResponse(null));
    const sound = createMockSound({ filePath: "unknown.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("returns false when fetch throws (missing file, network error, etc.)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const sound = createMockSound({ filePath: "missing.mp3" });
    expect(await checkIsLargeFile(sound)).toBe(false);
  });

  it("returns false without fetching when sound has no filePath", async () => {
    const sound = createMockSound({ filePath: undefined });
    expect(await checkIsLargeFile(sound)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches the result — only one HEAD request per sound ID", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses a HEAD request (not GET)", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "HEAD" }),
    );
  });
});

describe("evictSizeCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSizeCache();
  });

  it("forces a re-fetch after eviction", async () => {
    mockFetch.mockResolvedValue(headResponse(SMALL));
    const sound = createMockSound({ filePath: "sound.mp3" });
    await checkIsLargeFile(sound);
    evictSizeCache(sound.id);
    await checkIsLargeFile(sound);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/lib/audio/streamingCache.test.ts
```

Expected: FAIL — `Cannot find module './streamingCache'`

- [ ] **Step 3: Create `src/lib/audio/streamingCache.ts`**

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Sound } from "@/lib/schemas";

/**
 * Compressed files at or above this size are routed to the HTMLAudioElement
 * streaming path instead of the AudioBuffer decode path.
 * 20 MB: at 128 kbps MP3 ≈ 20 minutes audio; a 20 MB WAV ≈ 55 s.
 */
export const LARGE_FILE_THRESHOLD_BYTES = 20 * 1024 * 1024;

/** Cache: sound.id → isLarge. Avoids a HEAD request on every trigger. */
const sizeCache = new Map<string, boolean>();

/**
 * Returns true when the sound's compressed file is at or above the 20 MB
 * threshold, meaning it should be played via the streaming path.
 *
 * Caches the result per sound ID. Returns false (safe fallback: buffer path)
 * when the file has no path, the fetch fails, or Content-Length is absent.
 */
export async function checkIsLargeFile(sound: Sound): Promise<boolean> {
  if (!sound.filePath) return false;
  if (sizeCache.has(sound.id)) return sizeCache.get(sound.id)!;

  const url = convertFileSrc(sound.filePath);
  let isLarge = false;
  try {
    const response = await fetch(url, { method: "HEAD" });
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null) {
      isLarge = parseInt(contentLength, 10) >= LARGE_FILE_THRESHOLD_BYTES;
    }
  } catch {
    // Network error or missing file — fall back to buffer path.
    // loadBuffer will surface a MissingFileError with a proper toast.
  }

  sizeCache.set(sound.id, isLarge);
  return isLarge;
}

/** Remove a single entry (e.g. after a sound file is replaced on disk). */
export function evictSizeCache(soundId: string): void {
  sizeCache.delete(soundId);
}

/** Clear the entire size cache. Call in tests (via beforeEach) and on app reset. */
export function clearAllSizeCache(): void {
  sizeCache.clear();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/lib/audio/streamingCache.test.ts
```

Expected: all 9 tests pass.

---

## Task 3: `playbackStore.ts` — change voice type to `AudioVoice`

**Files:**
- Modify: `src/state/playbackStore.ts`
- Modify: `src/state/playbackStore.test.ts`

The store's internal voice maps are typed as `AudioBufferSourceNode[]`. Change them to `AudioVoice[]` so streaming voices can be tracked and stopped identically.

- [ ] **Step 1: Update the test mocks in `src/state/playbackStore.test.ts`**

Every test that passes a raw `{} as AudioBufferSourceNode` or `{ stop: () => ... } as unknown as AudioBufferSourceNode` must be updated to satisfy the full `AudioVoice` interface (`start`, `stop`, `setOnEnded`).

Replace every mock voice in the file with the helper below and update all usages:

```typescript
// Add this helper near the top of the file, after imports:
function makeVoice(opts: { onStop?: () => void } = {}): import("@/lib/audio/audioVoice").AudioVoice {
  return {
    start: async () => {},
    stop: opts.onStop ?? (() => {}),
    setOnEnded: () => {},
  };
}
```

Then replace every occurrence of:
- `{} as AudioBufferSourceNode` → `makeVoice()`
- `({ stop: () => stopped.push(true) }) as unknown as AudioBufferSourceNode` → `makeVoice({ onStop: () => stopped.push(true) })`

The full updated `src/state/playbackStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { usePlaybackStore } from "./playbackStore";
import type { AudioVoice } from "@/lib/audio/audioVoice";

const initialState = {
  masterVolume: 100,
  playingPadIds: [],
  padVolumes: {},
};

function makeVoice(opts: { onStop?: () => void } = {}): AudioVoice {
  return {
    start: async () => {},
    stop: opts.onStop ?? (() => {}),
    setOnEnded: () => {},
  };
}

beforeEach(() => {
  usePlaybackStore.getState().stopAll();
  usePlaybackStore.setState({ ...initialState });
});

describe("layer voice tracking", () => {
  it("layer is not active with no voices", () => {
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer becomes active after recording a voice", () => {
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("layer becomes inactive after clearing its only voice", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", voice);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("layer stays active while other voices remain", () => {
    const v1 = makeVoice();
    const v2 = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", v1);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", v2);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", v1);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(true);
  });

  it("stopLayer stops all voices for a layer", () => {
    const stopped: boolean[] = [];
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice({ onStop: () => stopped.push(true) }));
    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");
    expect(stopped).toHaveLength(2);
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
  });

  it("stopLayer does not affect other layers on the same pad", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", voice);
    usePlaybackStore.getState().stopLayer("pad-1", "layer-1");
    expect(usePlaybackStore.getState().isLayerActive("layer-1")).toBe(false);
    expect(usePlaybackStore.getState().isLayerActive("layer-2")).toBe(true);
  });

  it("recording a layer voice also marks the pad as active", () => {
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", makeVoice());
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(true);
  });

  it("clearing the last layer voice for a pad marks pad inactive", () => {
    const voice = makeVoice();
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice);
    usePlaybackStore.getState().clearLayerVoice("pad-1", "layer-1", voice);
    expect(usePlaybackStore.getState().isPadActive("pad-1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail** (type mismatch — store still expects `AudioBufferSourceNode`)

```bash
npm run test:run -- src/state/playbackStore.test.ts
```

Expected: TypeScript compile errors about `AudioVoice` not matching `AudioBufferSourceNode`.

- [ ] **Step 3: Rewrite `src/state/playbackStore.ts`** with `AudioVoice` types

```typescript
import { create } from "zustand";
import type { AudioVoice } from "@/lib/audio/audioVoice";

// Module-level voice maps — AudioVoice objects are non-serializable,
// kept outside Zustand state to avoid proxy issues.
const voiceMap = new Map<string, AudioVoice[]>();
const layerVoiceMap = new Map<string, AudioVoice[]>();

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  playingPadIds: string[];

  // Per-pad runtime volume (0–1), mirrored from padGainMap for React reactivity
  padVolumes: Record<string, number>;
  updatePadVolume: (padId: string, volume: number) => void;

  // ── Pad-level voice tracking ──────────────────────────────────────────────
  isPadActive: (padId: string) => boolean;
  recordVoice: (padId: string, voice: AudioVoice) => void;
  clearVoice: (padId: string, voice: AudioVoice) => void;
  stopPad: (padId: string) => void;
  stopAll: () => void;

  // ── Layer-level voice tracking ────────────────────────────────────────────
  isLayerActive: (layerId: string) => boolean;
  /** Record a voice for both its layer and its pad. */
  recordLayerVoice: (padId: string, layerId: string, voice: AudioVoice) => void;
  /** Clear a voice from both its layer and its pad. */
  clearLayerVoice: (padId: string, layerId: string, voice: AudioVoice) => void;
  /** Stop all voices for a single layer without affecting other layers. */
  stopLayer: (padId: string, layerId: string) => void;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: [],
  padVolumes: {},

  updatePadVolume: (padId, volume) =>
    set((s) => ({ padVolumes: { ...s.padVolumes, [padId]: volume } })),

  // ── Pad-level ─────────────────────────────────────────────────────────────

  isPadActive: (padId) => (voiceMap.get(padId)?.length ?? 0) > 0,

  recordVoice: (padId, voice) => {
    voiceMap.set(padId, [...(voiceMap.get(padId) ?? []), voice]);
    set((s) =>
      s.playingPadIds.includes(padId)
        ? s
        : { playingPadIds: [...s.playingPadIds, padId] }
    );
  },

  clearVoice: (padId, voice) => {
    const updated = (voiceMap.get(padId) ?? []).filter((v) => v !== voice);
    if (updated.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, updated);
    }
  },

  stopPad: (padId) => {
    const voices = voiceMap.get(padId) ?? [];
    voiceMap.delete(padId);
    set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    for (const voice of voices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },

  stopAll: () => {
    const allVoices = [...voiceMap.values()].flat();
    voiceMap.clear();
    layerVoiceMap.clear();
    set({ playingPadIds: [] });
    for (const voice of allVoices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },

  // ── Layer-level ───────────────────────────────────────────────────────────

  isLayerActive: (layerId) => (layerVoiceMap.get(layerId)?.length ?? 0) > 0,

  recordLayerVoice: (padId, layerId, voice) => {
    layerVoiceMap.set(layerId, [...(layerVoiceMap.get(layerId) ?? []), voice]);
    get().recordVoice(padId, voice);
  },

  clearLayerVoice: (padId, layerId, voice) => {
    const updated = (layerVoiceMap.get(layerId) ?? []).filter((v) => v !== voice);
    if (updated.length === 0) {
      layerVoiceMap.delete(layerId);
    } else {
      layerVoiceMap.set(layerId, updated);
    }
    get().clearVoice(padId, voice);
  },

  stopLayer: (padId, layerId) => {
    const voices = layerVoiceMap.get(layerId) ?? [];
    const stoppedSet = new Set(voices);

    // Clean up maps BEFORE calling stop(), because wrapStreamingElement.stop()
    // fires onended synchronously, which calls clearLayerVoice. Cleaning up first
    // makes that a safe no-op rather than a double-removal.
    layerVoiceMap.delete(layerId);
    const padVoices = (voiceMap.get(padId) ?? []).filter((v) => !stoppedSet.has(v));
    if (padVoices.length === 0) {
      voiceMap.delete(padId);
      set((s) => ({ playingPadIds: s.playingPadIds.filter((id) => id !== padId) }));
    } else {
      voiceMap.set(padId, padVoices);
    }

    for (const voice of voices) {
      try { voice.stop(); } catch { /* already ended */ }
    }
  },
}));
```

**Key difference from original `stopLayer`:** Maps are cleared **before** `voice.stop()` is called. This prevents a double-removal bug when `wrapStreamingElement.stop()` fires `onended` synchronously, causing `clearLayerVoice` to run mid-iteration. The cleanup is idempotent so this is safe for both voice types.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/state/playbackStore.test.ts
```

Expected: all 8 tests pass.

---

## Task 4: `padPlayer.ts` — dual path in `startLayerSound`

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

- [ ] **Step 1: Add the `streamingCache` mock + streaming tests to `src/lib/audio/padPlayer.test.ts`**

At the top of the file, add a mock for `streamingCache` right after the existing mocks (after the `vi.mock("sonner", ...)` line):

```typescript
vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false), // default: small file → buffer path
  evictSizeCache: vi.fn(),
  clearAllSizeCache: vi.fn(),
}));
```

This keeps all existing tests on the buffer path unchanged.

Now add a new describe block at the **end** of the file (after the `"retrigger modes"` block):

```typescript
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
```

To support these tests, add the following setup to the **existing** `beforeEach` block and mock setup area:

```typescript
// Add to the mockCtx object (alongside createBufferSource and createGain):
mockCtx.createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));

// Add global Audio mock (add BEFORE the describe blocks, at module level):
const mockAudioInstances: Array<{
  src: string;
  currentTime: number;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  onended: ((ev: Event) => any) | null;
}> = [];

vi.stubGlobal("Audio", vi.fn().mockImplementation((src?: string) => {
  const instance = {
    src: src ?? "",
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    onended: null as ((ev: Event) => any) | null,
  };
  mockAudioInstances.push(instance);
  return instance;
}));
```

And in `beforeEach`, add:
```typescript
mockAudioInstances.length = 0;
(global.Audio as ReturnType<typeof vi.fn>).mockClear();
mockCtx.createMediaElementSource.mockClear();
```

- [ ] **Step 2: Run tests to confirm the new tests fail**

```bash
npm run test:run -- src/lib/audio/padPlayer.test.ts
```

Expected: the 4 new streaming tests FAIL (streaming path not implemented yet); all existing tests still pass.

- [ ] **Step 3: Rewrite `src/lib/audio/padPlayer.ts`**

```typescript
import { ensureResumed, getAudioContext, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { checkMissingStatus } from "@/lib/library.reconcile";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { toast } from "sonner";

// Per-pad GainNodes: source(s) → padGain → masterGain → destination
const padGainMap = new Map<string, GainNode>();

// Tracks the longest-duration voice per pad for playback progress display.
// Only updated on the buffer path (duration is unknown upfront for streaming).
const padProgressInfo = new Map<string, { startedAt: number; duration: number }>();

// Remaining sounds to auto-chain after the current one ends (sequential/shuffled).
// Keyed by layer ID. Deleted when the chain is broken (stop/restart) or exhausted.
const layerChainQueue = new Map<string, Sound[]>();

export function getPadProgress(padId: string): number | null {
  const info = padProgressInfo.get(padId);
  if (!info) return null;
  const elapsed = getAudioContext().currentTime - info.startedAt;
  return Math.min(1, Math.max(0, elapsed / info.duration));
}

export function getPadGain(padId: string): GainNode {
  const existing = padGainMap.get(padId);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  gain.connect(getMasterGain());
  padGainMap.set(padId, gain);
  return gain;
}

export function setPadVolume(padId: string, volume: number): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const clamped = Math.max(0, Math.min(1, volume));
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(clamped, ctx.currentTime + 0.016);
  usePlaybackStore.getState().updatePadVolume(padId, clamped);
}

export function resetPadGain(padId: string): void {
  const gain = padGainMap.get(padId);
  if (gain) {
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
  }
  usePlaybackStore.getState().updatePadVolume(padId, 1.0);
}

export function clearAllPadGains(): void {
  padGainMap.clear();
}

export function clearAllLayerChains(): void {
  layerChainQueue.clear();
}

function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  const soundById = new Map(sounds.map((s) => [s.id, s]));
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      return sounds.filter(
        (s) => sel.tagIds.some((tid) => s.tags.includes(tid)) && !!s.filePath
      );
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}

/**
 * Load and start a single sound for a layer.
 *
 * Routes to the streaming path (HTMLAudioElement) for large files (≥ 20 MB
 * compressed) and the buffer path (AudioBufferSourceNode) for small files.
 *
 * Sets up an onended handler that auto-chains to the next sound in
 * layerChainQueue (sequential/shuffled arrangement).
 */
async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  padGain: GainNode,
): Promise<void> {
  try {
    let voice: AudioVoice;

    if (await checkIsLargeFile(sound)) {
      // ── Streaming path (large files) ───────────────────────────────────────
      // HTMLAudioElement streams from disk; browser manages buffering.
      // No padProgressInfo update — duration is unknown until loadedmetadata fires.
      const url = convertFileSrc(sound.filePath!);
      const audio = new Audio(url);
      const sourceNode = ctx.createMediaElementSource(audio);
      sourceNode.connect(padGain);
      voice = wrapStreamingElement(audio);
    } else {
      // ── Buffer path (short files) ──────────────────────────────────────────
      // Fully decoded AudioBuffer: instant retrigger, simultaneous instances.
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(padGain);
      voice = wrapBufferSource(source);

      const existing = padProgressInfo.get(pad.id);
      if (!existing || buffer.duration > existing.duration) {
        padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration });
      }
    }

    voice.setOnEnded(() => {
      usePlaybackStore.getState().clearLayerVoice(pad.id, layer.id, voice);
      // Chain to the next sound if one is queued (sequential/shuffled)
      const remaining = layerChainQueue.get(layer.id);
      if (remaining && remaining.length > 0) {
        const [next, ...rest] = remaining;
        layerChainQueue.set(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, padGain);
      } else {
        layerChainQueue.delete(layer.id);
      }
    });

    await voice.start();
    usePlaybackStore.getState().recordLayerVoice(pad.id, layer.id, voice);

  } catch (err) {
    if (err instanceof MissingFileError) {
      const settings = useAppSettingsStore.getState().settings;
      if (settings) {
        const { sounds } = useLibraryStore.getState();
        checkMissingStatus(settings.globalFolders, sounds).then((result) => {
          useLibraryStore.getState().setMissingState(result.missingSoundIds, result.missingFolderIds);
        });
      }
      toast.error(`Failed to play "${sound.name}" — file not found. Check the Sounds panel.`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[padPlayer] Failed to play "${sound.name}":`, err);
      toast.error(`Failed to play "${sound.name}": ${message}`);
    }
  }
}

// startVolume: 0–1. Pass 0 for drag-up gestures (silent start), defaults to 1.
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();

  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  padProgressInfo.delete(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(pad.id, startVolume);

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    const store = usePlaybackStore.getState();
    const isLayerPlaying = store.isLayerActive(layer.id);

    // ── Retrigger handling ─────────────────────────────────────────────────
    switch (layer.retriggerMode) {
      case "stop":
        if (isLayerPlaying) {
          layerChainQueue.delete(layer.id);
          store.stopLayer(pad.id, layer.id);
          resetPadGain(pad.id);
          continue;
        }
        break;

      case "continue":
        if (isLayerPlaying) continue;
        break;

      case "restart":
        if (isLayerPlaying) {
          layerChainQueue.delete(layer.id);
          store.stopLayer(pad.id, layer.id);
        }
        break;

      case "next":
        if (isLayerPlaying) {
          // Don't delete queue — stopping fires onended (synchronously for
          // streaming, asynchronously for buffer), which advances the chain.
          store.stopLayer(pad.id, layer.id);
          continue;
        }
        break;
    }

    // ── Start playback ─────────────────────────────────────────────────────
    const playOrder = buildPlayOrder(layer.arrangement, resolved);

    if (isChained(layer.arrangement)) {
      const [first, ...rest] = playOrder;
      layerChainQueue.set(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, padGain);
    } else {
      layerChainQueue.delete(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, padGain);
      }
    }
  }
}
```

- [ ] **Step 4: Run all padPlayer tests**

```bash
npm run test:run -- src/lib/audio/padPlayer.test.ts
```

Expected: all tests pass (existing + 4 new streaming tests).

---

## Task 5: `preview.ts` — dual path for preview

**Files:**
- Modify: `src/lib/audio/preview.ts`

Preview must also route large files through `HTMLAudioElement` to avoid the double-decode OOM that was the original bug trigger.

- [ ] **Step 1: Rewrite `src/lib/audio/preview.ts`**

```typescript
import { ensureResumed, getMasterGain } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile } from "./streamingCache";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Sound } from "@/lib/schemas";

let currentSource: AudioBufferSourceNode | null = null;
let currentStreamingAudio: HTMLAudioElement | null = null;

export function stopPreview(): void {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  if (currentStreamingAudio) {
    currentStreamingAudio.pause();
    currentStreamingAudio.currentTime = 0;
    currentStreamingAudio = null;
  }
}

export async function playPreview(sound: Sound, onEnded?: () => void): Promise<void> {
  stopPreview();
  const ctx = await ensureResumed();

  if (await checkIsLargeFile(sound)) {
    // ── Streaming path ─────────────────────────────────────────────────────
    if (!sound.filePath) throw new MissingFileError(`Sound "${sound.name}" has no file path`);
    const url = convertFileSrc(sound.filePath);
    const audio = new Audio(url);
    const sourceNode = ctx.createMediaElementSource(audio);
    sourceNode.connect(getMasterGain());
    currentStreamingAudio = audio;
    audio.onended = () => {
      if (currentStreamingAudio === audio) currentStreamingAudio = null;
      onEnded?.();
    };
    await audio.play();
  } else {
    // ── Buffer path ────────────────────────────────────────────────────────
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(getMasterGain());
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      onEnded?.();
    };
    source.start();
    currentSource = source;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

---

## Task 6: Full test suite

**Files:** no new changes — verify everything green.

- [ ] **Step 1: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass. Count should be higher than before (new audioVoice + streamingCache tests added).

- [ ] **Step 2: Fix any failures**

Common failure patterns:

**`checkIsLargeFile` not mocked in existing padPlayer tests causing HEAD requests:**
The `vi.mock("./streamingCache", ...)` block added in Task 4 should prevent this. If it's missing, add it.

**`Audio is not defined` in buffer-path padPlayer tests:**
The `vi.stubGlobal("Audio", ...)` mock in Task 4 covers all tests in that file. If only the new streaming tests should use it, the stubGlobal is still harmless for buffer-path tests since `Audio` is never constructed on that path.

**TypeScript: `AudioVoice` interface not assignable to `AudioBufferSourceNode`:**
Any test file that still casts `{} as AudioBufferSourceNode` needs updating to `makeVoice()` (as done in Task 3 for `playbackStore.test.ts`).

**`createMediaElementSource` not on mockCtx:**
If the padPlayer test fails with `mockCtx.createMediaElementSource is not a function`, confirm it was added to `mockCtx` in the `beforeEach` setup in Task 4.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output (clean).

---

## Self-Review

**Spec coverage:**
- ✅ Large files (≥ 20 MB) routed to streaming path — `streamingCache.checkIsLargeFile` + branch in `startLayerSound`
- ✅ Short files keep the existing `AudioBuffer` path — default `checkIsLargeFile` returns `false`
- ✅ Size determined via `Content-Length` HEAD request — `streamingCache.ts`
- ✅ Result cached per sound ID — `sizeCache` Map in `streamingCache.ts`
- ✅ Streaming path uses `HTMLAudioElement` + `createMediaElementSource` — connects to `padGain` → `masterGain` (volume control preserved)
- ✅ All retrigger modes work for streaming — `wrapStreamingElement.stop()` fires `onended` synchronously to advance chains
- ✅ Sequential/shuffled arrangement works for streaming — `onended` chain mechanism unchanged
- ✅ Preview also routes large files to streaming — `preview.ts`
- ✅ `stopAll()` / `stopLayer()` work for both voice types — `AudioVoice.stop()` unified interface
- ✅ `playbackStore.stopLayer()` cleans maps before calling `stop()` — prevents double-removal with synchronous onended

**Placeholder scan:** No TBD, TODO, or incomplete steps found.

**Type consistency:**
- `AudioVoice` defined in Task 1, imported in Tasks 3, 4, 5 — consistent
- `checkIsLargeFile(sound: Sound)` defined in Task 2, called with `Sound` in Tasks 4, 5 — consistent
- `wrapBufferSource`, `wrapStreamingElement` defined in Task 1, imported in Task 4 — consistent
- `clearAllSizeCache` exported in Task 2, used in Task 2 tests — consistent
