# Playback Modes, Stop Ramp & Audio Graph Refactor

**Date:** 2026-04-02  
**Status:** Approved  
**Scope:** `padPlayer.ts`, `audioVoice.ts`, `usePadGesture.ts`

---

## Goal

Implement the `loop` and `hold` playback modes, add click-free stop ramps throughout the audio engine, and refactor the audio graph to add per-voice and per-layer gain nodes.

---

## Audio Graph

### Current

```
sourceNode → padGain → masterGain → destination
```

### New

```
sourceNode → voiceGain → layerGain → padGain → masterGain → destination
```

**voiceGain** (created per voice inside `wrapBufferSource` / `wrapStreamingElement`):
- Initialized from `SoundInstance.volume / 100` for "assigned" arrangement
- Initialized at `1.0` for "tag" and "set" arrangements (no per-instance config yet; architecture supports adding it later)
- Owned by the `AudioVoice` wrapper — used for per-voice ramped stops

**layerGain** (one per active layer, stored in `layerGainMap: Map<layerId, GainNode>` in `padPlayer.ts`):
- Initialized from `layer.volume / 100` on first trigger
- Persists for the lifetime of the layer's active playback; reset to `layer.volume / 100` after a ramped stop
- Cleared when `stopAllPads()` is called

**padGain** — existing, unchanged (drag-to-volume gesture)

**masterGain** — existing, unchanged

### Passing `allSounds` to `startLayerSound`

For loop rebuild and consistent gain assignment, `startLayerSound` receives the full resolved sound list (`allSounds: Sound[]`) for all arrangement types — assigned, tag, and set. This replaces the current single-sound pattern for the chain rebuild path.

---

## Stop Ramp

### `AudioVoice` interface change

Add:

```typescript
stopWithRamp(rampS?: number): void  // default: 0.025s (25ms)
```

Implementation: ramp `voiceGain → 0` over `rampS` seconds using `linearRampToValueAtTime`, then call the underlying `source.stop()` / `audio.pause()` after `rampS * 1000 + 5` ms. The `onended` callback fires after the ramp completes (async).

`stop()` remains unchanged — instant, synchronous.

### Which path uses which

| Scenario | Method |
|---|---|
| Hold mode release | `stopWithRamp` on hold-layer voices |
| Retrigger "stop" | `stopWithRamp` on layer voices |
| Retrigger "restart" | `stop` — hard stop, new sound starts immediately (click masked) |
| Retrigger "next" | `stop` — hard stop, chain advanced directly (see below) |
| `stopAllPads` | `stopWithRamp` on all voices |
| Drag-to-zero | `stop` — padGain already at 0, click inaudible |

---

## Loop Mode (`playbackMode: 'loop'`)

### `simultaneous` + `loop`

Set `source.loop = true` (buffer path) or `audio.loop = true` (streaming path) before calling `start()`. The browser handles looping indefinitely. `onended` never fires naturally.

### `sequential` / `shuffled` + `loop`

Chain plays through normally. When `onended` fires and the queue is exhausted, instead of deleting the queue entry, call `buildPlayOrder(layer.arrangement, allSounds)` to rebuild the play order and start the chain again. For `shuffled`, this produces a new random order each loop iteration.

---

## Hold Mode (`playbackMode: 'hold'`)

Hold mode means: trigger on press, stop on release. While held, playback is identical to `loop` mode — chains advance and restart when exhausted.

### Chain behavior while held

`hold` and `loop` share the same chain-restart logic: when `onended` fires and the queue is exhausted, rebuild the play order and restart. The only difference is that `hold` stops on pointer release.

### `usePadGesture` changes

```typescript
const hasHoldLayer = pad.layers.some(l => l.playbackMode === 'hold');
```

**`onPointerDown`**: if `hasHoldLayer`, call `triggerPad(pad, 1.0)` immediately (don't wait for pointer up). The existing 150ms hold timer still runs for drag-to-volume detection.

**`onPointerUp`**: if `hasHoldLayer`, call `releasePadHoldLayers(pad)` — ramps + stops all hold-mode layer voices and clears their chain queue entries. Non-hold layers are unaffected.

### `releasePadHoldLayers(pad: Pad)` in `padPlayer.ts`

For each layer where `layer.playbackMode === 'hold'`:
1. Clear `layerChainQueue.get(layer.id)` first (prevent onended from restarting the chain)
2. Call `stopWithRamp` on all voices for that layer
3. Reset `layerGain` to `layer.volume / 100` after ramp completes

---

## "Next" Retrigger (redesigned)

Remove the `onended`-based chain advance. Instead, when retrigger "next" fires on an active layer:

1. Call `voice.setOnEnded(null)` on all current layer voices, then `stop()` — nulling the callback before stopping prevents `onended` from firing and re-advancing the chain
2. Pull next directly from `layerChainQueue.get(layer.id)` (the remaining sounds after the current)
3. If a next sound exists: set the updated remainder back on the queue, start the next sound via `startLayerSound`
4. If queue is empty and `playbackMode === 'loop'` or `'hold'`: `allSounds` is already in scope (resolved earlier in `triggerPad`), rebuild play order with `buildPlayOrder`, start from beginning
5. If queue is empty and `playbackMode === 'one-shot'`: delete queue entry, stop without restart

This eliminates the synchronous `onended` dependency that previously made "next" retrigger fragile to ramp changes.

---

## Files to Change

| File | Changes |
|---|---|
| `src/lib/audio/audioVoice.ts` | Add `voiceGain` node to both wrappers; add `stopWithRamp`; `voiceGain` initial value passed as param |
| `src/lib/audio/padPlayer.ts` | Add `layerGainMap`; wire `layerGain` and `voiceGain`; pass `allSounds` to `startLayerSound`; implement loop restart in `onended`; redesign "next" retrigger; add `releasePadHoldLayers`; update `stopAllPads` and retrigger "stop" to use `stopWithRamp`; clear `layerGainMap` in `stopAllPads` |
| `src/hooks/usePadGesture.ts` | Trigger on `pointerDown` for hold-mode pads; call `releasePadHoldLayers` on `pointerUp` |

---

## Out of Scope

- UI controls for `voiceGain` (tag/set per-sound volume sliders) — architecture supports it, deferred
- Progress bar behavior for looping sources — currently fills once and stays at 100%; deferred
- `startOffsetMs` on `SoundInstance` — exists in schema, not wired in audio engine yet
