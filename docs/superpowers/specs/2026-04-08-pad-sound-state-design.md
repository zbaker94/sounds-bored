# Pad Sound State — Design Spec

**Date:** 2026-04-08
**Status:** Approved

---

## Problem

When sounds are removed from the global library (via "Delete from Disk" or manual file deletion), pads that referenced those sounds silently stop playing. There is no visual feedback at the pad level, and users have no way to know which pads are affected without triggering each one.

Two distinct root causes:

1. **Orphan soundIds** — a `soundId` in a pad layer's `instances` array no longer exists in `libraryStore.sounds` at all (the library entry was deleted).
2. **Missing-file sounds** — the sound entry still exists in the library but its file is absent from disk (`libraryStore.missingSoundIds`).

---

## Goals

- Auto-clean orphan soundIds so stale references don't accumulate silently.
- Surface broken pad state at the pad face and in the pad config drawer.
- Disable fully unplayable pads.
- Warn users in delete confirmation dialogs about which pads will be affected.

---

## Out of Scope

- Tag/set layer validation (sound resolution is dynamic; no pre-validation).
- Auto-repair (remapping broken references to replacement sounds).
- Surfacing missing-file sounds beyond what the existing SoundsPanel + ResolveMissingDialog already handles.

---

## Section 1: Auto-Clean

### Trigger Points

1. After project load completes (library is reconciled before this runs).
2. After each library reconciliation while a project is open — both manual "Refresh" and the post-delete reconcile.

### What Is Cleaned

For every `assigned` layer in every pad across all scenes: remove any entry from `instances` whose `soundId` is not present in `libraryStore.sounds`.

- `tag` and `set` layers are not touched.
- If removing orphan instances leaves a layer with an empty `instances` array, the layer is **left in place** — called out visually (see Section 3), not deleted.

### Persistence

The cleaned project is written back via `updateProject()`, marking `isDirty = true` and triggering auto-save. No explicit save action needed.

### New Utility: `src/lib/projectSoundReconcile.ts`

```typescript
type ReconcileResult = {
  project: Project;
  removedCount: number;  // total soundId entries removed
};

function reconcileProjectSounds(project: Project, sounds: Sound[]): ReconcileResult
```

Pure function — no Zustand access. Returns the cleaned project and a count of removed references. Kept separate for testability.

---

## Section 2: Pad Visual States

### State Values

`getPadSoundState(pad, sounds, missingSoundIds)` returns one of:

| State | Condition | Visual treatment |
|---|---|---|
| `"ok"` | No issues | Normal |
| `"partial"` | At least one `soundId` across any `assigned` layer is in `missingSoundIds` | Warning icon overlay (bottom-right corner) |
| `"disabled"` | Every `assigned` layer has all `soundId`s in `missingSoundIds` (or empty `instances`), AND no `tag`/`set` layers exist | Reduced opacity, `pointer-events: none` |

Note: after auto-clean, orphan soundIds never produce `"partial"` or `"disabled"`. Both states at runtime come exclusively from `missingSoundIds` (file present in library, file missing on disk).

### Hook: `usePadSoundState(pad)`

Lives in `PadButton`. Reads:
- `useLibraryStore((s) => s.sounds)`
- `useLibraryStore((s) => s.missingSoundIds)`

Calls `getPadSoundState` inside `useMemo`.

### Warning Icon

- Icon: `Alert02Icon` (already used in the codebase)
- Position: bottom-right corner overlay on the pad face
- Tooltip: *"Some assigned sounds are missing from the library. Open pad settings to review."*

### Disabled State

- Existing `disabled` prop on `PadButton` handles visual treatment
- `pointer-events: none` prevents trigger
- No tooltip on the disabled pad itself

---

## Section 3: Pad Config Drawer — Layer-Level Warnings

In `LayerAccordion`, each layer header gets a small `Alert02Icon` when either:
- At least one `soundId` in `instances` is in `missingSoundIds`
- `instances` is empty (no sounds assigned, layer is inert)

**Tooltip content:**
- Missing sounds: *"Missing sounds: Kick 808, Snare Top"* (resolved by name from library)
- Empty layer: *"No sounds assigned to this layer."*

**Implementation:** `LayerAccordion` already has access to layer data. Needs two additional store selectors:
- `useLibraryStore((s) => s.sounds)` — to resolve names
- `useLibraryStore((s) => s.missingSoundIds)` — to check status

No separate alert banner in the drawer. Per-layer icon is sufficient.

---

## Section 4: Delete Confirmation — Impact Preview

Both **Delete Folder from Disk** and **Delete Sounds from Disk** dialogs show an impact section when the current project has pads referencing the sounds being deleted.

### New Utility (added to `projectSoundReconcile.ts`)

```typescript
type AffectedPad = {
  padName: string;
  sceneName: string;
  layerIndices: number[];  // 1-based for display
};

function getAffectedPads(project: Project, soundIds: Set<string>): AffectedPad[]
```

Called when the confirm dialog is opened. Result stored in component state alongside the existing confirm state.

### Display

Shown below the existing dialog description when `affectedPads.length > 0`:

```
Affects this project:
• "Kick" (Scene 1) — Layer 1, Layer 3
• "Intro Hit" (Scene 2) — Layer 1
```

Omitted entirely when no pads are affected.

**Informational only** — no user action required. The delete proceeds identically regardless.

---

## Implementation Touchpoints

| File | Change |
|---|---|
| `src/lib/projectSoundReconcile.ts` | New file — `reconcileProjectSounds`, `getPadSoundState`, `getAffectedPads` |
| `src/hooks/useProjectLifecycle.ts` | Call `reconcileProjectSounds` after project load |
| `src/hooks/useReconcileLibrary.ts` | Call `reconcileProjectSounds` after reconcile (when project is open) |
| `src/components/composite/SceneView/PadButton.tsx` | Add `usePadSoundState`, warning icon, disabled state |
| `src/components/composite/PadConfigDrawer/LayerAccordion.tsx` | Add per-layer warning icon |
| `src/components/composite/SidePanel/SoundsPanel.tsx` | Call `getAffectedPads`, pass result to confirm dialogs |
