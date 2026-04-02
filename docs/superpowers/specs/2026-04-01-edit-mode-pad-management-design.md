# Phase A: Edit Mode & Pad Management — Design Spec

**Date:** 2026-04-01  
**Branch:** master  
**Status:** Approved

---

## Overview

Add an edit mode to the main pad grid that lets users manage pads without accidentally triggering audio. When edit mode is active, pad taps open the config drawer, and pads show an info/action overlay. The `PadConfigDrawer` is extended to support multiple layers with accordion display and drag-and-drop reordering.

---

## 1. Edit Mode State & Hotkey

**Store change:** Add to `uiStore`:
```typescript
editMode: boolean;
toggleEditMode: () => void;
```

**Hotkey:** Wire `Mod+E` in `useGlobalHotkeys.ts` → calls `toggleEditMode()`. Follows the same pattern as existing `Mod+S` (save).

**Button:** `EditSection.tsx` currently has a button with no `onClick`. Connect it to `toggleEditMode()` and give it a visual active state when `editMode` is true (use shadcn `Button` variant `secondary` or a ring/highlight matching existing patterns).

**Scene tabs:** The pencil (rename) and delete icons in `SceneTab.tsx` currently appear only on hover. In edit mode they are always visible (no hover required). `SceneTab` should read `editMode` from `uiStore` directly and skip the hover condition when it's true.

---

## 2. PadButton Edit Mode Overlay

When `editMode` is true, `PadButton` changes behavior:

**Tap/gesture behavior in edit mode:**
- Tapping or dragging on the pad body does nothing — all gestures are suppressed.
- Only the overlay icon buttons trigger actions (see below).

**Visual treatment in edit mode:**
- Pads render with a dashed border (or similar visual distinction from the current solid/colored border) to signal they are in a non-playback state. Exact style should follow whatever looks consistent with the existing pad color/border system — a dashed outline or reduced opacity background are both acceptable.

**Overlay (always visible in edit mode):**
- Semi-transparent overlay on each pad showing: pad name + "N layers" count.
- Three icon buttons: Edit (pencil icon), Duplicate (copy icon), Delete (trash icon).
- Edit button → opens `PadConfigDrawer` with `initialConfig` populated from the pad's current data.
- Duplicate button → calls `duplicatePad(sceneId, padId)` immediately (no confirm).
- Delete button → shows a confirm dialog (reuse `ConfirmDeleteSceneDialog` pattern or new `ConfirmDeletePadDialog`), then calls `deletePad(sceneId, padId)`.

**Implementation note:** `PadButton` currently receives `pad` and `onClick`. It needs to also receive `sceneId` (for delete/duplicate actions) and read `editMode` from `uiStore` directly (following the domain-component-connects-to-store pattern).

---

## 3. PadConfigDrawer Multi-Layer Redesign

### Schema change

`PadConfigSchema` currently has `layer: LayerConfigFormSchema` (singular). Change to:
```typescript
layers: z.array(LayerConfigFormSchema).min(1)
```
Default value: array with one default layer. Existing callers (currently only `SceneView`) that build `initialConfig` need updating.

### Two modes

`PadConfigDrawer` receives a new optional `padId?: string` prop alongside the existing `initialConfig`. This is routing metadata, not form data.
- **Create mode** (`padId` is undefined): submit calls `addPad`. Title: "New Pad".
- **Edit mode** (`padId` is set): submit calls `updatePad(sceneId, padId, formValues)`. Title: "Edit Pad".

### Layer UI

Each layer is rendered as a shadcn `Accordion` item. Items are sortable via `@dnd-kit/sortable`.

**Accordion item header:**
- Drag handle (GripVertical icon) on the left — this is the `DragOverlay` trigger
- Label: "Layer 1", "Layer 2", etc.
- Remove button (X icon) on the right

**Accordion item body:** The existing layer form fields (arrangement, retriggerMode, playbackMode, selection type + values).

**Controls below accordion:**
- "Add Layer" button — appends a new layer with sensible defaults (simultaneous, restart, one-shot, assigned/empty). Available in both create and edit mode.
- Remove button per layer item — available in both create and edit mode. Disabled/hidden when only 1 layer remains.

### Drag-and-drop

Add `@dnd-kit/core` and `@dnd-kit/sortable` as dependencies.

Use `SortableContext` with `verticalListSortingStrategy`. Each accordion item wrapped in a `useSortable` hook. On `DragEndEvent`, reorder the `layers` array in form state.

The `AccordionItem` value should be a stable per-layer ID (generate one on layer creation, store in form state) so accordion open/close state survives reorder.

---

## 4. New Store Actions

Add to `projectStore`:

```typescript
deletePad(sceneId: string, padId: string): void
// Removes the pad with padId from the scene with sceneId.
// No-op if scene or pad not found.

duplicatePad(sceneId: string, padId: string): void
// Deep-clones the pad: new pad ID, new layer IDs, new SoundInstance IDs.
// Inserted immediately after the source pad in the scene's pad array.
// Uses crypto.randomUUID() for all new IDs.
```

Both actions mark `isDirty = true` (via Immer, same as existing actions).

---

## Testing Approach

- `projectStore`: unit tests for `deletePad` and `duplicatePad` (new IDs, correct position, dirty flag).
- `PadButton`: render test verifying overlay appears in edit mode, not in normal mode.
- `PadConfigDrawer`: render + interaction tests for multi-layer form (add/remove layer, form submission in create vs edit mode).
- `uiStore`: unit test for `toggleEditMode`.

---

## Out of Scope

- B.2 playback modes (loop/hold) — not part of this phase
- Tag color editing — Phase F
- Undo/redo — Phase F
