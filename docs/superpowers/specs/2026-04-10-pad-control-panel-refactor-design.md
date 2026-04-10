# Pad Control Panel Refactor — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

---

## Problem

The pad edit mode (back face of the flip card) and the right-click live control popover currently serve overlapping purposes with separate, inconsistent UIs. The edit/copy/delete actions only exist on the back face, not in the popover. The content between the two surfaces is not shared.

---

## Goal

Extract the live control panel into a single shared component (`PadControlContent`) that:
1. Adds edit/duplicate/delete actions into the header, visible on all surfaces
2. Is used by both the right-click popover/drawer and the back face in edit mode
3. Adapts its layout responsively based on available height

---

## Component Structure

### New file: `src/components/composite/SceneView/PadControlContent.tsx`

Extracted from `PadLiveControlPopover.tsx`. Contains:

- `PadControlContent` — main exported component
- `LayerRow` — moved as-is (was private to `PadLiveControlPopover.tsx`)
- `getSoundsForLayer` — moved as-is

**Props:**
```ts
interface PadControlContentProps {
  pad: Pad;
  sceneId: string;
  onClose: () => void;
  onEditClick?: (pad: Pad) => void;
}
```

---

## Header Row

Always visible in all modes. Contains:

- **Left:** pad name (`font-deathletter` truncated)
- **Right:** three icon buttons (size `icon-xs`):
  - Edit → `variant="default"` (black) — `PencilEdit01Icon` — calls `onEditClick?.(pad)`
  - Duplicate → `variant="secondary"` (yellow) — `Copy01Icon` — calls `duplicatePad(sceneId, pad.id)`
  - Delete → `variant="destructive"` (pink) — `Delete02Icon` — opens `ConfirmDeletePadDialog`

`ConfirmDeletePadDialog` state lives inside `PadControlContent`.

---

## Responsive Modes

`PadControlContent` attaches a `ResizeObserver` to its root container div to measure available height. Three modes:

### Full (height >= 280px)
Current layout unchanged, plus the new header:
1. Header (pad name + action buttons)
2. Start/Stop button
3. Fade section (fade slider, duration slider, fade in/out button, reset link)
4. Layers section (each `LayerRow` with volume slider, skip buttons, sound display)
5. Synchronized Fades button

### Condensed (height >= 120px)
1. Header (pad name + action buttons)
2. Start/Stop button
3. Fade In/Out button (fires fade with current levels — no slider visible)
4. Row of icon buttons:
   - Fade options icon → opens sub-popover with fade slider + duration slider
   - Layers icon → opens sub-popover with full layer rows
   - Synchronized Fades icon button (fires directly, no sub-popover needed)

Sub-popovers are anchored to their respective icon buttons. Only one sub-popover open at a time.

### Scroll (height < 120px)
Condensed layout inside an `overflow-y-auto` container. No layout changes — just adds scrolling.

---

## Updated: `PadLiveControlPopover.tsx`

- Renders `<PadControlContent>` in both the desktop Popover and mobile Drawer paths
- Drawer: removes `DrawerHeader` / `DrawerTitle` rendered outside `PadControlContent` (was duplicating the pad name). Uses a visually-hidden `DrawerTitle` (via `sr-only`) for accessibility.
- Popover: unchanged structurally — `PadControlContent` provides its own header
- Popover always has ample height; will render in full mode

---

## Updated: `PadButton.tsx`

- Back face replaces its current simple overlay (pad name + layer count + 3 buttons) with `<PadControlContent>`
- Back face container: `overflow-hidden` (scrolling handled inside the component)
- `onEditClick` prop threads through from `PadButton` → `PadControlContent`
- Removes direct imports of `PencilEdit01Icon`, `Copy01Icon`, `Delete02Icon` (now owned by `PadControlContent`)
- `handleContextMenu` guard (`if (editMode) return`) stays — right-click popover remains disabled in edit mode; the back face is the edit-mode control surface
- `ConfirmDeletePadDialog` and its `confirmingDelete` state move out of `PadButton` into `PadControlContent`

---

## Tests

### `PadControlContent.test.tsx` (new)
- Header renders pad name and all three action buttons
- Edit button calls `onEditClick`
- Duplicate button calls `duplicatePad`
- Delete button opens `ConfirmDeletePadDialog`; confirm calls `deletePad`
- Full mode renders fade section, layers section, synchronized fades button
- Condensed mode (mock ResizeObserver with height < 280px): shows icon buttons, hides full sections
- Scroll mode (mock ResizeObserver with height < 120px): condensed layout present

### `PadLiveControlPopover.test.tsx` (update)
- No duplicate pad name on mobile (DrawerTitle is sr-only, content header shows name once)
- Action buttons present in popover content

### `PadButton.test.tsx` (update)
- Back face renders `PadControlContent` (not the old simple overlay)
- Edit/copy/delete buttons no longer directly on back face — they live inside `PadControlContent`

---

## Out of Scope

- Changing playback behavior in edit mode (live controls on back face remain functional)
- Any changes to condensed sub-popover animations beyond Radix defaults
