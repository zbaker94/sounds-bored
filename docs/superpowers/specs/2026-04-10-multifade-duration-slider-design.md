# Multi-Fade Duration Slider — Design Spec

**Date:** 2026-04-10
**Status:** Approved

---

## Summary

Add a fade duration slider to the per-pad overlay shown during multi-fade mode. The slider appears and disappears in sync with the existing volume levels slider. Changing it immediately persists `pad.fadeDurationMs` to the project store so that `executeMultiFadeNow` picks it up at execution time without any additional wiring.

---

## Motivation

Users currently have no per-pad duration control during a multi-fade session. The only duration knob lives in pad config (drawer) or global app settings. Adding a live slider to the multi-fade overlay lets users tune timing per-pad right before executing the fade.

---

## Architecture

### Store change — `projectStore`

Add one targeted Immer action alongside `updateLayerVolume`:

```typescript
setPadFadeDuration(sceneId: string, padId: string, durationMs: number | undefined): void
```

- Finds the pad by `sceneId` + `padId`, sets `pad.fadeDurationMs = durationMs`, marks `isDirty = true`.
- Passing `undefined` clears the override (falls back to global setting at execute time).
- No changes to `multiFadeStore` — duration lives on the pad, not on the session state.

### Execute path — no changes needed

`executeMultiFadeNow` already calls `resolveFadeDuration(pad, globalFadeDurationMs)` which reads `pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000`. Persisting to the store before execute means it is picked up automatically.

### UI change — `PadButton`

Inside the existing multi-fade overlay block (`isMultiFadeSelected && multiFadeLevels`), add a second `Slider` below the volume one:

**Slider properties:**
- `min={100}` `max={10000}` `step={100}`
- `value={[pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000]}` where `globalFadeDurationMs` comes from `useAppSettingsStore((s) => s.settings?.globalFadeDurationMs)`
- `onValueChange={(v) => setPadFadeDuration(sceneId, pad.id, v[0])}`
- `tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}` — shown on the thumb via the existing `compact` Slider tooltip
- `compact` prop (matches volume slider style)

**Label row** below the slider:
- Left: `"fade"` label
- Right: current value formatted as `X.Xs` (e.g. `2.0s`)
- Styled identically to the existing `"end"` / `"start"` label row (`text-[9px] text-white/70`)

**Data needed in `PadButton`:**
- `setPadFadeDuration` from `useProjectStore`
- `globalFadeDurationMs` from `useAppSettingsStore((s) => s.settings?.globalFadeDurationMs)` — used to show a resolved default when `pad.fadeDurationMs` is unset
- `pad.fadeDurationMs` is already available via the `pad` prop

**Tooltip:** thumb only, via `tooltipLabel={(v) => \`${(v / 1000).toFixed(1)}s\`}`. No label tooltip.

**No change** to the show/hide logic — the duration slider shares the same `isMultiFadeSelected && multiFadeLevels` gate as the volume slider.

---

## Slider Layout (within overlay)

```
┌─────────────────────────────┐
│  [══●═══════════════]       │  ← volume range slider (existing)
│  end                  start │  ← existing label row
│  [═══════●═══════════]      │  ← fade duration slider (new)
│  fade ⓘ              2.0s  │  ← new label row with tooltip on "fade"
└─────────────────────────────┘
```

---

## Constraints

- Duration range: 100ms – 10,000ms (matches `PadSchema.fadeDurationMs` validation)
- Step: 100ms
- Display: always formatted as `X.Xs` (one decimal place)
- The slider only appears during multi-fade mode (not during normal playback or drag-volume)
- Persists immediately on every slider tick (same behavior as other pad config changes)

---

## Out of Scope

- Clearing the per-pad override (resetting to global) — can be done via pad config drawer
- Animating the duration value display
- Adding duration control outside of multi-fade mode via this overlay

---

## Files Changed

| File | Change |
|------|--------|
| `src/state/projectStore.ts` | Add `setPadFadeDuration` action |
| `src/components/composite/SceneView/PadButton.tsx` | Add duration slider + label row to multi-fade overlay |
