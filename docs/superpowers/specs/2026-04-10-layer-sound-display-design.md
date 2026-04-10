# Layer Sound Display in PadLiveControlPopover

**Date**: 2026-04-10  
**Status**: Approved  

---

## Overview

Add a sound-name display row to each `LayerRow` in `PadLiveControlPopover`. The row sits between the layer name/controls row and the volume slider. When playing a sequential or shuffled layer it shows the currently-playing sound name; otherwise it shows all sounds in the selection. A list icon (hidden when only one sound) opens a popover with the full numbered sound list.

---

## Layout

```
[●/○  Layer 1]  [▶/■]  [⏮]  [⏭]
[kick · snare · hi-hat open...  ] [≡]   ← new row (list icon hidden if ≤1 sound)
[══════════════ volume ═══════════════]
```

---

## Sound Names Display

### Container

- `overflow-hidden` outer div, full width minus list-icon width
- Inner `span`: `whitespace-nowrap text-xs text-muted-foreground`
- On mount and on content change, measure `scrollWidth > clientWidth` via `useRef` + `useEffect`
- If overflow detected: apply CSS marquee animation (double-copy trick — two identical spans side-by-side inside a flex container, translate `-50%` over ~10s linear infinite)
- If no overflow: render plain static text

### What to display

| Condition | Display |
|---|---|
| Layer not active | All sound names, joined by `" · "` |
| Layer active + `simultaneous` | All sound names, joined by `" · "` |
| Layer active + `sequential` or `shuffled` | Currently-playing sound name only |

### Resolving sound names

A helper `getSoundsForLayer(layer, sounds, tags, sets): Sound[]` (co-located in the file or a small util) derives the full sound list:

- `assigned` → map `layer.selection.instances` by `soundId` against `libraryStore.sounds`, preserving instance order
- `tag` → filter `libraryStore.sounds` where `sound.tags` includes `selection.tagId`
- `set` → find the `Set` by `selection.setId` in `libraryStore.sets`, then map its `soundIds` against `libraryStore.sounds`

Missing sounds (no matching library entry) are excluded from display.

### Current-sound polling (sequential/shuffled while active)

Inside `LayerRow`, when `layerActive` transitions to `true` and arrangement is `sequential` or `shuffled`, start a RAF loop that:

1. Reads `getLayerPlayOrder(layer.id)` from `audioState`
2. Reads `getLayerChain(layer.id)` from `audioState`
3. Computes `currentIndex = playOrder.length - (chain?.length ?? 0) - 1`
4. Sets local state `currentSoundId: string | null` to `playOrder[currentIndex]?.id ?? null`

Cancel the RAF when `layerActive` becomes `false` or the component unmounts. Clear `currentSoundId` on deactivation.

---

## List Icon + Popover

### Visibility

Only rendered when the total assigned sound count (including missing) is > 1.

### Icon

`ListMusicIcon` from `@hugeicons/core-free-icons`, 12px, same button style as the existing skip buttons (`p-0.5 rounded hover:bg-muted transition-colors`).

### Popover

Use the existing `Popover` / `PopoverContent` primitives from `@/components/ui/popover`.

- Trigger: the list icon button
- Side: `"top"` with a small `sideOffset`
- Width: `w-48` (192px)
- **Title** (selection context):
  - `assigned` → "Sounds"
  - `tag` → "Tag: \<tag name\>" (look up `libraryStore.tags` by `selection.tagId`)
  - `set` → "Set: \<set name\>" (look up `libraryStore.sets` by `selection.setId`)
- **Body**: numbered list (`ol`) of all sound names in selection order
  - `max-h-48 overflow-y-auto`
  - Each item: `text-xs` with index number + sound name
  - Missing sounds (no library match): show filename or ID in `text-muted-foreground italic`
- Currently-playing sound (for sequential/shuffled while active): bold or `text-foreground` instead of `text-muted-foreground`

---

## Data Access in LayerRow

`LayerRow` needs three additional library reads (all via selectors, no prop-drilling):

```typescript
const sounds = useLibraryStore((s) => s.sounds);
const tags   = useLibraryStore((s) => s.tags);
const sets   = useLibraryStore((s) => s.sets);
```

These are stable references via Zustand's shallow equality — no performance concern.

---

## File Changes

| File | Change |
|---|---|
| `src/components/composite/SceneView/PadLiveControlPopover.tsx` | All changes — `LayerRow` gets sound display row + list popover; add RAF polling for current sound; add `getSoundsForLayer` helper |

No new files needed.

---

## Edge Cases

- **Empty selection** (no sounds resolved): display row still renders but shows nothing; list icon hidden
- **Single sound**: display shows the name statically; list icon hidden
- **All sounds missing**: display shows nothing; list icon still shown if 2+ sounds are assigned (so the user can open the popover and see the missing entries)
- **cycleMode layers**: treated identically to sequential/shuffled for display purposes — poll the same maps
- **Tag/set with zero matching sounds**: treated as empty selection
