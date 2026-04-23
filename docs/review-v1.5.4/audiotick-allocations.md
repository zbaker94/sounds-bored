# Group: Per-Frame Heap Allocations in the Audio Tick RAF Loop

## Relationship

All three findings are unnecessary heap allocations that occur on every animation frame inside or as a direct result of the audio tick loop. PERF-1 allocates fresh `string[]` arrays to diff layer state that hasn't changed. PERF-6 allocates `Object.keys` arrays in equality checks even for empty records. PERF-9 allocates a new `Set` on every `getActiveLayerIdSet()` call without caching. At 60 fps these compound into thousands of short-lived allocations per second, increasing GC pressure during audio playback.

> **Audit note (2026-04-23):** PERF-9 is **already fixed** — `getActiveLayerIdSet()` is now version-gated by `layerVoiceVersion` at `audioTick.ts:107–119`. It is only called when `currentLayerVoiceVersion !== prevLayerVoiceVersion`, which is false on steady-state frames. PERF-1 and PERF-6 remain valid and are planned for a follow-up fix.

---

## Findings

---

**[PERF-1] Per-frame array allocation in audioTick layerPlayOrder/layerChain even when values are stable**
`src/lib/audio/audioTick.ts:130–151`

Every RAF tick calls `playOrder.map(s => s.id)` and `chain.map(s => s.id)` unconditionally for every active layer — allocating fresh arrays before diffing against the previous snapshot. On a 50-sound chain this is ~100 string allocations/frame (6,000/sec at 60fps) that are immediately discarded when nothing changed. The source `Sound[]` arrays in `layerPlayOrderMap`/`layerChainQueue` only change on explicit writes.

**Fix:** Before `playOrder.map`, check if the source reference equals the one from last tick. If it matches, reuse the previous snapshot and skip allocation. Track the source `Sound[]` reference per layer between ticks.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| PERF-6 | Performance | `audioTick.ts:223–258` | `volumesEqual`/`progressEqual` always allocate `Object.keys` arrays even when both records are empty |
| PERF-9 | Performance | `audioState.ts:305–307` | ~~`getActiveLayerIdSet()` allocates a new `Set` on every call — not cached by `layerVoiceVersion`~~ **✅ Already fixed** — version-gated at `audioTick.ts:107–119` |
