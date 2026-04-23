# Group: createDefaultLayer / createDefaultStoreLayer Type Confusion

## Relationship

All three findings stem from the same root cause: two near-identical functions (`createDefaultLayer` returning `LayerConfigForm` and `createDefaultStoreLayer` returning `Layer`) diverged in name but not body. The duplication (REUSE-3) directly enables the wrong-function call-site bugs (QUAL-1, QUAL-2). Fixing REUSE-3 by having one delegate to the other eliminates the risk of the call-site bugs recurring.

---

## Findings

---

**[QUAL-1] Unsafe `createDefaultLayer() as Layer` type cast**
`src/hooks/useGlobalHotkeys.ts:155`

`createDefaultLayer()` returns `LayerConfigForm`, not `Layer`. An `as Layer` cast coerces it into `PadConfig.layers`. `createDefaultStoreLayer()` already exists in `src/lib/padDefaults.ts` returning the correct type.

**Fix:** Replace `createDefaultLayer() as Layer` with `createDefaultStoreLayer()`.

---

**[QUAL-2] Same form/schema type confusion in PadBackFace new-layer insertion**
`src/components/composite/SceneView/PadBackFace.tsx:35, 285`

`createDefaultLayer()` (returns `LayerConfigForm`) is inserted into `pad.layers: Layer[]` without an explicit cast — TypeScript allows it due to structural compatibility today, but if a form-only field is ever added, this silently produces malformed store data.

**Fix:** Use `createDefaultStoreLayer()` in `handleAddLayer()`.

---

**[REUSE-3] `createDefaultLayer` and `createDefaultStoreLayer` are byte-for-byte identical at runtime**
`src/lib/padDefaults.ts:3–25`

Both functions return the same object; the only difference is the return type annotation. When one changes, the other must be manually kept in sync.

**Fix:** Have one delegate to the other: `export function createDefaultStoreLayer(): Layer { return createDefaultLayer() as Layer; }`. (Also see QUAL-1 and QUAL-2 — the name divergence is partly responsible for those call-site bugs.)

> **Audit note (2026-04-23):** All three findings confirmed valid. `padDefaults.ts:3–25` shows both functions are byte-for-byte identical. `useGlobalHotkeys.ts:155` still has `createDefaultLayer() as Layer`. `PadBackFace.tsx:285` still calls `createDefaultLayer()` (imported at line 35) and inserts it into `pad.layers` without an explicit cast. Fixes are as proposed.
