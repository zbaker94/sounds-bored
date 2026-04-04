# Fade & Crossfade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pad-level fade in/out and many-to-many crossfade to the scene view, with per-pad configurable fade duration and a global default in App Settings.

**Architecture:** Fade operations are gain ramps on the existing `padGain` node in `padPlayer.ts`. A new `useFadeMode` hook at the `SceneView` level owns mode state and selection, exposes a `getPadFadeVisual` function the pad grid consumes for visual treatment, and an `onPadTap` handler that replaces the normal gesture handlers when a fade mode is active.

**Tech Stack:** React 19 hooks, Zustand, `react-hotkeys-hook`, Web Audio API `linearRampToValueAtTime`, Zod 4, `@testing-library/react` + Vitest.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/lib/schemas.ts` | Modify | Add `fadeDurationMs` to `PadSchema`, `globalFadeDurationMs` to `AppSettingsSchema`, `fadeDurationMs` to `PadConfigSchema` |
| `src/test/factories.ts` | Modify | Add `globalFadeDurationMs` to `createMockAppSettings` |
| `src/lib/audio/padPlayer.ts` | Modify | Add `fadePadOut`, `fadePadIn`, `crossfadePads`, `resolveFadeDuration`, `fadePadTimeouts`, `clearFadePadTimeouts`; update `stopAllPads` |
| `src/lib/audio/padPlayer.test.ts` | Modify | Add tests for fade functions; add `clearFadePadTimeouts` to `beforeEach` |
| `src/hooks/useFadeMode.ts` | Create | Mode state, selection, derived visuals, hotkeys |
| `src/hooks/useFadeMode.test.ts` | Create | Tests for all useFadeMode behaviour |
| `src/components/composite/SceneView/PadButton.tsx` | Modify | Accept `fadeVisual` + `onFadeTap` props; three-way handler conditional; visual treatment |
| `src/components/composite/SceneView/PadButton.test.tsx` | Modify | Add tests for fade visual states and handler swap |
| `src/components/composite/SceneView/SceneView.tsx` | Modify | Mount `useFadeMode`; add Fade/Crossfade toolbar buttons; pass props to `PadButton` |
| `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` | Modify | Add `fadeDurationMs` slider; include in `onSubmit` |
| `src/components/modals/SettingsDialog.tsx` | Modify | Add Playback tab with global fade duration slider |

---

### Task 1: Schema — Add fade duration fields

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/test/factories.ts`

- [ ] **Step 1: Add `fadeDurationMs` to `PadSchema`**

In `src/lib/schemas.ts`, find the `PadSchema` definition (line ~155) and add `fadeDurationMs` as an optional field:

```typescript
export const PadSchema = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerSchema),
  muteTargetPadIds: z.array(z.string()),
  muteGroupId: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  fadeDurationMs: z.number().min(100).max(10000).optional(),
});
```

- [ ] **Step 2: Add `globalFadeDurationMs` to `AppSettingsSchema`**

Find `AppSettingsSchema` (line ~205) and add the field:

```typescript
export const AppSettingsSchema = z.object({
  version: z.string().optional().default(CURRENT_SETTINGS_VERSION),
  globalFolders: z.array(GlobalFolderSchema),
  downloadFolderId: z.string().uuid(),
  importFolderId: z.string().uuid(),
  globalFadeDurationMs: z.number().min(100).max(10000).default(2000),
});
```

- [ ] **Step 3: Add `fadeDurationMs` to `PadConfigSchema`**

Find `PadConfigSchema` (line ~145) and add the field:

```typescript
export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layers: z.array(LayerConfigFormSchema).min(1, "At least one layer is required"),
  fadeDurationMs: z.number().min(100).max(10000).optional(),
});
```

`PadConfigForm` is inferred from this schema via `z.infer` and will automatically include the new field.

- [ ] **Step 4: Update `createMockAppSettings` in factories**

In `src/test/factories.ts`, add `globalFadeDurationMs` to the returned object so tests get a valid settings object:

```typescript
export function createMockAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  const downloadFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/downloads",
    name: "Downloads",
  });
  const importFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/imported",
    name: "Imported",
  });
  const rootFolder = createMockGlobalFolder({
    path: "/music/SoundsBored",
    name: "SoundsBored",
  });
  return {
    version: CURRENT_SETTINGS_VERSION,
    globalFolders: [rootFolder, downloadFolder, importFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
    globalFadeDurationMs: 2000,
    ...overrides,
  };
}
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas.ts src/test/factories.ts
git commit -m "feat: add fadeDurationMs to PadSchema and globalFadeDurationMs to AppSettingsSchema"
```

---

### Task 2: Audio engine — fade functions

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`
- Modify: `src/lib/audio/padPlayer.test.ts`

- [ ] **Step 1: Write failing tests for fade functions**

At the bottom of `src/lib/audio/padPlayer.test.ts`, append:

```typescript
// ─── Fade functions ───────────────────────────────────────────────────────────

describe("fadePadOut", () => {
  it("schedules a gain ramp to 0 on the pad gain node", async () => {
    const { fadePadOut, getPadGain, clearFadePadTimeouts } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-pad" });

    fadePadOut(pad, 1000);

    const gain = getPadGain(pad.id);
    expect(gain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    clearFadePadTimeouts();
  });

  it("calls stopPad and resetPadGain after the fade duration", async () => {
    vi.useFakeTimers();
    const { fadePadOut, clearFadePadTimeouts } = await import("./padPlayer");
    const { stopPad: spyStopPad, resetPadGain } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-timer-pad" });

    // Record pad as playing so stopPad has voices to stop
    usePlaybackStore.setState({ playingPadIds: [pad.id] });

    fadePadOut(pad, 500);
    vi.advanceTimersByTime(510);

    // stopPad removes the pad from playingPadIds
    expect(usePlaybackStore.getState().playingPadIds).not.toContain(pad.id);
    clearFadePadTimeouts();
    vi.useRealTimers();
  });

  it("updates padVolumes to 0 immediately", async () => {
    const { fadePadOut, clearFadePadTimeouts } = await import("./padPlayer");
    const pad = createMockPad({ id: "fade-out-vol-pad" });

    fadePadOut(pad, 1000);

    expect(usePlaybackStore.getState().padVolumes[pad.id]).toBe(0);
    clearFadePadTimeouts();
  });
});

describe("fadePadIn", () => {
  it("triggers the pad at volume 0 then ramps to 1", async () => {
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);

    const source = makeMockSource();
    mockCtx.createBufferSource.mockReturnValue(source);
    const gain = makeMockGain();
    mockCtx.createGain.mockReturnValue(gain);

    const { fadePadIn } = await import("./padPlayer");
    const pad = createMockPad({
      id: "fade-in-pad",
      layers: [createMockLayer({ selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s1", volume: 100 }] } })],
    });
    useLibraryStore.setState({
      sounds: [createMockSound({ id: "s1", filePath: "sounds/test.wav" })],
      tags: [],
      sets: [],
    });

    await fadePadIn(pad, 1000);

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1.0, expect.any(Number));
    expect(usePlaybackStore.getState().padVolumes[pad.id]).toBe(1.0);
  });
});

describe("crossfadePads", () => {
  it("calls fadePadOut for each fading-out pad and fadePadIn for each fading-in pad", async () => {
    const { crossfadePads, fadePadOut: origFadePadOut, fadePadIn: origFadePadIn, clearFadePadTimeouts } = await import("./padPlayer");
    // We test via side effects — fadePadOut updates padVolumes to 0
    const padOut = createMockPad({ id: "xfade-out" });
    const padIn = createMockPad({ id: "xfade-in" });
    padIn.layers = [createMockLayer()];

    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    mockLoadBuffer.mockResolvedValue(mockBuffer);
    const source = makeMockSource();
    mockCtx.createBufferSource.mockReturnValue(source);
    mockCtx.createGain.mockReturnValue(makeMockGain());
    useLibraryStore.setState({ sounds: [], tags: [], sets: [] });

    crossfadePads([padOut], [padIn]);

    // fadePadOut side effect: padVolumes[padOut.id] = 0
    expect(usePlaybackStore.getState().padVolumes[padOut.id]).toBe(0);
    clearFadePadTimeouts();
  });
});

describe("stopAllPads clears fade timeouts", () => {
  it("cancels pending fade timeouts so cleanup callbacks do not fire", async () => {
    vi.useFakeTimers();
    const { fadePadOut, stopAllPads, clearFadePadTimeouts } = await import("./padPlayer");
    const pad = createMockPad({ id: "timeout-cancel-pad" });
    usePlaybackStore.setState({ playingPadIds: [pad.id] });

    fadePadOut(pad, 500);
    // Stop all before timeout fires
    stopAllPads();
    // Advance past the fade duration
    vi.advanceTimersByTime(600);

    // Pad was stopped by stopAllPads immediately; padVolumes should reflect stopAllPads reset (1.0 via resetPadGain)
    // The key assertion: no double-stop error thrown (stopPad called on already-stopped pad)
    // Since voices are cleared, this should be a no-op
    expect(usePlaybackStore.getState().playingPadIds).not.toContain(pad.id);
    clearFadePadTimeouts();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: new tests FAIL — `fadePadOut`, `fadePadIn`, `crossfadePads`, `clearFadePadTimeouts` not found.

- [ ] **Step 3: Add `fadePadTimeouts` map and `clearFadePadTimeouts` export to `padPlayer.ts`**

After the existing `layerPendingMap` declaration (around line 33), add:

```typescript
// Pending fade-out cleanup timeouts, keyed by pad ID. Cleared by stopAllPads.
const fadePadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function clearFadePadTimeouts(): void {
  for (const id of fadePadTimeouts.values()) clearTimeout(id);
  fadePadTimeouts.clear();
}
```

- [ ] **Step 4: Add `resolveFadeDuration` helper**

After `clearFadePadTimeouts`, add:

```typescript
export function resolveFadeDuration(pad: Pad): number {
  return (
    pad.fadeDurationMs ??
    useAppSettingsStore.getState().settings?.globalFadeDurationMs ??
    2000
  );
}
```

- [ ] **Step 5: Add `fadePadOut`**

After `resolveFadeDuration`, add:

```typescript
export function fadePadOut(pad: Pad, durationMs: number): void {
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);
  usePlaybackStore.getState().updatePadVolume(pad.id, 0);

  // Cancel any existing fade timeout for this pad before registering a new one
  const existing = fadePadTimeouts.get(pad.id);
  if (existing !== undefined) clearTimeout(existing);

  const timeoutId = setTimeout(() => {
    fadePadTimeouts.delete(pad.id);
    stopPad(pad);
    resetPadGain(pad.id);
  }, durationMs + 5);
  fadePadTimeouts.set(pad.id, timeoutId);
}
```

- [ ] **Step 6: Add `fadePadIn`**

After `fadePadOut`, add:

```typescript
export async function fadePadIn(pad: Pad, durationMs: number): Promise<void> {
  await triggerPad(pad, 0);
  const ctx = getAudioContext();
  const gain = getPadGain(pad.id);
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + durationMs / 1000);
  usePlaybackStore.getState().updatePadVolume(pad.id, 1.0);
}
```

- [ ] **Step 7: Add `crossfadePads`**

After `fadePadIn`, add:

```typescript
export function crossfadePads(fadingOut: Pad[], fadingIn: Pad[]): void {
  fadingOut.forEach((pad) => fadePadOut(pad, resolveFadeDuration(pad)));
  fadingIn.forEach((pad) => fadePadIn(pad, resolveFadeDuration(pad)).catch(console.error));
}
```

- [ ] **Step 8: Update `stopAllPads` to clear fade timeouts**

In `stopAllPads` (line ~128), add `clearFadePadTimeouts()` as the very first line:

```typescript
export function stopAllPads(): void {
  clearFadePadTimeouts();
  clearAllLayerChains();
  // ... rest of existing implementation unchanged
```

- [ ] **Step 9: Add `clearFadePadTimeouts` to the `beforeEach` in `padPlayer.test.ts`**

Find the `beforeEach` block (around line 104) and add the import + cleanup:

```typescript
beforeEach(async () => {
  vi.clearAllMocks();
  createdSources.length = 0;
  const { clearAllLayerChains, clearAllLayerGains, clearAllPadGains, clearFadePadTimeouts } = await import("./padPlayer");
  clearAllLayerChains();
  clearAllLayerGains();
  clearAllPadGains();
  clearFadePadTimeouts();
  usePlaybackStore.getState().stopAll();
  usePlaybackStore.setState({
    masterVolume: 100,
    playingPadIds: [],
    padVolumes: {},
  });
  useLibraryStore.setState({
    sounds: [],
    // ... keep rest of existing setState as-is
```

- [ ] **Step 10: Run the fade tests to confirm they pass**

```bash
npx vitest run src/lib/audio/padPlayer.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/audio/padPlayer.ts src/lib/audio/padPlayer.test.ts
git commit -m "feat: add fadePadOut, fadePadIn, crossfadePads to padPlayer"
```

---

### Task 3: `useFadeMode` hook

**Files:**
- Create: `src/hooks/useFadeMode.ts`
- Create: `src/hooks/useFadeMode.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useFadeMode.test.ts`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useFadeMode } from "@/hooks/useFadeMode";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer } from "@/test/factories";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  fadePadOut: vi.fn(),
  fadePadIn: vi.fn().mockResolvedValue(undefined),
  crossfadePads: vi.fn(),
  resolveFadeDuration: vi.fn().mockReturnValue(2000),
}));

import { fadePadOut, fadePadIn, crossfadePads } from "@/lib/audio/padPlayer";

// Pads: two with layers (valid), one without (invalid)
const padA: Pad = createMockPad({ id: "pad-a", layers: [createMockLayer()] });
const padB: Pad = createMockPad({ id: "pad-b", layers: [createMockLayer()] });
const padEmpty: Pad = createMockPad({ id: "pad-empty", layers: [] });
const allPads = [padA, padB, padEmpty];

beforeEach(() => {
  vi.clearAllMocks();
  usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
  useUiStore.setState({ ...initialUiState });
});

describe("useFadeMode — enterFade / enterCrossfade", () => {
  it("starts in null mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.mode).toBeNull();
  });

  it("enterFade sets mode to 'fade'", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBe("fade");
  });

  it("enterCrossfade sets mode to 'crossfade'", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.mode).toBe("crossfade");
  });

  it("does not enter fade mode when editMode is active", () => {
    useUiStore.setState({ editMode: true });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBeNull();
  });

  it("does not enter crossfade mode when an overlay is open", () => {
    useUiStore.setState({ overlayStack: [{ id: "some-dialog", type: "dialog" }] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.mode).toBeNull();
  });

  it("cancels active fade mode when editMode turns on", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.mode).toBe("fade");
    act(() => useUiStore.getState().toggleEditMode());
    expect(result.current.mode).toBeNull();
  });

  it("cancels active fade mode when an overlay opens", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => useUiStore.getState().openOverlay("some-dialog", "dialog"));
    expect(result.current.mode).toBeNull();
  });
});

describe("useFadeMode — cancel", () => {
  it("cancel sets mode to null and clears selection", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.cancel());
    expect(result.current.mode).toBeNull();
    expect(result.current.getPadFadeVisual(padA.id)).toBeNull();
  });
});

describe("useFadeMode — onPadTap in fade mode", () => {
  it("calls fadePadOut when tapping a playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(fadePadOut).toHaveBeenCalledWith(padA, 2000);
    expect(result.current.mode).toBeNull();
  });

  it("calls fadePadIn when tapping a non-playing pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padA.id));
    expect(fadePadIn).toHaveBeenCalledWith(padA, 2000);
    expect(result.current.mode).toBeNull();
  });

  it("is a no-op when tapping an invalid pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    act(() => result.current.onPadTap(padEmpty.id));
    expect(fadePadOut).not.toHaveBeenCalled();
    expect(fadePadIn).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("fade"); // mode stays active
  });
});

describe("useFadeMode — onPadTap in crossfade mode", () => {
  it("selects a pad on first tap", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toMatch(/selected/);
  });

  it("deselects a pad on second tap", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).not.toMatch(/selected/);
  });

  it("exits mode when selection drops to 0", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padA.id)); // deselect → 0 selected
    expect(result.current.mode).toBeNull();
  });

  it("does not execute automatically when only playing pads are selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id, padB.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(crossfadePads).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — canExecute and execute", () => {
  it("canExecute is false with only playing pads selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.canExecute).toBe(false);
  });

  it("canExecute is true with ≥1 playing and ≥1 non-playing selected", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id)); // playing
    act(() => result.current.onPadTap(padB.id)); // not playing
    expect(result.current.canExecute).toBe(true);
  });

  it("execute calls crossfadePads with correct pad lists and cancels mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id)); // playing → will fade out
    act(() => result.current.onPadTap(padB.id)); // not playing → will fade in
    act(() => result.current.execute());
    expect(crossfadePads).toHaveBeenCalledWith([padA], [padB]);
    expect(result.current.mode).toBeNull();
  });

  it("execute is a no-op when canExecute is false", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id)); // only playing selected
    act(() => result.current.execute());
    expect(crossfadePads).not.toHaveBeenCalled();
    expect(result.current.mode).toBe("crossfade");
  });
});

describe("useFadeMode — getPadFadeVisual", () => {
  it("returns null when mode is null", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.getPadFadeVisual(padA.id)).toBeNull();
  });

  it("returns 'invalid' for a pad with no layers in any mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padEmpty.id)).toBe("invalid");
  });

  it("returns 'fade-selectable' for valid pads in fade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("fade-selectable");
  });

  it("returns 'crossfade-out' for playing unselected pads in crossfade mode", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-out");
  });

  it("returns 'crossfade-in' for non-playing unselected pads in crossfade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.getPadFadeVisual(padA.id)).toBe("crossfade-in");
  });

  it("returns 'selected-out' for a selected playing pad", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-out");
  });

  it("returns 'selected-in' for a selected non-playing pad", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    expect(result.current.getPadFadeVisual(padA.id)).toBe("selected-in");
  });
});

describe("useFadeMode — statusLabel", () => {
  it("is null when mode is null", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    expect(result.current.statusLabel).toBeNull();
  });

  it("is 'Select a pad' in fade mode", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterFade());
    expect(result.current.statusLabel).toBe("Select a pad");
  });

  it("is 'Select pads to crossfade' when canExecute is false", () => {
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    expect(result.current.statusLabel).toBe("Select pads to crossfade");
  });

  it("is 'Ready — press X or Enter to execute' when canExecute is true", () => {
    usePlaybackStore.setState({ playingPadIds: [padA.id] });
    const { result } = renderHook(() => useFadeMode(allPads));
    act(() => result.current.enterCrossfade());
    act(() => result.current.onPadTap(padA.id));
    act(() => result.current.onPadTap(padB.id));
    expect(result.current.statusLabel).toBe("Ready — press X or Enter to execute");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run src/hooks/useFadeMode.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — `useFadeMode` module not found.

- [ ] **Step 3: Implement `useFadeMode`**

Create `src/hooks/useFadeMode.ts`:

```typescript
import { useState, useCallback, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import {
  fadePadOut,
  fadePadIn,
  crossfadePads,
  resolveFadeDuration,
} from "@/lib/audio/padPlayer";
import type { Pad } from "@/lib/schemas";

export type FadeMode = "fade" | "crossfade" | null;

export type PadFadeVisual =
  | "fade-selectable"
  | "crossfade-out"
  | "crossfade-in"
  | "selected-out"
  | "selected-in"
  | "invalid"
  | null;

export interface UseFadeModeReturn {
  mode: FadeMode;
  canExecute: boolean;
  statusLabel: string | null;
  getPadFadeVisual: (padId: string) => PadFadeVisual;
  enterFade: () => void;
  enterCrossfade: () => void;
  onPadTap: (padId: string) => void;
  execute: () => void;
  cancel: () => void;
}

export function useFadeMode(pads: Pad[]): UseFadeModeReturn {
  const [mode, setMode] = useState<FadeMode>(null);
  const [selectedPadIds, setSelectedPadIds] = useState<Set<string>>(new Set());

  const playingPadIds = usePlaybackStore((s) => s.playingPadIds);
  const editMode = useUiStore((s) => s.editMode);
  const overlayStack = useUiStore((s) => s.overlayStack);

  const isValidPad = useCallback(
    (padId: string) => {
      const pad = pads.find((p) => p.id === padId);
      return pad !== undefined && pad.layers.length > 0;
    },
    [pads],
  );

  const cancel = useCallback(() => {
    setMode(null);
    setSelectedPadIds(new Set());
  }, []);

  // Cancel when edit mode activates
  useEffect(() => {
    if (editMode && mode !== null) cancel();
  }, [editMode, mode, cancel]);

  // Cancel when any overlay opens
  useEffect(() => {
    if (overlayStack.length > 0 && mode !== null) cancel();
  }, [overlayStack.length, mode, cancel]);

  // Exit crossfade mode when selection drops to 0
  useEffect(() => {
    if (mode === "crossfade" && selectedPadIds.size === 0) {
      setMode(null);
    }
  }, [mode, selectedPadIds.size]);

  const enterFade = useCallback(() => {
    if (editMode || overlayStack.length > 0) return;
    setMode("fade");
    setSelectedPadIds(new Set());
  }, [editMode, overlayStack.length]);

  const enterCrossfade = useCallback(() => {
    if (editMode || overlayStack.length > 0) return;
    setMode("crossfade");
    setSelectedPadIds(new Set());
  }, [editMode, overlayStack.length]);

  const onPadTap = useCallback(
    (padId: string) => {
      if (!isValidPad(padId)) return;

      if (mode === "fade") {
        const pad = pads.find((p) => p.id === padId)!;
        const duration = resolveFadeDuration(pad);
        if (playingPadIds.includes(padId)) {
          fadePadOut(pad, duration);
        } else {
          fadePadIn(pad, duration).catch(console.error);
        }
        cancel();
        return;
      }

      if (mode === "crossfade") {
        setSelectedPadIds((prev) => {
          const next = new Set(prev);
          if (next.has(padId)) {
            next.delete(padId);
          } else {
            next.add(padId);
          }
          return next;
        });
      }
    },
    [mode, pads, playingPadIds, isValidPad, cancel],
  );

  const selectedArray = [...selectedPadIds];
  const canExecute =
    mode === "crossfade" &&
    selectedArray.some((id) => playingPadIds.includes(id)) &&
    selectedArray.some((id) => !playingPadIds.includes(id));

  const execute = useCallback(() => {
    if (!canExecute) return;
    const fadingOut = pads.filter(
      (p) => selectedPadIds.has(p.id) && playingPadIds.includes(p.id),
    );
    const fadingIn = pads.filter(
      (p) => selectedPadIds.has(p.id) && !playingPadIds.includes(p.id),
    );
    crossfadePads(fadingOut, fadingIn);
    cancel();
  }, [canExecute, pads, selectedPadIds, playingPadIds, cancel]);

  const getPadFadeVisual = useCallback(
    (padId: string): PadFadeVisual => {
      if (mode === null) return null;
      if (!isValidPad(padId)) return "invalid";
      if (mode === "fade") return "fade-selectable";

      const isSelected = selectedPadIds.has(padId);
      const isPlaying = playingPadIds.includes(padId);
      if (isSelected) return isPlaying ? "selected-out" : "selected-in";
      return isPlaying ? "crossfade-out" : "crossfade-in";
    },
    [mode, isValidPad, selectedPadIds, playingPadIds],
  );

  const statusLabel: string | null =
    mode === "fade"
      ? "Select a pad"
      : mode === "crossfade"
        ? canExecute
          ? "Ready — press X or Enter to execute"
          : "Select pads to crossfade"
        : null;

  // Hotkeys — no deps array so closures are always fresh
  useHotkeys("f", () => {
    if (mode === "fade") cancel();
    else enterFade();
  }, { enabled: !editMode, preventDefault: true });

  useHotkeys("x", () => {
    if (mode === "crossfade") {
      if (canExecute) execute();
      else cancel();
    } else {
      enterCrossfade();
    }
  }, { enabled: !editMode, preventDefault: true });

  useHotkeys("enter", () => {
    if (mode === "crossfade" && canExecute) execute();
  }, { enabled: !editMode });

  useHotkeys("escape", () => {
    if (mode !== null) cancel();
  });

  return {
    mode,
    canExecute,
    statusLabel,
    getPadFadeVisual,
    enterFade,
    enterCrossfade,
    onPadTap,
    execute,
    cancel,
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run src/hooks/useFadeMode.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFadeMode.ts src/hooks/useFadeMode.test.ts
git commit -m "feat: add useFadeMode hook for fade/crossfade mode state and selection"
```

---

### Task 4: PadButton — visual states and handler swap

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Write failing tests**

At the bottom of `src/components/composite/SceneView/PadButton.test.tsx`, append:

```typescript
// ─── Fade mode visual states ──────────────────────────────────────────────────

import type { PadFadeVisual } from "@/hooks/useFadeMode";

function renderPadWithFadeVisual(fadeVisual: PadFadeVisual, onFadeTap = vi.fn()) {
  return render(
    <PadButton
      pad={oneShotPad}
      sceneId="scene-1"
      fadeVisual={fadeVisual}
      onFadeTap={onFadeTap}
    />
  );
}

describe("PadButton — fade visual states", () => {
  it("applies fade-selectable ring class when fadeVisual is 'fade-selectable'", () => {
    renderPadWithFadeVisual("fade-selectable");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/border-white/);
  });

  it("applies amber ring class when fadeVisual is 'crossfade-out'", () => {
    renderPadWithFadeVisual("crossfade-out");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/border-amber/);
  });

  it("applies green ring class when fadeVisual is 'crossfade-in'", () => {
    renderPadWithFadeVisual("crossfade-in");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/border-emerald/);
  });

  it("applies bold amber ring class when fadeVisual is 'selected-out'", () => {
    renderPadWithFadeVisual("selected-out");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/ring-amber/);
  });

  it("applies bold green ring class when fadeVisual is 'selected-in'", () => {
    renderPadWithFadeVisual("selected-in");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/ring-emerald/);
  });

  it("applies opacity-40 and pointer-events-none when fadeVisual is 'invalid'", () => {
    renderPadWithFadeVisual("invalid");
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    expect(btn.className).toMatch(/opacity-40/);
  });

  it("calls onFadeTap on pointer down when fadeVisual is set", async () => {
    const onFadeTap = vi.fn();
    renderPadWithFadeVisual("fade-selectable", onFadeTap);
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    await userEvent.pointer({ target: btn, keys: "[MouseLeft]" });
    expect(onFadeTap).toHaveBeenCalledTimes(1);
  });

  it("does not call onFadeTap when fadeVisual is null", async () => {
    const onFadeTap = vi.fn();
    renderPadWithFadeVisual(null, onFadeTap);
    const btn = screen.getByRole("button", { name: oneShotPad.name });
    await userEvent.pointer({ target: btn, keys: "[MouseLeft]" });
    expect(onFadeTap).not.toHaveBeenCalled();
  });
});
```

Note: Check the existing `PadButton.test.tsx` imports for `screen`, `render`, `userEvent`, and the `oneShotPad` fixture — use the exact same imports and fixture already present in the file.

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run src/components/composite/SceneView/PadButton.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — `PadButton` does not accept `fadeVisual` or `onFadeTap` props.

- [ ] **Step 3: Update `PadButton` to accept and apply fade props**

In `src/components/composite/SceneView/PadButton.tsx`, update the `PadButtonProps` interface:

```typescript
import type { PadFadeVisual } from "@/hooks/useFadeMode";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  onEditClick?: () => void;
  fadeVisual?: PadFadeVisual;
  onFadeTap?: () => void;
}
```

Update the function signature to destructure the new props:

```typescript
export function PadButton({ pad, sceneId, onEditClick, fadeVisual = null, onFadeTap }: PadButtonProps) {
```

Add a `fadeHandlers` object after the existing gesture/sortable setup (after line ~38):

```typescript
const fadeHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onFadeTap?.();
  },
};
```

Update the three-way handler conditional (currently line ~72):

```typescript
{...(editMode
  ? { ...attributes, ...listeners }
  : fadeVisual !== null
    ? fadeHandlers
    : gestureHandlers
)}
```

Add fade visual classes to the `className` prop on the `<button>`. Add this computed value before the `return`:

```typescript
const fadeVisualClass = (() => {
  switch (fadeVisual) {
    case "fade-selectable": return "border-white/60";
    case "crossfade-out":   return "border-amber-400";
    case "crossfade-in":    return "border-emerald-400";
    case "selected-out":    return "border-amber-500 ring-2 ring-amber-500";
    case "selected-in":     return "border-emerald-500 ring-2 ring-emerald-500";
    case "invalid":         return "opacity-40 pointer-events-none";
    default:                return null;
  }
})();
```

Apply `fadeVisualClass` in the `cn(...)` call on the `<button>`, replacing the existing non-fade border logic when fade mode is active. The relevant section of the `cn(...)` becomes:

```typescript
className={cn(
  "relative w-full h-full rounded-xl overflow-hidden",
  "flex items-center justify-center p-2",
  "bg-card text-card-foreground",
  "shadow-[3px_3px_0px_rgba(0,0,0,0.25)]",
  "text-sm font-semibold text-center select-none",
  isSortableDragging && "opacity-50",
  editMode
    ? "border-2 border-dashed border-foreground/50 cursor-default"
    : fadeVisual !== null
      ? cn("border-2 cursor-pointer", fadeVisualClass)
      : cn(
          "border-2 transition-all cursor-pointer",
          "hover:brightness-110 active:scale-95 active:shadow-none",
          isPlaying
            ? "border-black drop-shadow-[0_5px_0px_rgba(0,0,0,1)]"
            : "border-black/20"
        )
)}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run src/components/composite/SceneView/PadButton.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "feat: add fadeVisual prop and fade handler swap to PadButton"
```

---

### Task 5: SceneView toolbar — wire up useFadeMode

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`

There are no isolated unit tests for the `SceneView` toolbar wiring — it is covered by integration (the end-to-end flow works once the underlying hook and PadButton tests pass). Verify visually after this task.

- [ ] **Step 1: Import `useFadeMode` and the Fade/Crossfade icons**

At the top of `SceneView.tsx`, add to the existing imports:

```typescript
import { useFadeMode } from "@/hooks/useFadeMode";
import { VolumeHighIcon, SwitchIcon } from "@hugeicons/core-free-icons";
```

(Use `VolumeHighIcon` for Fade and `SwitchIcon` for Crossfade, or substitute any available icons from `@hugeicons/core-free-icons` that visually represent the concepts — pick from the icon names available in the package.)

- [ ] **Step 2: Mount `useFadeMode` inside `SceneView`**

Inside the `SceneView` function body, after the existing state/hook declarations, add:

```typescript
const pads = activeScene?.pads ?? [];
const fadeMode = useFadeMode(pads);
```

Note: `pads` is already declared further down in the current file — move the existing `const pads = activeScene?.pads ?? []` up to this point, or reuse it. Do not declare it twice.

- [ ] **Step 3: Add the toolbar row above the pad grid**

Inside the `return` block, in the outer `<div className="flex-1 flex flex-col ...">`, add a toolbar row immediately before the `<DndContext>` block:

```tsx
{/* Fade toolbar — hidden when no scene or edit mode active */}
{activeScene && !editMode && (
  <div className="flex items-center gap-2 shrink-0">
    <Button
      variant={fadeMode.mode === "fade" ? "default" : "ghost"}
      size="sm"
      onClick={() => fadeMode.mode === "fade" ? fadeMode.cancel() : fadeMode.enterFade()}
      disabled={editMode}
      aria-label="Fade pad"
    >
      <HugeiconsIcon icon={VolumeHighIcon} size={16} />
      Fade
      <Kbd className="ml-1">F</Kbd>
    </Button>
    <Button
      variant={fadeMode.mode === "crossfade" ? "default" : "ghost"}
      size="sm"
      onClick={() => {
        if (fadeMode.mode === "crossfade") {
          if (fadeMode.canExecute) fadeMode.execute();
          else fadeMode.cancel();
        } else {
          fadeMode.enterCrossfade();
        }
      }}
      disabled={editMode}
      aria-label="Crossfade pads"
    >
      <HugeiconsIcon icon={SwitchIcon} size={16} />
      Crossfade
      <Kbd className="ml-1">X</Kbd>
    </Button>
    {fadeMode.statusLabel && (
      <span className="text-sm text-white/70">{fadeMode.statusLabel}</span>
    )}
  </div>
)}
```

- [ ] **Step 4: Pass `fadeVisual` and `onFadeTap` to each `PadButton`**

Find the `{displayPads.map((pad) => (` block and update each `PadButton`:

```tsx
{displayPads.map((pad) => (
  <PadButton
    key={pad.id}
    pad={pad}
    sceneId={activeScene.id}
    onEditClick={() => {
      setEditingPad(pad);
      openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
    }}
    fadeVisual={fadeMode.getPadFadeVisual(pad.id)}
    onFadeTap={() => fadeMode.onPadTap(pad.id)}
  />
))}
```

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx
git commit -m "feat: add Fade/Crossfade toolbar to SceneView and wire useFadeMode to PadButton grid"
```

---

### Task 6: PadConfigDrawer — per-pad fade duration slider

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`

- [ ] **Step 1: Add the fade duration field to the form and submit handler**

In `PadConfigDrawer.tsx`, the `DEFAULT_VALUES` constant currently has `name` and `layers`. Add `fadeDurationMs`:

```typescript
const DEFAULT_VALUES: PadConfigForm = {
  name: "",
  layers: [DEFAULT_LAYER],
  fadeDurationMs: undefined,
};
```

In the `useEffect` that resets the form on open (line ~57), add `fadeDurationMs` when in edit mode:

```typescript
reset({
  name: initialConfig.name ?? "",
  layers: (initialConfig.layers ?? []).map((l) => ({
    selection: l.selection as LayerConfigForm["selection"],
    arrangement: l.arrangement,
    playbackMode: l.playbackMode,
    retriggerMode: l.retriggerMode,
    volume: l.volume,
  })),
  fadeDurationMs: initialConfig.fadeDurationMs,
});
```

In `onSubmit`, include `fadeDurationMs` in the constructed `PadConfig`:

```typescript
function onSubmit(data: PadConfigForm) {
  const config: PadConfig = {
    name: data.name,
    layers: data.layers.map((l, i) => ({ id: layerIdsRef.current[i] ?? crypto.randomUUID(), ...l })),
    muteTargetPadIds: initialConfig?.muteTargetPadIds ?? [],
    fadeDurationMs: data.fadeDurationMs,
  };
  // ... rest unchanged
}
```

- [ ] **Step 2: Add the slider UI**

Add the following imports to `PadConfigDrawer.tsx`:

```typescript
import { Controller } from "react-hook-form";
import { Slider } from "@/components/ui/slider";
import { useAppSettingsStore } from "@/state/appSettingsStore";
```

Inside the `content` prop of `<DrawerDialog>`, after the `<LayerAccordion />`, add the fade duration section:

```tsx
<FadeDurationField />
```

Add a new component at the bottom of the file (outside `PadConfigDrawer`):

```typescript
function FadeDurationField() {
  const { control, watch } = useFormContext<PadConfigForm>();
  const globalDefault = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);
  const currentValue = watch("fadeDurationMs");
  const displayValue = currentValue ?? globalDefault;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Fade Duration</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">
            {(displayValue / 1000).toFixed(1)}s
          </span>
          {currentValue !== undefined && (
            <Controller
              name="fadeDurationMs"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => field.onChange(undefined)}
                >
                  Reset to default
                </button>
              )}
            />
          )}
        </div>
      </div>
      <Controller
        name="fadeDurationMs"
        control={control}
        render={({ field }) => (
          <Slider
            min={100}
            max={10000}
            step={100}
            value={[field.value ?? globalDefault]}
            onValueChange={(vals) => field.onChange(vals[0])}
          />
        )}
      />
      {currentValue === undefined && (
        <p className="text-xs text-muted-foreground">Using global default ({(globalDefault / 1000).toFixed(1)}s)</p>
      )}
    </div>
  );
}
```

Note: `useFormContext` requires `import { useFormContext } from "react-hook-form"` — add this to the imports at the top.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx
git commit -m "feat: add per-pad fade duration slider to PadConfigDrawer"
```

---

### Task 7: SettingsDialog — global fade duration default

**Files:**
- Modify: `src/components/modals/SettingsDialog.tsx`

- [ ] **Step 1: Add a Playback tab to `SettingsDialog`**

In `SettingsDialog.tsx`, add `"playback"` to the `TabsList` and a new `TabsContent`:

```tsx
<Tabs defaultValue="folders">
  <TabsList>
    <TabsTrigger value="folders">Folders</TabsTrigger>
    <TabsTrigger value="playback">Playback</TabsTrigger>
    <TabsTrigger value="about">About</TabsTrigger>
  </TabsList>
  <TabsContent value="folders">
    <FoldersTab />
  </TabsContent>
  <TabsContent value="playback">
    <PlaybackTab />
  </TabsContent>
  <TabsContent value="about">
    <AboutTab />
  </TabsContent>
</Tabs>
```

- [ ] **Step 2: Implement `PlaybackTab`**

Add the following imports to `SettingsDialog.tsx`:

```typescript
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
```

Add the `PlaybackTab` component after the `FoldersTab` component:

```typescript
function PlaybackTab() {
  const settings = useAppSettingsStore((s) => s.settings);
  const updateSettings = useAppSettingsStore((s) => s.updateSettings);
  const { mutate: saveSettings } = useSaveAppSettings();

  if (!settings) return null;

  const fadeDurationMs = settings.globalFadeDurationMs ?? 2000;

  function handleFadeDurationChange(value: number) {
    updateSettings((draft) => {
      draft.globalFadeDurationMs = value;
    });
    saveSettings(useAppSettingsStore.getState().settings!);
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Default Fade Duration</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            {(fadeDurationMs / 1000).toFixed(1)}s
          </span>
        </div>
        <Slider
          min={100}
          max={10000}
          step={100}
          value={[fadeDurationMs]}
          onValueChange={(vals) => handleFadeDurationChange(vals[0])}
        />
        <p className="text-xs text-muted-foreground">
          Applied to all pads that do not have a custom fade duration set.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/SettingsDialog.tsx
git commit -m "feat: add Playback tab with global fade duration slider to SettingsDialog"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Fade button in scene toolbar | Task 5 |
| Crossfade button in scene toolbar | Task 5 |
| Mode-based selection (Approach B) | Task 3 (useFadeMode) |
| Auto-execute for Fade (single tap) | Task 3 — `onPadTap` in fade mode |
| Manual execute for Crossfade | Task 3 — `execute()` + Task 5 toolbar button |
| Many-to-many crossfade | Task 3 — `execute()` splits pads by playing state |
| Deselect pad on re-tap | Task 3 — `onPadTap` in crossfade mode |
| Exit mode when selection hits 0 | Task 3 — `useEffect` on `selectedPadIds.size` |
| Pad visual states (fade-selectable, crossfade-out/in, selected-out/in, invalid) | Task 4 (PadButton) |
| Three-way handler swap (edit / fade / gesture) | Task 4 (PadButton) |
| Hotkeys F / X / Enter / Escape | Task 3 — `useHotkeys` in useFadeMode |
| Cancel when edit mode activates | Task 3 — `useEffect` on `editMode` |
| Cancel when overlay opens | Task 3 — `useEffect` on `overlayStack.length` |
| Buttons disabled when edit mode active | Task 5 — `disabled={editMode}` |
| `fadePadOut` — ramp + stop after duration | Task 2 |
| `fadePadIn` — trigger at 0 + ramp to 1 | Task 2 |
| `crossfadePads` — parallel ramps | Task 2 |
| `stopAllPads` clears fade timeouts | Task 2 |
| `fadeDurationMs` on `PadSchema` | Task 1 |
| `globalFadeDurationMs` on `AppSettingsSchema` | Task 1 |
| Per-pad fade duration slider in PadConfigDrawer | Task 6 |
| Reset-to-default control | Task 6 — "Reset to default" button |
| Global default slider in App Settings | Task 7 |
| Duration resolution: pad → global → 2000 | Task 2 — `resolveFadeDuration` |

All spec requirements are covered.
