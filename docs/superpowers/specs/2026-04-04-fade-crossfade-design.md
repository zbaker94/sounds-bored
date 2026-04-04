# Fade & Crossfade Design Spec

**Date:** 2026-04-04
**Status:** Approved

---

## Overview

Add pad-level fade in/out and many-to-many crossfade to the scene view. Users trigger fades via a toolbar button row and corresponding hotkeys. Each pad has a configurable fade duration; a global default covers pads that have not been explicitly configured.

---

## Feature Summary

| Feature | Description |
|---|---|
| Fade | Fade a single pad in (if not playing) or out (if playing) over its configured duration |
| Crossfade | Simultaneously fade out ≥1 playing pads and fade in ≥1 non-playing pads |
| Fade Duration | Per-pad configurable slider; falls back to global default from App Settings |
| Hotkeys | All actions accessible via keyboard; scoped to scene view when no input is focused |

---

## Scene Toolbar

Two buttons — **Fade** and **Crossfade** — are added to the menu bar above the pad grid in `SceneView`. They sit alongside existing controls (e.g. stop-all). Both buttons are **disabled when edit mode is active**.

### Fade Mode (hotkey: `F`)

1. Press Fade button or `F` → enter fade mode. Button becomes active/highlighted. Status label appears in toolbar: `"Select a pad"`.
2. Tap any valid pad → execute (fade out if playing, fade in if not playing) → exit mode.
3. Press Fade / `F` again, or press `Escape` → cancel, exit mode.

### Crossfade Mode (hotkey: `X`)

1. Press Crossfade button or `X` → enter crossfade mode. Button becomes active/highlighted. Status label: `"Select pads to crossfade"`.
2. Tap valid pads to build a selection:
   - Tapping an unselected pad selects it (strong ring appears).
   - Tapping a selected pad deselects it.
   - If selection drops to 0 pads → exit mode automatically.
3. When selection contains ≥1 playing pad AND ≥1 non-playing pad, status updates to: `"Ready — press X or Enter to execute"`.
4. **Execute**: press `X`, `Enter`, or the Crossfade button again → fire crossfade, exit mode.
5. **Cancel**: press `Escape`, or press `X` / Crossfade button when selection is not yet valid → clear selection, exit mode.

### Hotkey Table

| Action | Hotkey |
|---|---|
| Enter Fade mode | `F` |
| Enter Crossfade mode | `X` |
| Execute crossfade (valid selection only) | `Enter` |
| Cancel / exit any fade mode | `Escape` |

All hotkeys are scoped to the scene view and suppressed when any text input or dialog is focused.

---

## Pad Visual States

Pad visual treatment changes based on active mode. These states are derived from `padFadeState`, a map computed by `useFadeMode` and passed to the pad grid.

### In Fade Mode

| Pad state | Visual |
|---|---|
| Valid (has sounds) | Subtle selectable ring |
| Invalid (no sounds) | Dimmed, non-interactive |

### In Crossfade Mode

| Pad state | Visual |
|---|---|
| Playing, unselected | Warm amber ring — indicates "will fade out" |
| Non-playing, unselected | Cool green ring — indicates "will fade in" |
| Selected (either) | Bold solid ring (bright version of role color) |
| Invalid (no sounds) | Dimmed, non-interactive |

No special highlighting is applied to pads outside of fade modes.

---

## Pad Configuration — Fade Duration

A **Fade Duration** slider is added to the pad config dialog.

- **Range:** 0.1s – 10s
- **Default:** inherits global default if no pad-specific value is set
- A "Reset to default" control sits next to the slider so the user can clear the override without needing to know the current global value
- Stored as `fadeDurationMs?: number` on `PadSchema` — absence means "use global default"

### Global Default

A **Default Fade Duration** slider is added to **App Settings**.

- **Range:** 0.1s – 10s
- **Default value:** 2000ms (2s)
- Stored in `AppSettingsSchema` as `globalFadeDurationMs: number`

### Duration Resolution (used by all fade functions)

```typescript
pad.fadeDurationMs ?? appSettingsStore.getState().settings?.globalFadeDurationMs ?? 2000
```

---

## Audio Engine

The existing gain graph (`source → voiceGain → layerGain → padGain → masterGain`) already supports all required operations. Fades are ramps on the `padGain` node, the same node targeted by `setPadVolume`.

Three new functions are added to `padPlayer.ts`:

### `fadePadOut(pad: Pad, durationMs: number): void`

1. Get `padGain` via `getPadGain(pad.id)`.
2. Cancel any scheduled values on the gain.
3. Ramp `padGain.gain` from current value to `0` over `durationMs` using `linearRampToValueAtTime`.
4. Store the timeout ID in a module-level `fadePadTimeouts` map (keyed by `pad.id`).
5. After `durationMs`: call `stopPad(pad)` then `resetPadGain(pad.id)`.
6. Call `updatePadVolume(pad.id, 0)` immediately so the store reflects the intent.

### `fadePadIn(pad: Pad, durationMs: number): Promise<void>`

1. Call `triggerPad(pad, 0)` — starts playback silently at gain 0.
2. Ramp `padGain.gain` from `0` to `1.0` over `durationMs`.
3. Call `updatePadVolume(pad.id, 1.0)` immediately.

### `crossfadePads(fadingOut: Pad[], fadingIn: Pad[]): void`

Starts all ramps simultaneously. Each pad uses its own resolved fade duration.

```typescript
fadingOut.forEach((pad) => fadePadOut(pad, resolveFadeDuration(pad)));
fadingIn.forEach((pad) => fadePadIn(pad, resolveFadeDuration(pad)));
```

### Cancellation on `stopAllPads`

`stopAllPads` clears all entries in `fadePadTimeouts` before executing its gain ramp, preventing fade cleanup callbacks (stopPad / resetPadGain) from firing after the global stop has already settled voices.

---

## `useFadeMode` Hook

Lives at the `SceneView` level. Consumed by the toolbar (mode state, execute/cancel) and the pad grid (pad visual state map).

### State

```typescript
mode: "fade" | "crossfade" | null
selectedPadIds: Set<string>
```

### Actions

| Action | Description |
|---|---|
| `enterFade()` | Set mode to `"fade"` |
| `enterCrossfade()` | Set mode to `"crossfade"` |
| `togglePad(padId)` | Select if unselected, deselect if selected; exit if selection hits 0 |
| `execute()` | Run fade/crossfade audio functions; reset state |
| `cancel()` | Clear selection, set mode to null |

### Derived Values

- `padFadeState: Map<string, PadFadeState>` — computed from `mode`, `selectedPadIds`, and `playingPadIds` (from `playbackStore`). Passed to the pad grid so pads apply the correct visual treatment without knowing about fade mode internally.
- `canExecute: boolean` — true when in crossfade mode with ≥1 playing and ≥1 non-playing pad selected.

### Keyboard Listeners

Registered via `useEffect` on mount; removed on unmount. Suppressed when `editMode` is true or when any `<input>`, `<textarea>`, or dialog is focused.

---

## Gesture Handler Integration

`PadButton` currently conditionally applies gesture handlers based on `editMode`:

```tsx
{...(editMode ? { ...attributes, ...listeners } : gestureHandlers)}
```

This extends to a three-way conditional:

```tsx
{...(editMode
  ? { ...attributes, ...listeners }
  : fadeMode
    ? fadeHandlers
    : gestureHandlers
)}
```

`fadeHandlers` only implements `onPointerDown` — it calls `useFadeMode.togglePad(pad.id)` if the pad is valid, and is a no-op otherwise. No hold timer, no drag, no trigger.

---

## System Integration

### Edit Mode

- Fade/Crossfade buttons are disabled (visually and functionally) when `editMode` is true in `uiStore`.
- Activating edit mode while in any fade mode calls `cancel()` automatically.
- `useFadeMode` reads `editMode` from `uiStore` and early-returns from `enterFade` / `enterCrossfade` if it is active.

### Dialog Interop

- Opening any dialog (pad config, confirm delete, etc.) while in fade mode calls `cancel()`.
- Dialog-owning components (`PadButton`, pad config dialog) receive `cancelFadeMode` as a prop from `SceneView` and call it when setting their local dialog-open state to true.
- Fade mode entry is blocked while any dialog is open. `useFadeMode` reads a `dialogOpen` flag from `uiStore` (to be added) or receives it as a parameter.

### Stop-All Interop

- `stopAllPads()` clears `fadePadTimeouts` before ramping gains, preventing stale `stopPad` / `resetPadGain` callbacks from firing after the global stop completes.

### `padVolumes` Sync

- `fadePadOut` calls `updatePadVolume(padId, 0)` immediately on ramp start.
- `fadePadIn` calls `updatePadVolume(padId, 1.0)` immediately on ramp start.
- This keeps the playback store in sync with the gain graph for UI reactivity.

---

## Schema Changes

### `PadSchema` (addition)

```typescript
fadeDurationMs: z.number().min(100).max(10000).optional()
```

### `AppSettingsSchema` (addition)

```typescript
globalFadeDurationMs: z.number().min(100).max(10000).default(2000)
```

---

## Files Affected

| File | Change |
|---|---|
| `src/lib/schemas.ts` | Add `fadeDurationMs` to `PadSchema`; add `globalFadeDurationMs` to `AppSettingsSchema` |
| `src/lib/audio/padPlayer.ts` | Add `fadePadOut`, `fadePadIn`, `crossfadePads`, `fadePadTimeouts`; update `stopAllPads` |
| `src/hooks/useFadeMode.ts` | New hook — mode state, selection, keyboard listeners, derived `padFadeState` |
| `src/components/composite/SceneView/SceneView.tsx` | Mount `useFadeMode`; pass state/handlers to toolbar and pad grid |
| `src/components/composite/SceneView/PadButton.tsx` | Three-way handler conditional; consume `padFadeState` for visual treatment |
| `src/state/appSettingsStore.ts` | Surface `globalFadeDurationMs` from settings |
| App Settings UI | Add global fade duration slider |
| Pad config dialog | Add per-pad fade duration slider with reset-to-default control |
