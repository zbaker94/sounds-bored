# Layer Form Converter Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the `Layer ↔ LayerConfigForm` conversion helpers from file-private functions in `LayerConfigDialog.tsx` to exported functions in `padDefaults.ts`, giving them a canonical home and removing the `as` type cast.

**Architecture:** `padDefaults.ts` already owns `createDefaultLayer` (returns `LayerConfigForm`) and `createDefaultStoreLayer` (returns `Layer`). The two converter functions that translate between those two types belong there too. `LayerConfigDialog.tsx` currently defines `toLayer` and `layerToFormValues` as module-private helpers — this plan exports them from `padDefaults.ts` as `formLayerToLayer` and `layerToFormLayer` and updates `LayerConfigDialog.tsx` to import them.

**Tech Stack:** TypeScript strict, Zod 4, Vitest + Testing Library, `src/test/factories.ts` for test data

---

## File Structure

| File | Change |
|------|--------|
| `src/lib/padDefaults.ts` | Add `layerToFormLayer` and `formLayerToLayer` exports |
| `src/lib/padDefaults.test.ts` | **Create** — tests for the two new converters |
| `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx` | Remove local `toLayer` + `layerToFormValues`; import from `padDefaults` |

---

### Task 1: Add converters to `padDefaults.ts` with tests

**Files:**
- Modify: `src/lib/padDefaults.ts`
- Create: `src/lib/padDefaults.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/padDefaults.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createMockLayer } from "@/test/factories";
import type { Layer, LayerConfigForm } from "@/lib/schemas";
import { layerToFormLayer, formLayerToLayer } from "@/lib/padDefaults";

describe("layerToFormLayer", () => {
  it("converts all shared fields from Layer to LayerConfigForm", () => {
    const layer = createMockLayer({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
    const result = layerToFormLayer(layer);
    expect(result).toEqual({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
  });

  it("drops the optional name field", () => {
    const layer = createMockLayer({ name: "Kick" });
    const result = layerToFormLayer(layer);
    expect("name" in result).toBe(false);
  });

  it("preserves tag selection fields", () => {
    const layer = createMockLayer({
      selection: { type: "tag", tagIds: ["t1", "t2"], matchMode: "all", defaultVolume: 75 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: "tag",
      tagIds: ["t1", "t2"],
      matchMode: "all",
      defaultVolume: 75,
    });
  });

  it("preserves set selection fields", () => {
    const layer = createMockLayer({
      selection: { type: "set", setId: "s1", defaultVolume: 90 },
    });
    expect(layerToFormLayer(layer).selection).toEqual({
      type: "set",
      setId: "s1",
      defaultVolume: 90,
    });
  });
});

describe("formLayerToLayer", () => {
  it("converts all shared fields from LayerConfigForm to Layer", () => {
    const form: LayerConfigForm = {
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    };
    const result = formLayerToLayer(form);
    expect(result).toEqual({
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 80,
    });
  });

  it("does not add a name field", () => {
    const form: LayerConfigForm = {
      id: "abc",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect("name" in formLayerToLayer(form)).toBe(false);
  });

  it("round-trips with layerToFormLayer for a layer without a name", () => {
    const original = createMockLayer({
      id: "xyz",
      selection: { type: "assigned", instances: [] },
      arrangement: "shuffled",
      cycleMode: true,
      playbackMode: "loop",
      retriggerMode: "next",
      volume: 60,
    });
    // Layer has no `name`, so round-trip must be lossless.
    expect(formLayerToLayer(layerToFormLayer(original))).toEqual(original);
  });

  it("preserves tag selection fields", () => {
    const form: LayerConfigForm = {
      id: "def",
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 50 },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: "tag",
      tagIds: ["t1"],
      matchMode: "any",
      defaultVolume: 50,
    });
  });

  it("preserves set selection fields", () => {
    const form: LayerConfigForm = {
      id: "ghi",
      selection: { type: "set", setId: "s1", defaultVolume: 90 },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    };
    expect(formLayerToLayer(form).selection).toEqual({
      type: "set",
      setId: "s1",
      defaultVolume: 90,
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail with "not a function"**

```bash
npx vitest run src/lib/padDefaults.test.ts
```

Expected: FAIL — `layerToFormLayer is not a function` / `formLayerToLayer is not a function`

- [ ] **Step 3: Add the two converter functions to `padDefaults.ts`**

Open `src/lib/padDefaults.ts`. The current file imports `Layer, LayerConfigForm, Pad, PadConfig`.

Append after the `createDefaultStoreLayer` function and before `padToConfig`:

```typescript
export function layerToFormLayer(layer: Layer): LayerConfigForm {
  return {
    id: layer.id,
    // LayerSelection and LayerConfigForm["selection"] are structurally identical
    // TypeScript types — Zod's .min(1) refinements don't change the inferred shape.
    // If the compiler flags this in a future Zod upgrade, restore the `as` cast.
    selection: layer.selection as LayerConfigForm["selection"],
    arrangement: layer.arrangement,
    cycleMode: layer.cycleMode,
    playbackMode: layer.playbackMode,
    retriggerMode: layer.retriggerMode,
    volume: layer.volume,
  };
}

export function formLayerToLayer(form: LayerConfigForm): Layer {
  return {
    id: form.id,
    selection: form.selection,
    arrangement: form.arrangement,
    cycleMode: form.cycleMode,
    playbackMode: form.playbackMode,
    retriggerMode: form.retriggerMode,
    volume: form.volume,
  };
}
```

> **Note on the `as` cast in `layerToFormLayer`:** Try removing it first — `layer.selection` may be directly assignable. Only keep the cast if TypeScript reports a type error. The cast is safe because both schemas produce the same structural TypeScript type; Zod's `.min(1)` on arrays and strings is a runtime-only validator that does not narrow the inferred type.

- [ ] **Step 4: Run `npx tsc --noEmit` and verify it exits with no output**

```bash
npx tsc --noEmit
```

Expected: no output (empty = success).

- [ ] **Step 5: Run the new tests to confirm they pass**

```bash
npx vitest run src/lib/padDefaults.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/padDefaults.ts src/lib/padDefaults.test.ts
git commit -m "feat(padDefaults): add layerToFormLayer and formLayerToLayer converters"
```

---

### Task 2: Update `LayerConfigDialog.tsx` to use the new imports

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx`

- [ ] **Step 1: Swap imports and remove local helpers**

In `LayerConfigDialog.tsx`:

1. Change the `padDefaults` import from:
   ```typescript
   import { padToConfig } from "@/lib/padDefaults";
   ```
   to:
   ```typescript
   import { padToConfig, layerToFormLayer, formLayerToLayer } from "@/lib/padDefaults";
   ```

2. Delete the two local helper functions entirely (lines 26–48):
   ```typescript
   // DELETE this block:
   function toLayer(form: LayerConfigForm): Layer {
     return {
       id: form.id,
       selection: form.selection,
       arrangement: form.arrangement,
       cycleMode: form.cycleMode,
       playbackMode: form.playbackMode,
       retriggerMode: form.retriggerMode,
       volume: form.volume,
     };
   }

   // DELETE this block:
   function layerToFormValues(layer: Layer): LayerConfigForm {
     return {
       id: layer.id,
       selection: layer.selection as LayerConfigForm["selection"],
       arrangement: layer.arrangement,
       cycleMode: layer.cycleMode,
       playbackMode: layer.playbackMode,
       retriggerMode: layer.retriggerMode,
       volume: layer.volume,
     };
   }
   ```

3. Replace the two call sites of the old local names:
   - `layerToFormValues(layer)` → `layerToFormLayer(layer)` (appears at lines 84 and 98)
   - `toLayer(data.layers[0])` → `formLayerToLayer(data.layers[0])` (appears at line 142)

   The `Layer` import on line 9 (`import type { PadConfigForm, LayerConfigForm, Layer, Pad } from "@/lib/schemas"`) may no longer be needed after this change since `Layer` was only used in the local helper signatures. Remove it if TypeScript no longer requires it.

- [ ] **Step 2: Run `npx tsc --noEmit` — must exit with no output**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass (same count as before — no tests change).

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx
git commit -m "refactor(LayerConfigDialog): use padDefaults converters instead of local helpers"
```

---

## Self-Review

**Spec coverage:**
- ✅ `layerToFormLayer` exported from `padDefaults.ts`
- ✅ `formLayerToLayer` exported from `padDefaults.ts`
- ✅ Local `toLayer` and `layerToFormValues` removed from `LayerConfigDialog.tsx`
- ✅ All three call sites updated
- ✅ Tests for both new functions

**Placeholder scan:** None found.

**Type consistency:** `layerToFormLayer` and `formLayerToLayer` names used consistently across test file, implementation, and `LayerConfigDialog.tsx` update steps.
