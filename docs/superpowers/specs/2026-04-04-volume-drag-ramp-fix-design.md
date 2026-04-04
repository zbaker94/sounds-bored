# Volume Drag Ramp Fix — Design Spec

**Date:** 2026-04-04
**Status:** Approved

---

## Problem

Two UX defects with the pad volume drag gesture:

1. **Drag sensitivity is distance-based, not time-based.** The power curve (`x^1.5`) we introduced compresses volume changes for small displacements. This makes *all* early drag movement sluggish — including rapid gestures — because the curve applies regardless of how fast the user moves. The intended behaviour was a time-based ramp: sensitivity starts at zero and accelerates to full speed over a fixed duration from drag start.

2. **Fill bar is visually jerky during rapid drags.** The `transition-[height] duration-150 ease-out` CSS class continuously restarts a 150ms animation on every pointer-move event (~60fps). The bar perpetually chases the target with a lag, producing visible stutter.

---

## Design

### `usePadGesture.ts`

**Constants:**
- Remove `DRAG_EXPONENT = 1.5`
- Add `export const DRAG_RAMP_MS = 150` (exported so tests can reference it without hardcoding)

**`GestureState`:** add `dragStartTime: number` (initialized to `0`).

**Phase transition to `"drag"`** (inside `onPointerMove`): record `s.dragStartTime = Date.now()`.

**Volume calculation** (replaces power curve):
```
rampFactor = min(1, (Date.now() − s.dragStartTime) / DRAG_RAMP_MS)
newVolume  = clamp(s.startVolume + rampFactor × deltaY / DRAG_RANGE_PX, 0, 1)
```

At `t=0` of drag start, `rampFactor = 0` → volume equals `startVolume`, no jump. At `t=150ms`, full linear sensitivity.

**`isDragging` state:** add `const [isDragging, setIsDragging] = useState(false)`.
- Set `true` when phase transitions to `"drag"` in `onPointerMove`
- Set `false` in `onPointerUp`

**Return value:** add `isDragging` alongside `fillVolume`.

---

### `PadButton.tsx`

Destructure `isDragging` from `usePadGesture`. Apply the CSS transition conditionally on the fill bar div:

```tsx
className={cn(
  "absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black",
  !isDragging && "transition-[height] duration-150 ease-out"
)}
```

- `isDragging = false` (hold phase, fill just appeared): 150ms transition smooths the initial appearance
- `isDragging = true` (active drag): no transition, height updates instantly at frame rate
- On pointer up: `isDragging → false` and `fillVolume → null` happen together; bar is removed before the transition class re-applies

---

### `usePadGesture.test.ts`

**Remove:** the `"drag easing curve"` describe block (4 tests — all specific to the power curve).

**Update:** the H1 staleness test `"measures drag distance from where the cursor was at hold-start"`. The assertion `toBeCloseTo(0.0894, 3)` (eased) changes to:
1. Fire the first move (drag activates, `t=0`, rampFactor=0, volume=startVolume)
2. Advance fake time by `DRAG_RAMP_MS`
3. Fire move again at same position
4. Assert `toBeCloseTo(0.2, 5)` — `40px / 200px = 0.2` linear at full ramp

This still proves the H1 fix: a broken `startY` (300 instead of 320) would give `20px / 200px = 0.1`.

**Add:** `"time-based sensitivity ramp"` describe block (4 tests, all using `vi.useFakeTimers()`):

| Test | Setup | Assert |
|---|---|---|
| Zero sensitivity at drag start | Move immediately after drag activates | `setPadVolume` called with `startVolume` |
| Half sensitivity at half ramp | Advance `DRAG_RAMP_MS / 2`, re-move | Volume delta = `0.5 × linear` |
| Full sensitivity at full ramp | Advance `DRAG_RAMP_MS`, re-move | Volume delta = linear |
| Full range still clamps | Advance `DRAG_RAMP_MS`, move 200px | Volume = 1.0 (or 0.0) |

---

## Files Changed

| File | Change |
|---|---|
| `src/hooks/usePadGesture.ts` | Replace power curve; add `dragStartTime`, `isDragging`; export `DRAG_RAMP_MS` |
| `src/components/composite/SceneView/PadButton.tsx` | Conditional transition class using `isDragging` |
| `src/hooks/usePadGesture.test.ts` | Remove easing tests; update H1 assertion; add ramp tests |

---

## Non-Goals

- No "break-through" mechanism for rapid drags; ramp applies uniformly
- No change to `DRAG_RANGE_PX`, `HOLD_MS`, `DRAG_PX`, or any other gesture constants
- No change to fill bar appearance (color, border, position)
