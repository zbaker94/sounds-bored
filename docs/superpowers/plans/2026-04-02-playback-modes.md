# Playback Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `loop` and `hold` playback modes, add click-free stop ramps, and refactor the audio graph to `sourceNode → voiceGain → layerGain → padGain → masterGain`.

**Architecture:** Each `AudioVoice` owns a `voiceGain` node (initialized from `SoundInstance.volume`, or 1.0 for tag/set). Each active layer gets a `layerGain` node (from `layer.volume / 100`) stored in a module-level `layerGainMap` in `padPlayer.ts`. `stopWithRamp` ramps `voiceGain → 0` then stops the source — used for hold release, retrigger "stop", and `stopAllPads`. The "next" retrigger is redesigned to directly advance the chain rather than relying on `onended`.

**Tech Stack:** Web Audio API, Vitest, React hooks, Zustand

---

## File Map

| File | Change |
|---|---|
| `src/state/playbackStore.ts` | Add `getLayerVoices(layerId)` and `nullAllOnEnded()` |
| `src/lib/audio/audioVoice.ts` | Add `voiceGain`, `stopWithRamp`, `setVolume` to both wrappers |
| `src/lib/audio/audioVoice.test.ts` | Tests for new `AudioVoice` methods |
| `src/lib/audio/padPlayer.ts` | All engine changes: layerGainMap, loop mode, hold release, retrigger redesign, ramp stops |
| `src/lib/audio/padPlayer.test.ts` | Tests for all new engine behaviors |
| `src/hooks/usePadGesture.ts` | Trigger on pointerDown for hold layers; release on pointerUp |

---

## Task 1: playbackStore — add `getLayerVoices` and `nullAllOnEnded`

**Files:**
- Modify: `src/state/playbackStore.ts`

`padPlayer.ts` needs to null `onended` on layer voices before stopping them (to prevent chain restart callbacks from firing during ramps). These two methods expose that capability.

- [ ] **Step 1: Write the failing tests**

Add to `src/state/playbackStore.test.ts` (create if it doesn't exist, or find the existing test file):

```typescript
// At the top of the relevant describe block, after recordLayerVoice tests:

describe("getLayerVoices", () => {
  it("returns empty array for unknown layer", () => {
    expect(usePlaybackStore.getState().getLayerVoices("no-such-layer")).toEqual([]);
  });

  it("returns voices for a recorded layer", () => {
    const voice = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice as any);
    const voices = usePlaybackStore.getState().getLayerVoices("layer-1");
    expect(voices).toHaveLength(1);
    expect(voices[0]).toBe(voice);
  });
});

describe("nullAllOnEnded", () => {
  it("calls setOnEnded(null) on all recorded voices", () => {
    const voice1 = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    const voice2 = { start: vi.fn(), stop: vi.fn(), stopWithRamp: vi.fn(), setVolume: vi.fn(), setOnEnded: vi.fn() };
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-1", voice1 as any);
    usePlaybackStore.getState().recordLayerVoice("pad-1", "layer-2", voice2 as any);
    usePlaybackStore.getState().nullAllOnEnded();
    expect(voice1.setOnEnded).toHaveBeenCalledWith(null);
    expect(voice2.setOnEnded).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/state/playbackStore.test.ts
```

Expected: tests fail — `getLayerVoices` and `nullAllOnEnded` are not defined.

- [ ] **Step 3: Add the methods to `playbackStore.ts`**

In the `PlaybackState` interface (after `stopLayer`):

```typescript
/** Returns all active voices for a layer (read-only). Used by padPlayer for ramp-stop. */
getLayerVoices: (layerId: string) => readonly AudioVoice[];
/** Null all onended callbacks on all active voices. Prevents chain restarts during ramp. */
nullAllOnEnded: () => void;
```

In the `create` implementation (after `stopLayer`):

```typescript
getLayerVoices: (layerId) => layerVoiceMap.get(layerId) ?? [],

nullAllOnEnded: () => {
  for (const voices of voiceMap.values()) {
    for (const voice of voices) {
      voice.setOnEnded(null);
    }
  }
},
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/state/playbackStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/playbackStore.ts src/state/playbackStore.test.ts
git commit -m "feat(playback): add getLayerVoices and nullAllOnEnded to playbackStore"
```

---

## Task 2: `audioVoice.ts` — voiceGain, `stopWithRamp`, `setVolume`

**Files:**
- Modify: `src/lib/audio/audioVoice.ts`
- Modify: `src/lib/audio/audioVoice.test.ts`

Every voice now owns a `GainNode` inserted between the source and the downstream node. `stopWithRamp` ramps that gain to 0 before stopping the source. `setVolume` sets the gain directly.

> **Note on `SoundInstance.volume` scale:** `SoundInstance.volume` is 0–1 (the test factory uses `volume: 1` for 100%). Pass it directly as `initialVolume`. `layer.volume` is 0–100; divide by 100 before passing.

- [ ] **Step 1: Write failing tests**

Replace the contents of `src/lib/audio/audioVoice.test.ts` with the following (preserves all existing tests, adds new ones):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wrapBufferSource, wrapStreamingElement } from "./audioVoice";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockGain() {
  return {
    gain: {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function makeMockCtx() {
  const gain = makeMockGain();
  return {
    currentTime: 0,
    createGain: vi.fn(() => gain),
    _gain: gain,
  };
}

function makeMockDestination() {
  return { connect: vi.fn() };
}

function makeMockSource() {
  let endedCb: ((ev: Event) => any) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    loop: false,
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
    simulateEnd() { endedCb?.(new Event("ended")); },
  };
}

function makeMockSourceNode() {
  return { connect: vi.fn() };
}

// ── wrapBufferSource ──────────────────────────────────────────────────────────

describe("wrapBufferSource", () => {
  it("start() calls source.start()", async () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    await voice.start();
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stop() calls source.stop()", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    voice.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("stop() does not throw if source.stop() throws (already ended)", () => {
    const source = makeMockSource();
    source.stop.mockImplementation(() => { throw new Error("already ended"); });
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("setOnEnded wires callback to source.onended", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) clears callback", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    voice.setOnEnded(vi.fn());
    voice.setOnEnded(null);
    expect(source.onended).toBeNull();
  });

  it("stop() fires the onended callback synchronously", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() fires onended exactly once — Web Audio ended event after stop is ignored", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    source.onended?.(new Event("ended"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    source.onended?.(new Event("ended"));
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("creates a voiceGain and connects source → voiceGain → destination", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    wrapBufferSource(source as any, ctx as any, dest as any, 0.8);
    expect(ctx.createGain).toHaveBeenCalledOnce();
    expect(ctx._gain.gain.value).toBe(0.8);
    expect(source.connect).toHaveBeenCalledWith(ctx._gain);
    expect(ctx._gain.connect).toHaveBeenCalledWith(dest);
  });

  it("setVolume updates voiceGain.gain.value", () => {
    const source = makeMockSource();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
    voice.setVolume(0.5);
    expect(ctx._gain.gain.value).toBe(0.5);
  });

  describe("stopWithRamp", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("schedules a gain ramp to 0 then stops the source", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      voice.stopWithRamp(0.025);
      // Gain ramp scheduled
      expect(ctx._gain.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(ctx._gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.025);
      // Source not stopped yet
      expect(source.stop).not.toHaveBeenCalled();
      // After ramp completes
      vi.advanceTimersByTime(30);
      expect(source.stop).toHaveBeenCalledOnce();
    });

    it("fires onended callback after ramp", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("does not fire onended if setOnEnded(null) was called before ramp completes", () => {
      const source = makeMockSource();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapBufferSource(source as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      voice.setOnEnded(null); // null it before timeout fires
      vi.advanceTimersByTime(30);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});

// ── wrapStreamingElement ──────────────────────────────────────────────────────

describe("wrapStreamingElement", () => {
  it("start() calls audio.play()", async () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    await voice.start();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("stop() pauses the audio element", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    voice.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it("stop() seeks audio back to 0", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    audio.currentTime = 42;
    voice.stop();
    expect(audio.currentTime).toBe(0);
  });

  it("stop() fires the onended callback synchronously", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("stop() does not throw when no onended callback is set", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    expect(() => voice.stop()).not.toThrow();
  });

  it("stop() fires onended exactly once — not again on natural end after stop", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.stop();
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("natural audio end fires the onended callback", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    audio.simulateEnd();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("setOnEnded(null) removes the callback — natural end is a no-op", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb = vi.fn();
    voice.setOnEnded(cb);
    voice.setOnEnded(null);
    audio.simulateEnd();
    expect(cb).not.toHaveBeenCalled();
  });

  it("setOnEnded can be re-registered — only the new callback fires", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any);
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    voice.setOnEnded(cb1);
    voice.setOnEnded(cb2);
    audio.simulateEnd();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("creates a voiceGain and connects sourceNode → voiceGain → destination", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 0.7);
    expect(ctx.createGain).toHaveBeenCalledOnce();
    expect(ctx._gain.gain.value).toBe(0.7);
    expect(sourceNode.connect).toHaveBeenCalledWith(ctx._gain);
    expect(ctx._gain.connect).toHaveBeenCalledWith(dest);
  });

  it("setVolume updates voiceGain.gain.value", () => {
    const audio = makeMockAudio();
    const sourceNode = makeMockSourceNode();
    const ctx = makeMockCtx();
    const dest = makeMockDestination();
    const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
    voice.setVolume(0.3);
    expect(ctx._gain.gain.value).toBe(0.3);
  });

  describe("stopWithRamp", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("schedules a gain ramp to 0 then pauses and resets audio", () => {
      const audio = makeMockAudio();
      const sourceNode = makeMockSourceNode();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
      voice.stopWithRamp(0.025);
      expect(ctx._gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.025);
      expect(audio.pause).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.currentTime).toBe(0);
    });

    it("fires onended callback after ramp", () => {
      const audio = makeMockAudio();
      const sourceNode = makeMockSourceNode();
      const ctx = makeMockCtx();
      const dest = makeMockDestination();
      const voice = wrapStreamingElement(audio as any, sourceNode as any, ctx as any, dest as any, 1.0);
      const cb = vi.fn();
      voice.setOnEnded(cb);
      voice.stopWithRamp(0.025);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(cb).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/audio/audioVoice.test.ts
```

Expected: many failures — new test helpers expect `ctx` and `sourceNode` params, `stopWithRamp` and `setVolume` don't exist yet.

- [ ] **Step 3: Implement the updated `audioVoice.ts`**

Replace the full contents of `src/lib/audio/audioVoice.ts`:

```typescript
const STOP_RAMP_S = 0.025;

export interface AudioVoice {
  start(): Promise<void>;
  /** Hard/immediate stop. Fires onended synchronously. */
  stop(): void;
  /** Ramp voiceGain → 0 over rampS seconds, then stop. Fires onended async. */
  stopWithRamp(rampS?: number): void;
  /** Set voiceGain directly (0–1). */
  setVolume(v: number): void;
  setOnEnded(cb: (() => void) | null): void;
}

export function wrapBufferSource(
  source: AudioBufferSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = initialVolume;
  source.connect(voiceGain);
  voiceGain.connect(destination);

  let endedCb: (() => void) | null = null;

  return {
    start() {
      source.start();
      return Promise.resolve();
    },
    stop() {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      const cb = endedCb;
      endedCb = null;
      cb?.();
    },
    stopWithRamp(rampS = STOP_RAMP_S) {
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, ctx.currentTime);
      voiceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rampS);
      setTimeout(() => {
        source.onended = null;
        try { source.stop(); } catch { /* already ended */ }
        const cb = endedCb;
        endedCb = null;
        cb?.();
      }, rampS * 1000 + 5);
    },
    setVolume(v) {
      voiceGain.gain.value = v;
    },
    setOnEnded(cb) {
      endedCb = cb;
      source.onended = cb
        ? () => { endedCb = null; cb(); }
        : null;
    },
  };
}

export function wrapStreamingElement(
  audio: HTMLAudioElement,
  sourceNode: MediaElementAudioSourceNode,
  ctx: AudioContext,
  destination: AudioNode,
  initialVolume = 1.0,
): AudioVoice {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = initialVolume;
  sourceNode.connect(voiceGain);
  voiceGain.connect(destination);

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
      cb?.();
    },
    stopWithRamp(rampS = STOP_RAMP_S) {
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.setValueAtTime(voiceGain.gain.value, ctx.currentTime);
      voiceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + rampS);
      setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.onended = null;
        const cb = endedCb;
        endedCb = null;
        cb?.();
      }, rampS * 1000 + 5);
    },
    setVolume(v) {
      voiceGain.gain.value = v;
    },
    setOnEnded(cb) {
      endedCb = cb;
      audio.onended = cb
        ? () => { endedCb = null; cb(); }
        : null;
    },
  };
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
npx vitest run src/lib/audio/audioVoice.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/audioVoice.ts src/lib/audio/audioVoice.test.ts
git commit -m "feat(audio): add voiceGain, stopWithRamp, and setVolume to AudioVoice wrappers"
```

---

## Task 3: `padPlayer.ts` — audio graph refactor (layerGainMap + voiceGain wiring)

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

Wire `voiceGain` and `layerGain` into the audio graph. Update `startLayerSound` signature to accept `layerGain`, `voiceVolume`, and `allSounds`. Update `triggerPad` to create layer gains and compute per-voice volumes.

This task only changes the graph wiring — no loop or hold behavior yet.

- [ ] **Step 1: Update `beforeEach` in `padPlayer.test.ts` so each `createGain` call returns a fresh mock**

Change this line in `beforeEach`:
```typescript
mockCtx.createGain.mockReturnValue(makeMockGain());
```
to:
```typescript
mockCtx.createGain.mockImplementation(() => makeMockGain());
```

This prevents multiple gain nodes (padGain, layerGain, voiceGain) from sharing the same mock object.

- [ ] **Step 2: Write failing tests for voiceGain initialization**

Add to `padPlayer.test.ts` in the `simultaneous arrangement` describe block:

```typescript
it("initializes voiceGain from SoundInstance.volume (0-1) for assigned selection", async () => {
  const { triggerPad } = await import("./padPlayer");
  const sound = createMockSound({ filePath: "a.wav" });
  setSounds([sound]);

  const layer = createMockLayer({
    arrangement: "simultaneous",
    selection: { type: "assigned", instances: [{ id: sound.id, soundId: sound.id, volume: 0.6 }] },
  });
  const pad = createMockPad({ layers: [layer] });

  await triggerPad(pad);
  await tick();

  // createGain is called for padGain (1×), layerGain (1×), voiceGain (1×) = 3 total
  expect(mockCtx.createGain).toHaveBeenCalledTimes(3);
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

  // Gains created in order: padGain, layerGain, voiceGain
  // layerGain is gains[1], initialized to layer.volume / 100 = 0.8
  expect(gains[1].gain.value).toBe(0.8);
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts
```

Expected: the two new tests fail (createGain call count is 1, not 3).

- [ ] **Step 4: Implement audio graph refactor in `padPlayer.ts`**

Add after `padGainMap`:

```typescript
// Keyed by layer ID. One GainNode per active layer, connects to its padGain.
const layerGainMap = new Map<string, GainNode>();
```

Add these helpers before `resolveSounds`:

```typescript
function getOrCreateLayerGain(layer: Layer, padGain: GainNode): GainNode {
  const existing = layerGainMap.get(layer.id);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = layer.volume / 100;
  gain.connect(padGain);
  layerGainMap.set(layer.id, gain);
  return gain;
}

/** Returns the 0–1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads from SoundInstance.volume (already 0–1).
 *  For "tag"/"set" selections, defaults to 1.0 (no per-sound config yet). */
function getVoiceVolume(layer: Layer, sound: Sound): number {
  if (layer.selection.type === "assigned") {
    const inst = layer.selection.instances.find((i) => i.soundId === sound.id);
    return inst ? inst.volume : 1.0;
  }
  return 1.0;
}
```

Update `clearAllPadGains` to also clear `layerGainMap` and add a dedicated export:

```typescript
export function clearAllPadGains(): void {
  padGainMap.clear();
}

export function clearAllLayerGains(): void {
  layerGainMap.clear();
}
```

Update `stopAllPads` to clear `layerGainMap`:

```typescript
export function stopAllPads(): void {
  clearAllLayerChains();
  clearAllLayerGains();
  clearAllPadGains();
  padStreamingAudio.clear();
  padProgressInfo.clear();
  usePlaybackStore.getState().stopAll();
}
```

Update `startLayerSound` signature and body. Replace the full function:

```typescript
async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  allSounds: Sound[],
): Promise<void> {
  try {
    let voice: AudioVoice;
    let audio: HTMLAudioElement | null = null;

    if (await checkIsLargeFile(sound)) {
      const url = convertFileSrc(sound.filePath!);
      audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = url;
      const sourceNode = ctx.createMediaElementSource(audio);
      voice = wrapStreamingElement(audio, sourceNode, ctx, layerGain, voiceVolume);
      padStreamingAudio.set(pad.id, audio);
    } else {
      const buffer = await loadBuffer(sound);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);

      const existing = padProgressInfo.get(pad.id);
      if (!existing || buffer.duration > existing.duration) {
        padProgressInfo.set(pad.id, { startedAt: ctx.currentTime, duration: buffer.duration });
      }
    }

    voice.setOnEnded(() => {
      if (audio && padStreamingAudio.get(pad.id) === audio) padStreamingAudio.delete(pad.id);
      usePlaybackStore.getState().clearLayerVoice(pad.id, layer.id, voice);
      const remaining = layerChainQueue.get(layer.id);
      if (remaining && remaining.length > 0) {
        const [next, ...rest] = remaining;
        layerChainQueue.set(layer.id, rest);
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds);
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
```

Update `triggerPad` to use `layerGain` and `getVoiceVolume`. Replace the section from `for (const layer of pad.layers) {` onward:

```typescript
  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    const store = usePlaybackStore.getState();
    const isLayerPlaying = store.isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer, padGain);

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
          layerChainQueue.delete(layer.id);
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
      await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
    } else {
      layerChainQueue.delete(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      }
    }
  }
}
```

- [ ] **Step 5: Run all audio tests to verify no regressions**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts src/lib/audio/audioVoice.test.ts
```

Expected: all tests pass (including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat(audio): add layerGainMap and voiceGain — refactor audio graph to sourceNode→voiceGain→layerGain→padGain"
```

---

## Task 4: `padPlayer.ts` — loop mode

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

For `simultaneous` + `loop`/`hold`: set `source.loop = true` so the browser loops indefinitely.  
For `sequential`/`shuffled` + `loop`/`hold`: when `onended` fires and the queue is exhausted, rebuild the play order and restart.

- [ ] **Step 1: Write failing tests**

Add a new describe block to `padPlayer.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts -t "loop playback mode"
```

Expected: all 4 fail — `source.loop` stays false, chain does not restart.

- [ ] **Step 3: Implement loop mode in `padPlayer.ts`**

In `startLayerSound`, in the buffer path, after `source.buffer = buffer;` add:

```typescript
if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && !isChained(layer.arrangement)) {
  source.loop = true;
}
```

In the streaming path, after `audio.src = url;` add:

```typescript
if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && !isChained(layer.arrangement)) {
  audio.loop = true;
}
```

In `voice.setOnEnded(...)`, update the chain-exhausted branch. Replace:

```typescript
} else {
  layerChainQueue.delete(layer.id);
}
```

with:

```typescript
} else if (
  (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
  isChained(layer.arrangement)
) {
  // Chain exhausted — rebuild and restart (loop/hold both loop while running)
  const newOrder = buildPlayOrder(layer.arrangement, allSounds);
  const [first, ...rest] = newOrder;
  layerChainQueue.set(layer.id, rest);
  startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), allSounds);
} else {
  layerChainQueue.delete(layer.id);
}
```

- [ ] **Step 4: Run to verify loop tests pass, no regressions**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat(audio): implement loop playback mode — source.loop for simultaneous, chain restart for sequential/shuffled"
```

---

## Task 5: `padPlayer.ts` — `stopLayerWithRamp` + retrigger "stop" ramp

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

Add a helper `stopLayerWithRamp(pad, layer)` that nulls `onended`, calls `voice.stopWithRamp()`, and cleans up playbackStore state after the ramp. Use it for retrigger "stop".

- [ ] **Step 1: Write failing tests**

Add to `padPlayer.test.ts`:

```typescript
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
    await tick();
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
    await tick();

    await triggerPad(pad);
    vi.advanceTimersByTime(35);

    expect(usePlaybackStore.getState().playingPadIds).not.toContain(pad.id);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts -t "retrigger stop"
```

Expected: fail — source is stopped synchronously (hard stop), not after ramp.

- [ ] **Step 3: Add `stopLayerWithRamp` to `padPlayer.ts` and update retrigger "stop"**

Add this function before `triggerPad`:

```typescript
const STOP_RAMP_S = 0.025;

function stopLayerWithRamp(pad: Pad, layer: Layer): void {
  const store = usePlaybackStore.getState();
  const voices = [...store.getLayerVoices(layer.id)];
  if (voices.length === 0) return;

  // Null onended first — prevents chain restart during ramp window
  for (const v of voices) v.setOnEnded(null);
  // Ramp each voice's voiceGain to 0
  for (const v of voices) v.stopWithRamp(STOP_RAMP_S);

  // Clean up playbackStore state after ramp, reset layerGain
  setTimeout(() => {
    store.stopLayer(pad.id, layer.id);
    const gain = layerGainMap.get(layer.id);
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(layer.volume / 100, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
}
```

Update the retrigger `"stop"` case in `triggerPad`. Replace:

```typescript
case "stop":
  if (isLayerPlaying) {
    layerChainQueue.delete(layer.id);
    store.stopLayer(pad.id, layer.id);
    resetPadGain(pad.id);
    continue;
  }
  break;
```

with:

```typescript
case "stop":
  if (isLayerPlaying) {
    layerChainQueue.delete(layer.id);
    stopLayerWithRamp(pad, layer);
    continue;
  }
  break;
```

- [ ] **Step 4: Run to verify all tests pass**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat(audio): ramp-stop on retrigger 'stop' — click-free via stopLayerWithRamp"
```

---

## Task 6: `padPlayer.ts` — retrigger "next" redesign

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

Remove the `onended`-based chain advance. Instead, null `onended` on current voices, stop them hard, then directly start the next sound from the queue (or loop-restart if the queue is exhausted and the layer is loop/hold mode).

- [ ] **Step 1: Write failing tests**

Add to `padPlayer.test.ts`:

```typescript
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

    expect(usePlaybackStore.getState().playingPadIds).not.toContain(pad.id);
    expect(mockLoadBuffer).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts -t "retrigger next"
```

Expected: "advances to next sound" fails — currently "next" triggers via `onended` from `stop()`, but with the new voice wrapping the `onended` behavior has changed.

- [ ] **Step 3: Redesign retrigger "next" in `padPlayer.ts`**

Replace the `"next"` case in `triggerPad`:

```typescript
case "next":
  if (isLayerPlaying) {
    // Capture queue before clearing it
    const remaining = [...(layerChainQueue.get(layer.id) ?? [])];
    // Null onended to prevent the chain-advance callback from firing during stop
    for (const v of store.getLayerVoices(layer.id)) v.setOnEnded(null);
    layerChainQueue.delete(layer.id);
    store.stopLayer(pad.id, layer.id);

    if (remaining.length > 0) {
      // Advance to next sound in chain
      const [next, ...rest] = remaining;
      layerChainQueue.set(layer.id, rest);
      await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
    } else if (layer.playbackMode === "loop" || layer.playbackMode === "hold") {
      // Chain exhausted — loop back to beginning
      const newOrder = buildPlayOrder(layer.arrangement, resolved);
      const [first, ...rest] = newOrder;
      layerChainQueue.set(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
    }
    // one-shot: queue exhausted → just stop (already done above)
    continue;
  }
  break;
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat(audio): redesign retrigger 'next' — direct chain advance without onended dependency"
```

---

## Task 7: `padPlayer.ts` — `stopAllPads` ramp + `releasePadHoldLayers`

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

`stopAllPads` ramps all pad gains to 0 before stopping voices. `releasePadHoldLayers` exports a function used by `usePadGesture` to stop hold-mode layers on pointer release.

- [ ] **Step 1: Write failing tests**

Add to `padPlayer.test.ts`:

```typescript
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
    await tick();
    expect(createdSources).toHaveLength(1);

    stopAllPads();
    // Source not yet stopped — ramp in progress
    expect(createdSources[0].stop).not.toHaveBeenCalled();
    const padGain = getPadGain(pad.id);
    expect(padGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));

    vi.advanceTimersByTime(35);
    expect(usePlaybackStore.getState().playingPadIds).not.toContain(pad.id);
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
    await tick();
    expect(createdSources).toHaveLength(2);

    releasePadHoldLayers(pad);
    vi.advanceTimersByTime(35);

    // playbackStore should have cleared the hold layer's voice but not the one-shot's
    expect(usePlaybackStore.getState().isLayerActive(oneShotLayer.id)).toBe(true);
    expect(usePlaybackStore.getState().isLayerActive(holdLayer.id)).toBe(false);
  });

  it("clears the chain queue for hold layers on release", async () => {
    const { triggerPad, releasePadHoldLayers, clearAllLayerChains } = await import("./padPlayer");
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
    await tick();

    // A is playing, B is queued — release should clear queue and stop
    releasePadHoldLayers(pad);
    vi.advanceTimersByTime(35);

    // After release, B should NOT start (queue was cleared)
    expect(mockLoadBuffer).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts -t "stopAllPads — ramped|releasePadHoldLayers"
```

Expected: fail — `stopAllPads` hard-stops synchronously, `releasePadHoldLayers` doesn't exist.

- [ ] **Step 3: Update `stopAllPads` with ramp and add `releasePadHoldLayers`**

Replace `stopAllPads` in `padPlayer.ts`:

```typescript
export function stopAllPads(): void {
  clearAllLayerChains();
  // Null all onended callbacks — prevents loop restarts during ramp window
  usePlaybackStore.getState().nullAllOnEnded();

  const ctx = getAudioContext();
  for (const gain of padGainMap.values()) {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + STOP_RAMP_S);
  }
  setTimeout(() => {
    padStreamingAudio.clear();
    padProgressInfo.clear();
    clearAllLayerGains();
    clearAllPadGains();
    usePlaybackStore.getState().stopAll();
  }, STOP_RAMP_S * 1000 + 5);
}
```

Add `releasePadHoldLayers` as an export after `stopAllPads`:

```typescript
export function releasePadHoldLayers(pad: Pad): void {
  const store = usePlaybackStore.getState();
  for (const layer of pad.layers) {
    if (layer.playbackMode !== "hold") continue;

    // Clear chain queue first — prevents onended from restarting the chain
    layerChainQueue.delete(layer.id);

    const voices = [...store.getLayerVoices(layer.id)];
    if (voices.length === 0) continue;

    // Null onended before stopping
    for (const v of voices) v.setOnEnded(null);
    // Ramp voiceGains to 0
    for (const v of voices) v.stopWithRamp(STOP_RAMP_S);

    // Clean up playbackStore + reset layerGain after ramp
    const gain = layerGainMap.get(layer.id);
    const padId = pad.id;
    const layerId = layer.id;
    const resetValue = layer.volume / 100;
    setTimeout(() => {
      store.stopLayer(padId, layerId);
      if (gain) {
        const ctx = getAudioContext();
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(resetValue, ctx.currentTime);
      }
    }, STOP_RAMP_S * 1000 + 5);
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat(audio): ramp stopAllPads and add releasePadHoldLayers for hold mode"
```

---

## Task 8: `usePadGesture.ts` — hold mode trigger/release

**Files:**
- Modify: `src/hooks/usePadGesture.ts`

If any layer on the pad has `playbackMode === 'hold'`, trigger on `pointerDown` instead of `pointerUp`, and call `releasePadHoldLayers` on `pointerUp`.

- [ ] **Step 1: Update `usePadGesture.ts`**

There are no existing tests for `usePadGesture` — testing React hooks that use pointer events is complex and out of scope for this plan. Verify manually in the app after implementing.

Replace `src/hooks/usePadGesture.ts` with:

```typescript
import { useRef, useState } from "react";
import type React from "react";
import type { Pad } from "@/lib/schemas";
import { triggerPad, setPadVolume, resetPadGain, releasePadHoldLayers } from "@/lib/audio/padPlayer";
import { usePlaybackStore } from "@/state/playbackStore";

// Gesture thresholds
const HOLD_MS = 150;        // time before a press becomes a "hold"
const DRAG_PX = 4;          // vertical pixels before drag mode activates
const DRAG_RANGE_PX = 200;  // pixels of travel for full 0→1 volume range

type Phase = "idle" | "down" | "hold" | "drag";

interface GestureState {
  startY: number;
  startTime: number;
  phase: Phase;
  wasPlayingAtStart: boolean;
  startVolume: number;
  currentVolume: number;
}

export function usePadGesture(pad: Pad) {
  const hasHoldLayer = pad.layers.some((l) => l.playbackMode === "hold");

  const state = useRef<GestureState>({
    startY: 0,
    startTime: 0,
    phase: "idle",
    wasPlayingAtStart: false,
    startVolume: 1.0,
    currentVolume: 1.0,
  });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fillVolume, setFillVolume] = useState<number | null>(null);

  function clearHoldTimer() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clearHoldTimer();

    const s = state.current;
    s.startY = e.clientY;
    s.startTime = Date.now();
    s.phase = "down";
    s.wasPlayingAtStart = usePlaybackStore.getState().isPadActive(pad.id);

    // Hold-mode pads trigger immediately on press (not on release)
    if (hasHoldLayer) {
      triggerPad(pad, 1.0);
    }

    holdTimer.current = setTimeout(() => {
      const s = state.current;
      if (s.phase !== "down") return;
      s.phase = "hold";

      const vol = s.wasPlayingAtStart
        ? (usePlaybackStore.getState().padVolumes[pad.id] ?? 1.0)
        : 0;
      s.startVolume = vol;
      s.currentVolume = vol;
      setFillVolume(vol);
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = state.current;
    if (s.phase === "idle" || s.phase === "down") return;

    const deltaY = s.startY - e.clientY; // positive = dragged up

    if (s.phase === "hold" && Math.abs(deltaY) > DRAG_PX) {
      s.phase = "drag";

      if (deltaY > 0 && !s.wasPlayingAtStart) {
        triggerPad(pad, 0);
      }
    }

    if (s.phase === "drag") {
      const newVolume = Math.max(0, Math.min(1, s.startVolume + deltaY / DRAG_RANGE_PX));
      s.currentVolume = newVolume;

      if (newVolume > 0.01 && !usePlaybackStore.getState().isPadActive(pad.id)) {
        triggerPad(pad, 0);
      }

      setPadVolume(pad.id, newVolume);
      setFillVolume(newVolume);
    }
  }

  function onPointerUp(_e: React.PointerEvent<HTMLButtonElement>) {
    clearHoldTimer();
    const s = state.current;

    if (s.phase === "down") {
      // Normal tap — only trigger if not a hold-mode pad (those triggered on down)
      if (!hasHoldLayer) triggerPad(pad, 1.0);
    } else if (s.phase === "hold") {
      if (!hasHoldLayer) triggerPad(pad, 1.0);
    } else if (s.phase === "drag") {
      if (s.currentVolume < 0.01) {
        usePlaybackStore.getState().stopPad(pad.id);
        resetPadGain(pad.id);
      }
    }

    // Release hold-mode layers on pointer up (regardless of gesture phase)
    if (hasHoldLayer) {
      releasePadHoldLayers(pad);
    }

    setFillVolume(null);
    s.phase = "idle";
  }

  function onContextMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
  }

  return {
    gestureHandlers: { onPointerDown, onPointerMove, onPointerUp, onContextMenu },
    fillVolume,
  };
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Manual smoke test**

Start the app with `npm run tauri dev`. Create a pad with:
- One layer, `playbackMode: hold`, `arrangement: sequential`, two sounds
- Verify: pressing holds plays sound A, releasing stops it (with audible fade)
- Verify: holding long enough that sound A ends → sound B starts automatically → release stops it
- Create a second pad with `playbackMode: loop` → verify it loops indefinitely
- Hit the stop-all control → verify all pads fade out cleanly (no click)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePadGesture.ts
git commit -m "feat(gesture): trigger hold-mode pads on pointer down, release on pointer up"
```

---

## Self-Review Checklist

After writing this plan, checking against the spec:

| Spec requirement | Task |
|---|---|
| `sourceNode → voiceGain → layerGain → padGain → masterGain` | Task 2, Task 3 |
| `voiceGain` initialized from `SoundInstance.volume` (assigned) or 1.0 (tag/set) | Task 3 (`getVoiceVolume`) |
| `layerGain` initialized from `layer.volume / 100` | Task 3 (`getOrCreateLayerGain`) |
| `allSounds` passed to `startLayerSound` for all arrangement types | Task 3 |
| `stopWithRamp` method on `AudioVoice` | Task 2 |
| Hard stop preserved for retrigger restart | Task 3 (no change to restart case) |
| `simultaneous` + `loop`/`hold`: `source.loop = true` | Task 4 |
| `sequential/shuffled` + `loop`/`hold`: chain restart on exhaustion | Task 4 |
| Retrigger "stop" uses ramp | Task 5 |
| Retrigger "next" redesigned — direct advance, no onended dependency | Task 6 |
| `next` + loop/hold: wrap to beginning when queue exhausted | Task 6 |
| `stopAllPads` ramps pad gains | Task 7 |
| `releasePadHoldLayers` — ramp-stop hold layers, clear chain queue | Task 7 |
| Hold mode: trigger on pointerDown, release on pointerUp | Task 8 |
| `playbackStore.getLayerVoices` + `nullAllOnEnded` | Task 1 |
