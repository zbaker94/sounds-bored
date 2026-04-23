**[QUAL-6] Unreachable cleanup branch in `fadePad` else-block**
`src/lib/audio/fadeMixer.ts:102–112`

`fadingDown = toVolume < fromVolume`, so the `else` branch means `toVolume >= fromVolume`. The `if (toVolume === 0)` check inside that else branch can only be true if `fromVolume <= 0` — a degenerate 0→0 fade that cannot occur in normal use. The code reads as intentional but is effectively dead.

**Fix:** Remove the unreachable block or add an assertion/comment making the degenerate-case assumption explicit.

> **Audit note (2026-04-23):** Confirmed valid. `fadeMixer.ts:102–112` has the else-block with `if (toVolume === 0)` when `fadingDown` is false (i.e., `toVolume >= fromVolume`). This inner check is unreachable in practice. Fix: remove the inner `if/body` — leave only `cancelPadFade(pad.id)` in the else branch.
