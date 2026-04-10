# Speech Bubble Arrow on PopoverContent

**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

Add a comic speech bubble-style triangle arrow to the `PopoverContent` component that points toward the source element (the trigger/anchor). The feature is opt-in via a `showArrow` prop and is used initially in `PadLiveControlPopover`.

---

## Architecture

### `src/components/ui/popover.tsx`

Add a `showArrow?: boolean` prop to `PopoverContent`. When `true`, render two stacked `<PopoverPrimitive.Arrow>` elements inside the `PopoverPrimitive.Content`:

- **Outer arrow**: `width={14}` `height={8}`, `className="fill-foreground/10"` — provides the subtle border/ring impression
- **Inner arrow**: `width={12}` `height={7}`, `className="fill-popover"` — fills with the panel background color, visually covering the center of the outer arrow

Radix automatically positions both arrows at the correct edge of the panel (bottom when `side="top"`, etc.) and tracks the anchor horizontally.

The `sideOffset` prop in `PopoverContent` has no default change — callers are responsible for adjusting `sideOffset` to account for the arrow height when `showArrow` is used. The recommended value is `10` (vs the default `4`).

### `src/components/composite/SceneView/PadLiveControlPopover.tsx`

Update the desktop `<PopoverContent>` usage:

```tsx
// Before
<PopoverContent className="w-72" side="top" sideOffset={8}>

// After
<PopoverContent className="w-72" side="top" sideOffset={10} showArrow>
```

No changes to the mobile `<Drawer>` branch.

---

## Components

| Component | Change |
|---|---|
| `PopoverContent` | Add `showArrow?: boolean` prop; render two `PopoverPrimitive.Arrow` elements when true |
| `PadLiveControlPopover` | Pass `showArrow` and adjust `sideOffset` to `10` |

---

## Data Flow

No state or data flow changes. The arrow is purely presentational — SVG elements rendered inside the Radix popover content portal.

---

## Error Handling

No error handling required. Purely a visual/CSS change.

---

## Testing

No new tests required. The existing `PadLiveControlPopover.test.tsx` tests should continue to pass unchanged since the arrow is a visual-only addition with no behavior change.

---

## Non-Goals

- Arrow does not show on mobile (Drawer is used instead)
- `showArrow` defaults to `false` — no existing popover usages are affected
- No animation on the arrow (inherits the popover's open/close animation naturally as it is inside the content)
