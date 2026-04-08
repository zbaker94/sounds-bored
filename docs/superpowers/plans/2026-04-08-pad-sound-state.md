# Pad Sound State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface broken pad state visually, auto-clean orphan sound references on project load and library reconcile, and show project impact in delete confirmation dialogs.

**Architecture:** A single pure-utility module (`projectSoundReconcile.ts`) owns all cross-cutting logic. It is imported by the lifecycle hook (auto-clean), PadButton (pad state), LayerAccordion (layer warnings), and SoundsPanel (impact preview). No new stores — all derived state flows from existing `projectStore` and `libraryStore`.

**Tech Stack:** React 19, TypeScript strict, Zustand, react-hook-form `useWatch`, Vitest + Testing Library, HugeIcons (`Alert02Icon`), shadcn Tooltip.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/lib/projectSoundReconcile.ts` | **Create** | Pure functions: `reconcileProjectSounds`, `getPadSoundState`, `getAffectedPads` |
| `src/lib/projectSoundReconcile.test.ts` | **Create** | Unit tests for all three functions |
| `src/hooks/useProjectLifecycle.ts` | **Modify** | Run `reconcileProjectSounds` once per loaded project |
| `src/hooks/useReconcileLibrary.ts` | **Modify** | Run `reconcileProjectSounds` after every reconcile |
| `src/components/composite/SceneView/PadButton.tsx` | **Modify** | Add `getPadSoundState` + warning icon + disabled state |
| `src/components/composite/PadConfigDrawer/LayerAccordion.tsx` | **Modify** | Add per-layer warning icon via `useWatch` + store selectors |
| `src/components/composite/SidePanel/SoundsPanel.tsx` | **Modify** | Compute + show `getAffectedPads` in delete dialogs |
| `src/test/factories.ts` | **Modify** | Add `createMockSoundInstance` factory helper |

---

## Task 1: Pure utility module + tests

**Files:**
- Create: `src/lib/projectSoundReconcile.ts`
- Create: `src/lib/projectSoundReconcile.test.ts`
- Modify: `src/test/factories.ts`

- [ ] **Step 1: Add `createMockSoundInstance` to factories**

In `src/test/factories.ts`, add at the bottom:

```typescript
import type { SoundInstance } from "@/lib/schemas";

export function createMockSoundInstance(overrides?: Partial<SoundInstance>): SoundInstance {
  return {
    id: crypto.randomUUID(),
    soundId: crypto.randomUUID(),
    volume: 100,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/projectSoundReconcile.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reconcileProjectSounds, getPadSoundState, getAffectedPads } from "./projectSoundReconcile";
import { createMockProject, createMockScene, createMockPad, createMockLayer, createMockSound, createMockSoundInstance } from "@/test/factories";

// ── reconcileProjectSounds ────────────────────────────────────────────────────

describe("reconcileProjectSounds", () => {
  it("returns project unchanged when all soundIds exist in library", () => {
    const sound = createMockSound({ id: "sound-1" });
    const inst = createMockSoundInstance({ soundId: "sound-1" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const scene = createMockScene({ pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, [sound]);

    expect(removedCount).toBe(0);
    expect(cleaned.scenes[0].pads[0].layers[0].selection).toEqual(layer.selection);
  });

  it("removes orphan soundId from instances and reports count", () => {
    const inst = createMockSoundInstance({ soundId: "orphan-id" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const scene = createMockScene({ pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, []); // empty library

    expect(removedCount).toBe(1);
    const cleanedInstances = (cleaned.scenes[0].pads[0].layers[0].selection as { type: "assigned"; instances: unknown[] }).instances;
    expect(cleanedInstances).toHaveLength(0);
  });

  it("leaves the layer in place when instances becomes empty", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const { project: cleaned } = reconcileProjectSounds(project, []);

    expect(cleaned.scenes[0].pads[0].layers).toHaveLength(1);
  });

  it("does not touch tag or set layers", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const setLayer = createMockLayer({ selection: { type: "set", setId: "s1", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [tagLayer, setLayer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const { removedCount } = reconcileProjectSounds(project, []);

    expect(removedCount).toBe(0);
  });

  it("keeps valid instances when only some are orphaned", () => {
    const valid = createMockSoundInstance({ soundId: "good" });
    const orphan = createMockSoundInstance({ soundId: "gone" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [valid, orphan] } });
    const pad = createMockPad({ layers: [layer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });
    const sound = createMockSound({ id: "good" });

    const { project: cleaned, removedCount } = reconcileProjectSounds(project, [sound]);

    expect(removedCount).toBe(1);
    const cleanedInstances = (cleaned.scenes[0].pads[0].layers[0].selection as { type: "assigned"; instances: { soundId: string }[] }).instances;
    expect(cleanedInstances).toHaveLength(1);
    expect(cleanedInstances[0].soundId).toBe("good");
  });
});

// ── getPadSoundState ──────────────────────────────────────────────────────────

describe("getPadSoundState", () => {
  it("returns 'ok' when no assigned sounds are missing", () => {
    const inst = createMockSoundInstance({ soundId: "s1" });
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [inst] } })] });

    expect(getPadSoundState(pad, new Set())).toBe("ok");
  });

  it("returns 'partial' when some assigned sounds are missing", () => {
    const good = createMockSoundInstance({ soundId: "good" });
    const bad = createMockSoundInstance({ soundId: "bad" });
    const pad = createMockPad({
      layers: [createMockLayer({ selection: { type: "assigned", instances: [good, bad] } })],
    });

    expect(getPadSoundState(pad, new Set(["bad"]))).toBe("partial");
  });

  it("returns 'disabled' when all assigned sounds are missing", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [inst] } })] });

    expect(getPadSoundState(pad, new Set(["gone"]))).toBe("disabled");
  });

  it("returns 'disabled' when all assigned layers have empty instances", () => {
    const pad = createMockPad({ layers: [createMockLayer({ selection: { type: "assigned", instances: [] } })] });

    expect(getPadSoundState(pad, new Set())).toBe("disabled");
  });

  it("returns 'ok' when pad has a tag layer (even if assigned layers are empty)", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const emptyAssigned = createMockLayer({ selection: { type: "assigned", instances: [] } });
    const pad = createMockPad({ layers: [emptyAssigned, tagLayer] });

    expect(getPadSoundState(pad, new Set())).toBe("ok");
  });

  it("returns 'partial' when pad has missing assigned sounds but also a tag layer", () => {
    const inst = createMockSoundInstance({ soundId: "gone" });
    const assigned = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [assigned, tagLayer] });

    expect(getPadSoundState(pad, new Set(["gone"]))).toBe("partial");
  });
});

// ── getAffectedPads ───────────────────────────────────────────────────────────

describe("getAffectedPads", () => {
  it("returns empty array when no pads reference the given soundIds", () => {
    const project = createMockProject({ scenes: [] });
    expect(getAffectedPads(project, new Set(["s1"]))).toEqual([]);
  });

  it("returns affected pad with correct scene name and 1-based layer indices", () => {
    const inst = createMockSoundInstance({ soundId: "target" });
    const layer = createMockLayer({ selection: { type: "assigned", instances: [inst] } });
    const pad = createMockPad({ name: "Kick", layers: [layer] });
    const scene = createMockScene({ name: "Scene 1", pads: [pad] });
    const project = createMockProject({ scenes: [scene] });

    const result = getAffectedPads(project, new Set(["target"]));

    expect(result).toHaveLength(1);
    expect(result[0].padName).toBe("Kick");
    expect(result[0].sceneName).toBe("Scene 1");
    expect(result[0].layerIndices).toEqual([1]);
  });

  it("reports only affected layers when pad has a mix", () => {
    const inst1 = createMockSoundInstance({ soundId: "target" });
    const inst2 = createMockSoundInstance({ soundId: "safe" });
    const l1 = createMockLayer({ selection: { type: "assigned", instances: [inst1] } });
    const l2 = createMockLayer({ selection: { type: "assigned", instances: [inst2] } });
    const pad = createMockPad({ name: "Mixed", layers: [l1, l2] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    const result = getAffectedPads(project, new Set(["target"]));

    expect(result[0].layerIndices).toEqual([1]);
  });

  it("does not report tag or set layers", () => {
    const tagLayer = createMockLayer({ selection: { type: "tag", tagIds: ["target"], matchMode: "any", defaultVolume: 100 } });
    const pad = createMockPad({ layers: [tagLayer] });
    const project = createMockProject({ scenes: [createMockScene({ pads: [pad] })] });

    // soundIds set — tag layers are not sound references
    expect(getAffectedPads(project, new Set(["target"]))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests — expect all to fail**

```
npm run test:run -- src/lib/projectSoundReconcile.test.ts
```

Expected: all fail with "Cannot find module './projectSoundReconcile'"

- [ ] **Step 4: Implement `src/lib/projectSoundReconcile.ts`**

```typescript
import type { Pad, Project, Sound } from "@/lib/schemas";

// ── reconcileProjectSounds ────────────────────────────────────────────────────

export type ReconcileResult = {
  project: Project;
  removedCount: number;
};

/**
 * Removes any soundId in assigned layers that no longer exists in the library.
 * Leaves empty layers in place — callers decide whether to surface them as warnings.
 * Pure function: no side effects, no Zustand access.
 */
export function reconcileProjectSounds(project: Project, sounds: Sound[]): ReconcileResult {
  const soundIdSet = new globalThis.Set(sounds.map((s) => s.id));
  let removedCount = 0;

  const cleanedScenes = project.scenes.map((scene) => ({
    ...scene,
    pads: scene.pads.map((pad) => ({
      ...pad,
      layers: pad.layers.map((layer) => {
        if (layer.selection.type !== "assigned") return layer;
        const before = layer.selection.instances.length;
        const cleaned = layer.selection.instances.filter((inst) => soundIdSet.has(inst.soundId));
        removedCount += before - cleaned.length;
        if (cleaned.length === before) return layer; // nothing changed — return same ref
        return { ...layer, selection: { ...layer.selection, instances: cleaned } };
      }),
    })),
  }));

  return { project: { ...project, scenes: cleanedScenes }, removedCount };
}

// ── getPadSoundState ──────────────────────────────────────────────────────────

export type PadSoundState = "ok" | "partial" | "disabled";

/**
 * Derives the sound health of a pad relative to the current missing-sound set.
 * - "ok":       all assigned sounds are playable (or pad has tag/set layers)
 * - "partial":  at least one assigned soundId is missing, but pad still has playable sources
 * - "disabled": no playable sources — all assigned sounds are missing or instances are empty,
 *               AND there are no tag/set layers to fall back on
 */
export function getPadSoundState(pad: Pad, missingSoundIds: globalThis.Set<string>): PadSoundState {
  let hasNonAssignedLayer = false;
  let hasMissingSound = false;
  let hasPlayableSound = false;

  for (const layer of pad.layers) {
    if (layer.selection.type !== "assigned") {
      hasNonAssignedLayer = true;
      continue;
    }
    for (const inst of layer.selection.instances) {
      if (missingSoundIds.has(inst.soundId)) {
        hasMissingSound = true;
      } else {
        hasPlayableSound = true;
      }
    }
  }

  if (hasPlayableSound || hasNonAssignedLayer) {
    return hasMissingSound ? "partial" : "ok";
  }
  return "disabled";
}

// ── getAffectedPads ───────────────────────────────────────────────────────────

export type AffectedPad = {
  padName: string;
  sceneName: string;
  layerIndices: number[]; // 1-based for display
};

/**
 * Returns which pads and layers in the project reference any of the given soundIds.
 * Only checks assigned layers — tag/set layers resolve dynamically and are not included.
 */
export function getAffectedPads(project: Project, soundIds: globalThis.Set<string>): AffectedPad[] {
  const result: AffectedPad[] = [];
  for (const scene of project.scenes) {
    for (const pad of scene.pads) {
      const affectedLayers: number[] = [];
      pad.layers.forEach((layer, i) => {
        if (layer.selection.type !== "assigned") return;
        if (layer.selection.instances.some((inst) => soundIds.has(inst.soundId))) {
          affectedLayers.push(i + 1);
        }
      });
      if (affectedLayers.length > 0) {
        result.push({ padName: pad.name, sceneName: scene.name, layerIndices: affectedLayers });
      }
    }
  }
  return result;
}
```

- [ ] **Step 5: Run tests — expect all to pass**

```
npm run test:run -- src/lib/projectSoundReconcile.test.ts
```

Expected: all pass.

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 7: Commit**

```bash
git add src/lib/projectSoundReconcile.ts src/lib/projectSoundReconcile.test.ts src/test/factories.ts
git commit -m "feat: add projectSoundReconcile utilities and tests"
```

---

## Task 2: Wire auto-clean into lifecycle and reconcile hooks

**Files:**
- Modify: `src/hooks/useProjectLifecycle.ts`
- Modify: `src/hooks/useReconcileLibrary.ts`

- [ ] **Step 1: Add auto-clean to `useProjectLifecycle`**

Open `src/hooks/useProjectLifecycle.ts`. Add the import at the top:

```typescript
import { reconcileProjectSounds } from "@/lib/projectSoundReconcile";
```

Add a new selector and action near the top of the hook (after the existing `isDirty` line):

```typescript
const updateProject = useProjectStore((s) => s.updateProject);
const sounds = useLibraryStore((s) => s.sounds);
```

Add the following `useEffect` **before** the existing missing-sound notification effect (line 79). Use a ref to run only once per loaded project identity:

```typescript
const cleanedProjectKeyRef = useRef<string | null>(null);

useEffect(() => {
  if (!project) return;
  // Stable key: a new project load resets this. We use name+lastSaved because
  // the project object reference changes on every updateProject call.
  const key = project.name + (project.lastSaved ?? "");
  if (cleanedProjectKeyRef.current === key) return;
  cleanedProjectKeyRef.current = key;

  const { project: cleaned, removedCount } = reconcileProjectSounds(project, sounds);
  if (removedCount > 0) {
    updateProject(cleaned);
  }
}, [project, sounds, updateProject]);
```

The complete updated hook top section (replacing lines 18–27) looks like:

```typescript
export function useProjectLifecycle() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const updateProject = useProjectStore((s) => s.updateProject);
  const navigate = useNavigate();

  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const sounds = useLibraryStore((s) => s.sounds);
  const lastNotifiedProjectKey = useRef<string | null>(null);
  const cleanedProjectKeyRef = useRef<string | null>(null);
```

- [ ] **Step 2: Add auto-clean to `useReconcileLibrary`**

Open `src/hooks/useReconcileLibrary.ts`. Add the import at the top:

```typescript
import { reconcileProjectSounds } from "@/lib/projectSoundReconcile";
import { useProjectStore } from "@/state/projectStore";
```

At the end of the `reconcile` callback's `try` block (after `setMissingState` is called), add:

```typescript
// Auto-clean orphan soundIds from any loaded project.
// Reads state imperatively to avoid stale closure over project/sounds.
const currentProject = useProjectStore.getState().project;
if (currentProject) {
  const latestSounds = useLibraryStore.getState().sounds;
  const { project: cleaned, removedCount } = reconcileProjectSounds(currentProject, latestSounds);
  if (removedCount > 0) {
    useProjectStore.getState().updateProject(cleaned);
  }
}
```

Place this after line 74 (`setMissingState(missingResult.missingSoundIds, missingResult.missingFolderIds);`) and before the `isDirty` check.

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProjectLifecycle.ts src/hooks/useReconcileLibrary.ts
git commit -m "feat: auto-clean orphan soundIds on project load and library reconcile"
```

---

## Task 3: PadButton — warning icon and disabled state

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`

- [ ] **Step 1: Add imports**

In `src/components/composite/SceneView/PadButton.tsx`, add to the existing imports:

```typescript
import { useLibraryStore } from "@/state/libraryStore";
import { getPadSoundState } from "@/lib/projectSoundReconcile";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

- [ ] **Step 2: Compute pad sound state inside the component**

Inside `PadButton`, after the existing `const layerCount = pad.layers.length;` line, add:

```typescript
const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
const padSoundState = useMemo(
  () => getPadSoundState(pad, missingSoundIds),
  [pad, missingSoundIds],
);
const isUnplayable = padSoundState === "disabled";
```

- [ ] **Step 3: Apply disabled state to the front-face button**

Find the front-face `<button>` element (the one with `aria-label={pad.name}`). It currently has this `className` structure:

```tsx
className={cn(
  "relative w-full h-full rounded-xl overflow-hidden",
  "flex items-center justify-center p-2",
  "bg-card text-card-foreground",
  "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
  "text-sm font-semibold text-center select-none",
  fadeVisual !== null
    ? cn("border-2 cursor-pointer", fadeVisualClass, fadeVisual !== "invalid" && "hover:brightness-110")
    : cn(
        "border-2 transition-all cursor-pointer",
        "hover:brightness-110",
        isPlaying
          ? "border-yellow-400"
          : "border-black/20"
      )
)}
```

Replace it with:

```tsx
className={cn(
  "relative w-full h-full rounded-xl overflow-hidden",
  "flex items-center justify-center p-2",
  "bg-card text-card-foreground",
  "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
  "text-sm font-semibold text-center select-none",
  isUnplayable && "opacity-40 pointer-events-none",
  !isUnplayable && fadeVisual !== null
    ? cn("border-2 cursor-pointer", fadeVisualClass, fadeVisual !== "invalid" && "hover:brightness-110")
    : !isUnplayable && cn(
        "border-2 transition-all cursor-pointer",
        "hover:brightness-110",
        isPlaying
          ? "border-yellow-400"
          : "border-black/20"
      )
)}
```

Also add `disabled={isUnplayable}` as a prop on the `<button>`:

```tsx
<button
  aria-label={pad.name}
  disabled={isUnplayable}
  {...(fadeVisual !== null ? fadeHandlers : gestureHandlers)}
  className={cn(...)}
```

- [ ] **Step 4: Add warning icon overlay**

Inside the front-face wrapper `<div className="absolute inset-0 [backface-visibility:hidden]">`, **after** the closing `</button>` tag, add:

```tsx
{padSoundState === "partial" && (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="absolute bottom-1 right-1 z-20 pointer-events-auto">
        <HugeiconsIcon icon={Alert02Icon} size={12} className="text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">
      Some assigned sounds are missing from the library. Open pad settings to review.
    </TooltipContent>
  </Tooltip>
)}
```

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx
git commit -m "feat: show warning icon and disabled state on pads with missing sounds"
```

---

## Task 4: LayerAccordion — per-layer warning icons

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerAccordion.tsx`

- [ ] **Step 1: Add imports**

In `src/components/composite/PadConfigDrawer/LayerAccordion.tsx`, add to the existing imports:

```typescript
import { useWatch } from "react-hook-form";
import { useLibraryStore } from "@/state/libraryStore";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PadConfigForm } from "@/lib/schemas";
```

- [ ] **Step 2: Add `warning` prop to `SortableLayerItemProps`**

Replace the existing `SortableLayerItemProps` interface:

```typescript
type LayerWarning = {
  isEmpty: boolean;      // instances array is empty after auto-clean
  missingNames: string[]; // names of sounds that are in the library but have missing files
};

interface SortableLayerItemProps {
  fieldId: string;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  shouldScrollIntoView?: boolean;
  onScrollComplete?: () => void;
  warning: LayerWarning;
}
```

- [ ] **Step 3: Destructure `warning` in `SortableLayerItem` and render the icon**

In the `SortableLayerItem` function signature, add `warning` to destructuring:

```typescript
function SortableLayerItem({
  fieldId,
  index,
  canRemove,
  onRemove,
  isOpen,
  onOpenChange,
  shouldScrollIntoView,
  onScrollComplete,
  warning,
}: SortableLayerItemProps) {
```

In the layer header row (the `<div className="flex items-center gap-2 py-2">` block), add the warning icon **between** the `CollapsibleTrigger` and the remove button:

```tsx
{/* Warning icon — shown when layer has missing or empty sounds */}
{(warning.isEmpty || warning.missingNames.length > 0) && (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="shrink-0">
        <HugeiconsIcon icon={Alert02Icon} size={14} className="text-amber-400" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">
      {warning.isEmpty
        ? "No sounds assigned to this layer."
        : `Missing sounds: ${warning.missingNames.join(", ")}`}
    </TooltipContent>
  </Tooltip>
)}
```

The complete header row after this change:

```tsx
<div className="flex items-center gap-2 py-2">
  {/* Drag handle */}
  <button type="button" aria-label="Drag to reorder" {...attributes} {...listeners}
    className="cursor-grab touch-none text-muted-foreground hover:text-foreground shrink-0">
    ⠿
  </button>

  {/* Trigger */}
  <CollapsibleTrigger asChild>
    <button type="button"
      className="flex-1 min-w-0 text-left text-sm font-medium hover:text-foreground transition-colors">
      Layer {index + 1}
    </button>
  </CollapsibleTrigger>

  {/* Warning icon */}
  {(warning.isEmpty || warning.missingNames.length > 0) && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <HugeiconsIcon icon={Alert02Icon} size={14} className="text-amber-400" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {warning.isEmpty
          ? "No sounds assigned to this layer."
          : `Missing sounds: ${warning.missingNames.join(", ")}`}
      </TooltipContent>
    </Tooltip>
  )}

  {/* Remove button */}
  <button type="button" aria-label="Remove layer" onClick={onRemove} disabled={!canRemove}
    className="ml-2 p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
    <HugeiconsIcon icon={Cancel01Icon} size={14} />
  </button>
</div>
```

- [ ] **Step 4: Compute warnings in `LayerAccordion` and pass to items**

In `LayerAccordion`, add after the existing `const { fields, append, remove, move }` block:

```typescript
const watchedLayers = useWatch({ control, name: "layers" }) as PadConfigForm["layers"];
const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
const sounds = useLibraryStore((s) => s.sounds);
const soundById = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);

const layerWarnings = useMemo<LayerWarning[]>(
  () =>
    (watchedLayers ?? []).map((layer) => {
      if (layer.selection.type !== "assigned") return { isEmpty: false, missingNames: [] };
      if (layer.selection.instances.length === 0) return { isEmpty: true, missingNames: [] };
      const missingNames = layer.selection.instances
        .filter((inst) => missingSoundIds.has(inst.soundId))
        .map((inst) => soundById.get(inst.soundId)?.name ?? "Unknown");
      return { isEmpty: false, missingNames };
    }),
  [watchedLayers, missingSoundIds, soundById],
);
```

- [ ] **Step 5: Pass `warning` prop to `SortableLayerItem`**

In the `fields.map(...)` JSX inside `LayerAccordion`, add the `warning` prop:

```tsx
{fields.map((field, i) => (
  <SortableLayerItem
    key={field.rhfId}
    fieldId={field.rhfId}
    index={i}
    canRemove={fields.length > 1}
    onRemove={() => remove(i)}
    isOpen={openId === field.rhfId}
    onOpenChange={(open) => handleOpenChange(field.rhfId, open)}
    shouldScrollIntoView={pendingScrollId === field.rhfId}
    onScrollComplete={() => setPendingScrollId(null)}
    warning={layerWarnings[i] ?? { isEmpty: false, missingNames: [] }}
  />
))}
```

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerAccordion.tsx
git commit -m "feat: show per-layer missing sound warnings in pad config drawer"
```

---

## Task 5: SoundsPanel — impact preview in delete dialogs

**Files:**
- Modify: `src/components/composite/SidePanel/SoundsPanel.tsx`

- [ ] **Step 1: Add imports**

In `src/components/composite/SidePanel/SoundsPanel.tsx`, add to the existing imports:

```typescript
import { getAffectedPads, type AffectedPad } from "@/lib/projectSoundReconcile";
import { useProjectStore } from "@/state/projectStore";
```

- [ ] **Step 2: Read current project from store**

Inside `SoundsPanel()`, add after the existing store selectors (near the top of the function):

```typescript
const project = useProjectStore((s) => s.project);
```

- [ ] **Step 3: Add state for affected pads**

In the state declarations block (near `confirmDeleteFolderOpen`), add:

```typescript
const [affectedPadsForFolderDelete, setAffectedPadsForFolderDelete] = useState<AffectedPad[]>([]);
const [affectedPadsForSoundsDelete, setAffectedPadsForSoundsDelete] = useState<AffectedPad[]>([]);
```

- [ ] **Step 4: Compute affected pads when opening the folder delete dialog**

Find this JSX (the Delete folder button in the toolbar):

```tsx
onClick={() => setConfirmDeleteFolderOpen(true)}
```

Replace with:

```tsx
onClick={() => {
  if (selectedFolder && project) {
    const folderSoundIds = new globalThis.Set(
      sounds.filter((s) => s.folderId === selectedFolder.id).map((s) => s.id),
    );
    setAffectedPadsForFolderDelete(getAffectedPads(project, folderSoundIds));
  } else {
    setAffectedPadsForFolderDelete([]);
  }
  setConfirmDeleteFolderOpen(true);
}}
```

- [ ] **Step 5: Compute affected pads when opening the sounds delete dialog**

Find this JSX (the "Delete from Disk" button in the sounds toolbar):

```tsx
onClick={() => setConfirmDeleteSoundsFromDiskOpen(true)}
```

Replace with:

```tsx
onClick={() => {
  if (project) {
    setAffectedPadsForSoundsDelete(getAffectedPads(project, selectedSoundIds));
  } else {
    setAffectedPadsForSoundsDelete([]);
  }
  setConfirmDeleteSoundsFromDiskOpen(true);
}}
```

- [ ] **Step 6: Add impact section to the folder delete dialog**

Find the `{/* Delete folder from disk */}` dialog. Inside `<DialogContent>`, after the closing `</DialogHeader>` tag and before `<DialogFooter>`, add:

```tsx
{affectedPadsForFolderDelete.length > 0 && (
  <div className="text-sm space-y-1">
    <p className="font-medium text-amber-400">Affects this project:</p>
    <ul className="space-y-0.5 text-muted-foreground">
      {affectedPadsForFolderDelete.map((ap, i) => (
        <li key={i}>
          <span className="text-foreground">"{ap.padName}"</span>
          {" "}({ap.sceneName}) — Layer{ap.layerIndices.length > 1 ? "s" : ""}{" "}
          {ap.layerIndices.join(", ")}
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 7: Add impact section to the sounds delete dialog**

Find the `{/* Delete sounds from disk */}` dialog. Inside `<DialogContent>`, after `</DialogHeader>` and before `<DialogFooter>`, add:

```tsx
{affectedPadsForSoundsDelete.length > 0 && (
  <div className="text-sm space-y-1">
    <p className="font-medium text-amber-400">Affects this project:</p>
    <ul className="space-y-0.5 text-muted-foreground">
      {affectedPadsForSoundsDelete.map((ap, i) => (
        <li key={i}>
          <span className="text-foreground">"{ap.padName}"</span>
          {" "}({ap.sceneName}) — Layer{ap.layerIndices.length > 1 ? "s" : ""}{" "}
          {ap.layerIndices.join(", ")}
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 8: Type-check**

```
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 9: Run full test suite**

```
npm run test:run
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/composite/SidePanel/SoundsPanel.tsx
git commit -m "feat: show affected pads in folder and sound delete confirmation dialogs"
```
