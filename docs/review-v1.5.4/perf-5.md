**[PERF-5] updateLayerVolume spreads entire layerVolumes record on every call**
`src/state/playbackStore.ts:202–203`

`updateLayerVolume: (layerId, volume) => set(s => ({ layerVolumes: { ...s.layerVolumes, [layerId]: volume } }))` spreads the full record on every slider drag (~60×/sec). This is acceptable now but a structural risk if `layerVolumes` grows large.

**Fix:** Use Immer's `produce` to apply a targeted mutation, or accept the current approach with a comment noting the scale assumption.

> **Audit note (2026-04-23):** Confirmed valid — `playbackStore.ts:202–203` still spreads. `playbackStore` uses vanilla Zustand (not Immer middleware), so Immer's `produce` would need to be imported directly. **Recommended resolution: accept with a comment** — at the current scale (one layer per pad, dozens of pads) this is negligible. If `layerVolumes` ever tracks hundreds of layers simultaneously, revisit. Add a comment at the call site noting the spread assumption.
