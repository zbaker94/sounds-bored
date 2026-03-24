# Pad Sound & Layer Configuration — MVP Design

**Date:** 2026-03-24
**Status:** Approved
**Phase:** 3 (MainPage UI)

---

## Overview

When a user adds a pad, a `DrawerDialog` opens immediately so they can name the pad and configure its first layer (sound selection, arrangement, and playback settings). `DrawerDialog` renders as a Dialog on desktop and a bottom Drawer on mobile. The component is reusable for a future "edit pad" flow.

---

## Scope

### In MVP

- Pad name
- One layer per pad
- Layer selection: assigned (specific sounds), tag (all sounds with a tag), or set (a curated set)
- Layer arrangement: simultaneous / sequential / shuffled
- Layer playback mode: one-shot / hold / loop
- Layer retrigger mode: restart / continue / stop / next
- Layer volume (0–100)

### Deferred (keep in mind when designing)

- Multiple layers per pad
- Pad color and icon
- Mute groups (`muteGroupId`) and directional mutes (`muteTargetPadIds`)
- Edit mode (per-pad controls, edit mode toggle)
- Editing an existing pad (the `DrawerDialog` supports it via `initialConfig`, but no trigger UI yet)

---

## Data Flow

### Store Changes

**`projectStore`**

- `addPad(sceneId: string, config: PadConfig)` — replaces current default-only version. Accepts a full config, merges with a generated `id`. Generates a new `crypto.randomUUID()` for each layer's `id` when constructing the `Layer[]` from the form output.
- `updatePad(sceneId: string, padId: string, config: PadConfig)` — new action for the future edit flow. Replaces all `PadConfig` fields on the matching pad in-place, leaving `pad.id` unchanged.

**`uiStore`**

- Add `PAD_CONFIG_DRAWER` to the overlay ID constants.

### `PadConfig` Type

Not a new Zod schema — derived from the writable fields of `Pad`:

```ts
type PadConfig = {
  name: string
  layers: Layer[]
  muteTargetPadIds: string[]
  muteGroupId?: string
  color?: string
  icon?: string
}
```

For MVP, the form only populates `name` and `layers[0]`. All other fields default to empty.

---

## Form Schema

A new `PadConfigSchema` is added to `src/lib/schemas.ts`. It covers the writable fields validated by the form:

```ts
// Named LayerConfigFormSchema to distinguish from LayerSchema (which includes id)
const LayerConfigFormSchema = z.object({
  selection: LayerSelectionSchema,  // existing discriminated union
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number().min(0).max(100),
})

const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layer: LayerConfigFormSchema,
})
```

The form uses **React Hook Form** with `@hookform/resolvers/zod`. The `layer` field is singular in the form (MVP = one layer); `addPad` wraps it in a `layers` array and generates a `crypto.randomUUID()` for `Layer.id` before saving to the store.

### Default Form Values

```ts
const defaultValues: PadConfigFormValues = {
  name: "",
  layer: {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  },
}
```

When `initialConfig` is provided (edit flow), the form is pre-populated from the existing pad's `name` and first `layer`. When `initialConfig` is absent (create flow), these defaults are used.

When the user switches selection type, the form resets to the following per-type defaults:

```ts
// Reset targets when switching selection type
{ type: "assigned", instances: [] }
{ type: "tag",      tagId: "",  defaultVolume: 100 }
{ type: "set",      setId: "",  defaultVolume: 100 }
```

---

## Component Structure

All new components live in `src/components/composite/PadConfigDrawer/`.

### `PadConfigDrawer.tsx`

Root component. Wraps the existing `DrawerDialog` component (`src/components/ui/drawer-dialog.tsx`) — renders as a Dialog on desktop, bottom Drawer on mobile.

```ts
interface PadConfigDrawerProps {
  sceneId: string                     // needed to call addPad on save
  initialConfig?: Partial<PadConfig>  // undefined = create flow; populated = edit flow
}
```

**Mounting model: local mount inside `SceneView`.**

`PadConfigDrawer` is rendered as a child of `SceneView` (always mounted, or conditionally). This gives it access to `sceneId` as a prop, which is required to call `addPad(sceneId, config)` on save. Open state is still driven by `uiStore` — the component reads `useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER))` internally and calls `closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER)` on save and cancel.

This is the same pattern used by `ConfirmCloseDialog` and `SaveProjectDialog`, which are rendered inside `MainPage` (local mount) while driving their open state from `uiStore`.

- Owns the React Hook Form instance (`useForm` with Zod resolver)
- Calls `addPad(sceneId, config)` from `useProjectStore` on submit
- Renders title "Configure Pad" (or "Edit Pad" when editing — the caller decides)
- Footer: "Save" (submit) + "Cancel" buttons
- On submit: validates, calls `addPad`, closes overlay
- On cancel: closes overlay — nothing written to store

### `LayerConfigSection.tsx`

Renders one layer's configuration fields. Designed to be a list item in a future `useFieldArray` when multiple layers are supported.

Fields rendered:
- Selection type toggle (assigned / tag / set)
- `SoundSelector` (conditional on selection type)
- Arrangement segmented control
- Playback mode segmented control
- Retrigger mode segmented control
- Volume slider

### `SoundSelector.tsx`

Conditional selection UI. Reads from `useLibraryStore` directly (not passed as props).

| Selection type | UI |
|---|---|
| `assigned` | Searchable multi-select list of sounds from library |
| `tag` | Single-select dropdown of tags from library |
| `set` | Single-select dropdown of sets from library |

Switching selection type resets the previous type's value (no cross-type preservation in MVP).

---

## Trigger Flow

### Add Pad (MVP)

1. User clicks "Add Pad" in `SceneView`
2. `SceneView` calls `openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")` from `uiStore`
3. `PadConfigDrawer` opens with no `initialConfig` (empty defaults)
4. User fills in the form and clicks Save
5. `addPad(sceneId, config)` is called with the form output
6. Overlay closes

On Cancel: overlay closes, nothing written to store.

### Edit Pad (Future)

1. In edit mode, user clicks a pad's edit control
2. Caller passes the pad's existing config as `initialConfig`
3. On Save: `updatePad(sceneId, padId, config)` is called instead

---

## Dependencies

- `react-hook-form` — new, not yet in `package.json`, run `npm install react-hook-form @hookform/resolvers`
- `@hookform/resolvers` — new, bundled in same install above
- `DrawerDialog` (`src/components/ui/drawer-dialog.tsx`) — existing
- `useLibraryStore` — existing (sounds, tags, sets)
- `uiStore` — existing (overlay stack management)
- `projectStore` — existing (updated actions)

---

## Out of Scope

- Audio playback (Phase 5)
- Sound import UI / adding sounds to the library (Phase 4)
- yt-dlp integration (Phase 6)
- Edit mode pad controls (future Phase 3 work)
