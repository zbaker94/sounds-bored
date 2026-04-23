**[QUAL-3] `padToConfig` helper duplicated between PadBackFace and LayerConfigDialog**
`src/components/composite/SceneView/PadBackFace.tsx:41–53`
`src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx:37–49`

Identical helper function defined in two sibling files. Any change to `PadConfig` shape or defaults must be applied in both places or the dialog and back-face will drift.

**Fix:** Export a shared `padToConfig` from `src/lib/padDefaults.ts` or `src/lib/padHelpers.ts` and import it in both components.

> **Audit note (2026-04-23):** Confirmed valid. Both `PadBackFace.tsx:41–53` and `LayerConfigDialog.tsx:37–49` define identical `padToConfig` functions. Note: the two definitions differ slightly — `LayerConfigDialog` version takes `(pad, layers: Layer[])` (required, no default), while `PadBackFace` version takes `(pad, layers?: Layer[])` (optional, defaulting to `pad.layers`). The shared export should use the optional signature. Export from `padDefaults.ts` (already imports the needed types).
