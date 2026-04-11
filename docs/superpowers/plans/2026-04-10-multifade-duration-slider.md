# Multi-Fade Duration Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted fade-duration slider to the per-pad overlay shown during multi-fade mode, wired directly to `pad.fadeDurationMs` in the project store.

**Architecture:** Add a targeted `setPadFadeDuration` action to `projectStore` (follows the same pattern as `updateLayerVolume`). In `PadButton`, read `globalFadeDurationMs` from `appSettingsStore` and render a second `Slider` beneath the existing volume range slider inside the `isMultiFadeSelected` overlay block. No changes to `multiFadeStore` or `executeMultiFadeNow` — the execute path already calls `resolveFadeDuration(pad, globalFadeDurationMs)` which reads `pad.fadeDurationMs` automatically.

**Tech Stack:** React 19, TypeScript (strict), Zustand + Immer, Vitest + Testing Library, motion/react, shadcn Slider component

---

## Files Changed

| File | Change |
|------|--------|
| `src/state/projectStore.ts` | Add `setPadFadeDuration` to `ProjectActions` interface + implementation |
| `src/state/projectStore.test.ts` | Add tests for `setPadFadeDuration` |
| `src/components/composite/SceneView/PadButton.tsx` | Add duration slider + label row to multi-fade overlay |

---

## Task 1: Add `setPadFadeDuration` to projectStore

**Files:**
- Modify: `src/state/projectStore.ts`
- Test: `src/state/projectStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/state/projectStore.test.ts`. Add a new `describe("setPadFadeDuration")` block after the existing `describe("updateLayerVolume")` block (near the end of the file). Use the same `loadWithPad` helper pattern from `describe("updatePad")`:

```typescript
describe("setPadFadeDuration", () => {
  function loadWithPad() {
    const entry = createMockHistoryEntry();
    const pad = createMockPad({ id: "pad-1", name: "Kick" });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    return { sceneId: scene.id, padId: pad.id };
  }

  it("should set fadeDurationMs on the pad", () => {
    const { sceneId, padId } = loadWithPad();
    getState().setPadFadeDuration(sceneId, padId, 3000);
    const pad = getState().project?.scenes[0].pads[0];
    expect(pad?.fadeDurationMs).toBe(3000);
  });

  it("should clear fadeDurationMs when passed undefined", () => {
    const { sceneId, padId } = loadWithPad();
    getState().setPadFadeDuration(sceneId, padId, 3000);
    getState().setPadFadeDuration(sceneId, padId, undefined);
    const pad = getState().project?.scenes[0].pads[0];
    expect(pad?.fadeDurationMs).toBeUndefined();
  });

  it("should mark project as dirty", () => {
    const { sceneId, padId } = loadWithPad();
    getState().setPadFadeDuration(sceneId, padId, 1500);
    expect(getState().isDirty).toBe(true);
  });

  it("should do nothing if no project is loaded", () => {
    getState().setPadFadeDuration("any-scene", "any-pad", 2000);
    expect(getState().project).toBeNull();
  });

  it("should do nothing if padId does not exist in the scene", () => {
    const { sceneId } = loadWithPad();
    getState().setPadFadeDuration(sceneId, "nonexistent-pad", 2000);
    const pad = getState().project?.scenes[0].pads[0];
    expect(pad?.fadeDurationMs).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx tsc --noEmit && npm run test:run -- src/state/projectStore.test.ts
```

Expected: TypeScript error — `Property 'setPadFadeDuration' does not exist on type 'ProjectStore'`

- [ ] **Step 3: Add the action to the interface**

In `src/state/projectStore.ts`, add to the `ProjectActions` interface after `updateLayerVolume`:

```typescript
  updateLayerVolume: (layerId: string, volumePct: number) => void;
  setPadFadeDuration: (sceneId: string, padId: string, durationMs: number | undefined) => void;
```

- [ ] **Step 4: Add the implementation**

In `src/state/projectStore.ts`, add after the `updateLayerVolume` implementation (around line 222):

```typescript
    setPadFadeDuration: (sceneId, padId, durationMs) =>
      set((draft) => {
        if (!draft.project) return;
        const scene = draft.project.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const pad = scene.pads.find((p) => p.id === padId);
        if (!pad) return;
        pad.fadeDurationMs = durationMs;
        draft.isDirty = true;
      }),
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx tsc --noEmit && npm run test:run -- src/state/projectStore.test.ts
```

Expected: all `setPadFadeDuration` tests PASS, no TypeScript errors, all other tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "feat: add setPadFadeDuration action to projectStore"
```

---

## Task 2: Add fade duration slider to PadButton multi-fade overlay

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

- [ ] **Step 1: Add the store selector and action**

In `PadButton.tsx`, add two new selectors near the top of the component body (after the existing `useMultiFadeStore` selectors, around line 138):

```typescript
  const setPadFadeDuration = useProjectStore((s) => s.setPadFadeDuration);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs);
```

Also add the import for `useAppSettingsStore` at the top of the file if not already present:

```typescript
import { useAppSettingsStore } from "@/state/appSettingsStore";
```

And add `useProjectStore` to the existing import from `@/state/projectStore`:

```typescript
import { useProjectStore } from "@/state/projectStore";
```

- [ ] **Step 2: Add the duration slider and label row**

Find the existing multi-fade slider overlay block in `PadButton.tsx` (around line 395). It currently ends with a label row div. Add the duration slider and its label row directly after that label row, still inside the same `motion.div`:

Replace this:
```tsx
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>{isPlaying ? "end" : "start"}</span>
                        <span>{isPlaying ? "start" : "end"}</span>
                      </div>
                    </motion.div>
```

With this:
```tsx
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>{isPlaying ? "end" : "start"}</span>
                        <span>{isPlaying ? "start" : "end"}</span>
                      </div>
                      <Slider
                        compact
                        tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
                        value={[pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000]}
                        onValueChange={(v) => {
                          setPadFadeDuration(sceneId, pad.id, v[0]);
                        }}
                        onPointerUp={() => {}}
                        min={100}
                        max={10000}
                        step={100}
                        className="mt-1.5 [&_[data-slot=slider-track]]:bg-white/20"
                      />
                      <div className="flex justify-between text-[9px] text-white/70 mt-0.5">
                        <span>fade</span>
                        <span>{((pad.fadeDurationMs ?? globalFadeDurationMs ?? 2000) / 1000).toFixed(1)}s</span>
                      </div>
                    </motion.div>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (If `useAppSettingsStore` or `useProjectStore` were already imported, resolve any duplicate import errors.)

- [ ] **Step 4: Manual smoke test**

Start the app (`npm run tauri dev`) and verify:
1. Open multi-fade mode by right-clicking a pad → "Multi-Fade"
2. Select a pad — the overlay should show both the volume range slider AND the fade duration slider below it
3. Move the duration slider — the label on the right updates (e.g. `1.5s`, `3.0s`)
4. Hovering / touching the thumb shows the tooltip (e.g. `2.0s`)
5. Close and reopen the project — the pad's fade duration persists

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "feat: add fade duration slider to multi-fade pad overlay"
```
