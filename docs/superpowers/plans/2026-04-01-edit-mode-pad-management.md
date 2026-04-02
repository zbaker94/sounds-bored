# Edit Mode & Pad Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an edit mode toggle that lets users manage pads (edit, duplicate, delete) and layers (add, remove, reorder) without triggering audio.

**Architecture:** `editMode` lives in `uiStore`. `PadButton` reads it directly and suppresses gestures / shows an overlay with action buttons. `PadConfigDrawer` is extended to support multiple layers via an `@dnd-kit` sortable accordion, and gains a `padId` prop to distinguish create vs. update. `projectStore` gets `deletePad` and `duplicatePad` actions.

**Tech Stack:** React 19, TypeScript strict, Zustand, react-hook-form + Zod 4, shadcn/ui Accordion, `@dnd-kit/core` + `@dnd-kit/sortable`, HugeIcons, Vitest + Testing Library

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/lib/schemas.ts` | `PadConfigSchema`: `layer` → `layers` array |
| Modify | `src/state/uiStore.ts` | Add `editMode` + `toggleEditMode` |
| Modify | `src/state/projectStore.ts` | Add `deletePad`, `duplicatePad` |
| Modify | `src/hooks/useGlobalHotkeys.ts` | Wire `Mod+E` |
| Modify | `src/components/composite/SidePanel/EditSection.tsx` | Active state + onClick |
| Modify | `src/components/composite/SceneTabBar/SceneTab.tsx` | Always-visible icons in edit mode |
| Modify | `src/components/composite/SceneView/PadButton.tsx` | Edit mode overlay + gesture suppression |
| Modify | `src/components/composite/SceneView/SceneView.tsx` | Pass `sceneId`, track `editingPad`, wire drawer |
| Modify | `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` | Multi-layer, `padId` prop, create/edit modes |
| Modify | `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx` | `index` prop, update field paths |
| Create | `src/components/composite/PadConfigDrawer/LayerAccordion.tsx` | Sortable accordion layer list |
| Create | `src/components/modals/ConfirmDeletePadDialog.tsx` | Confirm dialog for pad deletion |
| Modify | `src/state/uiStore.test.ts` | Add `editMode` tests |
| Modify | `src/state/projectStore.test.ts` | Add `deletePad`, `duplicatePad` tests |
| Modify | `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx` | Update for `layers` array schema |
| Modify | `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx` | Update for multi-layer + edit mode |
| Create | `src/components/composite/SceneView/PadButton.test.tsx` | Edit mode overlay tests |

---

## Task 1: Install @dnd-kit packages

**Files:**
- (none — package.json + lock file)

- [ ] **Step 1: Install**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: packages added to `node_modules`, no peer-dep warnings.

- [ ] **Step 2: Verify types are available**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: same errors as before (if any) — no new "Cannot find module '@dnd-kit/core'" errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities"
```

---

## Task 2: Update PadConfigSchema — `layer` → `layers`

**Files:**
- Modify: `src/lib/schemas.ts:145-151`

This change will temporarily break `LayerConfigSection.tsx`, `LayerConfigSection.test.tsx`, `PadConfigDrawer.tsx`, and `PadConfigDrawer.test.tsx`. Those are fixed in Tasks 9–12.

- [ ] **Step 1: Write the failing test** (append to `src/state/projectStore.test.ts` — tests the schema directly via addPad which calls the store; the schema change test is implicit in the store tests added in Task 3, but we can confirm the type change compiles by just updating schemas.ts)

Actually the schema change is a structural refactor, not a behavior addition. No new behavior test needed here. Proceed directly.

- [ ] **Step 2: Update `src/lib/schemas.ts`**

Find the two lines:
```typescript
export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layer: LayerConfigFormSchema,
});

export type LayerConfigForm = z.infer<typeof LayerConfigFormSchema>;
export type PadConfigForm = z.infer<typeof PadConfigSchema>;
```

Replace with:
```typescript
export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layers: z.array(LayerConfigFormSchema).min(1, "At least one layer is required"),
});

export type LayerConfigForm = z.infer<typeof LayerConfigFormSchema>;
export type PadConfigForm = z.infer<typeof PadConfigSchema>;
```

- [ ] **Step 3: Confirm TypeScript reports errors in downstream files**

```bash
npx tsc --noEmit 2>&1 | grep -E "(LayerConfigSection|PadConfigDrawer)"
```

Expected: errors in `LayerConfigSection.tsx` and `PadConfigDrawer.tsx` referencing `layer` (now invalid). This is expected — those files are fixed in Tasks 9–12.

- [ ] **Step 4: Commit the schema change**

```bash
git add src/lib/schemas.ts
git commit -m "feat: PadConfigSchema uses layers array instead of singular layer"
```

---

## Task 3: projectStore — `deletePad` + `duplicatePad`

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

- [ ] **Step 1: Write failing tests** (append to `src/state/projectStore.test.ts`)

Add a new `describe` block after the existing ones:

```typescript
describe("deletePad", () => {
  function loadSceneWithPad() {
    const scene = createMockScene({ id: "scene-1" });
    const pad = createMockPad({ id: "pad-1", name: "Kick" });
    scene.pads.push(pad);
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    return { scene, pad };
  }

  it("removes the pad from the scene", () => {
    loadSceneWithPad();
    getState().deletePad("scene-1", "pad-1");
    expect(getState().project?.scenes[0].pads).toHaveLength(0);
  });

  it("marks the project as dirty", () => {
    loadSceneWithPad();
    getState().deletePad("scene-1", "pad-1");
    expect(getState().isDirty).toBe(true);
  });

  it("is a no-op if pad does not exist", () => {
    loadSceneWithPad();
    getState().deletePad("scene-1", "nonexistent");
    expect(getState().project?.scenes[0].pads).toHaveLength(1);
    expect(getState().isDirty).toBe(false);
  });

  it("is a no-op if scene does not exist", () => {
    loadSceneWithPad();
    getState().deletePad("nonexistent", "pad-1");
    expect(getState().project?.scenes[0].pads).toHaveLength(1);
    expect(getState().isDirty).toBe(false);
  });
});

describe("duplicatePad", () => {
  function loadSceneWithTwoPads() {
    const scene = createMockScene({ id: "scene-1" });
    const layer = createMockLayer({ id: "layer-1" });
    const pad1 = createMockPad({ id: "pad-1", name: "Kick", layers: [layer] });
    const pad2 = createMockPad({ id: "pad-2", name: "Snare" });
    scene.pads.push(pad1, pad2);
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    return { scene, pad1, pad2, layer };
  }

  it("inserts a new pad immediately after the source pad", () => {
    loadSceneWithTwoPads();
    getState().duplicatePad("scene-1", "pad-1");
    const pads = getState().project!.scenes[0].pads;
    expect(pads).toHaveLength(3);
    expect(pads[0].id).toBe("pad-1");
    expect(pads[1].name).toBe("Kick"); // duplicate is at index 1
    expect(pads[2].id).toBe("pad-2");
  });

  it("assigns a new unique id to the duplicated pad", () => {
    loadSceneWithTwoPads();
    getState().duplicatePad("scene-1", "pad-1");
    const pads = getState().project!.scenes[0].pads;
    expect(pads[1].id).not.toBe("pad-1");
    expect(pads[1].id).toBeTruthy();
  });

  it("assigns new ids to all layers in the duplicated pad", () => {
    loadSceneWithTwoPads();
    getState().duplicatePad("scene-1", "pad-1");
    const duplicate = getState().project!.scenes[0].pads[1];
    expect(duplicate.layers[0].id).not.toBe("layer-1");
  });

  it("marks the project as dirty", () => {
    loadSceneWithTwoPads();
    getState().duplicatePad("scene-1", "pad-1");
    expect(getState().isDirty).toBe(true);
  });

  it("is a no-op if pad does not exist", () => {
    loadSceneWithTwoPads();
    getState().duplicatePad("scene-1", "nonexistent");
    expect(getState().project?.scenes[0].pads).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/state/projectStore.test.ts
```

Expected: `deletePad is not a function` / `duplicatePad is not a function` errors.

- [ ] **Step 3: Add `deletePad` and `duplicatePad` to `src/state/projectStore.ts`**

Add to the `ProjectActions` interface (after `updatePad`):
```typescript
deletePad: (sceneId: string, padId: string) => void;
duplicatePad: (sceneId: string, padId: string) => void;
```

Add implementations inside `immer((set) => ({ ... }))` (after `updatePad`):
```typescript
deletePad: (sceneId, padId) =>
  set((draft) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const idx = scene.pads.findIndex((p) => p.id === padId);
    if (idx === -1) return;
    scene.pads.splice(idx, 1);
    draft.isDirty = true;
  }),

duplicatePad: (sceneId, padId) =>
  set((draft) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const idx = scene.pads.findIndex((p) => p.id === padId);
    if (idx === -1) return;
    const source = scene.pads[idx];
    const duplicate: Pad = {
      ...source,
      id: crypto.randomUUID(),
      layers: source.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
    };
    scene.pads.splice(idx + 1, 0, duplicate);
    draft.isDirty = true;
  }),
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/state/projectStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "feat: add deletePad and duplicatePad to projectStore"
```

---

## Task 4: uiStore — `editMode` + `toggleEditMode`

**Files:**
- Modify: `src/state/uiStore.ts`
- Modify: `src/state/uiStore.test.ts`

- [ ] **Step 1: Write failing tests** (append to `src/state/uiStore.test.ts`)

Add after the existing `hasOpenOverlay` describe block:

```typescript
describe("editMode", () => {
  it("starts as false", () => {
    expect(useUiStore.getState().editMode).toBe(false);
  });

  it("toggleEditMode turns it on", () => {
    useUiStore.getState().toggleEditMode();
    expect(useUiStore.getState().editMode).toBe(true);
  });

  it("toggleEditMode turns it off when already on", () => {
    useUiStore.getState().toggleEditMode();
    useUiStore.getState().toggleEditMode();
    expect(useUiStore.getState().editMode).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/state/uiStore.test.ts
```

Expected: `editMode` is `undefined`, `toggleEditMode is not a function`.

- [ ] **Step 3: Update `src/state/uiStore.ts`**

Add `editMode` to `UiState`:
```typescript
interface UiState {
  overlayStack: OverlayEntry[];
  editMode: boolean;
}
```

Add `toggleEditMode` to `UiActions`:
```typescript
interface UiActions {
  // ... existing actions ...
  toggleEditMode: () => void;
}
```

Update `initialUiState`:
```typescript
export const initialUiState: UiState = {
  overlayStack: [],
  editMode: false,
};
```

Add implementation in `create()(...)` (after `hasOpenOverlay`):
```typescript
toggleEditMode: () =>
  set((state) => ({ editMode: !state.editMode })),
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/state/uiStore.test.ts
```

Expected: all tests pass (including the new `editMode` tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/uiStore.ts src/state/uiStore.test.ts
git commit -m "feat: add editMode and toggleEditMode to uiStore"
```

---

## Task 5: Wire `Mod+E` hotkey + EditSection active state

**Files:**
- Modify: `src/hooks/useGlobalHotkeys.ts`
- Modify: `src/components/composite/SidePanel/EditSection.tsx`

- [ ] **Step 1: Add `mod+e` hotkey to `src/hooks/useGlobalHotkeys.ts`**

Add after the `mod+s` handler (around line 38):
```typescript
// Mod+E: toggle edit mode.
useHotkeys("mod+e", () => {
  useUiStore.getState().toggleEditMode();
});
```

- [ ] **Step 2: Update `src/components/composite/SidePanel/EditSection.tsx`**

Add selectors at the top of `EditSection()`:
```typescript
const editMode = useUiStore((s) => s.editMode);
const toggleEditMode = useUiStore((s) => s.toggleEditMode);
```

Update the Edit Mode button (the second `<Button>` with `PencilEdit01Icon`):
```typescript
<Button
  variant={editMode ? "secondary" : "default"}
  size="icon"
  className="size-11 md:size-9"
  onClick={toggleEditMode}
>
  <HugeiconsIcon icon={PencilEdit01Icon} />
</Button>
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep -E "(useGlobalHotkeys|EditSection)"
```

Expected: no new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useGlobalHotkeys.ts src/components/composite/SidePanel/EditSection.tsx
git commit -m "feat: wire Mod+E hotkey and EditSection button to toggleEditMode"
```

---

## Task 6: SceneTab — always-visible icons in edit mode

**Files:**
- Modify: `src/components/composite/SceneTabBar/SceneTab.tsx`

- [ ] **Step 1: Update `src/components/composite/SceneTabBar/SceneTab.tsx`**

Add the `editMode` selector at the top of `SceneTab`:
```typescript
const editMode = useUiStore((s) => s.editMode);
```

The import for `useUiStore` is already present. No new import needed.

Find the two buttons inside the non-editing `<TabsTrigger>` (lines 120–135). They currently use `group-hover:` Tailwind classes to hide/show. Change them to always be visible when `editMode` is true:

```typescript
<TabsTrigger value={scene.id} className={cn("group gap-0", editMode ? "gap-1.5" : "hover:gap-1.5")}>
  {scene.name}
  <button
    type="button"
    aria-label="Edit scene name"
    onMouseDown={startEditing}
    className={cn(
      "overflow-hidden transition-all inline-flex items-center justify-center",
      editMode
        ? "w-[14px] opacity-100"
        : "w-0 group-hover:w-[14px] opacity-0 group-hover:opacity-100"
    )}
  >
    <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
  </button>
  <button
    type="button"
    aria-label="Delete scene"
    onClick={handleDeleteClick}
    className={cn(
      "overflow-hidden transition-all inline-flex items-center justify-center",
      editMode
        ? "w-[14px] opacity-100"
        : "w-0 group-hover:w-[14px] opacity-0 group-hover:opacity-100"
    )}
  >
    <HugeiconsIcon icon={Cancel01Icon} size={14} />
  </button>
</TabsTrigger>
```

Add `cn` import if not present. `cn` is from `@/lib/utils` — check the existing imports at the top of the file; add `import { cn } from "@/lib/utils";` if it's missing.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep "SceneTab"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/SceneTabBar/SceneTab.tsx
git commit -m "feat: scene tab icons always visible in edit mode"
```

---

## Task 7: ConfirmDeletePadDialog

**Files:**
- Create: `src/components/modals/ConfirmDeletePadDialog.tsx`

- [ ] **Step 1: Create `src/components/modals/ConfirmDeletePadDialog.tsx`**

```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeletePadDialogProps {
  isOpen: boolean;
  padName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeletePadDialog({
  isOpen,
  padName,
  onConfirm,
  onCancel,
}: ConfirmDeletePadDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Pad</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{padName}"? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | grep "ConfirmDeletePadDialog"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/ConfirmDeletePadDialog.tsx
git commit -m "feat: add ConfirmDeletePadDialog"
```

---

## Task 8: PadButton — edit mode overlay + visual treatment

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Create: `src/components/composite/SceneView/PadButton.test.tsx`

- [ ] **Step 1: Write failing tests** in new file `src/components/composite/SceneView/PadButton.test.tsx`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer } from "@/test/factories";
import { PadButton } from "./PadButton";

function loadPadInStore(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  return pad;
}

describe("PadButton", () => {
  beforeEach(() => {
    useUiStore.setState({ ...initialUiState });
    useProjectStore.setState({ ...initialProjectState });
  });

  describe("normal mode (editMode false)", () => {
    it("renders the pad name", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByText("Kick")).toBeInTheDocument();
    });

    it("does not show the edit overlay", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.queryByRole("button", { name: /edit pad/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /duplicate pad/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /delete pad/i })).not.toBeInTheDocument();
    });
  });

  describe("edit mode (editMode true)", () => {
    beforeEach(() => {
      useUiStore.setState({ ...initialUiState, editMode: true });
    });

    it("shows the edit overlay with action buttons", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByRole("button", { name: /edit pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /duplicate pad/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete pad/i })).toBeInTheDocument();
    });

    it("shows layer count in overlay", () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      expect(screen.getByText(/1 layer/i)).toBeInTheDocument();
    });

    it("clicking edit button calls onEditClick", async () => {
      const pad = loadPadInStore();
      const onEditClick = vi.fn();
      render(<PadButton pad={pad} sceneId="scene-1" onEditClick={onEditClick} />);
      await userEvent.click(screen.getByRole("button", { name: /edit pad/i }));
      expect(onEditClick).toHaveBeenCalledTimes(1);
    });

    it("clicking duplicate button calls duplicatePad", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /duplicate pad/i }));
      const pads = useProjectStore.getState().project!.scenes[0].pads;
      expect(pads).toHaveLength(2);
      expect(pads[1].name).toBe("Kick");
    });

    it("clicking delete button shows confirm dialog", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/delete pad/i)).toBeInTheDocument();
    });

    it("confirming delete removes the pad", async () => {
      const pad = loadPadInStore();
      render(<PadButton pad={pad} sceneId="scene-1" />);
      await userEvent.click(screen.getByRole("button", { name: /delete pad/i }));
      const confirmBtn = await screen.findByRole("button", { name: /^delete$/i });
      await userEvent.click(confirmBtn);
      expect(useProjectStore.getState().project!.scenes[0].pads).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/components/composite/SceneView/PadButton.test.tsx
```

Expected: import errors (no `sceneId` prop yet, no `onEditClick` prop).

- [ ] **Step 3: Rewrite `src/components/composite/SceneView/PadButton.tsx`**

```typescript
import { useEffect, useRef, useState } from "react";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore } from "@/state/uiStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { getPadProgress } from "@/lib/audio/padPlayer";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit01Icon, Copy01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  onEditClick?: () => void;
}

export function PadButton({ pad, sceneId, onEditClick }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.includes(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const { gestureHandlers, fillVolume } = usePadGesture(pad);
  const [progress, setProgress] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        const p = getPadProgress(pad.id);
        if (p !== null) setProgress(p);
        rafRef.current = requestAnimationFrame(animate);
      };
      rafRef.current = requestAnimationFrame(animate);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, pad.id]);

  const layerCount = pad.layers.length;

  return (
    <>
      <button
        {...(editMode ? {} : gestureHandlers)}
        onClick={editMode ? undefined : undefined}
        className={cn(
          "relative w-full h-full rounded-xl overflow-hidden",
          "flex items-center justify-center p-2",
          "bg-card text-card-foreground",
          "shadow-[3px_3px_0px_rgba(0,0,0,0.25)]",
          "text-sm font-semibold text-center select-none",
          editMode
            ? "border-2 border-dashed border-foreground/50 cursor-default"
            : cn(
                "border-2 transition-all cursor-pointer",
                "hover:brightness-110 active:scale-95 active:shadow-none",
                isPlaying
                  ? "border-black drop-shadow-[0_5px_0px_rgba(0,0,0,1)]"
                  : "border-black/20"
              )
        )}
        style={pad.color ? { backgroundColor: pad.color } : undefined}
      >
        {/* Playback progress — normal mode only */}
        {!editMode && isPlaying && (
          <div
            className="absolute top-0 left-0 bottom-0 pointer-events-none bg-black/35"
            style={{ width: `${progress * 100}%` }}
          />
        )}
        {/* Volume fill — normal mode only */}
        {!editMode && fillVolume !== null && (
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
            style={{ height: `${fillVolume * 100}%` }}
          />
        )}

        {/* Edit mode overlay */}
        {editMode && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-between p-1.5 pointer-events-none">
            <div className="flex flex-col items-center gap-0.5 pointer-events-none">
              <span className="text-white text-xs font-semibold line-clamp-2 text-center leading-tight">
                {pad.name}
              </span>
              <span className="text-white/70 text-xs">
                {layerCount} {layerCount === 1 ? "layer" : "layers"}
              </span>
            </div>
            <div className="flex gap-1 pointer-events-auto">
              <button
                type="button"
                aria-label="Edit pad"
                onClick={(e) => { e.stopPropagation(); onEditClick?.(); }}
                className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
              >
                <HugeiconsIcon icon={PencilEdit01Icon} size={14} className="text-white" />
              </button>
              <button
                type="button"
                aria-label="Duplicate pad"
                onClick={(e) => { e.stopPropagation(); duplicatePad(sceneId, pad.id); }}
                className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
              >
                <HugeiconsIcon icon={Copy01Icon} size={14} className="text-white" />
              </button>
              <button
                type="button"
                aria-label="Delete pad"
                onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
                className="p-1 rounded bg-white/20 hover:bg-red-500/80 transition-colors"
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} className="text-white" />
              </button>
            </div>
          </div>
        )}

        {/* Pad name — normal mode */}
        {!editMode && (
          <span className="relative z-10 line-clamp-3 break-words leading-tight">
            {pad.name}
          </span>
        )}
      </button>

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          deletePad(sceneId, pad.id);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
```

**Note on icons:** `Copy01Icon` and `Delete02Icon` are used above — verify these exist in `@hugeicons/core-free-icons`. If they don't, find the closest equivalent (e.g., `CopyIcon`, `Bin01Icon`, `TrashIcon`). You can run `grep -r "from '@hugeicons/core-free-icons'" src/` to see what's already imported in the project, and browse the icon names for the closest match.

- [ ] **Step 4: Run PadButton tests**

```bash
npm run test:run -- src/components/composite/SceneView/PadButton.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "feat: PadButton edit mode overlay with edit/duplicate/delete actions"
```

---

## Task 9: LayerConfigSection — `index` prop + updated field paths

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx`

- [ ] **Step 1: Update the test wrapper in `LayerConfigSection.test.tsx`**

The test file imports `PadConfigForm` and uses `layer` (singular). Update the `defaultValues` and `Wrapper` component:

```typescript
const defaultValues: PadConfigForm = {
  name: "",
  layers: [
    {
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    },
  ],
};

function Wrapper({ index = 0, onSubmit = () => {} }: { index?: number; onSubmit?: (data: PadConfigForm) => void }) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues,
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <LayerConfigSection index={index} />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}
```

All test assertions (`screen.findByText(...)`) remain the same — they check rendered UI text, not form field paths.

- [ ] **Step 2: Run tests to confirm they fail** (TypeScript compile error because `LayerConfigSection` doesn't have `index` prop yet)

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
```

Expected: TypeScript error `Property 'index' does not exist on type 'IntrinsicAttributes'` or similar.

- [ ] **Step 3: Rewrite `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`**

```typescript
import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection, Arrangement, PlaybackMode, RetriggerMode } from "@/lib/schemas";

const SELECTION_TYPE_DEFAULTS: Record<LayerSelection["type"], LayerSelection> = {
  assigned: { type: "assigned", instances: [] },
  tag: { type: "tag", tagIds: [], defaultVolume: 100 },
  set: { type: "set", setId: "", defaultVolume: 100 },
};

const ARRANGEMENT_OPTIONS = [
  { value: "simultaneous", label: "Simultaneous" },
  { value: "sequential", label: "Sequential" },
  { value: "shuffled", label: "Shuffled" },
] as const;

const PLAYBACK_MODE_OPTIONS = [
  { value: "one-shot", label: "One-shot" },
  { value: "hold", label: "Hold" },
  { value: "loop", label: "Loop" },
] as const;

const RETRIGGER_MODE_OPTIONS = [
  { value: "restart", label: "Restart" },
  { value: "continue", label: "Continue" },
  { value: "stop", label: "Stop" },
  { value: "next", label: "Next" },
] as const;

interface LayerConfigSectionProps {
  index: number;
}

export function LayerConfigSection({ index }: LayerConfigSectionProps) {
  const { control, watch, setValue, formState: { errors } } = useFormContext<PadConfigForm>();

  // Read all layer values via the top-level array watch.
  // This is the most reliable way to get typed array element values from react-hook-form.
  const layers = watch("layers");
  const layer = layers[index];
  const selectionType = layer?.selection.type ?? "assigned";
  const arrangement = layer?.arrangement ?? "simultaneous";
  const playbackMode = layer?.playbackMode ?? "one-shot";
  const retriggerMode = layer?.retriggerMode ?? "restart";

  // Cast array element paths for setValue and Controller — react-hook-form requires the path string
  // but TypeScript's type inference for dynamic array indices requires a cast via a fixed-index alias.
  const selPath = `layers.${index}.selection` as `layers.0.selection`;
  const arrPath = `layers.${index}.arrangement` as `layers.0.arrangement`;
  const pbPath  = `layers.${index}.playbackMode` as `layers.0.playbackMode`;
  const rtPath  = `layers.${index}.retriggerMode` as `layers.0.retriggerMode`;
  const volPath = `layers.${index}.volume` as `layers.0.volume`;

  const selectionErrors = errors.layers?.[index]?.selection as Record<string, { message?: string }> | undefined;

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue(selPath, SELECTION_TYPE_DEFAULTS[type] as LayerSelection);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selection Type */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sound Selection
        </Label>
        <Tabs value={selectionType} onValueChange={(v) => {
          if (v === "assigned" || v === "tag" || v === "set")
            handleSelectionTypeChange(v);
        }}>
          <TabsList className="w-full">
            <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
            <TabsTrigger value="tag" className="flex-1">Tag</TabsTrigger>
            <TabsTrigger value="set" className="flex-1">Set</TabsTrigger>
          </TabsList>
        </Tabs>

        <Controller
          control={control}
          name={selPath}
          render={({ field }) => (
            <SoundSelector value={field.value as LayerSelection} onChange={field.onChange} />
          )}
        />

        {selectionType === "assigned" && selectionErrors?.instances?.message && (
          <p className="text-sm text-destructive">{selectionErrors.instances.message}</p>
        )}
        {selectionType === "tag" && selectionErrors?.tagIds?.message && (
          <p className="text-sm text-destructive">{selectionErrors.tagIds.message}</p>
        )}
        {selectionType === "set" && selectionErrors?.setId?.message && (
          <p className="text-sm text-destructive">{selectionErrors.setId.message}</p>
        )}
      </div>

      {/* Arrangement */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Arrangement
        </Label>
        <Tabs
          value={arrangement}
          onValueChange={(v) => {
            if (ARRANGEMENT_OPTIONS.some((o) => o.value === v))
              setValue(arrPath, v as Arrangement, { shouldDirty: true });
          }}
        >
          <TabsList className="w-full">
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Playback Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Playback Mode
        </Label>
        <Tabs
          value={playbackMode}
          onValueChange={(v) => {
            if (PLAYBACK_MODE_OPTIONS.some((o) => o.value === v))
              setValue(pbPath, v as PlaybackMode, { shouldDirty: true });
          }}
        >
          <TabsList className="w-full">
            {PLAYBACK_MODE_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Retrigger Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Retrigger Mode
        </Label>
        <Tabs
          value={retriggerMode}
          onValueChange={(v) => {
            if (RETRIGGER_MODE_OPTIONS.some((o) => o.value === v))
              setValue(rtPath, v as RetriggerMode, { shouldDirty: true });
          }}
        >
          <TabsList className="w-full">
            {RETRIGGER_MODE_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Volume
        </Label>
        <Controller
          control={control}
          name={volPath}
          render={({ field }) => (
            <Slider
              min={0}
              max={100}
              step={1}
              value={[field.value as number]}
              onValueChange={([v]) => field.onChange(v)}
            />
          )}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run LayerConfigSection tests**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerConfigSection.tsx src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
git commit -m "feat: LayerConfigSection accepts index prop for multi-layer form"
```

---

## Task 10: LayerAccordion — sortable accordion

**Files:**
- Create: `src/components/composite/PadConfigDrawer/LayerAccordion.tsx`

- [ ] **Step 1: Create `src/components/composite/PadConfigDrawer/LayerAccordion.tsx`**

```typescript
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useFieldArray, useFormContext } from "react-hook-form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import type { PadConfigForm, LayerConfigForm } from "@/lib/schemas";
import { LayerConfigSection } from "./LayerConfigSection";

// Default values for a newly added layer
const DEFAULT_LAYER: LayerConfigForm = {
  selection: { type: "assigned", instances: [] },
  arrangement: "simultaneous",
  playbackMode: "one-shot",
  retriggerMode: "restart",
  volume: 100,
};

interface SortableLayerItemProps {
  fieldId: string;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
}

function SortableLayerItem({ fieldId, index, canRemove, onRemove }: SortableLayerItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: fieldId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AccordionItem value={fieldId} className="border rounded-md px-2 mb-2">
        <AccordionTrigger className="py-2 hover:no-underline">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Drag handle — stop propagation so it doesn't toggle accordion */}
            <button
              type="button"
              aria-label="Drag to reorder"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              className="cursor-grab touch-none text-muted-foreground hover:text-foreground shrink-0"
            >
              <HugeiconsIcon icon={DragDropVerticalIcon} size={16} />
            </button>
            <span className="text-sm font-medium">Layer {index + 1}</span>
          </div>
          {/* Remove button — stop propagation so it doesn't toggle accordion */}
          <button
            type="button"
            aria-label="Remove layer"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            disabled={!canRemove}
            className="ml-2 p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-3">
          <LayerConfigSection index={index} />
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}

export function LayerAccordion() {
  const { control } = useFormContext<PadConfigForm>();
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "layers",
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.id === active.id);
    const to = fields.findIndex((f) => f.id === over.id);
    if (from !== -1 && to !== -1) move(from, to);
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <Accordion type="single" collapsible className="w-full">
            {fields.map((field, i) => (
              <SortableLayerItem
                key={field.id}
                fieldId={field.id}
                index={i}
                canRemove={fields.length > 1}
                onRemove={() => remove(i)}
              />
            ))}
          </Accordion>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append(DEFAULT_LAYER)}
        className="self-start"
      >
        + Add Layer
      </Button>
    </div>
  );
}
```

**Note on `DragDropVerticalIcon`:** Verify this icon name exists in `@hugeicons/core-free-icons`. If it doesn't compile, search for an alternative: `grep -r "import.*from '@hugeicons/core-free-icons'" src/ | head -10` to see icon naming conventions, then find the closest drag-handle icon name.

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | grep "LayerAccordion"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerAccordion.tsx
git commit -m "feat: LayerAccordion with sortable dnd-kit layers and add/remove"
```

---

## Task 11: PadConfigDrawer — multi-layer + create/edit modes

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`
- Modify: `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`

- [ ] **Step 1: Update `PadConfigDrawer.test.tsx` for multi-layer + edit mode**

Replace the entire file:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockHistoryEntry, createMockProject, createMockScene, createMockPad, createMockLayer, createMockSound } from "@/test/factories";
import { PadConfigDrawer } from "./PadConfigDrawer";

function renderDrawer(props: { sceneId?: string; padId?: string } = {}) {
  return render(<PadConfigDrawer sceneId={props.sceneId ?? "scene-1"} padId={props.padId} />);
}

function openDrawer() {
  act(() => {
    useUiStore.getState().openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  });
}

describe("PadConfigDrawer", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
    useLibraryStore.setState({ ...initialLibraryState });

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("is not visible when overlay is closed", () => {
    renderDrawer();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is visible when overlay is open", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the pad name input", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByLabelText(/pad name/i)).toBeInTheDocument();
  });

  it("shows at least one layer accordion item", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByText(/layer 1/i)).toBeInTheDocument();
  });

  it("shows Add Layer button", () => {
    renderDrawer();
    openDrawer();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });

  it("shows a validation error when name is empty and Save is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("create mode: calls addPad with all layers and closes overlay on valid submit", async () => {
    const sound = createMockSound({ id: "sound-1", name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    renderDrawer();
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");

    // Open layer 1 accordion and select a sound
    await userEvent.click(screen.getByText(/layer 1/i));
    const checkbox = await screen.findByRole("checkbox", { name: /kick/i });
    await userEvent.click(checkbox);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads).toHaveLength(1);
      expect(pads![0].name).toBe("Kick");
      expect(pads![0].layers).toHaveLength(1);
    });

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
  });

  it("edit mode: calls updatePad when padId is provided", async () => {
    const layer = createMockLayer({ id: "layer-1", selection: { type: "assigned", instances: [{ id: "inst-1", soundId: "s1", volume: 1 }] } });
    const pad = createMockPad({ id: "pad-1", name: "Original", layers: [layer] });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    const entry = createMockHistoryEntry();
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);

    render(<PadConfigDrawer sceneId="scene-1" padId="pad-1" initialConfig={{ name: "Original", layers: [layer], muteTargetPadIds: [] }} />);
    openDrawer();

    // Clear the name and type a new one
    const nameInput = screen.getByLabelText(/pad name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Updated");

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads![0].name).toBe("Updated");
    });
  });

  it("closes overlay without saving when Cancel is clicked", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });

  it("clicking Add Layer adds a second layer accordion item", async () => {
    renderDrawer();
    openDrawer();
    await userEvent.click(screen.getByRole("button", { name: /add layer/i }));
    expect(screen.getByText(/layer 2/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to see them fail** (PadConfigDrawer doesn't have `padId` prop yet)

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
```

Expected: TypeScript errors + test failures.

- [ ] **Step 3: Rewrite `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`**

```typescript
import { useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig, LayerConfigForm } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LayerAccordion } from "./LayerAccordion";

const DEFAULT_LAYER: LayerConfigForm = {
  selection: { type: "assigned", instances: [] },
  arrangement: "simultaneous",
  playbackMode: "one-shot",
  retriggerMode: "restart",
  volume: 100,
};

const DEFAULT_VALUES: PadConfigForm = {
  name: "",
  layers: [DEFAULT_LAYER],
};

interface PadConfigDrawerProps {
  sceneId: string;
  /** When set, the drawer operates in edit mode and calls updatePad on submit. */
  padId?: string;
  /** Pre-populate the form with existing pad data (only used when padId is set). */
  initialConfig?: Partial<PadConfig>;
  /** Called when the drawer closes, e.g. to clear parent editingPad state. */
  onClose?: () => void;
}

export function PadConfigDrawer({ sceneId, padId, initialConfig, onClose }: PadConfigDrawerProps) {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const addPad = useProjectStore((s) => s.addPad);
  const updatePad = useProjectStore((s) => s.updatePad);

  const isEditMode = padId !== undefined;

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { register, handleSubmit, reset, formState: { errors } } = methods;

  // Reset form with correct values whenever the drawer opens.
  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode && initialConfig) {
      reset({
        name: initialConfig.name ?? "",
        layers: (initialConfig.layers ?? []).map((l) => ({
          selection: l.selection as LayerConfigForm["selection"],
          arrangement: l.arrangement,
          playbackMode: l.playbackMode,
          retriggerMode: l.retriggerMode,
          volume: l.volume,
        })),
      });
    } else {
      reset(DEFAULT_VALUES);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, padId]);

  function handleClose() {
    reset(DEFAULT_VALUES);
    closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER);
    onClose?.();
  }

  function onSubmit(data: PadConfigForm) {
    const config: PadConfig = {
      name: data.name,
      layers: data.layers.map((l) => ({ id: crypto.randomUUID(), ...l })),
      muteTargetPadIds: initialConfig?.muteTargetPadIds ?? [],
    };
    if (isEditMode && padId) {
      updatePad(sceneId, padId, config);
    } else {
      addPad(sceneId, config);
    }
    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <DrawerDialog
        classNames={{
          title: "[font-family:DeathLetter] tracking-wider text-2xl",
        }}
        open={isOpen}
        onOpenChange={(open) => { if (!open) handleClose(); }}
        title={isEditMode ? "Edit Pad" : "New Pad"}
        content={
          <div className="flex flex-col gap-4 px-4 py-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pad-name">Pad Name</Label>
              <Input
                id="pad-name"
                aria-label="Pad name"
                placeholder="e.g. Kick"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <LayerAccordion />
          </div>
        }
        footer={
          <>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)}>Save</Button>
          </>
        }
      />
    </FormProvider>
  );
}
```

- [ ] **Step 4: Run PadConfigDrawer tests**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
git commit -m "feat: PadConfigDrawer multi-layer support with create/edit modes"
```

---

## Task 12: SceneView — wire `sceneId` + `editingPad` state

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`
- Modify: `src/components/composite/SceneView/SceneView.test.tsx`

- [ ] **Step 1: Update `src/components/composite/SceneView/SceneView.tsx`**

Add imports at the top:
```typescript
import { useState, useMemo } from "react";
import type { Pad } from "@/lib/schemas";
```

Add `editingPad` state inside `SceneView()`:
```typescript
const [editingPad, setEditingPad] = useState<Pad | null>(null);
const openOverlay = useUiStore((s) => s.openOverlay);
```

Update the `PadButton` render in the grid (around line 127):
```typescript
{pagePads.map((pad) => (
  <PadButton
    key={pad.id}
    pad={pad}
    sceneId={activeScene.id}
    onEditClick={() => {
      setEditingPad(pad);
      openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
    }}
  />
))}
```

Update the `PadConfigDrawer` at the bottom (appears twice — both empty-state and normal-state renders):

For the empty-state render (when `pads.length === 0`):
```typescript
<PadConfigDrawer sceneId={activeScene.id} />
```
(No change needed here — no editingPad in empty-pad context.)

For the full-grid render at the bottom:
```typescript
<PadConfigDrawer
  sceneId={activeScene.id}
  padId={editingPad?.id}
  initialConfig={
    editingPad
      ? {
          name: editingPad.name,
          layers: editingPad.layers,
          muteTargetPadIds: editingPad.muteTargetPadIds,
          muteGroupId: editingPad.muteGroupId,
          color: editingPad.color,
          icon: editingPad.icon,
        }
      : undefined
  }
  onClose={() => setEditingPad(null)}
/>
```

- [ ] **Step 2: Update `SceneView.test.tsx`** to use the new `sceneId` prop that PadButton now requires

The existing tests don't render `PadButton` with pads directly, so they should still pass. Run to check:

```bash
npm run test:run -- src/components/composite/SceneView/SceneView.test.tsx
```

Expected: all existing tests still pass.

- [ ] **Step 3: Verify full TypeScript compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or the same pre-existing errors if any — all Phase A files should now be clean).

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx
git commit -m "feat: SceneView passes sceneId to PadButton and wires edit mode drawer"
```

---

## Task 13: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass, no regressions.

- [ ] **Step 2: Fix any failures**

If tests fail:
- TypeScript-only errors (red squiggles in IDE but test passes): look for `as` cast issues in `LayerConfigSection` paths.
- Icon name errors: find the correct icon in `@hugeicons/core-free-icons` by grepping existing imports (`grep -r "from '@hugeicons/core-free-icons'" src/`).
- `DragDropVerticalIcon` not found: try `DragDropIcon`, `DragHandleIcon`, or `Menu01Icon` as alternatives.
- `Copy01Icon`/`Delete02Icon` not found: try `CopyIcon`, `Bin01Icon`, `TrashIcon`, `DeleteIcon`.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: Phase A edit mode & pad management — all tests passing"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `editMode` in uiStore + `toggleEditMode` — Task 4
- [x] `Mod+E` hotkey — Task 5
- [x] EditSection button active state — Task 5
- [x] Scene tabs always-visible in edit mode — Task 6
- [x] Pad gestures suppressed in edit mode — Task 8 (spreading empty object instead of gestureHandlers)
- [x] Pad visual treatment (dashed border) in edit mode — Task 8
- [x] Edit overlay: pad name + layer count + 3 buttons — Task 8
- [x] Edit button → opens drawer — Tasks 8 + 12
- [x] Duplicate button → duplicatePad — Task 8
- [x] Delete button → confirm → deletePad — Tasks 7 + 8
- [x] PadConfigSchema uses `layers` array — Task 2
- [x] `padId` prop on PadConfigDrawer to distinguish create/edit — Task 11
- [x] Multi-layer accordion display — Tasks 10 + 11
- [x] Add/remove layers in both modes — Task 10
- [x] Drag-and-drop reorder — Task 10
- [x] `deletePad` + `duplicatePad` in projectStore — Task 3
- [x] `sceneId` passed to PadButton — Task 12
