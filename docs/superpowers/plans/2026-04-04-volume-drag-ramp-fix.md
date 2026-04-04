# Volume Drag Ramp Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the distance-based power curve on pad volume drag with a time-based linear sensitivity ramp (0 → full over 150ms from drag activation), and suppress the CSS `transition-[height]` during active drag to eliminate visual jerkiness.

**Architecture:** `usePadGesture.ts` records `dragStartTime` when the phase transitions to `"drag"`, computes `rampFactor = min(1, elapsed / DRAG_RAMP_MS)` on every pointer-move, and returns a new `isDragging` boolean so `PadButton.tsx` can conditionally apply the transition class only when the drag is inactive.

**Tech Stack:** React 19 hooks (useState, useRef), Vitest with `vi.useFakeTimers()` for `Date.now()` control, Tailwind 4 conditional class via `cn()`.

---

## File Map

| File | Change |
|---|---|
| `src/hooks/usePadGesture.ts` | Remove `DRAG_EXPONENT`; add `export const DRAG_RAMP_MS`; add `dragStartTime` to `GestureState`; replace power curve with ramp formula; add `isDragging` useState; return `isDragging` |
| `src/components/composite/SceneView/PadButton.tsx` | Destructure `isDragging`; apply `transition-[height]` conditionally |
| `src/hooks/usePadGesture.test.ts` | Remove `"drag easing curve"` describe block (lines 503–599); update H1 staleness test (lines 470–500); add `"time-based sensitivity ramp"` describe block with 4 tests |

---

### Task 1: Write failing ramp tests

**Files:**
- Modify: `src/hooks/usePadGesture.test.ts`

These tests will fail immediately because the hook still uses the power curve and does not export `DRAG_RAMP_MS`.

- [ ] **Step 1: Add `DRAG_RAMP_MS` to the import line**

Change line 3 from:
```typescript
import { usePadGesture } from "@/hooks/usePadGesture";
```
to:
```typescript
import { usePadGesture, DRAG_RAMP_MS } from "@/hooks/usePadGesture";
```

- [ ] **Step 2: Remove the `"drag easing curve"` describe block**

Delete lines 503–599 in their entirety (the block starting with `// ─── Easing curve ─────` through the closing `}`).

- [ ] **Step 3: Update the H1 staleness test to use linear ramp instead of power curve**

Replace the existing test `"measures drag distance from where the cursor was at hold-start"` (lines 470–500) with this version:

```typescript
it("measures drag distance from where the cursor was at hold-start, not pointer-down", () => {
  const { result } = renderHook(() => usePadGesture(oneShotPad));

  // Press at Y=300
  act(() => {
    result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
  });

  // Drift 20px down during down phase
  act(() => {
    result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 320 }));
  });

  // Hold fires — startY should now be 320
  act(() => {
    vi.advanceTimersByTime(150);
  });

  // Drag 40px up from hold-start (320 → 280) — this activates drag phase (dragStartTime = now)
  act(() => {
    result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
  });

  // Advance time to full ramp so rampFactor = 1.0
  act(() => {
    vi.advanceTimersByTime(DRAG_RAMP_MS);
  });

  // Fire move again at same position — now at full ramp, linear
  act(() => {
    result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
  });

  // Volume applied should reflect 40px drag from hold-start (Y=320), not from pointer-down (Y=300)
  // Linear at full ramp: 0 + 1.0 × (40/200) = 0.2
  // If startY were wrong (300 instead of 320), deltaY = 300-280 = 20 → 20/200 = 0.1
  expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
  const calls = vi.mocked(setPadVolume).mock.calls;
  const appliedVolume = calls[calls.length - 1][1];
  expect(appliedVolume).toBeCloseTo(0.2, 5);
});
```

- [ ] **Step 4: Add the `"time-based sensitivity ramp"` describe block**

Append this after the closing `}` of the H1 describe block (after line 501):

```typescript
// ─── Time-based sensitivity ramp ─────────────────────────────────────────────

describe("usePadGesture — time-based sensitivity ramp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {}, isPadActive: () => false });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has zero sensitivity at drag start (rampFactor = 0)", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold activates, startVolume = 0

    // First move crosses DRAG_PX threshold — drag activates at t=0
    // rampFactor = 0, so newVolume should equal startVolume (0)
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const volumeAtDragStart = calls[calls.length - 1][1];
    expect(volumeAtDragStart).toBe(0); // startVolume, no ramp applied yet
  });

  it("has half sensitivity at half ramp duration", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0
    vi.mocked(setPadVolume).mockClear();

    // Activate drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });
    vi.mocked(setPadVolume).mockClear();

    // Advance to half ramp
    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS / 2); });

    // Move to 50px up from hold-start (300 → 250) while cursor stays at 290 from drag-start perspective
    // Re-issue the same position so the hook recomputes with new rampFactor
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });

    // deltaY = 300 - 250 = 50px from hold-start
    // linear = 50/200 = 0.25; rampFactor = 0.5; newVolume = 0 + 0.5 × 0.25 = 0.125
    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBeCloseTo(0.125, 3);
  });

  it("has full sensitivity at full ramp duration", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0

    // Activate drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });
    vi.mocked(setPadVolume).mockClear();

    // Advance to full ramp
    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS); });

    // Move 40px up from hold-start
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 260 }));
    });

    // deltaY = 300 - 260 = 40; rampFactor = 1.0; newVolume = 0 + 1.0 × (40/200) = 0.2
    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBeCloseTo(0.2, 5);
  });

  it("full range still clamps at 1.0 after ramp completes", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 500 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // hold, startVolume = 0

    // Activate drag
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 496 }));
    });

    act(() => { vi.advanceTimersByTime(DRAG_RAMP_MS); });

    // Move 200px up (full DRAG_RANGE_PX) → should clamp to 1.0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 300 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    const vol = calls[calls.length - 1][1];
    expect(vol).toBe(1.0);
  });
});
```

- [ ] **Step 5: Run only the new ramp tests to confirm they fail**

```bash
npx vitest run src/hooks/usePadGesture.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: The 4 new ramp tests FAIL (DRAG_RAMP_MS not exported; hook still uses power curve). The updated H1 test also FAILS. The easing tests are gone.

---

### Task 2: Implement the time-based ramp in `usePadGesture.ts`

**Files:**
- Modify: `src/hooks/usePadGesture.ts`

- [ ] **Step 1: Replace `DRAG_EXPONENT` with `DRAG_RAMP_MS` and add `isDragging` state**

Replace lines 1–38 (imports + constants + GestureState + function open + refs/state) with:

```typescript
import { useRef, useState } from "react";
import type React from "react";
import type { Pad } from "@/lib/schemas";
import { triggerPad, setPadVolume, resetPadGain, releasePadHoldLayers, stopPad } from "@/lib/audio/padPlayer";
import { usePlaybackStore } from "@/state/playbackStore";

// Gesture thresholds
const HOLD_MS = 150;        // time before a press becomes a "hold"
const DRAG_PX = 4;          // vertical pixels before drag mode activates
const DRAG_RANGE_PX = 200;  // pixels of travel for full 0→1 volume range
export const DRAG_RAMP_MS = 150; // ms from drag activation to full sensitivity

type Phase = "idle" | "down" | "hold" | "drag";

interface GestureState {
  startY: number;
  lastY: number;
  startTime: number;
  phase: Phase;
  wasPlayingAtStart: boolean;
  startVolume: number;
  currentVolume: number;
  dragStartTime: number;
}

export function usePadGesture(pad: Pad) {
  const hasHoldLayer = pad.layers.some((l) => l.playbackMode === "hold");

  const state = useRef<GestureState>({
    startY: 0,
    lastY: 0,
    startTime: 0,
    phase: "idle",
    wasPlayingAtStart: false,
    startVolume: 1.0,
    currentVolume: 1.0,
    dragStartTime: 0,
  });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fillVolume, setFillVolume] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
```

- [ ] **Step 2: Record `dragStartTime` and set `isDragging` when phase transitions to `"drag"`**

In `onPointerMove`, replace the phase transition block:

```typescript
    if (s.phase === "hold" && Math.abs(deltaY) > DRAG_PX) {
      s.phase = "drag";

      if (deltaY > 0 && !hasHoldLayer && !s.wasPlayingAtStart) {
        triggerPad(pad, 0).catch(console.error);
        justTriggered = true;
      }
    }
```

with:

```typescript
    if (s.phase === "hold" && Math.abs(deltaY) > DRAG_PX) {
      s.phase = "drag";
      s.dragStartTime = Date.now();
      setIsDragging(true);

      if (deltaY > 0 && !hasHoldLayer && !s.wasPlayingAtStart) {
        triggerPad(pad, 0).catch(console.error);
        justTriggered = true;
      }
    }
```

- [ ] **Step 3: Replace the power curve volume calculation with the time-based ramp**

In `onPointerMove`, replace:

```typescript
    if (s.phase === "drag") {
      const normalizedDelta = deltaY / DRAG_RANGE_PX;
      const easedDelta = Math.sign(normalizedDelta) * Math.pow(Math.abs(normalizedDelta), DRAG_EXPONENT);
      const newVolume = Math.max(0, Math.min(1, s.startVolume + easedDelta));
```

with:

```typescript
    if (s.phase === "drag") {
      const rampFactor = Math.min(1, (Date.now() - s.dragStartTime) / DRAG_RAMP_MS);
      const newVolume = Math.max(0, Math.min(1, s.startVolume + rampFactor * deltaY / DRAG_RANGE_PX));
```

- [ ] **Step 4: Set `isDragging` to false in `onPointerUp`**

In `onPointerUp`, after `setFillVolume(null)`, add `setIsDragging(false)`:

```typescript
    setFillVolume(null);
    setIsDragging(false);
    s.phase = "idle";
```

- [ ] **Step 5: Return `isDragging` from the hook**

Change the return statement:

```typescript
  return {
    gestureHandlers: { onPointerDown, onPointerMove, onPointerUp, onContextMenu },
    fillVolume,
    isDragging,
  };
```

- [ ] **Step 6: Run the ramp tests to confirm they now pass**

```bash
npx vitest run src/hooks/usePadGesture.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: All tests in `usePadGesture.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/usePadGesture.ts src/hooks/usePadGesture.test.ts
git commit -m "feat: replace power curve with time-based sensitivity ramp on pad volume drag"
```

---

### Task 3: Update `PadButton.tsx` to suppress transition during drag

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

- [ ] **Step 1: Destructure `isDragging` from `usePadGesture`**

Change line 26:

```typescript
  const { gestureHandlers, fillVolume } = usePadGesture(pad);
```

to:

```typescript
  const { gestureHandlers, fillVolume, isDragging } = usePadGesture(pad);
```

Note: `isDragging` from `usePadGesture` is the volume-drag state. The existing `isSortableDragging` (from `useSortable`) is unrelated — keep both.

- [ ] **Step 2: Apply `transition-[height]` conditionally on the fill bar div**

Replace the fill bar div (lines 100–105):

```tsx
        {/* Volume fill — normal mode only */}
        {!editMode && fillVolume !== null && (
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black transition-[height] duration-150 ease-out"
            style={{ height: `${fillVolume * 100}%` }}
          />
        )}
```

with:

```tsx
        {/* Volume fill — normal mode only */}
        {!editMode && fillVolume !== null && (
          <div
            className={cn(
              "absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black",
              !isDragging && "transition-[height] duration-150 ease-out"
            )}
            style={{ height: `${fillVolume * 100}%` }}
          />
        )}
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -50
```

Expected: All tests pass (previously 578+; new count includes the 4 added ramp tests).

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "fix: suppress fill bar CSS transition during active volume drag to eliminate jitter"
```
