**[QUAL-4] Magic number `0.016` duplicated three times in gainManager**
`src/lib/audio/gainManager.ts:16, 46, 62`

The click-free ramp duration `0.016` (≈ one 60Hz frame in seconds) appears in three separate `linearRampToValueAtTime` calls. `audioVoice.ts` already names a similar constant `STOP_RAMP_S = 0.025`.

**Fix:** Introduce `const CLICK_FREE_RAMP_S = 0.016` at the top of `gainManager.ts` (or share it with `audioVoice.ts`).

> **Audit note (2026-04-23):** Confirmed valid. `gainManager.ts` has `0.016` at lines 16, 46, and 62 (all three `linearRampToValueAtTime` calls). Keep the constant in `gainManager.ts` only — sharing with `audioVoice.ts` would create a new coupling between two modules that currently don't import each other.
