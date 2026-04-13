# Pad Hotkeys — Context Menu & Edit Mode

**Date**: 2026-04-13
**Status**: Approved

---

## Overview

Add keyboard shortcuts to the pad context menu (right-click popover) and edit mode backside, plus
enhance multi-fade mode hotkeys. Tooltips on buttons expose the bindings to the user.

---

## Requirements

### Context menu (popover open for a specific pad)
- `F` → fade the pad (`handleFade`)
- `X` → enter synchronized fade mode (`handleMultiFade`, preselects this pad)
- Both buttons get hover tooltips showing their hotkey

### Edit mode backside (all pads flipped simultaneously)
- `F` → exit edit mode + enter multi-fade with no pre-selected pad
- `X` → same as F
- "Synchronized Fades" button gets a hover tooltip showing `F / X`

### Multi-fade mode (additions/changes to existing behavior)
- `F` or `X` → execute the multi-fade (same as existing `Enter`)
- `Escape` → cancel multi-fade; the **global** escape handler must not also open the side menu drawer

---

## Architecture

### 1. `src/state/multiFadeStore.ts`

Add `enterMultiFadeEmpty()` action:

```typescript
enterMultiFadeEmpty: () =>
  set({
    active: true,
    originPadId: null,
    selectedPads: new Map(),
    reopenPadId: null,
  }),
```

No pad is pre-selected. The user clicks pads after entering the mode.

### 2. `src/hooks/useMultiFadeMode.ts`

- Add `useHotkeys("f,x", execute, { enabled: active && canExecute })` — triggers the fade alongside the existing `Enter` binding.
- No change to the escape handler (`cancelMultiFade` with `reopenPadId` reopen remains correct).

### 3. `src/hooks/useGlobalHotkeys.ts`

**Escape handler** — add early return when multi-fade is active:
```typescript
useHotkeys("esc", () => {
  if (useMultiFadeStore.getState().active) return; // let useMultiFadeMode handle it
  // ... existing logic
}, { enableOnFormTags: true });
```

**New edit-mode handler** — `F`/`X` exit edit mode and enter empty multi-fade:
```typescript
useHotkeys("f,x", () => {
  const { editMode, toggleEditMode } = useUiStore.getState();
  const { active: multiFadeActive } = useMultiFadeStore.getState();
  if (!editMode || multiFadeActive) return;
  toggleEditMode();
  useMultiFadeStore.getState().enterMultiFadeEmpty();
});
```

Both store mutations happen in the same synchronous flush so React 18 batches them. The
`useMultiFadeMode` effect (`if (editMode && active) cancelMultiFade()`) sees the final
state (`editMode=false, active=true`) and does not cancel.

### 4. `src/components/composite/SceneView/PadControlContent.tsx`

**New prop**: `context: "popover" | "backface"` (required — callers must declare intent).

**Local hotkeys** (enabled only in popover context):
```typescript
useHotkeys("f", handleFade,      { enabled: context === "popover" });
useHotkeys("x", handleMultiFade, { enabled: context === "popover" });
```

Since Radix only mounts `PopoverContent` / `DrawerContent` when open, at most one popover
`PadControlContent` exists in the DOM at any time — no multi-registration conflict.

**Tooltip wrappers** (both display modes):

| Button | Popover tooltip | Backface tooltip |
|--------|----------------|-----------------|
| Fade In/Out | `[F]` | none |
| Synchronized Fades | `[X]` | `[F] / [X]` |

Use the existing `Tooltip` + `TooltipContent` + `Kbd` components.

### 5. `src/components/composite/SceneView/PadButton.tsx`

Pass `context` prop to each `PadControlContent` instance:

| Render site | `context` value |
|-------------|----------------|
| `PopoverContent` | `"popover"` |
| `DrawerContent` | `"popover"` |
| Back face | `"backface"` |

---

## Data Flow — Hotkey Priority

```
Key pressed
  │
  ├─ multiFadeActive?
  │    F / X → executeMultiFadeNow()          (useMultiFadeMode)
  │    Esc   → cancelMultiFade()              (useMultiFadeMode)
  │             global Esc bails early        (useGlobalHotkeys)
  │
  ├─ popoverOpen (for pad P)?
  │    F → handleFade(P)                      (PadControlContent local)
  │    X → handleMultiFade(P)                 (PadControlContent local)
  │
  └─ editMode?
       F / X → toggleEditMode() + enterMultiFadeEmpty()   (useGlobalHotkeys)
       Esc   → toggleEditMode()                            (existing Esc → close overlay stack)
```

---

## Error Handling & Edge Cases

- **Unplayable pads**: popover never opens for them (`handleContextMenu` guards this), so local hotkeys are never active.
- **f/x conflict — popover vs multi-fade**: popover closes before multi-fade is entered (`onClose()` in `handleMultiFade`), disabling the local hotkeys.
- **f/x conflict — edit mode vs multi-fade**: global edit-mode handler checks `!multiFadeActive` before acting.
- **enterMultiFadeEmpty from edit mode**: `toggleEditMode()` + `enterMultiFadeEmpty()` in one flush; cancel-on-editMode effect sees `editMode=false` and does not fire.

---

## Testing

### Test-first order
1. Write / update failing tests
2. Implement
3. Verify tests pass

### Automated tests

| File | Changes |
|------|---------|
| `src/state/multiFadeStore.test.ts` | Add `enterMultiFadeEmpty` cases: sets `active=true`, empty `selectedPads`, `originPadId=null` |
| `src/hooks/useMultiFadeMode.test.ts` | Add: f/x execute when `canExecute`; f/x no-op when `!canExecute` |
| `src/components/composite/SceneView/PadControlContent.test.tsx` | Add: `context="popover"` — f triggers fade, x triggers multiFade; `context="backface"` — f/x do NOT trigger local handlers; tooltip text assertions |

### Manual tests

Update `docs/manual-tests/` — add or extend:
- Context menu hotkeys: open popover, press F → fade; press X → enter synchronized fade
- Edit mode hotkeys: enter edit mode, press F (or X) → exits edit mode, enters multi-fade with no preselection
- Multi-fade f/x execute: enter multi-fade, select pads, press F or X → fade executes
- Multi-fade escape: enter multi-fade, press Escape → cancelled, side menu does NOT open

---

## Files Changed

| File | Change type |
|------|------------|
| `src/state/multiFadeStore.ts` | Add `enterMultiFadeEmpty` action |
| `src/hooks/useMultiFadeMode.ts` | Add f/x hotkeys; add `enterMultiFadeEmpty` to return type |
| `src/hooks/useGlobalHotkeys.ts` | Patch escape; add f/x edit-mode handler |
| `src/components/composite/SceneView/PadControlContent.tsx` | Add `context` prop, local hotkeys, tooltips |
| `src/components/composite/SceneView/PadButton.tsx` | Pass `context` prop to all three `PadControlContent` usages |
| `src/state/multiFadeStore.test.ts` | New test cases |
| `src/hooks/useMultiFadeMode.test.ts` | New test cases |
| `src/components/composite/SceneView/PadControlContent.test.tsx` | New test cases |
| `docs/manual-tests/` | Add hotkey test entries |
