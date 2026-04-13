# padPlayer.ts Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `padPlayer.ts` from 1,149 lines into focused modules, eliminating the 3 remaining structural problems: oversized fade/gain functions, the `triggerPad`/`triggerLayer` retrigger switch-case duplication, and the mixed-concern `startLayerSound` function.

**Architecture:** State is already cleanly extracted in `audioState.ts`. This plan moves orchestration logic into four purpose-built modules. `gainManager.ts` owns volume/gain control. `fadeMixer.ts` owns pure fade scheduling. `layerTrigger.ts` owns layer sound loading, retrigger logic, and the start-playback helper used by both `triggerPad` and `triggerLayer`. `padPlayer.ts` becomes a thin orchestrator importing from all three. No circular dependencies anywhere.

**Tech Stack:** TypeScript (strict), Vitest, Web Audio API, Zustand stores (`playbackStore`, `projectStore`, `libraryStore`)

---

## Audit Findings — What Is Actually Wrong

The original issue was written before `audioState.ts` existed. Now the remaining problems are:

### Problem 1: Fade/gain functions mixed into padPlayer.ts (~107 lines)
`freezePadAtCurrentVolume`, `resolveFadeDuration`, `fadePadOut`, `fadePadInFromCurrent`, `setPadVolume`, `resetPadGain`, `syncLayerVolume`, `setLayerVolume`, `commitLayerVolume` are all independent of core playback logic. → **Fix: `fadeMixer.ts` + `gainManager.ts`**

### Problem 2: `triggerPad` and `triggerLayer` duplicate the same retrigger switch-case (~150 lines of duplication)
The `stop`/`continue`/`restart`/`next` switch in `triggerPad` (lines 704–783) is nearly identical to the one in `triggerLayer` (lines 867–935). A bug fix in one must be manually applied to the other. Comment at line 866 literally says *"(same logic as triggerPad per-layer section)"*. → **Fix: extract `applyRetriggerMode()` helper into `layerTrigger.ts`**

### Problem 3: `triggerPad` and `triggerLayer` duplicate the start-playback section (~74 lines of duplication)
The cycleMode / chained / simultaneous playback dispatch block (triggerPad lines 785–825, triggerLayer lines 937–968) is nearly identical. → **Fix: extract `startLayerPlayback()` helper into `layerTrigger.ts`**

### Problem 4: `startLayerSound` mixes voice creation with lifecycle management (130 lines)
The streaming-vs-buffer routing (lines 533–566) is tangled with the `onended` chain-continuation callback (lines 568–625). → **Fix: extract `loadLayerVoice()` into `layerTrigger.ts`, keeping `startLayerSound` for lifecycle only**

### What is NOT changing (explicitly scoped out)
- `progressTracker.ts` — progress state + accessors are already clean in `audioState.ts`
- `PadPlaybackState` object — the Map-based approach in `audioState.ts` is well-organized; restructuring it would require a 3,558-line test rewrite for minimal benefit
- `layerChain.ts` as originally proposed — the chain state is already in `audioState.ts`; what remains is the `startLayerSound` onended closure which is handled by `loadLayerVoice` extraction instead

---

## Circular Dependency Map

```
gainManager.ts   → audioState, audioContext, playbackStore, projectStore
fadeMixer.ts     → audioState, audioContext, gainManager
layerTrigger.ts  → audioState, audioContext, audioVoice, streamingCache, bufferCache,
                   audioTick, arrangement, resolveSounds, libraryStore, appSettingsStore,
                   library.reconcile, schemas, sonner
padPlayer.ts     → fadeMixer, gainManager, layerTrigger, audioState, audioContext,
                   audioTick, schemas, libraryStore, playbackStore, projectStore,
                   padUtils, sonner
```

**Neither `fadeMixer.ts`, `gainManager.ts`, nor `layerTrigger.ts` import from `padPlayer.ts`. Zero circular dependencies.**

---

## Backward Compatibility Strategy

All existing `import { X } from "@/lib/audio/padPlayer"` calls work unchanged.
`padPlayer.ts` re-exports everything it moves out:
```typescript
export { fadePadOut, fadePadInFromCurrent, freezePadAtCurrentVolume, resolveFadeDuration } from "./fadeMixer";
export { setPadVolume, resetPadGain, syncLayerVolume, setLayerVolume, commitLayerVolume } from "./gainManager";
// startLayerSound, resolveSounds, getVoiceVolume, liveLayerField are internal — not re-exported
```

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/audio/gainManager.ts` | Volume/gain control for pads and layers |
| Create | `src/lib/audio/gainManager.test.ts` | Unit tests for gainManager |
| Create | `src/lib/audio/fadeMixer.ts` | Pure fade scheduling (no padPlayer deps) |
| Create | `src/lib/audio/fadeMixer.test.ts` | Unit tests for fadeMixer |
| Create | `src/lib/audio/layerTrigger.ts` | Voice loading, retrigger logic, start-playback helper |
| Create | `src/lib/audio/layerTrigger.test.ts` | Tests for extracted helpers |
| Modify | `src/lib/audio/audioState.ts` | Add `clearAllAudioState()` |
| Modify | `src/lib/audio/audioState.test.ts` | Add test for `clearAllAudioState()` |
| Modify | `src/lib/audio/padPlayer.ts` | Remove moved functions, add imports/re-exports, slim triggerPad/triggerLayer |
| Modify | `src/components/screens/main/MainPage.tsx` | Call `clearAllAudioState()` on unmount |

**Expected padPlayer.ts size after all tasks: ~540 lines (down from 1,149)**

---

## Task 1: Create `gainManager.ts`

**Files:**
- Create: `src/lib/audio/gainManager.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/audio/gainManager.ts
import { getAudioContext } from "./audioContext";
import { getPadGain, getLayerGain, cancelPadFade } from "./audioState";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore } from "@/state/projectStore";

/**
 * Set the live volume for a pad's gain node with a short ramp to avoid clicks.
 * Pass a value in 0–1 range.
 */
export function setPadVolume(padId: string, volume: number): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const clamped = Math.max(0, Math.min(1, volume));
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(clamped, ctx.currentTime + 0.016);
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Cancel any pending fade and reset a pad's gain node to 1.0.
 * Called after a fade-out completes or when the pad is manually stopped.
 */
export function resetPadGain(padId: string): void {
  cancelPadFade(padId);
  const gain = getPadGain(padId);
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(1.0, ctx.currentTime);
  // Tick reads the gain node value automatically — no store call needed.
}

/**
 * Update a live layer gain node immediately (e.g. when pad config is saved mid-playback).
 * No-op if the layer isn't active. Pass volume in 0–100 range (matches layer.volume schema).
 */
export function syncLayerVolume(layerId: string, volume: number): void {
  const gain = getLayerGain(layerId);
  if (!gain) return;
  const ctx = getAudioContext();
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(volume / 100, ctx.currentTime);
}

/**
 * Set the live volume for a layer's gain node and mirror to the playback store.
 * Pass volume in 0–1 range. Call commitLayerVolume on drag-end to persist to schema.
 */
export function setLayerVolume(layerId: string, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  const gain = getLayerGain(layerId);
  if (gain) {
    // Layer is playing — update gain node. Tick reads the new value automatically.
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(clamped, ctx.currentTime);
  } else {
    // Layer not playing — tick has no gain node to read. Push directly to store.
    usePlaybackStore.getState().updateLayerVolume(layerId, clamped);
  }
}

/** Persist the current layer volume to the project schema (call on drag-end / value commit). */
export function commitLayerVolume(layerId: string, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  useProjectStore.getState().updateLayerVolume(layerId, clamped);
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors in `gainManager.ts`.

---

## Task 2: Create `gainManager.test.ts`

**Files:**
- Create: `src/lib/audio/gainManager.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/lib/audio/gainManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: { getState: vi.fn(() => ({ updateLayerVolume: vi.fn() })) },
}));

vi.mock("@/state/projectStore", () => ({
  useProjectStore: { getState: vi.fn(() => ({ updateLayerVolume: vi.fn() })) },
}));

function makeMockGain(initialValue = 1.0) {
  return {
    gain: {
      value: initialValue,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("gainManager", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllPadGains, clearAllLayerGains } = await import("./audioState");
    clearAllPadGains();
    clearAllLayerGains();
  });

  describe("setPadVolume", () => {
    it("schedules a linear ramp on the pad gain node", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-1");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-1", 0.5);

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 0.016);
    });

    it("clamps volume above 1 to 1", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-clamp-hi");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-clamp-hi", 1.5);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it("clamps volume below 0 to 0", async () => {
      const mockGain = makeMockGain();
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-clamp-lo");
      const { setPadVolume } = await import("./gainManager");

      setPadVolume("pad-clamp-lo", -0.5);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  describe("resetPadGain", () => {
    it("resets gain to 1.0 and cancels any scheduled values", async () => {
      const mockGain = makeMockGain(0.3);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-reset");
      const { resetPadGain } = await import("./gainManager");

      resetPadGain("pad-reset");

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 0);
    });
  });

  describe("syncLayerVolume", () => {
    it("updates an active layer gain node immediately (0–100 scale)", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-sync");
      getOrCreateLayerGain("layer-sync", 80, padGain);
      const { syncLayerVolume } = await import("./gainManager");

      syncLayerVolume("layer-sync", 50);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });

    it("is a no-op if the layer has no active gain node", async () => {
      const { syncLayerVolume } = await import("./gainManager");
      expect(() => syncLayerVolume("nonexistent-layer", 80)).not.toThrow();
    });
  });

  describe("setLayerVolume", () => {
    it("updates gain node directly when the layer is active", async () => {
      const mockPadGain = makeMockGain();
      const mockLayerGain = makeMockGain();
      mockCtx.createGain.mockReturnValueOnce(mockPadGain).mockReturnValueOnce(mockLayerGain);
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-setlvol");
      getOrCreateLayerGain("layer-setlvol", 80, padGain);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("layer-setlvol", 0.75);

      expect(mockLayerGain.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 0);
    });

    it("pushes to playback store when layer is not active", async () => {
      const { usePlaybackStore } = await import("@/state/playbackStore");
      const mockUpdate = vi.fn();
      vi.mocked(usePlaybackStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as ReturnType<typeof usePlaybackStore.getState>);
      const { setLayerVolume } = await import("./gainManager");

      setLayerVolume("inactive-layer", 0.6);

      expect(mockUpdate).toHaveBeenCalledWith("inactive-layer", 0.6);
    });
  });

  describe("commitLayerVolume", () => {
    it("persists clamped volume to project store", async () => {
      const { useProjectStore } = await import("@/state/projectStore");
      const mockUpdate = vi.fn();
      vi.mocked(useProjectStore.getState).mockReturnValue({ updateLayerVolume: mockUpdate } as ReturnType<typeof useProjectStore.getState>);
      const { commitLayerVolume } = await import("./gainManager");

      commitLayerVolume("layer-commit", 0.9);

      expect(mockUpdate).toHaveBeenCalledWith("layer-commit", 0.9);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit && npm run test:run -- gainManager`

Expected: All gainManager tests pass.

- [ ] **Step 3: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/lib/audio/gainManager.ts src/lib/audio/gainManager.test.ts && git commit -m "feat: extract gainManager.ts for pad/layer volume control (#40)"
```

---

## Task 3: Create `fadeMixer.ts`

**Files:**
- Create: `src/lib/audio/fadeMixer.ts`

**Key design note:** `fadePadOut`'s cleanup timeout originally called `stopPad(pad)` from `padPlayer.ts`. Moving it here would create a circular dep. Instead, we inline the equivalent audioState calls: `cancelPadFade`, loop over layers to clear chain/cycle/playOrder, then `stopPadVoices`. `fadePadIn` is NOT moved here because it calls `triggerPad` (which stays in `padPlayer.ts`).

- [ ] **Step 1: Write the file**

```typescript
// src/lib/audio/fadeMixer.ts
import { getAudioContext } from "./audioContext";
import {
  cancelPadFade,
  addFadingOutPad,
  removeFadingOutPad,
  setFadePadTimeout,
  deleteFadePadTimeout,
  getPadGain,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  stopPadVoices,
} from "./audioState";
import { resetPadGain } from "./gainManager";
import type { Pad } from "@/lib/schemas";

/**
 * Freeze a pad's gain at its current value — cancels any in-progress ramp
 * so the pad stays at whatever volume it was at when called.
 */
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const currentValue = gain.gain.value;
  cancelPadFade(padId);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentValue, ctx.currentTime);
  // Tick reads the frozen gain value automatically — no store call needed.
}

/**
 * Resolve the effective fade duration for a pad.
 * Pad-level override wins over the global setting; 2000ms if neither is set.
 */
export function resolveFadeDuration(pad: Pad, globalFadeDurationMs?: number): number {
  return pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000;
}

/**
 * Fade a pad's gain from its current value (or fromVolume) to endVol (default 0).
 * If endVol === 0, stops all voices and resets the pad's gain after the fade completes.
 */
export function fadePadOut(pad: Pad, durationMs: number, fromVolume?: number, toVolume?: number): void {
  // 1. Cancel any prior fade for this pad
  cancelPadFade(pad.id);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const currentGain = gain.gain.value;
  const startVol = fromVolume ?? currentGain;
  const endVol = toVolume ?? 0;

  // 2. Schedule Web Audio ramp
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 3. Mark this pad as fading out so a reverse fade-in can be detected
  addFadingOutPad(pad.id);

  // 4. Schedule cleanup. Inlines stopPad behavior via audioState functions directly
  //    to avoid a circular dependency on padPlayer.ts.
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    removeFadingOutPad(pad.id);
    if (endVol === 0) {
      // Inline stopPad: cancel fade, clear per-layer chain state, stop voices
      cancelPadFade(pad.id);
      for (const layer of pad.layers) {
        deleteLayerChain(layer.id);
        deleteLayerCycleIndex(layer.id);
        deleteLayerPlayOrder(layer.id);
      }
      stopPadVoices(pad.id);
      // Reset gain node to 1.0 so the next trigger starts at full volume
      resetPadGain(pad.id);
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

/**
 * Reverse an in-progress fade-out: cancel it and ramp gain back up from
 * current value. Does NOT restart audio — existing voices keep playing.
 */
export function fadePadInFromCurrent(pad: Pad, durationMs: number, toVolume?: number): void {
  // 1. Cancel the fade-out
  cancelPadFade(pad.id);

  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fromVolume = gain.gain.value;
  const endVol = toVolume ?? 1.0;

  // 2. Schedule Web Audio ramp back up
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);

  // 3. Schedule cleanup
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors in `fadeMixer.ts`.

---

## Task 4: Create `fadeMixer.test.ts`

**Files:**
- Create: `src/lib/audio/fadeMixer.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/lib/audio/fadeMixer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockPad, createMockLayer } from "@/test/factories";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("./gainManager", () => ({
  resetPadGain: vi.fn(),
}));

function makeMockGain(initialValue = 1.0) {
  return {
    gain: {
      value: initialValue,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("fadeMixer", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset();
    const { clearAllPadGains, clearAllFadeTracking } = await import("./audioState");
    clearAllPadGains();
    clearAllFadeTracking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("resolveFadeDuration", () => {
    it("returns pad.fadeDurationMs when set", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: 1500 });
      expect(resolveFadeDuration(pad, 3000)).toBe(1500);
    });

    it("returns globalFadeDurationMs when pad has no override", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: undefined });
      expect(resolveFadeDuration(pad, 3000)).toBe(3000);
    });

    it("returns 2000 when neither is set", async () => {
      const { resolveFadeDuration } = await import("./fadeMixer");
      const pad = createMockPad({ fadeDurationMs: undefined });
      expect(resolveFadeDuration(pad)).toBe(2000);
    });
  });

  describe("freezePadAtCurrentVolume", () => {
    it("cancels scheduled ramp and holds gain at its current value", async () => {
      const mockGain = makeMockGain(0.6);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-freeze");
      const { freezePadAtCurrentVolume } = await import("./fadeMixer");

      freezePadAtCurrentVolume("pad-freeze");

      expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.6, 0);
    });
  });

  describe("fadePadOut", () => {
    it("schedules a linear ramp to 0 and marks pad as fading out", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain, isPadFadingOut } = await import("./audioState");
      getPadGain("pad-fadeout");
      const { fadePadOut } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadeout" });

      fadePadOut(pad, 1000);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1);
      expect(isPadFadingOut("pad-fadeout")).toBe(true);
    });

    it("stops pad voices and resets gain after fade-to-0 completes", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadeout-stop");
      const { fadePadOut } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-fadeout-stop", layers: [createMockLayer()] });

      fadePadOut(pad, 500);
      vi.advanceTimersByTime(600);

      expect(resetPadGain).toHaveBeenCalledWith("pad-fadeout-stop");
    });

    it("does not stop pad when fading to a non-zero volume", async () => {
      const mockGain = makeMockGain(1.0);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-partial-fade");
      const { fadePadOut } = await import("./fadeMixer");
      const { resetPadGain } = await import("./gainManager");
      const pad = createMockPad({ id: "pad-partial-fade" });

      fadePadOut(pad, 500, 1.0, 0.3);
      vi.advanceTimersByTime(600);

      expect(resetPadGain).not.toHaveBeenCalled();
    });

    it("uses fromVolume parameter instead of current gain", async () => {
      const mockGain = makeMockGain(0.8);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-from-vol");
      const { fadePadOut } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-from-vol" });

      fadePadOut(pad, 1000, 0.5);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });
  });

  describe("fadePadInFromCurrent", () => {
    it("cancels fade-out and ramps gain up from current value to 1.0", async () => {
      const mockGain = makeMockGain(0.3);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein");
      const { fadePadInFromCurrent } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein" });

      fadePadInFromCurrent(pad, 1000);

      expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0);
      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, 1);
    });

    it("ramps to toVolume when specified", async () => {
      const mockGain = makeMockGain(0.2);
      mockCtx.createGain.mockReturnValue(mockGain);
      const { getPadGain } = await import("./audioState");
      getPadGain("pad-fadein-vol");
      const { fadePadInFromCurrent } = await import("./fadeMixer");
      const pad = createMockPad({ id: "pad-fadein-vol" });

      fadePadInFromCurrent(pad, 1000, 0.7);

      expect(mockGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit && npm run test:run -- fadeMixer`

Expected: All fadeMixer tests pass.

- [ ] **Step 3: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/lib/audio/fadeMixer.ts src/lib/audio/fadeMixer.test.ts && git commit -m "feat: extract fadeMixer.ts for pure fade scheduling (#40)"
```

---

## Task 5: Create `layerTrigger.ts`

This is the core refactoring task. It extracts five groups of logic from `padPlayer.ts`:

1. **Private helpers** (`resolveSounds`, `liveLayerField`, `getVoiceVolume`) — currently private in padPlayer.ts, needed by the extracted functions
2. **`rampStopLayerVoices` + `stopLayerWithRampInternal`** — used by `applyRetriggerMode` in the "stop" case, also needed by padPlayer's `releasePadHoldLayers` and `stopLayerWithRamp`
3. **`loadLayerVoice`** — separates voice creation (streaming vs buffer) from the onended lifecycle in `startLayerSound`
4. **`startLayerSound`** — the onended-chain-continuation lifecycle, still ~75 lines but now focused solely on lifecycle
5. **`applyRetriggerMode`** — deduplicates the `stop`/`continue`/`restart`/`next` switch shared by `triggerPad` and `triggerLayer`
6. **`startLayerPlayback`** — deduplicates the cycleMode/chained/simultaneous start-playback section shared by both

**Files:**
- Create: `src/lib/audio/layerTrigger.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/audio/layerTrigger.ts
//
// Extracted layer trigger helpers used by padPlayer.ts:
//   - resolveSounds / liveLayerField / getVoiceVolume — private utilities
//   - rampStopLayerVoices / stopLayerWithRampInternal — ramped layer stop primitives
//   - loadLayerVoice — voice creation (streaming vs buffer), separated from lifecycle
//   - startLayerSound — onended chain-continuation lifecycle (calls loadLayerVoice)
//   - applyRetriggerMode — deduplicates the retrigger switch shared by triggerPad + triggerLayer
//   - startLayerPlayback — deduplicates the start-playback section shared by both

import { ensureResumed, getAudioContext } from "./audioContext";
import { loadBuffer, MissingFileError } from "./bufferCache";
import { checkIsLargeFile, getOrCreateStreamingElement } from "./streamingCache";
import { wrapBufferSource, wrapStreamingElement, STOP_RAMP_S } from "./audioVoice";
import type { AudioVoice } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { filterSoundsByTags } from "./resolveSounds";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useProjectStore } from "@/state/projectStore";
import { checkMissingStatus } from "@/lib/library.reconcile";
import type { Layer, Pad, Sound } from "@/lib/schemas";
import { toast } from "sonner";
import { startAudioTick } from "./audioTick";
import {
  clearLayerVoice,
  clearLayerStreamingAudio,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  getLayerChain,
  getLayerCycleIndex,
  getLayerGain,
  getLayerVoices,
  getPadGain,
  getOrCreateLayerGain,
  getPadProgressInfo,
  isLayerActive,
  isPadActive,
  recordLayerVoice,
  registerStreamingAudio,
  setLayerChain,
  setLayerCycleIndex,
  setLayerPlayOrder,
  setLayerProgressInfo,
  setPadProgressInfo,
  clearLayerProgressInfo,
  clearPadProgressInfo,
  setLayerPending,
  clearLayerPending,
  stopLayerVoices,
  stopPadVoices,
  unregisterStreamingAudio,
} from "./audioState";

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/** Read a field from the live project store for a layer. Falls back to `captured`
 *  if the pad/layer is not found (e.g. deleted mid-playback or project cleared). */
export function liveLayerField<K extends keyof Layer>(
  padId: string,
  layerId: string,
  field: K,
  captured: Layer[K],
): Layer[K] {
  const project = useProjectStore.getState().project;
  if (project) {
    for (const scene of project.scenes) {
      const pad = scene.pads.find((p) => p.id === padId);
      if (pad) return pad.layers.find((l) => l.id === layerId)?.[field] ?? captured;
    }
  }
  return captured;
}

/** Returns the 0–1 gain value for a specific sound within a layer.
 *  For "assigned" selections, reads SoundInstance.volume (0–100 scale).
 *  For "tag"/"set" selections, defaults to 1.0. */
export function getVoiceVolume(layer: Layer, sound: Sound): number {
  if (layer.selection.type === "assigned") {
    const inst = layer.selection.instances.find((i) => i.soundId === sound.id);
    return inst ? inst.volume / 100 : 1.0;
  }
  return 1.0;
}

/** Resolve a layer's sound selection to actual Sound objects with valid file paths. */
export function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  const soundById = new Map(sounds.map((s) => [s.id, s]));
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      return filterSoundsByTags(sounds, sel.tagIds, sel.matchMode);
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}

// ---------------------------------------------------------------------------
// Ramped layer stop primitives (used by applyRetriggerMode + padPlayer stop fns)
// ---------------------------------------------------------------------------

/**
 * Ramp-stop a specific set of voices on a layer: null their onended callbacks,
 * stop with a gain ramp, then clean up voice + gain state after the ramp window.
 */
export function rampStopLayerVoices(
  padId: string,
  layer: Layer,
  voices: readonly AudioVoice[],
): void {
  for (const v of voices) v.setOnEnded(null);
  for (const v of voices) v.stopWithRamp(STOP_RAMP_S);

  const gain = getLayerGain(layer.id);
  const resetValue = layer.volume / 100;
  setTimeout(() => {
    for (const v of voices) clearLayerVoice(padId, layer.id, v);
    if (gain) {
      const ctx = getAudioContext();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(resetValue, ctx.currentTime);
    }
  }, STOP_RAMP_S * 1000 + 5);
}

/** Stop all active voices for a layer with a short gain ramp. No-op if no voices. */
export function stopLayerWithRampInternal(pad: Pad, layer: Layer): void {
  const voices = [...getLayerVoices(layer.id)];
  if (voices.length === 0) return;
  rampStopLayerVoices(pad.id, layer, voices);
}

// ---------------------------------------------------------------------------
// Voice creation — streaming vs buffer path
// ---------------------------------------------------------------------------

/**
 * Create and start a voice for one sound on one layer.
 * Routes to the streaming path (HTMLAudioElement) for large files and the
 * buffer path (AudioBufferSourceNode) for small files. Updates progress info
 * as a side effect. Returns the started voice and the HTMLAudioElement (if
 * streaming, for cleanup tracking; null for buffer path).
 *
 * Throws on load failure — caller is responsible for catching.
 */
export async function loadLayerVoice(
  sound: Sound,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  padId: string,
): Promise<{ voice: AudioVoice; audio: HTMLAudioElement | null }> {
  if (await checkIsLargeFile(sound)) {
    // -- Streaming path (large files) ---
    const { audio: cachedAudio, sourceNode } = getOrCreateStreamingElement(sound, ctx);
    sourceNode.disconnect();
    cachedAudio.currentTime = 0;
    cachedAudio.loop =
      (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
      (!isChained(layer.arrangement) || layer.cycleMode);
    const voice = wrapStreamingElement(cachedAudio, sourceNode, ctx, layerGain, voiceVolume);
    registerStreamingAudio(padId, layer.id, cachedAudio);
    return { voice, audio: cachedAudio };
  } else {
    // -- Buffer path (short files) ---
    const buffer = await loadBuffer(sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (
      (layer.playbackMode === "loop" || layer.playbackMode === "hold") &&
      (!isChained(layer.arrangement) || layer.cycleMode)
    ) {
      source.loop = true;
    }
    const voice = wrapBufferSource(source, ctx, layerGain, voiceVolume);

    // Chained: always update progress to track the current sound.
    // Simultaneous: keep the longest-duration voice so the bar fills on the slowest sound.
    const existing = getPadProgressInfo(padId);
    if (isChained(layer.arrangement) || !existing || buffer.duration > existing.duration) {
      setPadProgressInfo(padId, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });
    }
    setLayerProgressInfo(layer.id, { startedAt: ctx.currentTime, duration: buffer.duration, isLooping: source.loop });

    return { voice, audio: null };
  }
}

// ---------------------------------------------------------------------------
// startLayerSound — voice lifecycle + onended chain continuation
// ---------------------------------------------------------------------------

/**
 * Load and start a single sound for a layer. Sets up the onended callback that
 * auto-chains to the next sound in layerChainQueue (sequential/shuffled arrangement).
 *
 * Audio graph: sourceNode -> voiceGain -> layerGain -> padGain -> masterGain
 */
export async function startLayerSound(
  pad: Pad,
  layer: Layer,
  sound: Sound,
  ctx: AudioContext,
  layerGain: GainNode,
  voiceVolume: number,
  allSounds: Sound[],
): Promise<void> {
  try {
    const { voice, audio } = await loadLayerVoice(sound, layer, ctx, layerGain, voiceVolume, pad.id);

    voice.setOnEnded(() => {
      // endedCb is nulled on first fire — prevents double-call if the source
      // ends naturally while a stopWithRamp timeout is pending.
      if (audio) unregisterStreamingAudio(pad.id, layer.id, audio);
      clearLayerVoice(pad.id, layer.id, voice);

      // Chain to the next sound if one is queued (sequential/shuffled).
      // `remaining === undefined` means the queue was cleared externally (stop/reset).
      // `remaining.length === 0` means the chain ran to completion naturally.
      const remaining = getLayerChain(layer.id);
      const liveMode = liveLayerField(pad.id, layer.id, "playbackMode", layer.playbackMode);

      if (remaining === undefined) {
        // Queue cleared externally — do not chain.
      } else if (remaining.length > 0) {
        const [next, ...rest] = remaining;
        setLayerChain(layer.id, rest);
        // Clear stale progress so the bar resets during the async buffer load.
        clearLayerProgressInfo(layer.id);
        clearPadProgressInfo(pad.id);
        startAudioTick(); // keep tick alive during the async gap
        startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), allSounds);
      } else if (liveMode === "loop" || liveMode === "hold") {
        // Chain exhausted naturally — restart using live store values so mid-playback
        // config changes (arrangement, playback mode, selection) take effect.
        const liveArr = liveLayerField(pad.id, layer.id, "arrangement", layer.arrangement);
        const liveSelection = liveLayerField(pad.id, layer.id, "selection", layer.selection);
        const liveLayerSnap = { ...layer, arrangement: liveArr, playbackMode: liveMode, selection: liveSelection };
        const liveSounds = resolveSounds(liveLayerSnap, useLibraryStore.getState().sounds);
        clearLayerProgressInfo(layer.id);
        clearPadProgressInfo(pad.id);
        startAudioTick(); // keep tick alive during the async gap
        if (isChained(liveArr)) {
          const newOrder = buildPlayOrder(liveArr, liveSounds);
          if (newOrder.length === 0) { deleteLayerChain(layer.id); return; }
          const [first, ...rest] = newOrder;
          setLayerChain(layer.id, rest);
          startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(liveLayerSnap, first), liveSounds);
        } else {
          deleteLayerChain(layer.id);
          for (const snd of liveSounds) {
            startLayerSound(pad, liveLayerSnap, snd, ctx, layerGain, getVoiceVolume(liveLayerSnap, snd), liveSounds);
          }
        }
      } else {
        deleteLayerChain(layer.id);
      }
    });

    await voice.start();
    recordLayerVoice(pad.id, layer.id, voice);
    startAudioTick();

  } catch (err) {
    // Clear stale progress so a failed load doesn't freeze the bar at 1.0.
    clearLayerProgressInfo(layer.id);
    clearPadProgressInfo(pad.id);
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
      toast.error(`Failed to play "${sound.name}": ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// applyRetriggerMode — deduplicates the retrigger switch shared by
//   triggerPad (iterates layers, uses `continue`) and
//   triggerLayer (single layer, uses `return`).
// ---------------------------------------------------------------------------

/**
 * Result of applying retrigger logic for one layer:
 * - "skip"           — don't start new playback (stop mode stopped; continue mode kept going)
 * - "proceed"        — clear progress and start new playback via startLayerPlayback
 * - "chain-advanced" — "next" mode already started the chain's next sound; caller should
 *                      record addPlayingPad if needed (triggerLayer) and then return/continue
 */
export type RetriggerAction = "skip" | "proceed" | "chain-advanced";

/**
 * Apply the layer's retrigger mode when the layer is already active (or not).
 *
 * @param afterStopCleanup - Optional callback fired after a "stop"-mode ramp-stop.
 *   `triggerLayer` uses this to schedule a deferred `removePlayingPad` check;
 *   `triggerPad` omits it (the pad-level store state is managed globally).
 */
export async function applyRetriggerMode(
  pad: Pad,
  layer: Layer,
  isLayerPlaying: boolean,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
  afterStopCleanup?: () => void,
): Promise<RetriggerAction> {
  switch (layer.retriggerMode) {
    case "stop":
      if (isLayerPlaying) {
        deleteLayerChain(layer.id);
        // rampStopLayerVoices nulls onended before stopping, so the normal cleanup
        // callback won't fire — delete the layer's streaming entry explicitly.
        clearLayerStreamingAudio(pad.id, layer.id);
        stopLayerWithRampInternal(pad, layer);
        afterStopCleanup?.();
        // Cycle mode: advance cursor so next trigger plays the next sound.
        if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
          const nextIndex = (getLayerCycleIndex(layer.id) ?? 0) + 1;
          if (nextIndex >= resolved.length) {
            deleteLayerCycleIndex(layer.id);
          } else {
            setLayerCycleIndex(layer.id, nextIndex);
          }
        }
        return "skip";
      }
      break;

    case "continue":
      if (isLayerPlaying) return "skip";
      break;

    case "restart":
      if (isLayerPlaying) {
        deleteLayerChain(layer.id);
        stopLayerVoices(pad.id, layer.id);
        // Cycle mode: back cursor up so the same sound replays.
        if (layer.cycleMode && isChained(layer.arrangement) && resolved.length > 0) {
          const cur = getLayerCycleIndex(layer.id) ?? 0;
          setLayerCycleIndex(layer.id, cur === 0 ? resolved.length - 1 : cur - 1);
        }
      }
      break;

    case "next":
      if (isLayerPlaying) {
        // Capture queue before clearing it.
        const remaining = [...(getLayerChain(layer.id) ?? [])];
        // Null onended BEFORE stopLayerVoices — stop() fires onended synchronously;
        // nulling first prevents the chain-advance callback from re-firing.
        for (const v of getLayerVoices(layer.id)) v.setOnEnded(null);
        deleteLayerChain(layer.id);
        clearLayerStreamingAudio(pad.id, layer.id);
        stopLayerVoices(pad.id, layer.id);
        // Clear progress immediately so the bar resets to 0 while the next buffer loads.
        clearPadProgressInfo(pad.id);
        clearLayerProgressInfo(layer.id);

        if (layer.cycleMode && isChained(layer.arrangement)) {
          // Cycle mode + next: fall through to start-playback (reads updated cycle cursor).
          return "proceed";
        }

        if (remaining.length > 0) {
          const [next, ...rest] = remaining;
          setLayerChain(layer.id, rest);
          await startLayerSound(pad, layer, next, ctx, layerGain, getVoiceVolume(layer, next), resolved);
        } else if ((layer.playbackMode === "loop" || layer.playbackMode === "hold") && isChained(layer.arrangement)) {
          // Chain exhausted — loop back to beginning.
          const newOrder = buildPlayOrder(layer.arrangement, resolved);
          if (newOrder.length > 0) {
            const [first, ...rest] = newOrder;
            setLayerChain(layer.id, rest);
            await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
          }
        }
        // one-shot: queue exhausted — just stopped (already done above).
        return "chain-advanced";
      }
      break;
  }

  return "proceed";
}

// ---------------------------------------------------------------------------
// startLayerPlayback — deduplicates the start-playback section shared by
//   triggerPad (inside its layer for-loop) and triggerLayer.
// ---------------------------------------------------------------------------

/**
 * Build the play order and start all sounds for a layer.
 * Handles cycleMode, chained (sequential/shuffled), and simultaneous arrangements.
 * Manages the layerPending guard internally.
 *
 * Callers are responsible for clearing padProgressInfo BEFORE calling this
 * (triggerPad does it once for the first layer that starts; triggerLayer always does it).
 */
export async function startLayerPlayback(
  pad: Pad,
  layer: Layer,
  ctx: AudioContext,
  layerGain: GainNode,
  resolved: Sound[],
): Promise<void> {
  clearLayerProgressInfo(layer.id);
  setLayerPending(layer.id);
  try {
    const playOrder = buildPlayOrder(layer.arrangement, resolved);
    setLayerPlayOrder(layer.id, playOrder);

    if (layer.cycleMode && isChained(layer.arrangement)) {
      // Cycle mode: play exactly one sound per trigger, advancing the cursor.
      // No chain queue — onended will not auto-advance.
      deleteLayerChain(layer.id);
      const cycleIndex = getLayerCycleIndex(layer.id) ?? 0;
      const sound = playOrder[cycleIndex % playOrder.length];
      const nextIndex = cycleIndex + 1;
      if (nextIndex >= playOrder.length && layer.playbackMode === "one-shot") {
        deleteLayerCycleIndex(layer.id);
      } else {
        setLayerCycleIndex(layer.id, nextIndex % playOrder.length);
      }
      await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
    } else if (isChained(layer.arrangement)) {
      const [first, ...rest] = playOrder;
      setLayerChain(layer.id, rest);
      await startLayerSound(pad, layer, first, ctx, layerGain, getVoiceVolume(layer, first), resolved);
    } else {
      deleteLayerChain(layer.id);
      for (const sound of playOrder) {
        await startLayerSound(pad, layer, sound, ctx, layerGain, getVoiceVolume(layer, sound), resolved);
      }
    }
  } finally {
    clearLayerPending(layer.id);
  }
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit 2>&1 | head -40`

Expected: No errors in `layerTrigger.ts`.

---

## Task 6: Create `layerTrigger.test.ts`

The existing `padPlayer.test.ts` (134 tests) covers `startLayerSound`, `applyRetriggerMode`, and `startLayerPlayback` indirectly through `triggerPad` and `triggerLayer`. After the refactor those tests still serve as regression coverage. These new tests add focused unit tests for the two extracted helpers that had no direct tests.

**Files:**
- Create: `src/lib/audio/layerTrigger.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/lib/audio/layerTrigger.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockLayer, createMockPad, createMockSound } from "@/test/factories";
import { isLayerActive } from "./audioState";

const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
  createBufferSource: vi.fn(),
  createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
};

vi.mock("./audioContext", () => ({
  getAudioContext: vi.fn(() => mockCtx),
  getMasterGain: vi.fn(() => ({ connect: vi.fn() })),
  ensureResumed: vi.fn(() => Promise.resolve(mockCtx)),
}));
vi.mock("./audioTick", () => ({
  startAudioTick: vi.fn(),
  stopAudioTick: vi.fn(),
}));
vi.mock("./bufferCache", () => ({
  loadBuffer: vi.fn().mockResolvedValue({ duration: 1.0 }),
  MissingFileError: class MissingFileError extends Error {},
}));
vi.mock("./streamingCache", () => ({
  checkIsLargeFile: vi.fn().mockResolvedValue(false),
  getOrCreateStreamingElement: vi.fn(),
  LARGE_FILE_THRESHOLD_BYTES: 20 * 1024 * 1024,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/state/libraryStore", () => ({
  useLibraryStore: { getState: vi.fn(() => ({ sounds: [] })) },
}));
vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: vi.fn(() => ({ settings: null })) },
}));
vi.mock("@/state/projectStore", () => ({
  useProjectStore: { getState: vi.fn(() => ({ project: null })) },
}));
vi.mock("@/lib/library.reconcile", () => ({
  checkMissingStatus: vi.fn(),
}));

function makeMockGain() {
  return {
    gain: { value: 1.0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("layerTrigger", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockCtx.currentTime = 0;
    mockCtx.createGain.mockReset().mockReturnValue(makeMockGain());
    mockCtx.createBufferSource.mockReset().mockReturnValue({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    });
    const { clearAllPadGains, clearAllLayerGains, clearAllLayerChains, clearAllFadeTracking, clearAllVoices } = await import("./audioState");
    clearAllPadGains();
    clearAllLayerGains();
    clearAllLayerChains();
    clearAllFadeTracking();
    clearAllVoices();
  });

  // ── resolveSounds ─────────────────────────────────────────────────────────

  describe("resolveSounds", () => {
    it("returns only assigned sounds with valid filePaths", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const s1 = createMockSound({ id: "s1", filePath: "s1.wav" });
      const s2 = createMockSound({ id: "s2", filePath: "" }); // invalid
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ soundId: "s1", volume: 100, startOffsetMs: 0 }, { soundId: "s2", volume: 100, startOffsetMs: 0 }] },
      });
      expect(resolveSounds(layer, [s1, s2])).toEqual([s1]);
    });

    it("returns empty array when no sounds match", async () => {
      const { resolveSounds } = await import("./layerTrigger");
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ soundId: "missing", volume: 100, startOffsetMs: 0 }] },
      });
      expect(resolveSounds(layer, [])).toEqual([]);
    });
  });

  // ── getVoiceVolume ────────────────────────────────────────────────────────

  describe("getVoiceVolume", () => {
    it("returns instance volume / 100 for assigned selection", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({
        selection: { type: "assigned", instances: [{ soundId: "s1", volume: 80, startOffsetMs: 0 }] },
      });
      expect(getVoiceVolume(layer, sound)).toBeCloseTo(0.8);
    });

    it("returns 1.0 for tag/set selections", async () => {
      const { getVoiceVolume } = await import("./layerTrigger");
      const sound = createMockSound({ id: "s1" });
      const layer = createMockLayer({ selection: { type: "set", setId: "set-1" } });
      expect(getVoiceVolume(layer, sound)).toBe(1.0);
    });
  });

  // ── applyRetriggerMode ────────────────────────────────────────────────────

  describe("applyRetriggerMode", () => {
    async function setup() {
      const { getPadGain, getOrCreateLayerGain } = await import("./audioState");
      const padGain = getPadGain("pad-r");
      const layerGain = getOrCreateLayerGain("layer-r", 100, padGain);
      return { padGain, layerGain };
    }

    it("returns 'proceed' when layer is not playing (all modes)", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const resolved = [createMockSound()];

      const result = await applyRetriggerMode(pad, layer, false, mockCtx as unknown as AudioContext, layerGain, resolved);
      expect(result).toBe("proceed");
    });

    it("returns 'skip' for 'continue' mode when layer is playing", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "continue" });

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);
      expect(result).toBe("skip");
    });

    it("returns 'proceed' for 'restart' mode when layer is playing (stops current voices)", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "restart" });

      const result = await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, []);
      expect(result).toBe("proceed");
    });

    it("calls afterStopCleanup when 'stop' mode stops a playing layer", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const afterStopCleanup = vi.fn();

      await applyRetriggerMode(pad, layer, true, mockCtx as unknown as AudioContext, layerGain, [createMockSound()], afterStopCleanup);

      expect(afterStopCleanup).toHaveBeenCalledTimes(1);
    });

    it("does NOT call afterStopCleanup when layer is not playing", async () => {
      const { applyRetriggerMode } = await import("./layerTrigger");
      const { layerGain } = await setup();
      const pad = createMockPad({ id: "pad-r" });
      const layer = createMockLayer({ id: "layer-r", retriggerMode: "stop" });
      const afterStopCleanup = vi.fn();

      await applyRetriggerMode(pad, layer, false, mockCtx as unknown as AudioContext, layerGain, [], afterStopCleanup);

      expect(afterStopCleanup).not.toHaveBeenCalled();
    });
  });

  // ── startLayerPlayback ────────────────────────────────────────────────────

  describe("startLayerPlayback", () => {
    it("starts simultaneous sounds for non-chained arrangement", async () => {
      const { startLayerPlayback } = await import("./layerTrigger");
      const { getPadGain, getOrCreateLayerGain, isLayerActive } = await import("./audioState");
      const padGain = getPadGain("pad-slp");
      const layerGain = getOrCreateLayerGain("layer-slp", 100, padGain);
      const pad = createMockPad({ id: "pad-slp" });
      const sound = createMockSound({ id: "s1", filePath: "s.wav" });
      const layer = createMockLayer({
        id: "layer-slp",
        arrangement: "simultaneous",
        selection: { type: "assigned", instances: [{ soundId: "s1", volume: 100, startOffsetMs: 0 }] },
      });

      await startLayerPlayback(pad, layer, mockCtx as unknown as AudioContext, layerGain, [sound]);

      expect(isLayerActive("layer-slp")).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit && npm run test:run -- layerTrigger`

Expected: All layerTrigger tests pass.

- [ ] **Step 3: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/lib/audio/layerTrigger.ts src/lib/audio/layerTrigger.test.ts && git commit -m "feat: extract layerTrigger.ts — applyRetriggerMode, startLayerPlayback, startLayerSound (#40)"
```

---

## Task 7: Add `clearAllAudioState()` to `audioState.ts`

**Files:**
- Modify: `src/lib/audio/audioState.ts`
- Modify: `src/lib/audio/audioState.test.ts`

- [ ] **Step 1: Append the function to the bottom of `audioState.ts`**

```typescript
// ---------------------------------------------------------------------------
// Consolidated cleanup — instant, no gain ramp (for project close)
// ---------------------------------------------------------------------------

/**
 * Instantly release all audio engine state — no gain ramp.
 * Use on project close / component unmount where a click is acceptable.
 * For graceful in-session stopping (with gain ramp), use padPlayer.stopAllPads() instead.
 *
 * Clears in the same order as stopAllPads to respect invariants:
 *   1. Chain queues + fade tracking first (prevents onended from restarting chains)
 *   2. onended callbacks nulled (prevents callbacks from firing during voice.stop())
 *   3. Voices stopped, then gains cleared
 */
export function clearAllAudioState(): void {
  clearAllFadeTracking();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  nullAllOnEnded();
  clearAllStreamingAudio();
  clearAllPadProgressInfo();
  clearAllLayerProgressInfo();
  clearAllLayerGains();
  clearAllPadGains();
  stopAllVoices();
}
```

- [ ] **Step 2: Append a test to `audioState.test.ts`**

Find the last `describe` block and add a new one after it:

```typescript
describe("clearAllAudioState", () => {
  it("clears fade tracking, chain queues, voices, gains, and progress in one call", async () => {
    const {
      clearAllAudioState,
      getPadGain,
      getOrCreateLayerGain,
      setPadProgressInfo,
      setLayerChain,
      addFadingOutPad,
      isPadFadingOut,
      getLayerChain,
      isPadActive,
    } = await import("./audioState");

    const padGain = getPadGain("pad-clearall");
    getOrCreateLayerGain("layer-clearall", 80, padGain);
    setPadProgressInfo("pad-clearall", { startedAt: 0, duration: 1, isLooping: false });
    setLayerChain("layer-clearall", []);
    addFadingOutPad("pad-clearall");

    clearAllAudioState();

    expect(isPadFadingOut("pad-clearall")).toBe(false);
    expect(getLayerChain("layer-clearall")).toBeUndefined();
    expect(isPadActive("pad-clearall")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit && npm run test:run -- audioState`

Expected: All audioState tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/lib/audio/audioState.ts src/lib/audio/audioState.test.ts && git commit -m "feat: add clearAllAudioState() consolidated cleanup entry point (#40)"
```

---

## Task 8: Slim `padPlayer.ts`

This is the final and largest edit. Read `padPlayer.ts` in full before making changes. Replace the functions moved to other modules, add imports from those modules, update the re-exports block, and rewrite `triggerPad` and `triggerLayer` to use the extracted helpers.

**Expected size reduction: ~1,149 → ~540 lines**

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`

### 8a: Update imports

- [ ] **Step 1: Replace the existing imports block**

The new imports block (replacing everything before the `// Re-export public query/clear functions` comment):

```typescript
import { ensureResumed, getAudioContext } from "./audioContext";
import { STOP_RAMP_S } from "./audioVoice";
import { buildPlayOrder, isChained } from "./arrangement";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Layer, Pad, Scene, Sound } from "@/lib/schemas";
import { isFadeablePad } from "@/lib/padUtils";
import { toast } from "sonner";
import { stopAudioTick } from "./audioTick";

import {
  cancelPadFade,
  clearAllFadeTracking,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  clearAllLayerGains,
  clearAllLayerPending,
  clearAllLayerPlayOrders,
  clearAllPadGains,
  clearAllStreamingAudio,
  clearAllPadProgressInfo,
  clearAllLayerProgressInfo,
  deleteLayerChain,
  deleteLayerCycleIndex,
  deleteLayerPlayOrder,
  forEachPadGain,
  getLayerVoices,
  getOrCreateLayerGain,
  getPadGain,
  isLayerActive,
  isPadActive,
  isPadFadingOut,
  nullAllOnEnded,
  stopAllVoices,
  stopLayerVoices,
  stopPadVoices,
} from "./audioState";

import {
  freezePadAtCurrentVolume,
  resolveFadeDuration,
  fadePadOut,
  fadePadInFromCurrent,
} from "./fadeMixer";

import {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
  commitLayerVolume,
} from "./gainManager";

import {
  applyRetriggerMode,
  startLayerPlayback,
  startLayerSound,
  rampStopLayerVoices,
  stopLayerWithRampInternal,
  resolveSounds,
  getVoiceVolume,
  liveLayerField,
} from "./layerTrigger";
```

- [ ] **Step 2: Replace the re-exports block**

Replace the existing `// Re-export public query/clear functions` block with:

```typescript
// Re-export public query/clear functions for backward compatibility
export {
  clearAllFadeTracking,
  clearAllPadGains,
  clearAllLayerGains,
  clearAllLayerChains,
  clearAllLayerCycleIndexes,
  isPadFadingOut,
  isPadFading,
  isPadStreaming,
  getPadProgress,
  getPadGain,
  isLayerActive,
  isPadActive,
} from "./audioState";

// Re-export functions moved to fadeMixer / gainManager for backward compatibility
export {
  freezePadAtCurrentVolume,
  resolveFadeDuration,
  fadePadOut,
  fadePadInFromCurrent,
} from "./fadeMixer";

export {
  setPadVolume,
  resetPadGain,
  syncLayerVolume,
  setLayerVolume,
  commitLayerVolume,
} from "./gainManager";

/** @deprecated Use clearAllFadeTracking instead. */
export const clearFadePadTimeouts = clearAllFadeTracking;
```

### 8b: Delete moved function bodies

- [ ] **Step 3: Delete from padPlayer.ts the bodies of all functions now in fadeMixer / gainManager / layerTrigger**

Delete the following function implementations (they are now imported and re-exported):
- `freezePadAtCurrentVolume`
- `resolveFadeDuration`
- `fadePadOut`
- `fadePadInFromCurrent`
- `setPadVolume`
- `resetPadGain`
- `syncLayerVolume`
- `setLayerVolume`
- `commitLayerVolume`
- `getVoiceVolume` (private, now in layerTrigger)
- `resolveSounds` (private, now in layerTrigger)
- `liveLayerField` (private, now in layerTrigger)
- `startLayerSound` (now in layerTrigger)
- `rampStopLayerVoices` (now in layerTrigger)
- `stopLayerWithRampInternal` (now in layerTrigger)

### 8c: Rewrite `triggerPad` to use `applyRetriggerMode` + `startLayerPlayback`

- [ ] **Step 4: Replace the `triggerPad` function body**

The new `triggerPad` (~30 lines, down from ~150):

```typescript
export async function triggerPad(pad: Pad, startVolume = 1.0): Promise<void> {
  const { sounds } = useLibraryStore.getState();
  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  padGain.gain.cancelScheduledValues(ctx.currentTime);
  padGain.gain.setValueAtTime(startVolume, ctx.currentTime);

  let progressCleared = false;

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;
    if (isLayerPending(layer.id)) continue; // Note: isLayerPending imported from audioState

    const isLayerPlaying = isLayerActive(layer.id);
    const layerGain = getOrCreateLayerGain(layer.id, layer.volume, padGain);

    const action = await applyRetriggerMode(pad, layer, isLayerPlaying, ctx, layerGain, resolved);
    // triggerPad does not pass afterStopCleanup — pad-level playback store state
    // is managed globally (stopAllPads / clearVoice).
    if (action === "skip" || action === "chain-advanced") continue;

    if (!progressCleared) {
      clearPadProgressInfo(pad.id);
      progressCleared = true;
    }
    await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
  }
}
```

Note: `isLayerPending` also needs to be imported from `audioState`. Add it to the audioState import block in step 1 above.

### 8d: Rewrite `triggerLayer` to use `applyRetriggerMode` + `startLayerPlayback`

- [ ] **Step 5: Replace the `triggerLayer` function body**

The new `triggerLayer` (~25 lines, down from ~117):

```typescript
export async function triggerLayer(pad: Pad, layer: Layer): Promise<void> {
  const { sounds } = useLibraryStore.getState();
  const resolved = resolveSounds(layer, sounds);
  if (resolved.length === 0) return;
  if (isLayerPending(layer.id)) return; // isLayerPending from audioState

  const ctx = await ensureResumed();
  const padGain = getPadGain(pad.id);
  const isPlaying = isLayerActive(layer.id);
  const layerGain = getOrCreateLayerGain(layer.id, layer.volume, padGain);

  const action = await applyRetriggerMode(
    pad, layer, isPlaying, ctx, layerGain, resolved,
    // triggerLayer-specific: after a "stop"-mode ramp-stop, check if the pad
    // still has any active voices and remove it from the playing-pads set if not.
    () => setTimeout(() => {
      if (!isPadActive(pad.id)) {
        usePlaybackStore.getState().removePlayingPad(pad.id);
      }
    }, STOP_RAMP_S * 1000 + 10),
  );

  if (action === "skip") return;
  if (action === "chain-advanced") {
    usePlaybackStore.getState().addPlayingPad(pad.id);
    return;
  }

  clearPadProgressInfo(pad.id);
  await startLayerPlayback(pad, layer, ctx, layerGain, resolved);
  usePlaybackStore.getState().addPlayingPad(pad.id);
}
```

Also add `clearPadProgressInfo`, `isLayerPending` to the `audioState` import block.

### 8e: Verify and run full test suite

- [ ] **Step 6: Run TypeScript check**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit`

Expected: Empty output (= no errors).

- [ ] **Step 7: Run full test suite**

Run: `cd C:/Repos/sounds-bored && npm run test:run`

Expected: All tests pass (existing 1,071 + new tests from Tasks 2, 4, 6, 7).

- [ ] **Step 8: Verify padPlayer.ts size reduction**

Run: `wc -l C:/Repos/sounds-bored/src/lib/audio/padPlayer.ts`

Expected: Under 600 lines.

- [ ] **Step 9: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/lib/audio/padPlayer.ts && git commit -m "refactor: slim padPlayer.ts — import from fadeMixer, gainManager, layerTrigger; rewrite triggerPad/triggerLayer (#40)"
```

---

## Task 9: Update `MainPage.tsx`

**Files:**
- Modify: `src/components/screens/main/MainPage.tsx`

- [ ] **Step 1: Read lines 1–45 of MainPage.tsx** to see the current imports and cleanup effect.

- [ ] **Step 2: Update the import**

Change:
```typescript
import { stopAllPads } from "@/lib/audio/padPlayer";
```
To:
```typescript
import { clearAllAudioState } from "@/lib/audio/audioState";
import { stopAudioTick } from "@/lib/audio/audioTick";
```
(Remove the `stopAllPads` import — `clearAllAudioState` is a superset of what's needed on unmount.)

- [ ] **Step 3: Update the cleanup effect**

Change:
```typescript
useEffect(() => {
  return () => {
    stopAllPads();
  };
}, []);
```
To:
```typescript
useEffect(() => {
  return () => {
    stopAudioTick();
    clearAllAudioState();
  };
}, []);
```

- [ ] **Step 4: Run TypeScript check + full test suite**

Run: `cd C:/Repos/sounds-bored && npx tsc --noEmit && npm run test:run`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Repos/sounds-bored && git add src/components/screens/main/MainPage.tsx && git commit -m "refactor: use clearAllAudioState() on project close instead of stopAllPads (#40)"
```

---

## Self-Review

### Spec Coverage

| Problem | Fix | Task |
|---|---|---|
| fadePadOut, fadePadInFromCurrent, freezePadAtCurrentVolume bloating padPlayer.ts | Moved to `fadeMixer.ts` | 3 |
| setPadVolume, resetPadGain, syncLayerVolume, setLayerVolume, commitLayerVolume bloating padPlayer.ts | Moved to `gainManager.ts` | 1 |
| `triggerPad`/`triggerLayer` retrigger switch-case duplication (~150 lines) | `applyRetriggerMode()` in `layerTrigger.ts` | 5 |
| `triggerPad`/`triggerLayer` start-playback duplication (~74 lines) | `startLayerPlayback()` in `layerTrigger.ts` | 5 |
| `startLayerSound` mixing voice creation with lifecycle management | `loadLayerVoice()` extracted in `layerTrigger.ts` | 5 |
| No `clearAllAudioState()` for project close | Added to `audioState.ts` | 7 |
| MainPage.tsx calls stopAllPads (with gain ramp) on unmount | Replaced with `clearAllAudioState()` | 9 |

### Circular Dependency Check

- `fadeMixer.ts` imports `gainManager.ts` (for `resetPadGain`) and `audioState` ✓
- `gainManager.ts` imports `audioState`, stores only ✓
- `layerTrigger.ts` imports `audioState`, `audioContext`, `audioVoice`, `streamingCache`, `bufferCache`, `audioTick`, `arrangement`, `resolveSounds`, `libraryStore`, `appSettingsStore`, `library.reconcile`, `schemas`, `sonner` — does NOT import `padPlayer.ts` ✓
- `padPlayer.ts` imports from all three new modules — they do NOT import back ✓

### Backward Compatibility Check

All existing import sites work unchanged because `padPlayer.ts` re-exports everything it moved:
- `usePadGesture.ts`: `triggerPad`, `setPadVolume`, `resetPadGain`, `releasePadHoldLayers`, `stopPad`, `isPadFading`, `freezePadAtCurrentVolume` ✓
- `useMultiFadeMode.ts`: `fadePadWithLevels`, `resolveFadeDuration` ✓
- `PadControlContent.tsx`: `commitLayerVolume`, `setPadVolume`, `skipLayerForward`, `skipLayerBack` ✓
- `PadConfigDrawer.tsx`: `syncLayerVolume`, `syncLayerConfig` ✓
- `SceneTab.tsx`: `stopScene` ✓
- `PlaySection.tsx`, `MainPage.tsx`: `stopAllPads` ✓
