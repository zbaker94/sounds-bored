# Robust Audio Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `[0, 1]` gain ceiling in normalization with a configurable max-boost cap, and add a per-pad `DynamicsCompressorNode` (limiter) and a per-preview limiter so quiet sounds get properly boosted and loud transients are squashed.

**Architecture:** A new `normalizationConfig.ts` holds the typed config shape and safe defaults. `gainNormalization.ts` uses it to cap the normalization multiplier at `maxBoostDb` instead of 1.0 and exports a `createLimiterNode` factory. `audioState.ts` inserts a `DynamicsCompressorNode` between `padGain` and `masterGain` for every pad; `preview.ts` does the same for each preview session. The graph after the change is: `source → voiceGain → layerGain → padGain → padLimiter → masterGain → destination`.

**Tech Stack:** TypeScript strict, Web Audio API (`DynamicsCompressorNode`), Vitest + Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/audio/normalizationConfig.ts` | **Create** | `NormalizationConfig` type + `DEFAULT_NORMALIZATION_CONFIG` |
| `src/lib/audio/gainNormalization.ts` | **Modify** | Raise boost cap using config; add `createLimiterNode` factory |
| `src/lib/audio/audioState.ts` | **Modify** | `padLimiterMap`; per-pad limiter in `getPadGain`; cleanup in 3 functions |
| `src/lib/audio/preview.ts` | **Modify** | Per-session `currentPreviewLimiter`; wire both paths; tear down in `stopPreview` |
| `src/lib/audio/gainNormalization.test.ts` | **Modify** | Update 1.0-cap test; add max-boost cap test; add `createLimiterNode` test |
| `src/lib/audio/audioState.test.ts` | **Modify** | Mock `createDynamicsCompressor`; add limiter-wiring and cleanup tests |
| `src/lib/audio/preview.test.ts` | **Modify** | Mock `createDynamicsCompressor`; test limiter creation and teardown |

---

## Task 1: Create `normalizationConfig.ts`

**Files:**
- Create: `src/lib/audio/normalizationConfig.ts`

- [ ] **Step 1: Create the config file**

```typescript
// src/lib/audio/normalizationConfig.ts
export interface NormalizationConfig {
  targetLufs: number;
  maxBoostDb: number;
  limiter: {
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
  };
}

export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  targetLufs: -14,
  maxBoostDb: 12,
  limiter: {
    threshold: -2,
    knee: 0,
    ratio: 20,
    attack: 0.001,
    release: 0.1,
  },
};
```

No tests — this is a pure constants/types file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio/normalizationConfig.ts
git commit -m "feat: add NormalizationConfig type and defaults"
```

---

## Task 2: Update `gainNormalization.ts` — raise cap, add `createLimiterNode`

**Files:**
- Modify: `src/lib/audio/gainNormalization.ts`
- Modify: `src/lib/audio/gainNormalization.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `src/lib/audio/gainNormalization.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import {
  computeNormalizationGain,
  normalizedVoiceGain,
  createLimiterNode,
} from "./gainNormalization";
import { DEFAULT_NORMALIZATION_CONFIG } from "./normalizationConfig";

describe("computeNormalizationGain", () => {
  it("returns 1.0 when measured equals target", () => {
    expect(computeNormalizationGain(-14, -14)).toBeCloseTo(1.0);
  });

  it("returns gain > 1.0 for a quiet sound (measured below target)", () => {
    const gain = computeNormalizationGain(-20, -14);
    expect(gain).toBeGreaterThan(1.0);
  });

  it("returns gain < 1.0 for a loud sound (measured above target)", () => {
    const gain = computeNormalizationGain(-8, -14);
    expect(gain).toBeLessThan(1.0);
  });

  it("uses -14 LUFS as the default target", () => {
    expect(computeNormalizationGain(-14)).toBeCloseTo(1.0);
    expect(computeNormalizationGain(-20)).toBeCloseTo(computeNormalizationGain(-20, -14));
  });

  it("computes correct gain for +6 dB boost (-20 LUFS → -14 LUFS)", () => {
    const gain = computeNormalizationGain(-20, -14);
    expect(gain).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it("computes correct gain for -6 dB attenuation (-8 LUFS → -14 LUFS)", () => {
    const gain = computeNormalizationGain(-8, -14);
    expect(gain).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });

  it("respects a custom targetLufs", () => {
    const gain = computeNormalizationGain(-23, -23);
    expect(gain).toBeCloseTo(1.0);
  });
});

describe("normalizedVoiceGain", () => {
  it("returns rawGain unchanged when loudnessLufs is undefined", () => {
    expect(normalizedVoiceGain(0.8, undefined)).toBe(0.8);
    expect(normalizedVoiceGain(1.0, undefined)).toBe(1.0);
    expect(normalizedVoiceGain(0.0, undefined)).toBe(0.0);
  });

  it("boosts a quiet sound (rawGain 0.5 at -20 LUFS)", () => {
    // -20 LUFS → -14 LUFS = +6 dB ≈ ×1.995; rawGain 0.5 → ≈0.998 (within cap)
    const result = normalizedVoiceGain(0.5, -20);
    expect(result).toBeCloseTo(Math.pow(10, 6 / 20) * 0.5, 5);
  });

  it("allows boost above 1.0 for quiet sounds within the max boost cap", () => {
    // -20 LUFS → +6 dB ≈ ×1.995; rawGain 1.0 → ≈1.995 (cap is +12 dB = ×3.981)
    expect(normalizedVoiceGain(1.0, -20)).toBeCloseTo(Math.pow(10, 6 / 20), 5);
  });

  it("clamps normalization gain at maxBoostDb when the required boost is too large", () => {
    // -40 LUFS wants +26 dB (×19.95) but maxBoostDb=12 caps at ×3.981
    const maxGain = Math.pow(10, DEFAULT_NORMALIZATION_CONFIG.maxBoostDb / 20);
    expect(normalizedVoiceGain(1.0, -40)).toBeCloseTo(maxGain, 4);
  });

  it("attenuates a loud sound below rawGain", () => {
    // -8 LUFS → -14 LUFS = -6 dB ≈ ×0.501; rawGain 1.0 → ≈0.501
    const result = normalizedVoiceGain(1.0, -8);
    expect(result).toBeCloseTo(Math.pow(10, -6 / 20), 5);
    expect(result).toBeLessThan(1.0);
  });

  it("returns rawGain when loudness equals target (no-op normalization)", () => {
    expect(normalizedVoiceGain(1.0, -14)).toBeCloseTo(1.0);
    expect(normalizedVoiceGain(0.5, -14)).toBeCloseTo(0.5);
  });

  it("respects a custom config with different maxBoostDb", () => {
    const config = { ...DEFAULT_NORMALIZATION_CONFIG, maxBoostDb: 6 };
    const maxGain = Math.pow(10, 6 / 20); // ≈1.995
    // -40 LUFS wants +26 dB but cap is +6 dB
    expect(normalizedVoiceGain(1.0, -40, config)).toBeCloseTo(maxGain, 4);
  });
});

describe("createLimiterNode", () => {
  it("creates a DynamicsCompressorNode configured from DEFAULT_NORMALIZATION_CONFIG", () => {
    const mockLimiter = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
    };
    const mockCtx = {
      createDynamicsCompressor: vi.fn(() => mockLimiter),
    } as unknown as AudioContext;

    const result = createLimiterNode(mockCtx);

    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(mockLimiter.threshold.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.threshold);
    expect(mockLimiter.knee.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.knee);
    expect(mockLimiter.ratio.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.ratio);
    expect(mockLimiter.attack.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.attack);
    expect(mockLimiter.release.value).toBe(DEFAULT_NORMALIZATION_CONFIG.limiter.release);
    expect(result).toBe(mockLimiter);
  });

  it("applies a custom config when provided", () => {
    const customConfig = {
      ...DEFAULT_NORMALIZATION_CONFIG,
      limiter: { threshold: -6, knee: 3, ratio: 10, attack: 0.005, release: 0.2 },
    };
    const mockLimiter = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
    };
    const mockCtx = {
      createDynamicsCompressor: vi.fn(() => mockLimiter),
    } as unknown as AudioContext;

    createLimiterNode(mockCtx, customConfig);

    expect(mockLimiter.threshold.value).toBe(-6);
    expect(mockLimiter.ratio.value).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/gainNormalization.test.ts
```

Expected: failures on `normalizedVoiceGain` (still has 1.0 cap) and `createLimiterNode` (not exported yet).

- [ ] **Step 3: Update `gainNormalization.ts`**

Replace the file with:

```typescript
import { DEFAULT_NORMALIZATION_CONFIG, type NormalizationConfig } from "./normalizationConfig";

export { DEFAULT_NORMALIZATION_CONFIG };
export type { NormalizationConfig };

export const DEFAULT_TARGET_LUFS = DEFAULT_NORMALIZATION_CONFIG.targetLufs;

export function computeNormalizationGain(
  loudnessLufs: number,
  targetLufs: number = DEFAULT_TARGET_LUFS,
): number {
  return Math.pow(10, (targetLufs - loudnessLufs) / 20);
}

/**
 * Apply loudness normalization to a raw gain value.
 * Clamps the normalization multiplier to [0, 10^(maxBoostDb/20)] so very quiet
 * sounds get a bounded boost rather than an uncapped amplification.
 * Returns rawGain unchanged when loudnessLufs is undefined (sound not yet analyzed).
 * The per-pad limiter node handles any peaks that exceed 0 dBFS after boosting.
 */
export function normalizedVoiceGain(
  rawGain: number,
  loudnessLufs: number | undefined,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): number {
  if (loudnessLufs === undefined) return rawGain;
  const maxNormGain = Math.pow(10, config.maxBoostDb / 20);
  const normGain = Math.min(computeNormalizationGain(loudnessLufs, config.targetLufs), maxNormGain);
  return normGain * rawGain;
}

/**
 * Create a DynamicsCompressorNode configured as a near-brickwall limiter.
 * Used by audioState (per-pad) and preview (per-session) to catch peaks
 * that exceed 0 dBFS after normalization gain is applied.
 */
export function createLimiterNode(
  ctx: AudioContext,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = config.limiter.threshold;
  limiter.knee.value = config.limiter.knee;
  limiter.ratio.value = config.limiter.ratio;
  limiter.attack.value = config.limiter.attack;
  limiter.release.value = config.limiter.release;
  return limiter;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/gainNormalization.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/normalizationConfig.ts src/lib/audio/gainNormalization.ts src/lib/audio/gainNormalization.test.ts
git commit -m "feat: raise normalization boost cap and add createLimiterNode factory"
```

---

## Task 3: Add per-pad limiter to `audioState.ts`

**Files:**
- Modify: `src/lib/audio/audioState.ts`
- Modify: `src/lib/audio/audioState.test.ts`

- [ ] **Step 1: Write failing tests**

In `audioState.test.ts`, make the following changes:

**a) Add `createDynamicsCompressor` to `mockCtx`** (find the existing `mockCtx` definition and add the new property):

```typescript
const mockCtx = {
  currentTime: 0,
  createGain: vi.fn(),
  createDynamicsCompressor: vi.fn(),
};
```

**b) Add a `makeMockCompressor` factory** (add after the existing `makeMockGain` definition):

```typescript
function makeMockCompressor() {
  return {
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 1 },
    attack: { value: 0 },
    release: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}
```

**c) Update `beforeEach`** to reset `createDynamicsCompressor` (add alongside the existing `mockCtx.createGain.mockImplementation` line):

```typescript
mockCtx.createDynamicsCompressor.mockImplementation(() => makeMockCompressor());
```

**d) Add imports** for `clearPadGainsForIds` and `clearInactivePadGains` to the existing import block:

```typescript
import {
  // ... existing imports ...
  clearPadGainsForIds,
  clearInactivePadGains,
} from "./audioState";
```

**e) Add a new test section** at the end of the file (before the last closing brace if there is one, or simply appended):

```typescript
// ── Per-pad limiter ───────────────────────────────────────────────────────────

describe("getPadGain limiter wiring", () => {
  it("creates a DynamicsCompressorNode and connects padGain → limiter → masterGain", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    const mockMaster = { connect: vi.fn() };
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);
    vi.mocked(getMasterGain).mockReturnValueOnce(mockMaster as any);

    getPadGain("pad-limiter-1");

    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(mockGain.connect).toHaveBeenCalledWith(mockLimiter);
    expect(mockLimiter.connect).toHaveBeenCalledWith(mockMaster);
  });

  it("does not create a new limiter on subsequent calls for the same pad", () => {
    getPadGain("pad-limiter-2");
    vi.clearAllMocks();
    getPadGain("pad-limiter-2");
    expect(mockCtx.createDynamicsCompressor).not.toHaveBeenCalled();
  });
});

describe("clearAllPadGains limiter cleanup", () => {
  it("disconnects and clears limiters alongside pad gains", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-cl-1");
    clearAllPadGains();

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });
});

describe("clearInactivePadGains limiter cleanup", () => {
  it("disconnects limiters for pads with no active voices", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-inactive-1"); // no voices registered

    clearInactivePadGains();

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });

  it("does not disconnect limiters for pads that still have active voices", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-active-1");
    const voice = { stop: vi.fn(), setOnEnded: vi.fn(), setLoop: vi.fn() } as unknown as AudioVoice;
    recordVoice("pad-active-1", voice);

    clearInactivePadGains();

    expect(mockLimiter.disconnect).not.toHaveBeenCalled();
  });
});

describe("clearPadGainsForIds limiter cleanup", () => {
  it("disconnects limiters for the specified pad IDs", () => {
    const mockGain = makeMockGain();
    const mockLimiter = makeMockCompressor();
    mockCtx.createGain.mockReturnValueOnce(mockGain);
    mockCtx.createDynamicsCompressor.mockReturnValueOnce(mockLimiter);

    getPadGain("pad-scope-1");
    clearPadGainsForIds(new Set(["pad-scope-1"]));

    expect(mockGain.disconnect).toHaveBeenCalledOnce();
    expect(mockLimiter.disconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/audioState.test.ts
```

Expected: the new limiter tests fail (import errors or `createDynamicsCompressor` not called).

- [ ] **Step 3: Update `audioState.ts`**

**a) Add import** at the top of `audioState.ts` (after the existing imports):

```typescript
import { createLimiterNode } from "./gainNormalization";
```

**b) Add `padLimiterMap`** (add after the existing `padGainMap` declaration, around line 80):

```typescript
/** Per-pad DynamicsCompressorNodes: padGain → padLimiter → masterGain → destination */
const padLimiterMap = new Map<string, DynamicsCompressorNode>();
```

**c) Update the STATE INVENTORY table comment** to add a row for `padLimiterMap` (find the table that starts at "Name | Keys | Values | Purpose | Cleared by" and add):

```
 * padLimiterMap      | pad ID     | DynamicsCompressorNode                    | Per-pad brickwall limiter after padGain     | clearAllPadGains() (disconnects+clears)
```

**d) Replace `getPadGain`** (find the function at line ~330 and replace the whole function body):

```typescript
export function getPadGain(padId: string): GainNode {
  const existing = padGainMap.get(padId);
  if (existing) return existing;
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  const limiter = createLimiterNode(ctx);
  gain.connect(limiter);
  limiter.connect(getMasterGain());
  padLimiterMap.set(padId, limiter);
  padGainMap.set(padId, gain);
  return gain;
}
```

**e) Replace `clearAllPadGains`**:

```typescript
export function clearAllPadGains(): void {
  for (const gain of padGainMap.values()) gain.disconnect();
  padGainMap.clear();
  for (const limiter of padLimiterMap.values()) limiter.disconnect();
  padLimiterMap.clear();
}
```

**f) Replace `clearPadGainsForIds`**:

```typescript
export function clearPadGainsForIds(padIds: ReadonlySet<string>): void {
  for (const padId of padIds) {
    const gain = padGainMap.get(padId);
    if (gain) {
      gain.disconnect();
      padGainMap.delete(padId);
    }
    const limiter = padLimiterMap.get(padId);
    if (limiter) {
      limiter.disconnect();
      padLimiterMap.delete(padId);
    }
  }
}
```

**g) Replace `clearInactivePadGains`**:

```typescript
export function clearInactivePadGains(): void {
  for (const padId of [...padGainMap.keys()]) {
    if (!voiceMap.has(padId)) {
      padGainMap.get(padId)!.disconnect();
      padGainMap.delete(padId);
      const limiter = padLimiterMap.get(padId);
      if (limiter) {
        limiter.disconnect();
        padLimiterMap.delete(padId);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/audioState.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to catch regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/audioState.ts src/lib/audio/audioState.test.ts
git commit -m "feat: add per-pad DynamicsCompressorNode limiter between padGain and masterGain"
```

---

## Task 4: Add per-session limiter to `preview.ts`

**Files:**
- Modify: `src/lib/audio/preview.ts`
- Modify: `src/lib/audio/preview.test.ts`

- [ ] **Step 1: Write failing tests**

In `preview.test.ts`, make the following changes:

**a) Add `createDynamicsCompressor` to the existing `mockCtx`** (find the `mockCtx` object and add the property):

```typescript
const mockLimiterNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  threshold: { value: 0 },
  knee: { value: 0 },
  ratio: { value: 1 },
  attack: { value: 0 },
  release: { value: 0 },
};

const mockCtx = {
  createMediaElementSource: vi.fn(() => mockSourceNode),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
  })),
  createGain: vi.fn(() => mockGainNode),
  createDynamicsCompressor: vi.fn(() => mockLimiterNode),
};
```

**b) Reset `mockLimiterNode` mocks in `beforeEach`** (find the `beforeEach` block and add):

```typescript
vi.mocked(mockLimiterNode.connect).mockReset();
vi.mocked(mockLimiterNode.disconnect).mockReset();
```

**c) Add new test cases** (append to the existing test file):

```typescript
describe("playPreview limiter wiring (buffer path)", () => {
  it("creates a DynamicsCompressorNode and wires previewGain → limiter → masterGain", async () => {
    const sound = createMockSound({ loudnessLufs: -20 });
    const mockMaster = { connect: vi.fn() };
    vi.mocked(getMasterGain).mockReturnValueOnce(mockMaster as any);

    await playPreview(sound);

    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockLimiterNode);
    expect(mockLimiterNode.connect).toHaveBeenCalledWith(mockMaster);
  });
});

describe("stopPreview limiter teardown", () => {
  it("disconnects the limiter node on stopPreview", async () => {
    const sound = createMockSound({ loudnessLufs: -20 });
    await playPreview(sound);
    stopPreview();
    expect(mockLimiterNode.disconnect).toHaveBeenCalledOnce();
  });

  it("is a no-op if no preview is active", () => {
    stopPreview(); // no prior playPreview call
    expect(mockLimiterNode.disconnect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/preview.test.ts
```

Expected: the new limiter tests fail (limiter not yet created/disconnected).

- [ ] **Step 3: Update `preview.ts`**

**a) Add import** for `createLimiterNode` (find the existing import from `./gainNormalization` and add to it):

```typescript
import { normalizedVoiceGain, createLimiterNode } from "./gainNormalization";
```

**b) Add the `currentPreviewLimiter` module variable** (add after `currentPreviewGain`):

```typescript
let currentPreviewLimiter: DynamicsCompressorNode | null = null;
```

**c) Update `stopPreview`** to also disconnect the limiter. Find the block that handles `currentPreviewGain` and add the limiter teardown immediately after:

```typescript
if (currentPreviewLimiter) {
  try { currentPreviewLimiter.disconnect(); } catch { /* already disconnected */ }
  currentPreviewLimiter = null;
}
```

The full updated `stopPreview` should look like:

```typescript
export function stopPreview(): void {
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  if (currentStreamingAudio) {
    currentStreamingAudio.pause();
    currentStreamingAudio.currentTime = 0;
    currentStreamingAudio = null;
  }
  if (currentPreviewGain) {
    try { currentPreviewGain.disconnect(); } catch { /* already disconnected */ }
    currentPreviewGain = null;
  }
  if (currentPreviewLimiter) {
    try { currentPreviewLimiter.disconnect(); } catch { /* already disconnected */ }
    currentPreviewLimiter = null;
  }
  stopPreviewRaf();
  usePlaybackStore.getState().setIsPreviewPlaying(false);
}
```

**d) Update the streaming path in `playPreview`**. Find the section that does `sourceNode.connect(previewGain); previewGain.connect(getMasterGain())` and replace it:

```typescript
const previewGain = ctx.createGain();
previewGain.gain.value = normalizedVoiceGain(1.0, sound.loudnessLufs);
const previewLimiter = createLimiterNode(ctx);
sourceNode.connect(previewGain);
previewGain.connect(previewLimiter);
previewLimiter.connect(getMasterGain());
currentStreamingAudio = audio;
currentPreviewGain = previewGain;
currentPreviewLimiter = previewLimiter;
```

**e) Update the buffer path in `playPreview`**. Find the section that does `source.connect(previewGain); previewGain.connect(getMasterGain())` and replace it:

```typescript
const previewGain = ctx.createGain();
previewGain.gain.value = normalizedVoiceGain(1.0, sound.loudnessLufs);
const previewLimiter = createLimiterNode(ctx);
source.connect(previewGain);
previewGain.connect(previewLimiter);
previewLimiter.connect(getMasterGain());
currentPreviewGain = previewGain;
currentPreviewLimiter = previewLimiter;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsc --noEmit && npx vitest run src/lib/audio/preview.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/preview.ts src/lib/audio/preview.test.ts
git commit -m "feat: add per-session limiter to preview playback path"
```

---

## Self-Review Notes

- **Spec coverage:** ✓ normalizationConfig.ts (Task 1), gain cap raised (Task 2), per-pad limiter (Task 3), preview limiter (Task 4)
- **No placeholders:** All code blocks are complete
- **Type consistency:** `NormalizationConfig` defined in Task 1, imported in Tasks 2–4; `createLimiterNode` defined in Task 2, used in Tasks 3–4; `padLimiterMap` introduced and cleaned up in same task
- **Cleanup symmetry:** All three pad cleanup paths (`clearAllPadGains`, `clearPadGainsForIds`, `clearInactivePadGains`) clear `padLimiterMap` in Task 3 — matches existing `padGainMap` cleanup pattern
- **Preview graph correctness:** Both streaming and buffer paths in `playPreview` wire the limiter; `stopPreview` disconnects it — no path leaves a dangling node
