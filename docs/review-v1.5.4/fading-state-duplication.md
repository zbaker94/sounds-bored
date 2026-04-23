# Group: Fading Pad State Dual-Ownership

## Relationship

Both findings describe the same problem from two angles. ARCH-5 identifies that `fadingOutPadIds`, `fadingPadIds`, and `reversingPadIds` in `playbackStore` duplicate state that the audio engine already tracks — they exist to notify the UI but could instead be published by the `audioTick`. QUAL-5 is the concrete hazard this creates today: every call site must manually keep both `fadeMixer`'s internal set and `playbackStore`'s matching fields in sync, with no type-system enforcement, across six code paths. Fixing ARCH-5 (publishing fading state via `audioTick`) would eliminate the synchronization hazard described in QUAL-5.

---

## Findings

---

**[QUAL-5] Dual-ownership of `fadingOutPadIds` creates synchronization hazard** *(cross-ref: ARCH-5)*
`src/lib/audio/fadeMixer.ts:68–75`

Every call to `addFadingOutPad`/`removeFadingOutPad` must be paired with a matching call to `usePlaybackStore.getState().addFadingOutPad`/`removeFadingOutPad`. Six code paths must remember both sides of this pair. Any missed call causes the UI to desync from audio engine state with no type-system guard.

**Fix:** Provide a wrapper `markPadFadingOut()` / `unmarkPadFadingOut()` that updates both stores in a single call. See also ARCH-5 for a deeper architectural fix.

> **Audit note (2026-04-23):** Both findings confirmed valid. `fadeMixer.ts:68–75` shows the paired dual calls. **Additional finding:** the `fadePad` fade-up else branch (line 74) calls `usePlaybackStore.getState().removeFadingOutPad(pad.id)` but does NOT call `removeFadingOutPad(pad.id)` (audioState). Investigate whether this is intentional (fading up doesn't remove from the audioState fading-out set) or a pre-existing sync bug before applying the wrapper. Rename wrappers to `markFadingOut`/`unmarkFadingOut` (shorter) — the proposed `markPadFadingOut`/`unmarkPadFadingOut` is also fine.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| ARCH-5 | Architecture | `playbackStore.ts:60–81` | `fadingOutPadIds`/`fadingPadIds`/`reversingPadIds` duplicate audio engine state that could be published via `audioTick` |
