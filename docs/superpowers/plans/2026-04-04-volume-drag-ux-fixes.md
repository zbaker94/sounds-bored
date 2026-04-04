# Volume Drag UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three interrelated UX issues with the pad volume drag gesture: a coordinate staleness bug that causes volume to jump on drag start, a visual pop when the fill bar first appears, and a linear-feel drag that makes fine adjustments difficult.

**Architecture:** All gesture logic lives in `src/hooks/usePadGesture.ts`. The hook tracks gesture phase (`idle → down → hold → drag`) via a ref-based state machine and fires pointer event handlers attached to the pad button. The fill bar is rendered in `src/components/composite/SceneView/PadButton.tsx` based on `fillVolume` returned from the hook. All three fixes are self-contained and non-breaking to the hook's external interface.

**Tech Stack:** React 19 + TypeScript strict mode + Vitest + Testing Library (`renderHook`, `act`) + happy-dom + Tailwind 4

---

## Background / What You Need to Know

### The gesture state machine

`usePadGesture` manages a ref (`state.current: GestureState`) with these fields:

```typescript
interface GestureState {
  startY: number;       // Y position at pointer down — used as drag reference
  startTime: number;
  phase: Phase;         // "idle" | "down" | "hold" | "drag"
  wasPlayingAtStart: boolean;
  startVolume: number;  // volume at start of drag gesture
  currentVolume: number;
}
```

**Phase transitions:**
1. `onPointerDown` → phase = `"down"`, records `startY = e.clientY`
2. 150ms `setTimeout` (`HOLD_MS`) → phase = `"hold"`, captures `startVolume` from store
3. `onPointerMove` when `|deltaY| > DRAG_PX (4px)` → phase = `"drag"`, applies volume
4. `onPointerUp` → phase = `"idle"`, triggers/releases as appropriate

**Critical:** During `"down"` phase, `onPointerMove` returns early — all movement is silently dropped.

### Bug 1 (H1): stale `startY`

`startY` is set once at pointer down (line 50) and never updated. If the user's mouse drifts during the 150ms hold window (movement is ignored in `"down"` phase), `startY` becomes stale. When `"hold"` phase activates and the first move event fires, `deltaY = startY - e.clientY` includes all accumulated drift — immediately exceeding `DRAG_PX` and jumping the volume before any intentional gesture.

**Fix (Option B):** Add `lastY` to `GestureState`, update it in `onPointerMove` before the early return, then reset `startY = lastY` inside the hold timer when transitioning to `"hold"`. Both the `DRAG_PX` threshold and volume calculations are then relative to where the cursor was when hold started, not when the button was pressed.

### Bug 2 (H2): fill bar visual pop

When `"hold"` phase activates, `setFillVolume(vol)` is called, causing the yellow fill bar to appear instantly at the stored volume. For already-playing pads this is typically 1.0 (100%), producing a sudden full-height fill. The fix is a CSS `transition` on the fill bar height.

### Bug 3: linear drag feel

The current volume mapping is `startVolume + deltaY / DRAG_RANGE_PX` — fully linear. This makes fine adjustments near the current volume difficult. Applying a power curve (`exponent = 1.5`) gives slow-start acceleration: small drags produce small changes, larger drags produce proportionally larger changes. Full `DRAG_RANGE_PX` (200px) still reaches the full 0→1 range.

With `exponent = 1.5`:
- 20px drag → 3.2% change (vs 10% linear)
- 50px drag → 12.5% change (vs 25% linear)
- 100px drag → 35.4% change (vs 50% linear)
- 200px drag → 100% change (same as linear)

### Layer schema (for test mocks)

```typescript
// From src/lib/schemas.ts
LayerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  selection: LayerSelectionSchema,   // { type: "assigned", instances: [] } for tests
  arrangement: "simultaneous" | "sequential" | "shuffled",
  playbackMode: "one-shot" | "hold" | "loop",
  retriggerMode: "restart" | "continue" | "stop" | "next",
  volume: z.number(),
});
```

---

## File Map

| File | Change |
|---|---|
| `src/hooks/usePadGesture.test.ts` | New file — comprehensive baseline tests created in Task 1; extended in Tasks 2 and 3 |
| `src/hooks/usePadGesture.ts` | Add `lastY` to `GestureState`; track in `onPointerMove`; reset `startY` in hold timer; add power curve easing |
| `src/components/composite/SceneView/PadButton.tsx` | Add Tailwind transition classes to fill bar div |

**Task execution order:** Tasks 1 → 2 → 3 are sequential (all touch `usePadGesture.ts`). Task 4 is independent and can run at any point.

---

## Task 1: Create Comprehensive Gesture Handler Test Suite

**Files:**
- Create: `src/hooks/usePadGesture.test.ts`

### Background

`usePadGesture` has zero test coverage. This task documents the existing behavior of the state machine before making any changes. Tests here cover normal taps, hold activation, drag phase, hold-mode layers, and edge cases. Subsequent tasks will add tests for specific bug fixes and new behavior on top of this foundation.

The hook returns `{ gestureHandlers, fillVolume }`. Call the handlers directly with mock pointer events — no DOM rendering needed. Use `vi.useFakeTimers()` to control the 150ms hold timer.

- [ ] **Step 1: Create the test file with shared setup**

Create `src/hooks/usePadGesture.test.ts`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { usePadGesture } from "@/hooks/usePadGesture";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Pad } from "@/lib/schemas";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  setPadVolume: vi.fn(),
  resetPadGain: vi.fn(),
  releasePadHoldLayers: vi.fn(),
  stopPad: vi.fn(),
}));

import {
  triggerPad,
  setPadVolume,
  resetPadGain,
  releasePadHoldLayers,
  stopPad,
} from "@/lib/audio/padPlayer";

// ─── Shared test fixtures ────────────────────────────────────────────────────

const oneShotPad: Pad = {
  id: "pad-oneshot",
  name: "One Shot Pad",
  layers: [
    {
      id: "layer-1",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 1.0,
    },
  ],
  muteTargetPadIds: [],
};

const holdPad: Pad = {
  id: "pad-hold",
  name: "Hold Pad",
  layers: [
    {
      id: "layer-hold",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "hold",
      retriggerMode: "restart",
      volume: 1.0,
    },
  ],
  muteTargetPadIds: [],
};

function makePointerEvent(overrides: {
  clientY: number;
  button?: number;
}): React.PointerEvent<HTMLButtonElement> {
  return {
    button: overrides.button ?? 0,
    clientY: overrides.clientY,
    pointerId: 1,
    currentTarget: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLButtonElement>;
}

function makeMouseEvent(): React.MouseEvent<HTMLButtonElement> {
  return {
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent<HTMLButtonElement>;
}
```

- [ ] **Step 2: Add tests — normal tap behavior**

Append to the test file:

```typescript
// ─── Normal tap (quick press + release, no hold) ─────────────────────────────

describe("usePadGesture — normal tap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(triggerPad).mockClear();
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers pad on pointer up when released before hold timer fires", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    // Release before 150ms
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(oneShotPad, expect.any(Number));
  });

  it("does not show fill during a quick tap", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });

  it("ignores non-primary button presses (right-click, middle-click)", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300, button: 2 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300, button: 2 }));
    });

    expect(triggerPad).not.toHaveBeenCalled();
    expect(result.current.fillVolume).toBeNull();
  });

  it("cancels hold timer if pointer is released quickly", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    // Advance past hold timer — fill should never appear
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.fillVolume).toBeNull();
    // triggerPad called once on up, not again from the (cancelled) timer path
    expect(triggerPad).toHaveBeenCalledTimes(1);
  });

  it("prevents context menu", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));
    const event = makeMouseEvent();

    act(() => {
      result.current.gestureHandlers.onContextMenu(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Add tests — hold phase**

Append to the test file:

```typescript
// ─── Hold phase ───────────────────────────────────────────────────────────────

describe("usePadGesture — hold phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(triggerPad).mockClear();
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows fill indicator at 0 for non-playing pad after 150ms", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.fillVolume).toBe(0);
  });

  it("shows fill indicator at stored volume for already-playing pad after 150ms", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 0.7 },
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.fillVolume).toBe(0.7);
  });

  it("triggers pad on pointer up after hold (when no drag occurred)", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(oneShotPad, expect.any(Number));
  });

  it("clears fill indicator on pointer up", () => {
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.fillVolume).not.toBeNull();

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });
});
```

- [ ] **Step 4: Add tests — drag phase**

Append to the test file:

```typescript
// ─── Drag phase ───────────────────────────────────────────────────────────────

describe("usePadGesture — drag phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(setPadVolume).mockClear();
    vi.mocked(stopPad).mockClear();
    vi.mocked(resetPadGain).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call setPadVolume when movement is within DRAG_PX (4px) of hold-start", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Move only 3px — below DRAG_PX threshold of 4px
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 297 }));
    });

    expect(setPadVolume).not.toHaveBeenCalled();
  });

  it("calls setPadVolume once movement exceeds DRAG_PX", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Move 10px up — exceeds DRAG_PX
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
  });

  it("clears fill indicator on pointer up after drag", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 290 }));
    });

    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 290 }));
    });

    expect(result.current.fillVolume).toBeNull();
  });

  it("calls stopPad and resetPadGain when dragged to near-zero volume", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150); // startVolume = 1.0
    });

    // Drag far down — volume hits 0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 600 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 600 }));
    });

    expect(stopPad).toHaveBeenCalledWith(oneShotPad);
    expect(resetPadGain).toHaveBeenCalledWith(oneShotPad.id);
  });

  it("does not call stopPad when dragged to non-zero volume", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Drag up slightly — volume stays well above 0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 250 }));
    });

    expect(stopPad).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Add tests — hold-mode layer pads**

Append to the test file:

```typescript
// ─── Hold-mode layer pads ─────────────────────────────────────────────────────

describe("usePadGesture — hold-mode layer pad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(triggerPad).mockClear();
    vi.mocked(releasePadHoldLayers).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers pad immediately on pointer down (not on pointer up)", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    expect(triggerPad).toHaveBeenCalledTimes(1);
    expect(triggerPad).toHaveBeenCalledWith(holdPad, expect.any(Number));
  });

  it("releases hold layers on pointer up", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    expect(releasePadHoldLayers).toHaveBeenCalledTimes(1);
    expect(releasePadHoldLayers).toHaveBeenCalledWith(holdPad);
  });

  it("does not trigger again on pointer up", () => {
    const { result } = renderHook(() => usePadGesture(holdPad));

    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => {
      result.current.gestureHandlers.onPointerUp(makePointerEvent({ clientY: 300 }));
    });

    // Only called once — at pointer down
    expect(triggerPad).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run all tests to establish baseline**

```bash
npm run test:run -- src/hooks/usePadGesture.test.ts
```

Expected: all tests PASS (these cover existing behavior, not the bugs being fixed). If any fail, the existing behavior differs from what was expected — investigate before proceeding.

- [ ] **Step 7: Run full test suite to confirm no conflicts**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/usePadGesture.test.ts
git commit -m "test: add comprehensive gesture handler test suite

Establishes baseline coverage for usePadGesture state machine: normal
tap, hold phase activation, drag phase, hold-mode layers, and edge cases.
No production code changed."
```

---

## Task 2: Fix `startY` Staleness (H1 — Option B)

**Files:**
- Modify: `src/hooks/usePadGesture.ts`
- Modify: `src/hooks/usePadGesture.test.ts`

### Background

`startY` is set once at pointer down (line 50) and never updated. Movement during the 150ms `"down"` phase is silently dropped (line 79 early return). When hold fires, `startY` is stale. The first `onPointerMove` in `"hold"` computes `deltaY` from the wrong reference, jumping the volume.

**Fix:** Add `lastY` to `GestureState`. Track current pointer Y in `onPointerMove` before the early return. In the hold timer, reset `s.startY = s.lastY` before anything else.

- [ ] **Step 1: Write the failing tests**

Append to `src/hooks/usePadGesture.test.ts`:

```typescript
// ─── H1 fix: startY staleness ─────────────────────────────────────────────────

describe("usePadGesture — startY staleness fix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not immediately activate drag when mouse drifted during down phase", () => {
    const { result } = renderHook(() => usePadGesture(oneShotPad));

    // Press at Y=300
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });

    // Drift 15px down during the 150ms hold window — all moves dropped in "down" phase
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 308 }));
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 315 }));
    });

    // Hold timer fires
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // First move in hold phase at the drifted position (still at 315)
    // Before fix: deltaY = 300 - 315 = -15 → exceeds DRAG_PX, drag activates, setPadVolume called
    // After fix: startY reset to 315, deltaY = 0 → drag does NOT activate
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 315 }));
    });

    expect(setPadVolume).not.toHaveBeenCalled();
  });

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

    // Drag 40px up from hold-start (320 → 280)
    // startVolume = 0 (non-playing pad)
    // Expected newVolume is based on deltaY = 320 - 280 = 40 from hold-start position
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 280 }));
    });

    // Volume applied should reflect 40px drag from hold-start (Y=320), not from pointer-down (Y=300)
    // Exact value depends on easing (Task 3 will change this) — just verify drag activated correctly
    expect(setPadVolume).toHaveBeenCalledWith(oneShotPad.id, expect.any(Number));
    const appliedVolume = vi.mocked(setPadVolume).mock.calls[0][1];
    // With no easing yet: 0 + 40/200 = 0.2
    expect(appliedVolume).toBeCloseTo(0.2, 5);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/hooks/usePadGesture.test.ts
```

Expected: the two new H1 tests FAIL. All Task 1 tests still PASS.

- [ ] **Step 3: Implement the fix**

Open `src/hooks/usePadGesture.ts`. Make exactly these five changes:

**3a. Add `lastY` to `GestureState` interface (after `startY: number`):**

```typescript
interface GestureState {
  startY: number;
  lastY: number;        // ← add
  startTime: number;
  phase: Phase;
  wasPlayingAtStart: boolean;
  startVolume: number;
  currentVolume: number;
}
```

**3b. Initialize `lastY` in the `state` ref (after `startY: 0`):**

```typescript
const state = useRef<GestureState>({
  startY: 0,
  lastY: 0,             // ← add
  startTime: 0,
  phase: "idle",
  wasPlayingAtStart: false,
  startVolume: 1.0,
  currentVolume: 1.0,
});
```

**3c. Initialize `lastY` in `onPointerDown` alongside `startY`:**

```typescript
const s = state.current;
s.startY = e.clientY;
s.lastY = e.clientY;   // ← add immediately after s.startY = e.clientY
s.startTime = Date.now();
```

**3d. Track `lastY` at the top of `onPointerMove`, before the early return:**

```typescript
function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
  const s = state.current;
  s.lastY = e.clientY;                                    // ← add this line
  if (s.phase === "idle" || s.phase === "down") return;
  // ... rest unchanged
```

**3e. Reset `startY` to `lastY` at the top of the hold timer callback:**

```typescript
holdTimer.current = setTimeout(() => {
  const s = state.current;
  if (s.phase !== "down") return;
  s.phase = "hold";
  s.startY = s.lastY;    // ← add immediately after s.phase = "hold"

  const vol = hasHoldLayer
  // ... rest unchanged
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/hooks/usePadGesture.test.ts
```

Expected: all tests PASS, including the two new H1 tests.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePadGesture.ts src/hooks/usePadGesture.test.ts
git commit -m "fix: reset startY to current pointer position on hold phase start

Mouse drift during the 150ms hold window was silently accumulated in
startY, causing deltaY to include unintentional movement and triggering
an immediate volume jump. Track lastY during the down phase and use it
to reset startY when hold activates."
```

---

## Task 3: Add Easing Curve to Drag Volume

**Files:**
- Modify: `src/hooks/usePadGesture.ts`
- Modify: `src/hooks/usePadGesture.test.ts`

### Background

Current: `newVolume = startVolume + deltaY / DRAG_RANGE_PX` (fully linear). Fix: normalize delta to `[-1, 1]`, apply `sign(x) * |x|^1.5`, scale back. Full `DRAG_RANGE_PX` (200px) still reaches the complete 0→1 range since `1.0^1.5 = 1.0`. Small drags produce proportionally smaller changes, making fine adjustments near the current volume easier.

**Note:** The H1 test in Task 2 asserted `appliedVolume ≈ 0.2` using linear math. After this task that test will need updating — the assertion is relaxed below to use eased math.

- [ ] **Step 1: Write the failing tests**

Append to `src/hooks/usePadGesture.test.ts`:

```typescript
// ─── Easing curve ─────────────────────────────────────────────────────────────

describe("usePadGesture — drag easing curve", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlaybackStore.setState({ playingPadIds: [], padVolumes: {} });
    vi.mocked(setPadVolume).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function dragFromHoldStart(clientYStart: number, clientYEnd: number) {
    const { result } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: clientYStart }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: clientYEnd }));
    });
    const calls = vi.mocked(setPadVolume).mock.calls;
    vi.mocked(setPadVolume).mockClear();
    return calls.length > 0 ? calls[calls.length - 1][1] : null;
  }

  it("small drag produces less volume change than linear mapping", () => {
    // startVolume = 0 (non-playing). Drag 20px up from hold-start.
    // Linear: 0 + 20/200 = 0.10
    // Eased (exponent 1.5): 0 + (0.1)^1.5 ≈ 0.0316
    const volume = dragFromHoldStart(300, 280);
    expect(volume).not.toBeNull();
    expect(volume!).toBeLessThan(0.10);
    expect(volume!).toBeCloseTo(0.0316, 3);
  });

  it("full DRAG_RANGE_PX (200px) still reaches the full range boundary", () => {
    // startVolume = 0. Drag 200px up → should reach 1.0 (clamped).
    const volume = dragFromHoldStart(500, 300);
    expect(volume).toBe(1.0);
  });

  it("full DRAG_RANGE_PX downward from startVolume=1.0 reaches 0", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 1.0 },
    });
    vi.mocked(setPadVolume).mockClear();

    const { result } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      result.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); }); // startVolume = 1.0
    act(() => {
      result.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 500 }));
    });

    const calls = vi.mocked(setPadVolume).mock.calls;
    expect(calls[calls.length - 1][1]).toBe(0);
  });

  it("easing is symmetric: equal distance up and down produces equal magnitude delta", () => {
    usePlaybackStore.setState({
      playingPadIds: [oneShotPad.id],
      padVolumes: { [oneShotPad.id]: 0.5 },
    });

    // Drag 50px up from startVolume=0.5
    vi.mocked(setPadVolume).mockClear();
    const { result: r1 } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      r1.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      r1.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 250 }));
    });
    const volumeUp = vi.mocked(setPadVolume).mock.calls.at(-1)![1];

    // Drag 50px down from startVolume=0.5
    vi.mocked(setPadVolume).mockClear();
    const { result: r2 } = renderHook(() => usePadGesture(oneShotPad));
    act(() => {
      r2.current.gestureHandlers.onPointerDown(makePointerEvent({ clientY: 300 }));
    });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => {
      r2.current.gestureHandlers.onPointerMove(makePointerEvent({ clientY: 350 }));
    });
    const volumeDown = vi.mocked(setPadVolume).mock.calls.at(-1)![1];

    expect(Math.abs(volumeUp - 0.5)).toBeCloseTo(Math.abs(0.5 - volumeDown), 5);
  });
});
```

- [ ] **Step 2: Update the H1 Task 2 test that used linear math**

In `src/hooks/usePadGesture.test.ts`, find the test `"measures drag distance from where the cursor was at hold-start"` (added in Task 2). The final assertion currently reads:

```typescript
expect(appliedVolume).toBeCloseTo(0.2, 5);
```

Replace it with:

```typescript
// With exponent 1.5 easing: startVolume(0) + (40/200)^1.5 = 0^1.5... wait:
// normalizedDelta = 40/200 = 0.2; easedDelta = 0.2^1.5 ≈ 0.0894
expect(appliedVolume).toBeCloseTo(0.0894, 3);
```

- [ ] **Step 3: Run tests to confirm new tests fail and old tests still pass**

```bash
npm run test:run -- src/hooks/usePadGesture.test.ts
```

Expected: the four new easing tests FAIL (volumes match linear formula). All Task 1 and Task 2 tests PASS (the updated H1 assertion now also fails — that's expected).

- [ ] **Step 4: Implement the easing**

Open `src/hooks/usePadGesture.ts`.

**4a. Add `DRAG_EXPONENT` constant after `DRAG_RANGE_PX`:**

```typescript
const HOLD_MS = 150;
const DRAG_PX = 4;
const DRAG_RANGE_PX = 200;
const DRAG_EXPONENT = 1.5;   // ← add
```

**4b. Replace the volume calculation in the `"drag"` block of `onPointerMove`.**

Find (in the `if (s.phase === "drag")` block):

```typescript
const newVolume = Math.max(0, Math.min(1, s.startVolume + deltaY / DRAG_RANGE_PX));
```

Replace with:

```typescript
const normalizedDelta = deltaY / DRAG_RANGE_PX;
const easedDelta = Math.sign(normalizedDelta) * Math.pow(Math.abs(normalizedDelta), DRAG_EXPONENT);
const newVolume = Math.max(0, Math.min(1, s.startVolume + easedDelta));
```

- [ ] **Step 5: Run tests to confirm all pass**

```bash
npm run test:run -- src/hooks/usePadGesture.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/usePadGesture.ts src/hooks/usePadGesture.test.ts
git commit -m "feat: apply power curve easing to pad volume drag

Small drags now produce proportionally smaller volume changes, making
fine adjustments easier. Full DRAG_RANGE_PX (200px) still covers the
complete 0-1 range. Exponent of 1.5 gives noticeable but not extreme
slow-start acceleration."
```

---

## Task 4: Add Transition to Volume Fill Bar

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

### Background

When `"hold"` phase activates (150ms after press), `setFillVolume(vol)` is called and the yellow fill bar appears instantly at the stored volume. For already-playing pads this is typically 1.0 (100%), producing a sudden full-height pop. A short CSS height transition smooths this appearance. At 150ms it won't feel laggy during intentional dragging — frame-rate updates during drag are fast enough that the transition just softens the visual slightly.

- [ ] **Step 1: Locate the fill bar div in `src/components/composite/SceneView/PadButton.tsx`**

Inside the `{!editMode && fillVolume !== null && (...)}` block, the div currently reads:

```tsx
<div
  className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
  style={{ height: `${fillVolume * 100}%` }}
/>
```

- [ ] **Step 2: Add transition classes**

Replace with:

```tsx
<div
  className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black transition-[height] duration-150 ease-out"
  style={{ height: `${fillVolume * 100}%` }}
/>
```

`transition-[height]` limits the transition to `height` only. `duration-150` is 150ms. `ease-out` starts fast and decelerates, which feels natural for a fill rising from the bottom.

- [ ] **Step 3: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass. If any test asserts the exact `className` string of the fill bar and fails, update that test's expected string to include `transition-[height] duration-150 ease-out`.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "fix: smooth volume fill bar appearance with CSS height transition

The fill bar previously appeared instantly at the stored volume when
hold phase activated, causing a visual pop. A 150ms ease-out transition
softens the appearance without adding noticeable lag during dragging."
```

---

## Self-Review

**Spec coverage:**
- Comprehensive gesture handler tests → Task 1 ✓
- H1 (startY staleness) → Task 2 ✓
- H2 (fill bar visual pop) → Task 4 ✓
- Easing / acceleration → Task 3 ✓

**Placeholder scan:** No TBDs. All test code uses exact values with documented derivations.

**Type consistency:**
- `lastY: number` added to `GestureState` interface (Task 2, Step 3a), initialized in ref (3b), written in `onPointerDown` (3c) and `onPointerMove` (3d), read in hold timer (3e). Consistent throughout.
- `DRAG_EXPONENT` defined at module level (Task 3, Step 4a) and used in `onPointerMove` (Step 4b). Consistent.
- `transition-[height] duration-150 ease-out` are valid Tailwind 4 utility classes.

**Dependency order:** Tasks 1 → 2 → 3 are sequential (all touch `usePadGesture.ts` / `.test.ts`). Task 4 touches only `PadButton.tsx` and is independent — it can run at any point.

**Cross-task test dependency:** Task 3 updates one assertion from Task 2 (linear → eased math). This is noted explicitly in Task 3, Step 2. Execute Task 2 fully before starting Task 3.
