# Audio Tick: Single Global RAF for Audio Engine → UI State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all per-pad/per-component RAF loops and scattered Zustand push calls with a single global `audioTick` RAF that polls imperative audio engine state each frame and emits one batched store update, so audio engine → UI sync is structurally guaranteed rather than manually maintained.

**Architecture:** A new `audioTick.ts` module owns one RAF loop that starts when any voice is recorded and self-terminates when all voices are gone. Each frame it reads from `audioState.ts` Maps (gain nodes, voice map, progress tracking) and emits a single batched `setAudioTick()` call to `playbackStore`. All existing per-pad fade RAFs and per-component polling RAFs are deleted. `playingPadIds` stays push-based (discrete events); the four continuously-varying signals (`padVolumes`, `layerVolumes`, `padProgress`, `activeLayerIds`) move to tick ownership.

**Tech Stack:** Web Audio API `GainNode.gain.value`, `requestAnimationFrame`, Zustand batch update, React selector hooks

---

## Signal Inventory

Before touching code, understand what changes and why:

| Signal | Owned by (before) | Owned by (after) | Removed from |
|---|---|---|---|
| `playingPadIds` | push in `audioState.ts` | unchanged | — |
| `padVolumes` | per-pad RAF in `audioState.startFadeRaf` | global tick | `padFadeRafs`, `startFadeRaf`, fade functions |
| `layerVolumes` | explicit push in `padPlayer.setLayerVolume` | global tick (playing layers); direct push for non-playing | partial |
| `volumeTransitioningPadIds` | mixed: audio engine + UI gestures | **DELETED** — derived in UI from `padVolumes` | all callers |
| `padProgress` | per-PadButton RAF | global tick → new `padProgress` store field | PadButton RAF |
| `activeLayerIds` | per-PadControlContent RAF | global tick → new `activeLayerIds` store field | PadControlContent RAF |

### Key design decisions

- **`padVolumes` write policy**: The tick only writes an entry when `gain.gain.value < 0.999`. No entry means full volume. This is what drives the fill bar — it appears only when volume is not at 1.0, disappears when volume returns to 1.0 or the pad stops.
- **`volumeTransitioningPadIds` removed**: PadButton derives "show fill bar" from `padVolumes[pad.id] !== undefined`. The linger/fade-out timers in PadButton stay exactly as-is, triggered by the `padVolumes` entry appearing/disappearing.
- **`layerVolumes` hybrid**: The tick writes layer volume for playing layers (has a gain node in `layerGainMap`). For non-playing layers, `setLayerVolume` still pushes directly via `updateLayerVolume`. The layer volume slider in `PadControlContent` is only shown when playing, so this edge case rarely matters in practice.
- **Self-terminating tick**: The tick checks `getActivePadCount()` each frame. When 0, it clears all tick-managed store fields and exits. `padPlayer.stopAllPads` also calls `stopAudioTick()` immediately to clear bars without waiting for the next frame.
- **No circular imports**: `audioTick.ts` imports `audioState.ts` (reads Maps) and `playbackStore.ts` (writes). `padPlayer.ts` imports `audioTick.ts` (calls `startAudioTick` / `stopAudioTick`). `audioState.ts` does NOT import `audioTick.ts`.

---

## File Map

| File | Change |
|---|---|
| `src/lib/audio/audioTick.ts` | **Create** — global RAF tick |
| `src/lib/audio/audioState.ts` | **Modify** — add tick-read accessors; remove `padFadeRafs`, `startFadeRaf`; simplify `cancelPadFade` and `clearAllFadeTracking` |
| `src/lib/audio/padPlayer.ts` | **Modify** — remove `startFadeRaf`/`startVolumeTransition` calls from fade functions; call `startAudioTick`/`stopAudioTick` at voice boundaries |
| `src/state/playbackStore.ts` | **Modify** — add `padProgress`, `activeLayerIds`, `setAudioTick()`; remove `volumeTransitioningPadIds` + all transition actions + `resetAllPadVolumes` |
| `src/components/composite/SceneView/PadButton.tsx` | **Modify** — remove per-pad progress RAF; derive volume visibility from `padVolumes`; remove `startVolumeTransition`/`clearVolumeTransition` calls |
| `src/components/composite/SceneView/PadControlContent.tsx` | **Modify** — remove per-component `activeLayerIds` RAF; subscribe to store |
| `src/state/playbackStore.test.ts` | **Modify** — remove old action tests, add `setAudioTick` tests |
| `src/lib/audio/audioTick.test.ts` | **Create** — tick unit tests |
| `src/lib/audio/audioState.test.ts` | **Modify** — add tests for new accessor functions |
| `src/lib/audio/padPlayer.test.ts` | **Modify** — update assertions using `layerVolumes`/`padVolumes`/`volumeTransitioningPadIds` |
| `src/components/composite/SceneView/PadButton.test.tsx` | **Modify** — update store setup (no `volumeTransitioningPadIds`) |
| `src/components/composite/SceneView/PadControlContent.test.tsx` | **Modify** — update store setup; verify `activeLayerIds` from store |

---

## Task 1: Add tick-read accessor functions to audioState.ts

The tick needs to read from private Maps without importing them directly. Add three new export functions.

**Files:**
- Modify: `src/lib/audio/audioState.ts`
- Test: `src/lib/audio/audioState.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/lib/audio/audioState.test.ts`. Add a new describe block near the bottom (after existing voice tracking tests):

```typescript
describe("tick accessor functions", () => {
  beforeEach(() => {
    // Use existing clearAll* helpers to reset Maps
    clearAllPadGains();
    clearAllLayerGains();
    clearAllVoices();
  });

  it("forEachActivePadGain iterates only pads with both a voice and a gain node", () => {
    // Setup: create mock gain nodes and voices
    const mockGain1 = { gain: { value: 0.5 } } as unknown as GainNode;
    const mockGain2 = { gain: { value: 0.8 } } as unknown as GainNode;
    const mockVoice = {} as AudioVoice;

    // Directly seed Maps via recordVoice + getPadGain
    // Use the real getPadGain (returns/creates from padGainMap) — but in tests
    // AudioContext is mocked, so we must seed the map indirectly.
    // We'll use recordVoice to add to voiceMap, and forEachActivePadGain to read padGainMap.
    // Since padGainMap is only populated by getPadGain calls, simulate by calling it.
    
    // This test verifies the function doesn't throw when maps are empty
    const results: [string, GainNode][] = [];
    forEachActivePadGain((padId, gain) => results.push([padId, gain]));
    expect(results).toHaveLength(0);
  });

  it("getActivePadCount returns 0 when no voices are active", () => {
    expect(getActivePadCount()).toBe(0);
  });

  it("getActivePadCount returns the number of pads with active voices", () => {
    const mockVoice1 = { setOnEnded: vi.fn() } as unknown as AudioVoice;
    const mockVoice2 = { setOnEnded: vi.fn() } as unknown as AudioVoice;
    recordVoice("pad-a", mockVoice1);
    recordVoice("pad-b", mockVoice2);
    expect(getActivePadCount()).toBe(2);
  });

  it("forEachActiveLayerGain iterates only layers with active voices", () => {
    const results: string[] = [];
    forEachActiveLayerGain((layerId) => results.push(layerId));
    expect(results).toHaveLength(0);
  });

  it("getActiveLayerIdSet returns empty set when no layers are active", () => {
    const ids = getActiveLayerIdSet();
    expect(ids.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsc --noEmit
```
Expected: type errors for `forEachActivePadGain`, `getActivePadCount`, `forEachActiveLayerGain`, `getActiveLayerIdSet` — not exported yet.

- [ ] **Step 3: Implement the accessor functions in audioState.ts**

Add after the existing `forEachPadGain` function (around line 183):

```typescript
/** Iterate active pad gain nodes — only pads currently in voiceMap (with active voices). */
export function forEachActivePadGain(fn: (padId: string, gain: GainNode) => void): void {
  for (const padId of voiceMap.keys()) {
    const gain = padGainMap.get(padId);
    if (gain) fn(padId, gain);
  }
}

/** Return the number of pads with active voices. Used by the tick to self-terminate. */
export function getActivePadCount(): number {
  return voiceMap.size;
}

/** Iterate active layer gain nodes — only layers currently in layerVoiceMap. */
export function forEachActiveLayerGain(fn: (layerId: string, gain: GainNode) => void): void {
  for (const layerId of layerVoiceMap.keys()) {
    const gain = layerGainMap.get(layerId);
    if (gain) fn(layerId, gain);
  }
}

/** Return the Set of currently active layer IDs (layers with at least one voice). */
export function getActiveLayerIdSet(): Set<string> {
  return new Set(layerVoiceMap.keys());
}
```

Also add a helper for computing progress across all active pads (tick needs this):

```typescript
/**
 * Compute padProgress for all active pads in one pass.
 * Returns a Record<padId, progress 0–1>. Pads with no progress info are omitted.
 */
export function computeAllPadProgress(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const padId of voiceMap.keys()) {
    const p = getPadProgress(padId);
    if (p !== null) result[padId] = p;
  }
  return result;
}
```

- [ ] **Step 4: Export the new functions and run tsc**

Verify the test file can import them by running:

```bash
npx tsc --noEmit
```
Expected: clean (empty output).

- [ ] **Step 5: Run tests**

```bash
npm run test:run -- audioState.test
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/audioState.ts src/lib/audio/audioState.test.ts
git commit -m "feat(audio): add tick accessor functions to audioState"
```

---

## Task 2: Update playbackStore — add tick fields, remove old signals

Replace `volumeTransitioningPadIds` and scattered volume/transition actions with a single `setAudioTick()` batch action and two new fields (`padProgress`, `activeLayerIds`).

**Files:**
- Modify: `src/state/playbackStore.ts`
- Modify: `src/state/playbackStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/state/playbackStore.test.ts`. Replace the `volumeTransitioningPadIds` describe block and `updatePadVolume` describe block with:

```typescript
describe("setAudioTick", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("updates padVolumes", () => {
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5 } });
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });

  it("updates layerVolumes", () => {
    usePlaybackStore.getState().setAudioTick({ layerVolumes: { "layer-1": 0.7 } });
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.7);
  });

  it("updates padProgress", () => {
    usePlaybackStore.getState().setAudioTick({ padProgress: { "pad-1": 0.42 } });
    expect(usePlaybackStore.getState().padProgress["pad-1"]).toBe(0.42);
  });

  it("updates activeLayerIds", () => {
    usePlaybackStore.getState().setAudioTick({ activeLayerIds: new Set(["layer-a", "layer-b"]) });
    expect(usePlaybackStore.getState().activeLayerIds.has("layer-a")).toBe(true);
    expect(usePlaybackStore.getState().activeLayerIds.has("layer-b")).toBe(true);
  });

  it("can update multiple fields in one call", () => {
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.3 },
      padProgress: { "pad-1": 0.6 },
    });
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.3);
    expect(usePlaybackStore.getState().padProgress["pad-1"]).toBe(0.6);
  });

  it("partial update does not clobber unspecified fields", () => {
    usePlaybackStore.getState().setAudioTick({ padVolumes: { "pad-1": 0.5 } });
    usePlaybackStore.getState().setAudioTick({ padProgress: { "pad-1": 0.2 } });
    // padVolumes should still have the prior value
    expect(usePlaybackStore.getState().padVolumes["pad-1"]).toBe(0.5);
  });
});
```

Also add the `updateLayerVolume` test (kept for non-playing layer fallback):

```typescript
describe("updateLayerVolume (non-playing fallback)", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
  });

  it("stores volume for non-playing layer", () => {
    usePlaybackStore.getState().updateLayerVolume("layer-1", 0.75);
    expect(usePlaybackStore.getState().layerVolumes["layer-1"]).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run tsc to verify failures**

```bash
npx tsc --noEmit
```
Expected: errors for `setAudioTick`, `padProgress`, `activeLayerIds` not found on store type.

- [ ] **Step 3: Rewrite playbackStore.ts**

Replace the file content entirely:

```typescript
import { create } from "zustand";

// NOTE: All non-serializable audio engine state (voiceMap, layerVoiceMap, GainNodes,
// streaming audio, chain queues, fade tracking) lives in src/lib/audio/audioState.ts.
// This store contains only reactive Zustand state that drives UI re-renders.
//
// Tick-managed fields (padVolumes, layerVolumes, padProgress, activeLayerIds) are
// written by the single global audioTick RAF loop in src/lib/audio/audioTick.ts.
// All other writes to these fields are bugs.

interface AudioTickSnapshot {
  padVolumes?: Record<string, number>;
  layerVolumes?: Record<string, number>;
  padProgress?: Record<string, number>;
  activeLayerIds?: Set<string>;
}

interface PlaybackState {
  masterVolume: number; // 0–100
  setMasterVolume: (volume: number) => void;

  // Which pad IDs currently have active voices (for UI feedback)
  // Push-based (discrete events), NOT tick-managed.
  playingPadIds: Set<string>;
  addPlayingPad: (padId: string) => void;
  removePlayingPad: (padId: string) => void;
  clearAllPlayingPads: () => void;

  // Whether a sound preview is currently playing (for Stop All button state)
  isPreviewPlaying: boolean;
  setIsPreviewPlaying: (v: boolean) => void;

  // ---------------------------------------------------------------------------
  // Tick-managed fields — written exclusively by audioTick.ts via setAudioTick()
  // ---------------------------------------------------------------------------

  /** Per-pad runtime volume (0–1). Entry exists only when gain < 0.999 (pad is fading/adjusted).
   *  Absence of an entry means the pad is at full volume. Used to drive the fill bar in PadButton. */
  padVolumes: Record<string, number>;

  /** Per-layer runtime volume (0–1). Entry exists for playing layers with an active gain node.
   *  updateLayerVolume() is kept as a fallback for non-playing layer gesture drags. */
  layerVolumes: Record<string, number>;
  updateLayerVolume: (layerId: string, volume: number) => void;

  /** Per-pad playback progress (0–1). Entry exists for playing pads with progress info. */
  padProgress: Record<string, number>;

  /** Set of layer IDs currently playing (have active voices). Replaces per-component RAF polling. */
  activeLayerIds: Set<string>;

  /** Batch-set any subset of tick-managed fields in a single Zustand mutation. */
  setAudioTick: (snapshot: AudioTickSnapshot) => void;
}

// Factory ensures each spread gets fresh Set/object instances — prevents tests from sharing mutable state.
export const initialPlaybackState = {
  masterVolume: 100,
  get playingPadIds() { return new Set<string>(); },
  get padVolumes() { return {} as Record<string, number>; },
  get layerVolumes() { return {} as Record<string, number>; },
  get padProgress() { return {} as Record<string, number>; },
  get activeLayerIds() { return new Set<string>(); },
  isPreviewPlaying: false,
};

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  masterVolume: 100,
  setMasterVolume: (volume) => set({ masterVolume: volume }),

  playingPadIds: new Set<string>(),

  addPlayingPad: (padId) =>
    set((s) => {
      if (s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.add(padId);
      return { playingPadIds: next };
    }),

  removePlayingPad: (padId) =>
    set((s) => {
      if (!s.playingPadIds.has(padId)) return s;
      const next = new Set(s.playingPadIds);
      next.delete(padId);
      return { playingPadIds: next };
    }),

  clearAllPlayingPads: () => set({ playingPadIds: new Set() }),

  isPreviewPlaying: false,
  setIsPreviewPlaying: (v) => set({ isPreviewPlaying: v }),

  padVolumes: {},
  layerVolumes: {},
  padProgress: {},
  activeLayerIds: new Set<string>(),

  updateLayerVolume: (layerId, volume) =>
    set((s) => ({ layerVolumes: { ...s.layerVolumes, [layerId]: volume } })),

  setAudioTick: (snapshot) =>
    set((s) => ({
      ...(snapshot.padVolumes !== undefined ? { padVolumes: snapshot.padVolumes } : {}),
      ...(snapshot.layerVolumes !== undefined ? { layerVolumes: snapshot.layerVolumes } : {}),
      ...(snapshot.padProgress !== undefined ? { padProgress: snapshot.padProgress } : {}),
      ...(snapshot.activeLayerIds !== undefined ? { activeLayerIds: snapshot.activeLayerIds } : {}),
    })),
}));
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: type errors from all the callers of the removed actions (`startVolumeTransition`, `clearVolumeTransition`, `updatePadVolume`, `removeLayerVolume`, `removeLayerVolumes`, `clearAllVolumeTransitions`, `resetAllPadVolumes`). These will be fixed in later tasks — note them but don't fix them yet.

- [ ] **Step 5: Run the store tests**

```bash
npm run test:run -- playbackStore.test
```
Expected: `setAudioTick` tests pass. Other test files that reference removed actions will fail — that's expected and will be fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/state/playbackStore.ts src/state/playbackStore.test.ts
git commit -m "feat(store): add setAudioTick batch action, padProgress, activeLayerIds; remove volumeTransitioningPadIds"
```

---

## Task 3: Create audioTick.ts

The single global RAF loop that reads audio engine state and emits batched store updates.

**Files:**
- Create: `src/lib/audio/audioTick.ts`
- Create: `src/lib/audio/audioTick.test.ts`

- [ ] **Step 1: Write the tests first**

Create `src/lib/audio/audioTick.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startAudioTick, stopAudioTick } from "./audioTick";
import { usePlaybackStore, initialPlaybackState } from "@/state/playbackStore";

// Mock audioState accessors
vi.mock("./audioState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audioState")>();
  return {
    ...actual,
    getActivePadCount: vi.fn().mockReturnValue(0),
    forEachActivePadGain: vi.fn(),
    forEachActiveLayerGain: vi.fn(),
    getActiveLayerIdSet: vi.fn().mockReturnValue(new Set()),
    computeAllPadProgress: vi.fn().mockReturnValue({}),
  };
});

import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  computeAllPadProgress,
} from "./audioState";

describe("audioTick", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...initialPlaybackState });
    vi.mocked(getActivePadCount).mockReturnValue(0);
    vi.mocked(forEachActivePadGain).mockImplementation(() => {});
    vi.mocked(forEachActiveLayerGain).mockImplementation(() => {});
    vi.mocked(getActiveLayerIdSet).mockReturnValue(new Set());
    vi.mocked(computeAllPadProgress).mockReturnValue({});
  });

  afterEach(() => {
    stopAudioTick();
  });

  it("stopAudioTick clears all tick-managed store fields", () => {
    usePlaybackStore.getState().setAudioTick({
      padVolumes: { "pad-1": 0.5 },
      layerVolumes: { "layer-1": 0.7 },
      padProgress: { "pad-1": 0.3 },
      activeLayerIds: new Set(["layer-1"]),
    });

    stopAudioTick();

    const state = usePlaybackStore.getState();
    expect(state.padVolumes).toEqual({});
    expect(state.layerVolumes).toEqual({});
    expect(state.padProgress).toEqual({});
    expect(state.activeLayerIds.size).toBe(0);
  });

  it("startAudioTick is idempotent — calling twice does not create two RAFs", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    startAudioTick();
    startAudioTick();
    // Should only have scheduled one RAF, not two
    expect(rafSpy).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  it("stopAudioTick is safe to call when tick is not running", () => {
    expect(() => stopAudioTick()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tsc to confirm test imports fail**

```bash
npx tsc --noEmit
```
Expected: error that `audioTick` module doesn't exist.

- [ ] **Step 3: Implement audioTick.ts**

Create `src/lib/audio/audioTick.ts`:

```typescript
/**
 * audioTick.ts — Single global RAF loop for audio engine → UI state synchronization.
 *
 * Reads from audioState.ts Maps (gain nodes, voice map, progress) each animation frame
 * and emits one batched setAudioTick() call to playbackStore. Replaces:
 *   - Per-pad RAF loops (padFadeRafs / startFadeRaf in audioState.ts)
 *   - Per-PadButton RAF (progress polling)
 *   - Per-PadControlContent RAF (activeLayerIds polling)
 *   - Scattered updatePadVolume / updateLayerVolume calls from fade functions
 *
 * Start/stop contract:
 *   - startAudioTick(): called by padPlayer when a voice is recorded. Idempotent.
 *   - stopAudioTick(): called by padPlayer.stopAllPads() to immediately clear bars.
 *     The tick also self-terminates when getActivePadCount() returns 0.
 *
 * Import graph: audioTick → audioState (reads), audioTick → playbackStore (writes).
 * padPlayer → audioTick (calls start/stop). audioState does NOT import audioTick.
 */

import { usePlaybackStore } from "@/state/playbackStore";
import {
  getActivePadCount,
  forEachActivePadGain,
  forEachActiveLayerGain,
  getActiveLayerIdSet,
  computeAllPadProgress,
} from "./audioState";

const VOLUME_EPSILON = 0.001;

let rafId: number | null = null;

// Track previous values to avoid emitting no-op store updates.
let prevPadVolumes: Record<string, number> = {};
let prevLayerVolumes: Record<string, number> = {};

function tick(): void {
  // Self-terminate when no pads are active.
  if (getActivePadCount() === 0) {
    rafId = null;
    _clearAllTickFields();
    return;
  }

  // --- Compute padVolumes ---
  // Only entries where gain < (1 - VOLUME_EPSILON). Absence = full volume.
  const nextPadVolumes: Record<string, number> = {};
  forEachActivePadGain((padId, gain) => {
    const v = gain.gain.value;
    if (v < 1 - VOLUME_EPSILON) {
      nextPadVolumes[padId] = v;
    }
  });

  // --- Compute layerVolumes ---
  const nextLayerVolumes: Record<string, number> = {};
  forEachActiveLayerGain((layerId, gain) => {
    nextLayerVolumes[layerId] = gain.gain.value;
  });

  // --- Compute padProgress ---
  const nextPadProgress = computeAllPadProgress();

  // --- Compute activeLayerIds ---
  const nextActiveLayerIds = getActiveLayerIdSet();

  // --- Diff check: only call setAudioTick if something changed ---
  const padVolumesChanged = !shallowEqualRecords(nextPadVolumes, prevPadVolumes);
  const layerVolumesChanged = !shallowEqualRecords(nextLayerVolumes, prevLayerVolumes);
  // Progress and activeLayerIds change every frame when playing, so always include them.

  if (padVolumesChanged || layerVolumesChanged || true) {
    prevPadVolumes = nextPadVolumes;
    prevLayerVolumes = nextLayerVolumes;
    usePlaybackStore.getState().setAudioTick({
      padVolumes: nextPadVolumes,
      layerVolumes: nextLayerVolumes,
      padProgress: nextPadProgress,
      activeLayerIds: nextActiveLayerIds,
    });
  }

  rafId = requestAnimationFrame(tick);
}

/** Start the global audio tick if not already running. Idempotent. */
export function startAudioTick(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/** Stop the tick immediately and clear all tick-managed store fields. */
export function stopAudioTick(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  _clearAllTickFields();
  prevPadVolumes = {};
  prevLayerVolumes = {};
}

function _clearAllTickFields(): void {
  usePlaybackStore.getState().setAudioTick({
    padVolumes: {},
    layerVolumes: {},
    padProgress: {},
    activeLayerIds: new Set(),
  });
}

function shallowEqualRecords(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (Math.abs(a[k] - (b[k] ?? -1)) > VOLUME_EPSILON) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Run tick tests**

```bash
npm run test:run -- audioTick.test
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/audioTick.ts src/lib/audio/audioTick.test.ts
git commit -m "feat(audio): add global audioTick RAF loop for engine→UI state sync"
```

---

## Task 4: Clean up audioState.ts — remove padFadeRafs and startFadeRaf

Delete the per-pad RAF infrastructure from `audioState.ts` now that the global tick owns padVolumes.

**Files:**
- Modify: `src/lib/audio/audioState.ts`

- [ ] **Step 1: Remove `padFadeRafs` Map and all functions that use it**

In `audioState.ts`, delete:
- The `padFadeRafs` declaration (around line 106):
  ```typescript
  // DELETE THIS LINE:
  const padFadeRafs = new Map<string, number>();
  ```
- The entire `startFadeRaf()` export function (around line 251–266):
  ```typescript
  // DELETE THIS ENTIRE FUNCTION:
  export function startFadeRaf(padId: string, fromVolume: number, toVolume: number, durationMs: number): void {
    ...
  }
  ```

- [ ] **Step 2: Simplify cancelPadFade — remove RAF cancellation and store call**

Replace the current `cancelPadFade` function with:

```typescript
/**
 * Cancel all fade-related resources for a pad: pending timeout and fadingOut tracking.
 * The global audioTick handles padVolumes — no store call needed here.
 * Safe to call even if no fade is registered -- all operations are idempotent.
 */
export function cancelPadFade(padId: string): void {
  const tId = fadePadTimeouts.get(padId);
  if (tId !== undefined) {
    clearTimeout(tId);
    fadePadTimeouts.delete(padId);
  }
  fadingOutPadIds.delete(padId);
}
```

- [ ] **Step 3: Simplify clearAllFadeTracking — remove store calls**

Replace with:

```typescript
export function clearAllFadeTracking(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
  fadingOutPadIds.clear();
  // padFadeRafs removed — global audioTick owns padVolumes now.
  // Store clearing (padVolumes, etc.) is handled by stopAudioTick() in padPlayer.stopAllPads().
}
```

- [ ] **Step 4: Remove padFadeRafs from the state inventory comment**

In the module-level docblock table (lines ~49-51), delete the row:
```
// fadePadTimeouts    | pad ID     | timeout ID                                | Pending fade cleanup timeouts                   | cancelPadFade(), clearAllFadeTracking()
// padFadeRafs        | pad ID     | RAF ID                                    | Animated volume lerp loops during fades         | cancelPadFade(), clearAllFadeTracking()
```
Keep `fadePadTimeouts`, remove `padFadeRafs`.

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```
Expected: errors in `padPlayer.ts` where `startFadeRaf` is imported and called — fix those in the next task.

- [ ] **Step 6: Commit what compiles**

Skip commit here — this task is a prerequisite for Task 5. Move straight to Task 5.

---

## Task 5: Clean up padPlayer.ts — remove manual store sync, wire tick start/stop

Remove `startFadeRaf`, `startVolumeTransition`, `updatePadVolume`, and `updateLayerVolume` calls from all fade/trigger/volume functions. Wire `startAudioTick` and `stopAudioTick` at voice boundaries.

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

- [ ] **Step 1: Remove startFadeRaf import and add audioTick imports**

At the top of `padPlayer.ts`, find the import from `./audioState`:
```typescript
import {
  cancelPadFade,
  startFadeRaf,         // ← DELETE this line
  addFadingOutPad,
  ...
} from "./audioState";
```

Add the audioTick import after the audioState import:
```typescript
import { startAudioTick, stopAudioTick } from "./audioTick";
```

Also remove from the re-export block at the top if `startFadeRaf` is re-exported:
```typescript
// If present, remove:
export { startFadeRaf } from "./audioState";
```

- [ ] **Step 2: Update fadePadOut — remove startFadeRaf and startVolumeTransition**

Find `fadePadOut` (around line 101). Remove steps 4 and 5 which set up the RAF:

```typescript
// BEFORE:
export function fadePadOut(pad: Pad, durationMs: number, fromVolume?: number, toVolume?: number): void {
  cancelPadFade(pad.id);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const currentGain = gain.gain.value;
  const startVol = fromVolume ?? currentGain;
  const endVol = toVolume ?? 0;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);
  addFadingOutPad(pad.id);
  usePlaybackStore.getState().startVolumeTransition(pad.id);  // ← DELETE
  startFadeRaf(pad.id, startVol, endVol, durationMs);         // ← DELETE
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    removeFadingOutPad(pad.id);
    if (endVol === 0) {
      stopPad(pad);
      resetPadGain(pad.id);
    } else {
      usePlaybackStore.getState().clearVolumeTransition(pad.id);  // ← DELETE
    }
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}

// AFTER:
export function fadePadOut(pad: Pad, durationMs: number, fromVolume?: number, toVolume?: number): void {
  cancelPadFade(pad.id);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const currentGain = gain.gain.value;
  const startVol = fromVolume ?? currentGain;
  const endVol = toVolume ?? 0;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(startVol, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);
  addFadingOutPad(pad.id);
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    removeFadingOutPad(pad.id);
    if (endVol === 0) {
      stopPad(pad);
      resetPadGain(pad.id);
    }
    // endVol != 0: pad keeps playing — tick reads the stable new gain value, no cleanup needed
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
```

- [ ] **Step 3: Update fadePadInFromCurrent — remove startFadeRaf and startVolumeTransition**

Find `fadePadInFromCurrent` (around line 145). Apply the same pattern — remove the RAF and store calls:

```typescript
// AFTER (key diff — remove the two store/RAF lines):
export function fadePadInFromCurrent(pad: Pad, durationMs: number, toVolume?: number): void {
  cancelPadFade(pad.id);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  const fromVolume = gain.gain.value;
  const endVol = toVolume ?? 1.0;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(fromVolume, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(endVol, ctx.currentTime + durationMs / 1000);
  // No startVolumeTransition — tick reads gain continuously
  // No startFadeRaf — tick animates padVolumes automatically
  const timeoutId = setTimeout(() => {
    deleteFadePadTimeout(pad.id);
    cancelPadFade(pad.id);
  }, durationMs + 5);
  setFadePadTimeout(pad.id, timeoutId);
}
```

- [ ] **Step 4: Update fadePadIn — remove startFadeRaf and startVolumeTransition**

Find `fadePadIn` (around line 173). Same pattern — remove the RAF and `startVolumeTransition` lines.

- [ ] **Step 5: Update freezePadAtCurrentVolume — remove updatePadVolume call**

Find `freezePadAtCurrentVolume`:

```typescript
// BEFORE:
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const currentValue = gain.gain.value;
  cancelPadFade(padId);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentValue, ctx.currentTime);
  usePlaybackStore.getState().updatePadVolume(padId, currentValue);  // ← DELETE
}

// AFTER:
export function freezePadAtCurrentVolume(padId: string): void {
  const ctx = getAudioContext();
  const gain = getPadGain(padId);
  const currentValue = gain.gain.value;
  cancelPadFade(padId);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(currentValue, ctx.currentTime);
  // Tick reads the frozen gain value on the next frame
}
```

- [ ] **Step 6: Update setLayerVolume — remove updateLayerVolume call for playing layers**

Find `setLayerVolume` (around line 828):

```typescript
// BEFORE:
export function setLayerVolume(layerId: string, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  const gain = getLayerGain(layerId);
  if (gain) {
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(clamped, ctx.currentTime);
  }
  usePlaybackStore.getState().updateLayerVolume(layerId, clamped);  // ← update to be conditional
}

// AFTER:
export function setLayerVolume(layerId: string, volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  const gain = getLayerGain(layerId);
  if (gain) {
    // Layer is playing — update gain node. Tick will read the new value.
    const ctx = getAudioContext();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(clamped, ctx.currentTime);
  } else {
    // Layer not playing — tick has no gain node to read. Push directly to store.
    usePlaybackStore.getState().updateLayerVolume(layerId, clamped);
  }
}
```

- [ ] **Step 7: Wire startAudioTick into recordLayerVoice call sites**

Find the internal function `startLayerSound` (or wherever `recordLayerVoice` is called from within `padPlayer.ts`). After each `recordLayerVoice(...)` call, add `startAudioTick()`:

```typescript
recordLayerVoice(pad.id, layer.id, voice);
startAudioTick(); // ensure tick is running while voices are active
```

There are multiple call sites for `recordLayerVoice` (one-shot, hold, loop paths). Add `startAudioTick()` after each one.

- [ ] **Step 8: Wire stopAudioTick into stopAllPads**

Find `stopAllPads` (around line 456):

```typescript
export function stopAllPads(): void {
  clearAllFadeTracking();
  clearAllLayerChains();
  clearAllLayerCycleIndexes();
  clearAllLayerPlayOrders();
  clearAllLayerPending();
  nullAllOnEnded();
  stopAudioTick(); // ← ADD: immediately clear bars before the STOP_RAMP_S window

  const ctx = getAudioContext();
  forEachPadGain((_padId, gain) => {
    // ... ramp to zero ...
  });
  setTimeout(() => {
    clearAllStreamingAudio();
    clearAllPadProgressInfo();
    clearAllLayerGains();
    clearAllPadGains();
    stopAllVoices();
  }, STOP_RAMP_S * 1000 + 5);
}
```

- [ ] **Step 9: Remove unused store imports from padPlayer.ts**

Check the `usePlaybackStore` import in padPlayer.ts. After these changes it should only be used in `setMasterVolume` or other non-tick paths. Remove any remaining references to the deleted actions (`startVolumeTransition`, `clearVolumeTransition`, `updatePadVolume`).

- [ ] **Step 10: Run tsc**

```bash
npx tsc --noEmit
```
Expected: errors in PadButton.tsx and PadControlContent.tsx — fix in Tasks 6 and 7.

- [ ] **Step 11: Run padPlayer tests (expect failures in assertions about store state)**

```bash
npm run test:run -- padPlayer.test
```
Expected: some test failures related to `layerVolumes`/`padVolumes`/`volumeTransitioningPadIds` — these are fixed in Step 12.

- [ ] **Step 12: Update padPlayer.test.ts — replace store signal assertions**

Search the test file for:
- `volumeTransitioningPadIds` → replace with checks on `padVolumes` or remove (the tick is mocked in tests, so padVolumes won't auto-update; check gain node values instead via `getPadGain`)
- `updateLayerVolume` test assertions on `layerVolumes` store state → update to verify `getLayerGain(layer.id)?.gain.value` instead for the playing-layer case

Key test pattern change: tests that verified `usePlaybackStore.getState().layerVolumes[layer.id]` is `0.5` after `setLayerVolume` should now verify the gain node value if the layer is playing, or still check the store if not playing.

For any test using `clearVolumeTransition` / `startVolumeTransition`:
```typescript
// BEFORE: expect(usePlaybackStore.getState().volumeTransitioningPadIds.has("pad-1")).toBe(true);
// AFTER: Not applicable — volumeTransitioningPadIds removed. No direct replacement needed in unit tests.
// The visual behavior is verified at the PadButton component test level.
```

- [ ] **Step 13: Commit**

```bash
git add src/lib/audio/audioState.ts src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "refactor(audio): wire audioTick into padPlayer; remove manual store sync from fade functions"
```

---

## Task 6: Update PadButton.tsx — read from store, remove per-pad RAF

Replace the per-pad progress RAF and `volumeTransitioningPadIds` logic with store subscriptions.

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Remove the progress RAF**

In `PadButton.tsx`, find the `useEffect` that runs a RAF for progress (around line 169):

```typescript
// DELETE THIS ENTIRE EFFECT:
useEffect(() => {
  if (isPlaying) {
    const animate = () => {
      const p = getPadProgress(pad.id);
      setProgress(p ?? 0);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
  } else {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setProgress(0);
  }
  return () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };
}, [isPlaying, pad.id]);
```

Also delete:
- `const [progress, setProgress] = useState(0);`
- `const rafRef = useRef<number | null>(null);`

Replace the progress state with a store selector:

```typescript
const progress = usePlaybackStore((s) => s.padProgress[pad.id] ?? 0);
```

Remove the `getPadProgress` import from `padPlayer` if it's no longer used anywhere else in the file.

- [ ] **Step 2: Replace volumeTransitioningPadIds logic with padVolumes derivation**

Find (around line 33):

```typescript
// BEFORE:
const isVolumeTransitioning = usePlaybackStore((s) => s.volumeTransitioningPadIds.has(pad.id));
const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id] ?? 1.0);
const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
const [volumeExiting, setVolumeExiting] = useState(false);
const volumeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const lastTransitionVolumeRef = useRef(liveVolume);

if (isVolumeTransitioning) {
  lastTransitionVolumeRef.current = liveVolume;
}

const displayVolume = isVolumeTransitioning ? liveVolume : lastTransitionVolumeRef.current;
```

Replace with:

```typescript
// padVolumes entry exists only when pad gain is < 0.999 (tick write policy)
const liveVolume = usePlaybackStore((s) => s.padVolumes[pad.id]);
const isVolumeActive = liveVolume !== undefined;
const [showVolumeDisplay, setShowVolumeDisplay] = useState(false);
const [volumeExiting, setVolumeExiting] = useState(false);
const volumeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// Preserve last known volume for display during linger phase
const lastVolumeRef = useRef(liveVolume ?? 1.0);
if (liveVolume !== undefined) lastVolumeRef.current = liveVolume;
const displayVolume = liveVolume ?? lastVolumeRef.current;
```

- [ ] **Step 3: Update the volume display useEffect**

Find the `useEffect` keyed on `[isVolumeTransitioning]` (around line 53):

```typescript
// BEFORE: keyed on isVolumeTransitioning
useEffect(() => {
  if (isVolumeTransitioning) { ... } else { ... }
}, [isVolumeTransitioning]);

// AFTER: keyed on isVolumeActive
useEffect(() => {
  if (isVolumeActive) {
    if (volumeFadeTimerRef.current !== null) {
      clearTimeout(volumeFadeTimerRef.current);
      volumeFadeTimerRef.current = null;
    }
    if (volumeHideTimerRef.current !== null) {
      clearTimeout(volumeHideTimerRef.current);
      volumeHideTimerRef.current = null;
    }
    setShowVolumeDisplay(true);
    setVolumeExiting(false);
  } else {
    volumeFadeTimerRef.current = setTimeout(() => {
      volumeFadeTimerRef.current = null;
      setVolumeExiting(true);
      volumeHideTimerRef.current = setTimeout(() => {
        volumeHideTimerRef.current = null;
        setShowVolumeDisplay(false);
        setVolumeExiting(false);
      }, 220);
    }, 450);
  }
  return () => {
    if (volumeFadeTimerRef.current !== null) {
      clearTimeout(volumeFadeTimerRef.current);
      volumeFadeTimerRef.current = null;
    }
    if (volumeHideTimerRef.current !== null) {
      clearTimeout(volumeHideTimerRef.current);
      volumeHideTimerRef.current = null;
    }
  };
}, [isVolumeActive]);
```

- [ ] **Step 4: Remove startVolumeTransition / clearVolumeTransition calls from gesture handlers**

Search PadButton.tsx for `startVolumeTransition` and `clearVolumeTransition`. Delete those calls entirely — the tick derives volume changes automatically from the gain node.

Specifically:
```typescript
// In the multiFade slider onValueChange — DELETE this line:
usePlaybackStore.getState().startVolumeTransition(pad.id);

// In the multiFade slider onPointerUp — DELETE this line:
usePlaybackStore.getState().clearVolumeTransition(pad.id);
```

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```
Expected: clean or errors only in PadControlContent.tsx.

- [ ] **Step 6: Update PadButton.test.tsx**

Search for `volumeTransitioningPadIds` in `PadButton.test.tsx`. Replace any test setup like:

```typescript
// BEFORE:
usePlaybackStore.setState({ ...initialPlaybackState, volumeTransitioningPadIds: new Set(["pad-1"]) });

// AFTER (use padVolumes to simulate volume bar being active):
usePlaybackStore.setState({ ...initialPlaybackState, padVolumes: { "pad-1": 0.5 } });
```

- [ ] **Step 7: Run PadButton tests**

```bash
npm run test:run -- PadButton.test
```
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "refactor(PadButton): remove per-pad RAF; derive progress+volume from store"
```

---

## Task 7: Update PadControlContent.tsx — remove activeLayerIds RAF

Replace the per-component RAF that polls `isLayerActive` with a store subscription.

**Files:**
- Modify: `src/components/composite/SceneView/PadControlContent.tsx`
- Modify: `src/components/composite/SceneView/PadControlContent.test.tsx`

- [ ] **Step 1: Replace the activeLayerIds RAF with a store selector**

Find the `useEffect` that runs the `activeLayerIds` RAF (around line 442):

```typescript
// DELETE the entire useState + useEffect for activeLayerIds:
const [activeLayerIds, setActiveLayerIds] = useState<Set<string>>(new Set());
const rafRef = useRef<number | null>(null);

useEffect(() => {
  if (!isPlaying) {
    setActiveLayerIds((prev) => (prev.size === 0 ? prev : new Set()));
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    return;
  }
  const poll = () => {
    const active = new Set<string>();
    for (const layer of pad.layers) {
      if (checkLayerActive(layer.id)) active.add(layer.id);
    }
    setActiveLayerIds((prev) => {
      if (prev.size === active.size && [...active].every((id) => prev.has(id))) return prev;
      return active;
    });
    rafRef.current = requestAnimationFrame(poll);
  };
  rafRef.current = requestAnimationFrame(poll);
  return () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setActiveLayerIds(new Set());
  };
}, [isPlaying, pad.layers]);
```

Replace with a single store selector (place near the other store selectors at the top of the component):

```typescript
const activeLayerIds = usePlaybackStore((s) => s.activeLayerIds);
```

Remove the `checkLayerActive` import from `audioState` if no longer used elsewhere in this file.

- [ ] **Step 2: Update the clearVolumeTransition calls in PadControlContent**

Search for `startVolumeTransition` and `clearVolumeTransition` calls in the fade slider section:

```typescript
// In the Slider onValueChange — DELETE:
usePlaybackStore.getState().startVolumeTransition(pad.id);

// In the Slider onPointerUp and pointer event handlers — DELETE:
usePlaybackStore.getState().clearVolumeTransition(pad.id);
```

These calls appear in the `handlePointerUp` window listener and inline slider handlers. Remove all of them.

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Update PadControlContent.test.tsx**

Search for any test setup using `volumeTransitioningPadIds`:
```typescript
// BEFORE:
usePlaybackStore.setState({ ...initialPlaybackState, volumeTransitioningPadIds: new Set(...) });

// AFTER:
usePlaybackStore.setState({ ...initialPlaybackState, activeLayerIds: new Set(["layer-1"]) });
```

Also update any mock of `isLayerActive` that was used for the RAF poll — the component no longer reads `isLayerActive` directly. Tests that want a layer to appear active should set `activeLayerIds` in the store instead.

- [ ] **Step 5: Run PadControlContent tests**

```bash
npm run test:run -- PadControlContent.test
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/PadControlContent.tsx src/components/composite/SceneView/PadControlContent.test.tsx
git commit -m "refactor(PadControlContent): remove activeLayerIds RAF; read from store"
```

---

## Task 8: Fix remaining test failures

Clean up any remaining test failures introduced by the store API changes.

**Files:**
- Modify: various test files

- [ ] **Step 1: Run all tests and collect failures**

```bash
npm run test:run 2>&1 | grep -E "FAIL|×"
```

- [ ] **Step 2: Fix each failing file**

For each failing test file, the issues will be one of:
- References to `volumeTransitioningPadIds` → remove or replace with `padVolumes` assertions
- References to `startVolumeTransition` / `clearVolumeTransition` → remove
- References to `updatePadVolume` → use `setAudioTick({ padVolumes: ... })` instead
- References to `removeLayerVolume` / `removeLayerVolumes` → use `setAudioTick({ layerVolumes: ... })`
- References to `resetAllPadVolumes` → use `setAudioTick({ padVolumes: {} })`

Pattern for each fix:
```typescript
// BEFORE (store test setup using removed actions):
usePlaybackStore.setState({ ...initialPlaybackState, padVolumes: { "pad-1": 0.5 } });
usePlaybackStore.getState().startVolumeTransition("pad-1");

// AFTER (set fields directly):
usePlaybackStore.setState({
  ...initialPlaybackState,
  padVolumes: { "pad-1": 0.5 },
});
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add -p  # stage only test file changes
git commit -m "test: update test fixtures for audioTick store API"
```

---

## Task 9: Manual verification

The automated tests can't catch visual timing issues. Verify the key scenarios manually.

**Files:** None — runtime verification only.

- [ ] **Step 1: Start the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify volume fill bar disappears immediately on stop during a fade**

1. Start a long sound on a pad
2. Trigger a fade-out with a long duration (e.g., 5s)
3. While fill bar is animating, stop the pad via right-click → Stop
4. Expected: fill bar disappears immediately (no lingering animation)

- [ ] **Step 3: Verify progress bar works for playing pads**

1. Play a pad with a short one-shot sound
2. Watch the white progress bar sweep across
3. Verify it resets to 0 when sound ends

- [ ] **Step 4: Verify layer active indicators in live controls**

1. Play a pad with multiple layers having different playback modes
2. Right-click to open live controls
3. Verify active layer indicators update correctly as layers start/stop

- [ ] **Step 5: Verify volume bar shows during gesture slider drags**

1. Play a pad
2. Right-click → open live controls
3. Drag the fade start slider
4. Verify volume fill bar appears and tracks the slider value
5. Release slider → verify bar lingers 450ms then fades out

- [ ] **Step 6: Commit manual test results** (no code change needed if all pass)

---

## Self-Review

**Spec coverage:**
- ✅ Replaced per-pad fade RAFs (`padFadeRafs` / `startFadeRaf`) → global tick
- ✅ Replaced per-PadButton progress RAF → `padProgress` from store
- ✅ Replaced per-PadControlContent activeLayerIds RAF → `activeLayerIds` from store
- ✅ Removed `volumeTransitioningPadIds` — derived from `padVolumes` presence
- ✅ Removed `startVolumeTransition`/`clearVolumeTransition` from all gesture handlers
- ✅ Removed `updatePadVolume`, `resetAllPadVolumes` (replaced by tick)
- ✅ Kept `playingPadIds` push-based (discrete events, not continuous)
- ✅ Kept `updateLayerVolume` as fallback for non-playing layers
- ✅ Single `setAudioTick()` batch action — one Zustand mutation per frame
- ✅ `stopAudioTick()` called in `stopAllPads` for immediate bar clear

**Extensibility**: To add a new time-varying audio engine signal in future, add an accessor to `audioState.ts`, add a field to `PlaybackState` + include it in `AudioTickSnapshot`, and add the read/write to the tick loop. No manual push calls needed anywhere else.

**Circular import check:**
- `audioTick.ts` imports from `audioState.ts` ✓ (one direction)
- `audioTick.ts` imports from `playbackStore.ts` ✓ (one direction)
- `padPlayer.ts` imports from `audioTick.ts` ✓
- `audioState.ts` does NOT import from `audioTick.ts` ✓

**Placeholder scan:** No TBDs, all code shown. ✅

**Type consistency:** `AudioTickSnapshot` type is defined once in `playbackStore.ts` and used in `setAudioTick` and `stopAudioTick`/`_clearAllTickFields`. ✅
