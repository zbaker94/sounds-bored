**[PERF-2] O(scenes × pads) flatMap + linear find on every multi-fade action**
`src/hooks/useMultiFadeMode.ts:14–21, 69–79`

`executeMultiFadeNow`, `enter`, and `togglePad` each call `scenes.flatMap(s => s.pads)` then `.find(p => p.id === padId)` inside a loop over `selectedPads`. With 50 pads and 20 selected, that's 1,000 linear scans per fade execution.

**Fix:** Build `Map<string, Pad>` once from the flatMap result, then use `.get(padId)` inside the loop.

> **Audit note (2026-04-23):** Confirmed valid. `useMultiFadeMode.ts:14` (`executeMultiFadeNow`), line 70 (`enter`), and line 76 (`togglePad`) each call `scenes.flatMap(s => s.pads)` then `.find()`. In `executeMultiFadeNow` the `.find()` is inside a `for` loop; in `enter`/`togglePad` it's a single `.find()` (not O(n²) but still O(n)). Only `executeMultiFadeNow` is truly O(n×m). Fix: extract a `buildPadMap()` helper returning `Map<string, Pad>` and use `.get()` in all three sites.
