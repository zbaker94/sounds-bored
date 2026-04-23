# Group: PadBackFace God Component Complexity

## Relationship

All three findings concern the excessive complexity of `PadBackFace.tsx`. QUAL-9 identifies the top-level problem: the component is 327 lines with 14 hooks, mixing unrelated concerns. QUAL-15 and REUSE-2 are specific examples of that complexity: QUAL-15 is an inline IIFE (`selectionSummary`) that should be a named, testable helper, and REUSE-2 is six near-identical slider+label blocks duplicated within `PadBackFace` and its siblings — the kind of duplication that accumulates in a god component. Decomposing `PadBackFace` (QUAL-9) naturally creates the seams needed to extract both the named helper (QUAL-15) and the shared slider component (REUSE-2).

---

## Findings

---

**[REUSE-2] Four near-identical slider+label blocks across PadBackFace and siblings**
`src/components/composite/SceneView/PadBackFace.tsx:208–217, 397–413, 421–431, 436–442`
Also: `PadButtonFadeOverlay.tsx:58–107`, `PadButton.tsx:318–327`

~6 copies of the pattern: percent label row with `tabular-nums` + `<Slider compact tooltipLabel={(v) => \`${v}%\`}>` + local drag state + `onValueCommit` that persists to the store. The popover copy in `PadButton.tsx` already lacks the percent label present in `PadBackFace`.

**Fix:** Extract `PadPercentSlider` (volume/target, 0–100 scale, percent tooltip, commit callback) and `PadDurationSlider` (ms→s tooltip) into the `SceneView/` folder. Both `PadBackFace` and `PadButtonFadeOverlay` consume them.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| QUAL-9 | Quality | `PadBackFace.tsx` (327 lines, 14 hooks) | God component — mixes name/color editing, transport, sliders, layer list, overlay, delete confirmation |
| QUAL-15 | Quality | `PadBackFace.tsx:86–102` | Inline IIFE for `selectionSummary` — extract to a named `summarizeLayerSelection()` for readability and testability |

> **Audit note (2026-04-23):** QUAL-15 confirmed valid — the IIFE is at `BackFaceLayerRow` lines 86–102, inside the `memo` sub-component. The selectionSummary depends on `layer`, `allSounds`, `tags`, and `sets`. Extract as `summarizeLayerSelection(layer, sounds, tags, sets)` to `src/lib/layerHelpers.ts` (new file). REUSE-2 and QUAL-9 are deferred — the slider extraction and component decomposition are larger refactors best done together after QUAL-15 is extracted.
