# Pad Volume Drag — Label Swap Design

**Date:** 2026-04-01
**Status:** Approved

## Summary

When a user drags on a pad to adjust volume, replace the pad name text with the current volume percentage. Snap instantly (no animation). When the drag ends, snap back to the pad name.

## Scope

Single-file change: `src/components/composite/SceneView/PadButton.tsx`

## Behavior

- While `fillVolume !== null` (drag is active), the center label shows `${Math.round(fillVolume * 100)}%`
- When `fillVolume === null` (drag ended), the center label shows `pad.name`
- Transition is instant — no fade or animation (deferred to a future animation pass)
- Applies in normal mode only (edit mode is unaffected)

## Implementation

In the normal-mode name span (currently line 127), change the content to:

```tsx
<span className="relative z-10 line-clamp-3 break-words leading-tight">
  {fillVolume !== null ? `${Math.round(fillVolume * 100)}%` : pad.name}
</span>
```

`fillVolume` is already available in `PadButton` via `usePadGesture`. No new state, hooks, or props needed.

## Out of Scope

- Animation / transition effects (future pass)
- Styling changes to the percentage label
