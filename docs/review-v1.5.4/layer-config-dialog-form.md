# Group: LayerConfigDialog Form/Reset Logic Duplication

## Relationship

Both findings are in `LayerConfigDialog.tsx` and both point to the same missing extraction: a `layerToFormValues()` helper. QUAL-7 finds the `defaultValues` object literal duplicated between `useForm` and `reset()`, meaning any schema change must be applied in two places. QUAL-8 finds two identical `as LayerConfigForm["selection"]` casts that would also be centralized by the same helper. Extracting `layerToFormValues()` resolves both issues at once.

---

## Findings

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| QUAL-7 | Quality | `LayerConfigDialog.tsx:83–99, 107–123` | `defaultValues` object literal duplicated between `useForm` and `reset()` — must be kept in sync manually |
| QUAL-8 | Quality | `LayerConfigDialog.tsx:88, 112` | Two identical `as LayerConfigForm["selection"]` casts — centralize in a `layerToFormValues()` helper |

> **Audit note (2026-04-23):** Both findings confirmed valid. `LayerConfigDialog.tsx:83–99` and `107–123` show the duplicated object literal verbatim. Lines 88 and 112 each have `layer.selection as LayerConfigForm["selection"]`. The extracted helper should include the full `layers[0]` sub-object (not the whole form) since `name`, `fadeDurationMs`, `volume`, and `fadeTargetVol` come from `pad`, not `layer`. Proposed signature: `layerToFormValues(layer: Layer): LayerConfigForm` returning just the layer fields.
