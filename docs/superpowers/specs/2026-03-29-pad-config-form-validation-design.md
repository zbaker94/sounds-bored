# Pad Config Form Validation

**Date:** 2026-03-29
**Status:** Approved

## Problem

The pad config form (`PadConfigDrawer`) has a Zod schema wired up via `zodResolver`, and `errors.name` is already rendered. However, the `LayerSelection` fields are not validated correctly:

- `tagId: z.string()` passes with `""` (the default when switching to Tag mode)
- `setId: z.string()` passes with `""` (same)
- `instances: z.array(...)` passes with an empty array (no sounds assigned)

This means a user can save a pad with no sounds configured, which is always an error.

## Goal

Block form submission when the sound selection is incomplete, and display a clear inline error message telling the user what to fix.

## Approach

**react-hook-form `mode: "onSubmit"` (default)** — errors only appear after the user clicks Save. Consistent with how `errors.name` already works. No aggressive inline validation on a fresh form.

## Changes

### `src/lib/schemas.ts`

Tighten the three discriminated union variants in `LayerSelectionSchema`:

```ts
z.object({
  type: z.literal("assigned"),
  instances: z.array(SoundInstanceSchema).min(1, "At least one sound is required"),
}),
z.object({
  type: z.literal("tag"),
  tagId: z.string().min(1, "A tag must be selected"),
  defaultVolume: z.number(),
}),
z.object({
  type: z.literal("set"),
  setId: z.string().min(1, "A set must be selected"),
  defaultVolume: z.number(),
}),
```

No changes to `PadConfigSchema` or `LayerConfigFormSchema` — the error propagates through automatically.

### `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`

Destructure `formState: { errors }` from `useFormContext<PadConfigForm>()`.

After the `SoundSelector` / Select widget, render an error paragraph based on the active `selectionType`:

```tsx
{selectionType === "assigned" && errors.layer?.selection?.instances?.message && (
  <p className="text-sm text-destructive">{errors.layer.selection.instances.message}</p>
)}
{selectionType === "tag" && errors.layer?.selection?.tagId?.message && (
  <p className="text-sm text-destructive">{errors.layer.selection.tagId.message}</p>
)}
{selectionType === "set" && errors.layer?.selection?.setId?.message && (
  <p className="text-sm text-destructive">{errors.layer.selection.setId.message}</p>
)}
```

Same `text-sm text-destructive` class used by `errors.name` in `PadConfigDrawer.tsx`.

## Out of Scope

- Save button disabling (approach B/C — rejected in favor of inline errors only)
- Validation of `layer.volume`, arrangement, playbackMode, retriggerMode — all constrained by UI controls, can't be set to invalid values

## Files Touched

- `src/lib/schemas.ts`
- `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`
- `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx` (update tests)
