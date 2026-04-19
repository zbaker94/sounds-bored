# Pad Back-Face Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the context popover + PadConfigDrawer with a unified back-face editing surface so right-clicking a pad flips it to its edit side, which contains all runtime controls and inline structural editing.

**Architecture:** The pad's CSS flip animation now triggers both for global `editMode` (all pads) and for a new `editingPadId` field in `uiStore` (single pad, right-click). The back face hosts a new `PadBackFace` component that combines the existing runtime controls (play/stop/fade/layers) with direct-save structural editing (name, color, add/remove layers). Per-layer sound-selection and playback config live in a new `LayerConfigDialog` opened from the back face. No drawer, no popover.

**Tech Stack:** React 19, TypeScript strict, Zustand, Immer, react-hook-form + zod, shadcn/ui, HugeIcons, Vitest + Testing Library

---

## File Map

### New files
| Path | Purpose |
|------|---------|
| `src/components/composite/SceneView/PadBackFace.tsx` | The entire edit surface rendered on the back face. Owns direct `updatePad` calls. |
| `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx` | Single-layer form dialog (sound selection, playback config). Wraps existing `LayerConfigSection`. |

### Modified files
| Path | Changes |
|------|---------|
| `src/state/uiStore.ts` | Add `editingPadId`, `setEditingPadId`. Remove `padPopoverOpenId`, `setPadPopoverOpenId`, `OVERLAY_ID.PAD_CONFIG_DRAWER`. Add `OVERLAY_ID.LAYER_CONFIG_DIALOG`. |
| `src/state/projectStore.ts` | `addPad` accepts optional third param `id?: string` to support pre-generated UUIDs. |
| `src/components/composite/SceneView/PadButton.tsx` | Remove all Popover/Drawer/PadControlContent code. Right-click → `setEditingPadId`. Flip on `editMode || editingPadId === pad.id`. Click-outside closes individual flip. Back face renders `<PadBackFace>`. |
| `src/components/composite/SceneView/SceneView.tsx` | Remove `editingPad` state, `handleEditClick`, `PadConfigDrawer`. Add-pad buttons call `handleAddPad` which pre-generates ID, calls `addPad`, sets `editingPadId`. |
| `src/hooks/useGlobalHotkeys.ts` | Replace `padPopoverOpenId` guards with `editingPadId`. Rewrite `mod+shift+n` to call `addPad` + `setEditingPadId`. |
| `src/state/uiStore.test.ts` | Add tests for `editingPadId` / `setEditingPadId`. |
| `src/hooks/useGlobalHotkeys.test.ts` | Replace `padPopoverOpenId` references with `editingPadId`. |
| `src/components/composite/SceneView/PadButton.test.tsx` | Update mocks; add tests for right-click flip, click-outside close. |
| `src/components/composite/SceneView/SceneView.test.tsx` | Update add-pad flow tests to match new back-face flip behaviour. |

### Deleted files
| Path | Reason |
|------|--------|
| `src/components/composite/SceneView/PadControlContent.tsx` | Replaced by `PadBackFace` |
| `src/components/composite/SceneView/PadControlContent.test.tsx` | No longer relevant |
| `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` | Replaced by back-face inline editing |
| `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx` | No longer relevant |
| `src/components/composite/PadConfigDrawer/LayerAccordion.tsx` | Not used after drawer deletion |
| `src/components/composite/PadConfigDrawer/LayerAccordion.test.tsx` | No longer relevant |

### Unchanged files (still needed)
- `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx` — reused inside `LayerConfigDialog`
- `src/components/composite/PadConfigDrawer/SoundSelector.tsx` — reused inside `LayerConfigSection`
- `src/components/composite/PadConfigDrawer/constants.ts` — `createDefaultLayer()` reused
- `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx` — unchanged
- `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx` — unchanged

---

## Task 1: Extend `projectStore.addPad` to accept an optional pre-supplied ID

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

The add-pad flow needs to call `addPad` and then immediately set `editingPadId` to the new pad's ID. Currently `addPad` generates the UUID internally. We need to thread it out by accepting an optional `id` param.

- [ ] **Step 1: Write the failing test**

Add to the `addPad` describe block in `src/state/projectStore.test.ts`:

```typescript
it("uses the supplied id when provided", () => {
  const { loadProject, addPad } = useProjectStore.getState();
  const project = createMockProject({ scenes: [createMockScene({ id: "scene-1", pads: [] })] });
  const entry = createMockHistoryEntry();
  loadProject(entry, project, false);

  const layer = createMockLayer();
  addPad("scene-1", {
    name: "Test",
    layers: [layer],
    muteTargetPadIds: [],
    fadeLowVol: 0,
    fadeHighVol: 1,
  }, "my-custom-id");

  const pads = useProjectStore.getState().project!.scenes[0].pads;
  expect(pads[0].id).toBe("my-custom-id");
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/state/projectStore.test.ts
```

Expected: TypeScript error — third argument not accepted.

- [ ] **Step 3: Update the `ProjectActions` interface and implementation**

In `src/state/projectStore.ts`, change the `addPad` signature and implementation:

```typescript
// In ProjectActions interface (around line 36):
addPad: (sceneId: string, config: PadConfig, id?: string) => void;

// In the implementation (around line 145):
addPad: (sceneId, config, id) =>
  set((draft) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const newPad: Pad = {
      id: id ?? crypto.randomUUID(),
      ...config,
    };
    scene.pads.push(newPad);
    draft.isDirty = true;
  }),
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/state/projectStore.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "feat: allow addPad to accept a pre-supplied pad ID"
```

---

## Task 2: Update `uiStore` — add `editingPadId`, remove popover state, add `LAYER_CONFIG_DIALOG`

**Files:**
- Modify: `src/state/uiStore.ts`
- Modify: `src/state/uiStore.test.ts`

`padPopoverOpenId` tracked which pad had its right-click popover open so hotkeys could guard against firing. The new `editingPadId` fills the same role but also drives the individual-pad flip.

- [ ] **Step 1: Write failing tests**

Add to `src/state/uiStore.test.ts`:

```typescript
describe("editingPadId", () => {
  it("starts as null", () => {
    expect(useUiStore.getState().editingPadId).toBeNull();
  });

  it("setEditingPadId sets the id", () => {
    useUiStore.getState().setEditingPadId("pad-123");
    expect(useUiStore.getState().editingPadId).toBe("pad-123");
  });

  it("setEditingPadId(null) clears it", () => {
    useUiStore.getState().setEditingPadId("pad-123");
    useUiStore.getState().setEditingPadId(null);
    expect(useUiStore.getState().editingPadId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/state/uiStore.test.ts
```

Expected: FAIL — `editingPadId` undefined.

- [ ] **Step 3: Update `uiStore.ts`**

Replace the full file content. Key changes:
- Remove `padPopoverOpenId` from state interface and initial state
- Remove `setPadPopoverOpenId` from actions interface
- Add `editingPadId` to state interface and initial state
- Add `setEditingPadId` to actions interface
- Add `OVERLAY_ID.LAYER_CONFIG_DIALOG`
- Remove `OVERLAY_ID.PAD_CONFIG_DRAWER`

```typescript
import { create } from "zustand";

export type OverlayType = "drawer" | "dialog";

export interface OverlayEntry {
  id: string;
  type: OverlayType;
}

/** Canonical IDs for all tracked overlays. Use these instead of bare string literals. */
export const OVERLAY_ID = {
  MENU_DRAWER: "menu-drawer",
  SOUNDS_PANEL: "sounds-panel",
  SAVE_PROJECT_DIALOG: "save-project-dialog",
  CONFIRM_NAVIGATE_DIALOG: "confirm-navigate-dialog",
  CONFIRM_CLOSE_DIALOG: "confirm-close-dialog",
  SETTINGS_DIALOG: "settings-dialog",
  EXPORT_PROGRESS_DIALOG: "export-progress-dialog",
  CONFIRM_REMOVE_MISSING_SOUNDS: "confirm-remove-missing-sounds",
  CONFIRM_REMOVE_MISSING_FOLDERS: "confirm-remove-missing-folders",
  LAYER_CONFIG_DIALOG: "layer-config-dialog",
} as const;

interface UiState {
  overlayStack: OverlayEntry[];
  editMode: boolean;
  activeSceneId: string | null;
  hoveredPadId: string | null;
  /** The pad whose back face is currently shown individually (right-click flip). */
  editingPadId: string | null;
}

interface UiActions {
  openOverlay: (id: string, type: OverlayType) => void;
  closeOverlay: (id: string) => void;
  toggleOverlay: (id: string, type: OverlayType) => void;
  isOverlayOpen: (id: string) => boolean;
  isTopOverlay: (id: string) => boolean;
  hasOpenOverlay: () => boolean;
  toggleEditMode: () => void;
  setHoveredPadId: (id: string | null) => void;
  /** Set the pad whose back face is individually flipped, or null to restore. */
  setEditingPadId: (id: string | null) => void;
  setActiveSceneId: (id: string | null) => void;
}

export type UiStore = UiState & UiActions;

export const initialUiState: UiState = {
  overlayStack: [],
  editMode: false,
  activeSceneId: null,
  hoveredPadId: null,
  editingPadId: null,
};

export const useUiStore = create<UiStore>()((set, get) => ({
  ...initialUiState,

  openOverlay: (id, type) =>
    set((state) => {
      if (state.overlayStack.some((entry) => entry.id === id)) return state;
      return { overlayStack: [...state.overlayStack, { id, type }] };
    }),

  closeOverlay: (id) =>
    set((state) => {
      if (!state.overlayStack.some((entry) => entry.id === id)) return state;
      return { overlayStack: state.overlayStack.filter((entry) => entry.id !== id) };
    }),

  toggleOverlay: (id, type) =>
    set((state) => {
      if (state.overlayStack.some((entry) => entry.id === id)) {
        return { overlayStack: state.overlayStack.filter((entry) => entry.id !== id) };
      }
      return { overlayStack: [...state.overlayStack, { id, type }] };
    }),

  isOverlayOpen: (id) => get().overlayStack.some((entry) => entry.id === id),

  isTopOverlay: (id) => {
    const { overlayStack } = get();
    return overlayStack.length > 0 && overlayStack[overlayStack.length - 1].id === id;
  },

  hasOpenOverlay: () => get().overlayStack.length > 0,

  toggleEditMode: () =>
    set((state) => ({ editMode: !state.editMode })),

  setHoveredPadId: (id) => set({ hoveredPadId: id }),

  setEditingPadId: (id) => set({ editingPadId: id }),

  setActiveSceneId: (id) => set({ activeSceneId: id }),
}));

export const selectIsOverlayOpen = (id: string) => (s: UiStore) =>
  s.overlayStack.some((entry) => entry.id === id);

export const selectIsTopOverlay = (id: string) => (s: UiStore) =>
  s.overlayStack.at(-1)?.id === id;

export const selectHasOpenOverlay = (s: UiStore) =>
  s.overlayStack.length > 0;
```

- [ ] **Step 4: Run tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/state/uiStore.test.ts
```

Expected: All pass. (TypeScript will fail on files that still reference `padPopoverOpenId` — that's OK for now, we'll fix them in subsequent tasks.)

- [ ] **Step 5: Commit**

```bash
git add src/state/uiStore.ts src/state/uiStore.test.ts
git commit -m "feat: replace padPopoverOpenId with editingPadId in uiStore"
```

---

## Task 3: Update `useGlobalHotkeys` — replace `padPopoverOpenId` guards, rewrite `mod+shift+n`

**Files:**
- Modify: `src/hooks/useGlobalHotkeys.ts`
- Modify: `src/hooks/useGlobalHotkeys.test.ts`

`padPopoverOpenId` was used as a "user is actively interacting with a pad UI, don't also fire hotkeys" guard. `editingPadId` serves the same role. The `mod+shift+n` shortcut used to open the `PadConfigDrawer`; it now calls `addPad` + `setEditingPadId`.

- [ ] **Step 1: Update the test mock state**

In `src/hooks/useGlobalHotkeys.test.ts`, find the `mockUiState` object (around line 37) and make these replacements:

Replace:
```typescript
padPopoverOpenId: null as string | null,
```
With:
```typescript
editingPadId: null as string | null,
```

Find all test lines that set `mockUiState.padPopoverOpenId` and replace with `mockUiState.editingPadId`. There are two locations (around lines 107 and 149).

- [ ] **Step 2: Run the test file to confirm failures**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/hooks/useGlobalHotkeys.test.ts
```

Expected: TypeScript/runtime errors on `padPopoverOpenId`.

- [ ] **Step 3: Update `useGlobalHotkeys.ts`**

There are four changes needed:

**3a. Remove `OVERLAY_ID.PAD_CONFIG_DRAWER` import** — it no longer exists. Update the OVERLAY_ID import to only import what's still used. Add an import for `createDefaultLayer` from `@/components/composite/PadConfigDrawer/constants`.

**3b. F hotkey** (around line 98–119): Replace `padPopoverOpenId` with `editingPadId`:

```typescript
useHotkeys("f", () => {
  const { editMode, hoveredPadId, editingPadId } = useUiStore.getState();
  if (useMultiFadeStore.getState().active) return;

  if (editMode) {
    exitEditModeWithHover(hoveredPadId);
    return;
  }

  if (hoveredPadId && !editingPadId) {
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const pad = pads.find((p) => p.id === hoveredPadId);
    if (!pad) return;
    const globalFadeDurationMs = useAppSettingsStore.getState().settings?.globalFadeDurationMs;
    const duration = resolveFadeDuration(pad, globalFadeDurationMs);
    fadePadWithLevels(pad, duration).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Playback error: audio fade failed — ${message}`);
    });
  }
}, { enableOnFormTags: true });
```

**3c. X hotkey** (around line 133–148): Same replacement:

```typescript
useHotkeys("x", () => {
  const { editMode, hoveredPadId, editingPadId } = useUiStore.getState();
  if (useMultiFadeStore.getState().active) return;

  if (editMode) {
    exitEditModeWithHover(hoveredPadId);
    return;
  }

  if (hoveredPadId && !editingPadId) {
    const pads = useProjectStore.getState().project?.scenes.flatMap((s) => s.pads) ?? [];
    const pad = pads.find((p) => p.id === hoveredPadId);
    useMultiFadeStore.getState().enterMultiFade(hoveredPadId, pad?.fadeLowVol ?? 0, pad?.fadeHighVol ?? 1);
  }
}, { enableOnFormTags: true });
```

**3d. `mod+shift+n` hotkey** (around line 150–157): Replace drawer-open with add-pad + flip:

```typescript
import { createDefaultLayer } from "@/components/composite/PadConfigDrawer/constants";
import type { PadConfig } from "@/lib/schemas";

// ...

useHotkeys("mod+shift+n", () => {
  const { project, addPad } = useProjectStore.getState();
  const { activeSceneId, setEditingPadId } = useUiStore.getState();
  if (!activeSceneId || !project?.scenes.some((s) => s.id === activeSceneId)) return;
  const newId = crypto.randomUUID();
  const config: PadConfig = {
    name: "",
    layers: [createDefaultLayer()],
    muteTargetPadIds: [],
    fadeLowVol: 0,
    fadeHighVol: 1,
  };
  addPad(activeSceneId, config, newId);
  setEditingPadId(newId);
});
```

- [ ] **Step 4: Run tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/hooks/useGlobalHotkeys.test.ts
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalHotkeys.ts src/hooks/useGlobalHotkeys.test.ts
git commit -m "feat: replace padPopoverOpenId with editingPadId in hotkeys, rewrite mod+shift+n add-pad"
```

---

## Task 4: Build `LayerConfigDialog`

**Files:**
- Create: `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx`
- Create: `src/components/composite/PadConfigDrawer/LayerConfigDialog.test.tsx`

A modal dialog for editing one layer's full configuration (sound selection, arrangement, playback mode, retrigger mode, volume). Uses react-hook-form + zod like the old drawer. On Save, calls `updatePad` with the updated layer merged back into the pad. On Cancel, discards. Registers itself in the overlay stack so `PadButton`'s click-outside handler won't close the back face while the dialog is open.

- [ ] **Step 1: Write the failing test**

Create `src/components/composite/PadConfigDrawer/LayerConfigDialog.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { LayerConfigDialog } from "./LayerConfigDialog";

vi.mock("./SoundSelector", () => ({
  SoundSelector: () => <div data-testid="sound-selector" />,
}));

function loadPad(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1", volume: 80 });
  const pad = createMockPad({ id: "pad-1", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const project = createMockProject({ scenes: [scene] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, project, false);
  return { pad, layer };
}

describe("LayerConfigDialog", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
  });

  it("renders when open", () => {
    const { pad, layer } = loadPad();
    useUiStore.getState().openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
    render(
      <LayerConfigDialog
        pad={pad}
        sceneId="scene-1"
        layerIndex={0}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Edit Layer")).toBeInTheDocument();
  });

  it("calls updatePad and onClose when saved", async () => {
    const { pad } = loadPad();
    const onClose = vi.fn();
    useUiStore.getState().openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
    render(
      <LayerConfigDialog
        pad={pad}
        sceneId="scene-1"
        layerIndex={0}
        onClose={onClose}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /save layer/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const pads = useProjectStore.getState().project!.scenes[0].pads;
    expect(pads[0].layers[0].id).toBe("layer-1");
  });

  it("calls onClose without saving when cancelled", async () => {
    const { pad } = loadPad();
    const onClose = vi.fn();
    useUiStore.getState().openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
    render(
      <LayerConfigDialog
        pad={pad}
        sceneId="scene-1"
        layerIndex={0}
        onClose={onClose}
      />
    );

    const updatePad = vi.spyOn(useProjectStore.getState(), "updatePad");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updatePad).not.toHaveBeenCalled();
  });

  it("registers and removes itself from the overlay stack", () => {
    const { pad } = loadPad();
    useUiStore.getState().openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
    const { unmount } = render(
      <LayerConfigDialog
        pad={pad}
        sceneId="scene-1"
        layerIndex={0}
        onClose={vi.fn()}
      />
    );
    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG)).toBe(true);
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/PadConfigDrawer/LayerConfigDialog.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `LayerConfigDialog.tsx`**

Create `src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx`:

```typescript
import { useEffect } from "react";
import { useForm, FormProvider, type Resolver, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { Pad, PadConfig, PadConfigForm, LayerConfigForm, Layer } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LayerConfigSection } from "./LayerConfigSection";
import { filterSoundsByTags } from "@/lib/audio/resolveSounds";
import { syncLayerConfig, syncLayerVolume } from "@/lib/audio/padPlayer";
import { getLayerNormalizedVolume } from "@/lib/audio/layerTrigger";
import { createDefaultLayer } from "./constants";

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

function padToConfig(pad: Pad, layers: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    fadeLowVol: pad.fadeLowVol ?? 0,
    fadeHighVol: pad.fadeHighVol ?? 1,
  };
}

interface LayerConfigDialogProps {
  pad: Pad;
  sceneId: string;
  layerIndex: number;
  onClose: () => void;
}

export function LayerConfigDialog({ pad, sceneId, layerIndex, onClose }: LayerConfigDialogProps) {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.LAYER_CONFIG_DIALOG));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const updatePad = useProjectStore((s) => s.updatePad);

  const layer = pad.layers[layerIndex];

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema) as Resolver<PadConfigForm>,
    defaultValues: {
      name: pad.name,
      layers: [
        layer
          ? {
              id: layer.id,
              selection: layer.selection as LayerConfigForm["selection"],
              arrangement: layer.arrangement,
              cycleMode: layer.cycleMode,
              playbackMode: layer.playbackMode,
              retriggerMode: layer.retriggerMode,
              volume: layer.volume,
            }
          : createDefaultLayer(),
      ],
      fadeDurationMs: pad.fadeDurationMs,
      fadeLowVol: pad.fadeLowVol ?? 0,
      fadeHighVol: pad.fadeHighVol ?? 1,
    },
  });

  const { handleSubmit, reset, setError } = methods;

  // Re-populate form when the target layer changes (e.g. editing a different layer).
  useEffect(() => {
    if (!isOpen || !layer) return;
    reset({
      name: pad.name,
      layers: [
        {
          id: layer.id,
          selection: layer.selection as LayerConfigForm["selection"],
          arrangement: layer.arrangement,
          cycleMode: layer.cycleMode,
          playbackMode: layer.playbackMode,
          retriggerMode: layer.retriggerMode,
          volume: layer.volume,
        },
      ],
      fadeDurationMs: pad.fadeDurationMs,
      fadeLowVol: pad.fadeLowVol ?? 0,
      fadeHighVol: pad.fadeHighVol ?? 1,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, layer?.id]);

  function handleClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    onClose();
  }

  function onSubmit(data: PadConfigForm) {
    const sounds = useLibraryStore.getState().sounds;
    const sel = data.layers[0].selection;

    if (sel.type === "tag") {
      if (filterSoundsByTags(sounds, sel.tagIds, sel.matchMode).length === 0) {
        const field: FieldPath<PadConfigForm> = `layers.0.selection.tagIds`;
        setError(field, { type: "manual", message: "No sounds in library match these tags" });
        return;
      }
    } else if (sel.type === "set") {
      if (sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath).length === 0) {
        const field: FieldPath<PadConfigForm> = `layers.0.selection.setId`;
        setError(field, { type: "manual", message: "No sounds in library match this set" });
        return;
      }
    }

    const updatedLayer = toLayer(data.layers[0]);
    const newLayers = pad.layers.map((l, i) => (i === layerIndex ? updatedLayer : l));
    updatePad(sceneId, pad.id, padToConfig(pad, newLayers));

    syncLayerVolume(updatedLayer.id, getLayerNormalizedVolume(updatedLayer));
    if (layer) syncLayerConfig(updatedLayer, layer);

    handleClose();
  }

  if (!layer) return null;

  return (
    <FormProvider {...methods}>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Layer</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <LayerConfigSection index={0} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleSubmit(onSubmit)}>Save Layer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormProvider>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/PadConfigDrawer/LayerConfigDialog.test.tsx
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerConfigDialog.tsx src/components/composite/PadConfigDrawer/LayerConfigDialog.test.tsx
git commit -m "feat: add LayerConfigDialog for inline per-layer editing"
```

---

## Task 5: Build `PadBackFace`

**Files:**
- Create: `src/components/composite/SceneView/PadBackFace.tsx`
- Create: `src/components/composite/SceneView/PadBackFace.test.tsx`

This component is the full edit surface for the back face of a pad. It combines:
- Runtime controls: play/stop, fade in/out, synchronized fades
- Structural editing: name input, color picker, layers list with add/remove/edit, fade sliders
All structural changes call `updatePad` directly (auto-save on change/blur, no Save/Cancel on the outer surface). The `LayerConfigDialog` is mounted here and opened when a layer's Edit button is clicked.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/SceneView/PadBackFace.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState } from "@/state/uiStore";
import { createMockPad, createMockLayer, createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadBackFace } from "./PadBackFace";

vi.mock("@/lib/audio/padPlayer", () => ({
  triggerPad: vi.fn().mockResolvedValue(undefined),
  stopPad: vi.fn(),
  fadePadWithLevels: vi.fn().mockResolvedValue(undefined),
  triggerLayer: vi.fn().mockResolvedValue(undefined),
  stopLayerWithRamp: vi.fn(),
  setLayerVolume: vi.fn(),
  setPadVolume: vi.fn(),
  skipLayerForward: vi.fn(),
  skipLayerBack: vi.fn(),
  syncLayerConfig: vi.fn(),
  syncLayerVolume: vi.fn(),
}));

vi.mock("../PadConfigDrawer/LayerConfigDialog", () => ({
  LayerConfigDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="layer-config-dialog">
      <button onClick={onClose}>Close Dialog</button>
    </div>
  ),
}));

function loadPad(padOverrides = {}) {
  const layer = createMockLayer({ id: "layer-1" });
  const pad = createMockPad({ id: "pad-1", name: "Kick", layers: [layer], ...padOverrides });
  const scene = createMockScene({ id: "scene-1", pads: [pad] });
  const project = createMockProject({ scenes: [scene] });
  const entry = createMockHistoryEntry();
  useProjectStore.getState().loadProject(entry, project, false);
  return { pad, layer };
}

describe("PadBackFace", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });
  });

  it("renders pad name in an input", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByDisplayValue("Kick")).toBeInTheDocument();
  });

  it("saves name on blur", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    const input = screen.getByDisplayValue("Kick");
    await userEvent.clear(input);
    await userEvent.type(input, "Snare");
    fireEvent.blur(input);

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.name).toBe("Snare");
    });
  });

  it("renders a layer row for each layer", () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
  });

  it("opens LayerConfigDialog when a layer's edit button is clicked", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /edit layer 1/i }));
    expect(screen.getByTestId("layer-config-dialog")).toBeInTheDocument();
  });

  it("adds a new layer when Add Layer is clicked", async () => {
    const { pad } = loadPad();
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /add layer/i }));

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.layers).toHaveLength(2);
    });
  });

  it("removes a layer when remove is clicked (disabled if only 1 layer)", async () => {
    const layer1 = createMockLayer({ id: "layer-1" });
    const layer2 = createMockLayer({ id: "layer-2" });
    const { pad } = loadPad({ layers: [layer1, layer2] });
    render(<PadBackFace pad={pad} sceneId="scene-1" onMultiFade={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /remove layer 1/i }));

    await waitFor(() => {
      const updatedPad = useProjectStore.getState().project!.scenes[0].pads[0];
      expect(updatedPad.layers).toHaveLength(1);
      expect(updatedPad.layers[0].id).toBe("layer-2");
    });
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/PadBackFace.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `PadBackFace.tsx`**

Create `src/components/composite/SceneView/PadBackFace.tsx`:

```typescript
import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useHotkeys } from "react-hotkeys-hook";
import type { Pad, Layer, PadConfig, Sound } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
  NextIcon,
  PreviousIcon,
  ListMusicIcon,
  PencilEdit01Icon,
  Cancel01Icon,
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { usePlaybackStore } from "@/state/playbackStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import {
  triggerPad, stopPad, fadePadWithLevels,
  triggerLayer, stopLayerWithRamp, setLayerVolume, setPadVolume,
  skipLayerForward, skipLayerBack,
} from "@/lib/audio/padPlayer";
import { resolveLayerSounds } from "@/lib/audio/resolveSounds";
import { getLayerNormalizedVolume } from "@/lib/audio/layerTrigger";
import { createDefaultLayer } from "@/components/composite/PadConfigDrawer/constants";
import { LayerConfigDialog } from "@/components/composite/PadConfigDrawer/LayerConfigDialog";
import { ConfirmDeletePadDialog } from "@/components/modals/ConfirmDeletePadDialog";
import { toast } from "sonner";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padToConfig(pad: Pad, layers?: Layer[]): PadConfig {
  return {
    name: pad.name,
    layers: layers ?? pad.layers,
    muteTargetPadIds: pad.muteTargetPadIds,
    muteGroupId: pad.muteGroupId,
    color: pad.color,
    icon: pad.icon,
    fadeDurationMs: pad.fadeDurationMs,
    fadeLowVol: pad.fadeLowVol ?? 0,
    fadeHighVol: pad.fadeHighVol ?? 1,
  };
}

// ─── BackFaceLayerRow ─────────────────────────────────────────────────────────

const BackFaceLayerRow = memo(function BackFaceLayerRow({
  pad,
  layer,
  index,
  sceneId,
  canRemove,
  onEditLayer,
  onRemoveLayer,
}: {
  pad: Pad;
  layer: Layer;
  index: number;
  sceneId: string;
  canRemove: boolean;
  onEditLayer: () => void;
  onRemoveLayer: () => void;
}) {
  const layerActive = usePlaybackStore((s) => s.activeLayerIds.has(layer.id));
  const layerVol = usePlaybackStore(
    (s) => Math.round((s.layerVolumes[layer.id] ?? getLayerNormalizedVolume(layer)) * 100)
  );
  const [localLayerVol, setLocalLayerVol] = useState<number | null>(null);
  const sliderVol = localLayerVol ?? layerVol;

  const sounds = useLibraryStore((s) => s.sounds);
  const allSounds = useMemo(() => resolveLayerSounds(layer, sounds), [layer, sounds]);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  const isChained = layer.arrangement === "sequential" || layer.arrangement === "shuffled";
  const [listOpen, setListOpen] = useState(false);
  const listAnchorRef = useRef<HTMLButtonElement>(null);

  const selectionSummary = (() => {
    const sel = layer.selection;
    switch (sel.type) {
      case "assigned":
        return allSounds.length === 0
          ? "No sounds assigned"
          : allSounds.map((s) => s.name).join(", ");
      case "tag": {
        const names = sel.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id).join(", ");
        return `Tag: ${names || "—"}`;
      }
      case "set": {
        const name = sets.find((s) => s.id === sel.setId)?.name ?? sel.setId;
        return `Set: ${name}`;
      }
    }
  })();

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-1.5">
      {/* Row: status dot | name | play | skip | edit | remove */}
      <div className="flex items-center gap-1">
        <span className={`text-xs ${layerActive ? "text-emerald-400" : "text-muted-foreground"}`}>
          {layerActive ? "●" : "○"}
        </span>
        <span className="text-xs font-medium flex-1 truncate">Layer {index + 1}</span>

        <AnimatePresence mode="wait">
          {layerActive ? (
            <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => stopLayerWithRamp(pad, layer.id)}
                className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Stop layer ${index + 1}`}
              >
                <HugeiconsIcon icon={StopIcon} size={12} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              <button
                type="button"
                onClick={() => triggerLayer(pad, layer).catch((err: unknown) => {
                  toast.error(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
                })}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label={`Play layer ${index + 1}`}
              >
                <HugeiconsIcon icon={PlayIcon} size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {isChained && (
          <>
            <button
              type="button"
              onClick={() => skipLayerBack(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip back"
            >
              <HugeiconsIcon icon={PreviousIcon} size={12} />
            </button>
            <button
              type="button"
              onClick={() => skipLayerForward(pad, layer.id)}
              className="p-0.5 rounded hover:bg-muted transition-colors"
              aria-label="Skip forward"
            >
              <HugeiconsIcon icon={NextIcon} size={12} />
            </button>
          </>
        )}

        {/* Sound list popover */}
        {allSounds.length > 1 && (
          <>
            <button
              ref={listAnchorRef}
              type="button"
              aria-label="Show sound list"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setListOpen((o) => !o)}
              className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
            >
              <HugeiconsIcon icon={ListMusicIcon} size={12} />
            </button>
            <Popover open={listOpen} onOpenChange={setListOpen}>
              <PopoverAnchor virtualRef={listAnchorRef as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
              <PopoverContent side="top" sideOffset={6} className="w-48 p-2">
                <ol className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                  {allSounds.map((s, i) => (
                    <li key={s.id} className="text-xs py-0.5 text-muted-foreground">{i + 1}. {s.name}</li>
                  ))}
                </ol>
              </PopoverContent>
            </Popover>
          </>
        )}

        <button
          type="button"
          aria-label={`Edit layer ${index + 1}`}
          onClick={onEditLayer}
          className="p-0.5 rounded hover:bg-muted transition-colors"
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
        </button>

        <button
          type="button"
          aria-label={`Remove layer ${index + 1}`}
          onClick={onRemoveLayer}
          disabled={!canRemove}
          className="p-0.5 rounded hover:bg-destructive/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
        </button>
      </div>

      {/* Sound selection summary */}
      <p className="text-xs text-muted-foreground truncate px-1">{selectionSummary}</p>

      {/* Layer volume slider */}
      <Slider
        compact
        tooltipLabel={(v) => `${v}%`}
        value={[sliderVol]}
        onValueChange={([v]) => { setLocalLayerVol(v); setLayerVolume(layer.id, v / 100); }}
        onValueCommit={([v]) => { setLocalLayerVol(null); useProjectStore.getState().updateLayerVolume(layer.id, v / 100); }}
        min={0}
        max={100}
        step={1}
      />
    </div>
  );
});

// ─── PadBackFace ─────────────────────────────────────────────────────────────

export interface PadBackFaceProps {
  pad: Pad;
  sceneId: string;
  onMultiFade: () => void;
}

export const PadBackFace = memo(function PadBackFace({ pad, sceneId, onMultiFade }: PadBackFaceProps) {
  const updatePad = useProjectStore((s) => s.updatePad);
  const duplicatePad = useProjectStore((s) => s.duplicatePad);
  const deletePad = useProjectStore((s) => s.deletePad);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const isFadingOut = usePlaybackStore((s) => s.fadingOutPadIds.has(pad.id));
  const enterMultiFade = useMultiFadeStore((s) => s.enterMultiFade);
  const globalFadeDurationMs = useAppSettingsStore((s) => s.settings?.globalFadeDurationMs ?? 2000);
  const fadeDuration = pad.fadeDurationMs ?? globalFadeDurationMs;

  // Pad name — local state while typing, saved to store on blur
  const [localName, setLocalName] = useState(pad.name);
  useEffect(() => { setLocalName(pad.name); }, [pad.name]);

  function handleNameBlur() {
    const trimmed = localName.trim();
    if (trimmed === pad.name) return;
    updatePad(sceneId, pad.id, padToConfig(pad, undefined));
    // We need to re-read pad from store to get the current layers etc.
    // Directly pass trimmed name:
    updatePad(sceneId, pad.id, { ...padToConfig(pad), name: trimmed });
  }

  // Fade levels — same pattern as PadControlContent
  const [fadeLevels, setFadeLevels] = useState<[number, number]>(() => [
    Math.round((pad.fadeLowVol ?? 0) * 100),
    Math.round((pad.fadeHighVol ?? 1) * 100),
  ]);
  const startThumbDraggingRef = useRef(false);
  const setPadFadeLevels = useProjectStore((s) => s.setPadFadeLevels);

  useEffect(() => {
    if (!isPlaying) {
      setFadeLevels([
        Math.round((pad.fadeLowVol ?? 0) * 100),
        Math.round((pad.fadeHighVol ?? 1) * 100),
      ]);
    }
  }, [isPlaying, pad.fadeLowVol, pad.fadeHighVol]);

  useEffect(() => {
    const handlePointerUp = () => { startThumbDraggingRef.current = false; };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  // Layer config dialog
  const [editingLayerIndex, setEditingLayerIndex] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function handleEditLayer(index: number) {
    setEditingLayerIndex(index);
    openOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG, "dialog");
  }

  function handleLayerDialogClose() {
    closeOverlay(OVERLAY_ID.LAYER_CONFIG_DIALOG);
    setEditingLayerIndex(null);
  }

  function handleAddLayer() {
    const newLayer = createDefaultLayer();
    const newLayers = [...pad.layers, newLayer];
    updatePad(sceneId, pad.id, padToConfig(pad, newLayers));
    // Open the new layer's dialog immediately
    handleEditLayer(newLayers.length - 1);
  }

  function handleRemoveLayer(index: number) {
    if (pad.layers.length <= 1) return;
    const newLayers = pad.layers.filter((_, i) => i !== index);
    updatePad(sceneId, pad.id, padToConfig(pad, newLayers));
  }

  const handleStartStop = useCallback(() => {
    if (isPlaying) {
      stopPad(pad);
    } else {
      triggerPad(pad).catch((err: unknown) => {
        toast.error(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [isPlaying, pad]);

  const handleFade = useCallback(() => {
    fadePadWithLevels(pad, fadeDuration).catch((err: unknown) => {
      toast.error(`Playback error: audio fade failed — ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [pad, fadeDuration]);

  const handleMultiFade = useCallback(() => {
    enterMultiFade(pad.id, pad.fadeLowVol ?? 0, pad.fadeHighVol ?? 1);
    onMultiFade();
  }, [pad, enterMultiFade, onMultiFade]);

  // F/X hotkeys are active on the back face too
  useHotkeys("f", handleFade, { enableOnFormTags: true });
  useHotkeys("x", handleMultiFade, { enableOnFormTags: true });

  return (
    <>
      <div className="w-full h-full p-2 flex flex-col gap-2 overflow-y-auto text-xs">
        {/* ── Header: color + name + duplicate + delete ── */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            type="color"
            value={pad.color ?? "#1a1a2e"}
            onChange={(e) => updatePad(sceneId, pad.id, { ...padToConfig(pad), color: e.target.value })}
            className="w-5 h-5 rounded cursor-pointer border border-border flex-shrink-0 p-0"
            aria-label="Pad color"
            title="Pad color"
          />
          <input
            type="text"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameBlur}
            className="flex-1 min-w-0 bg-transparent border-b border-border text-sm font-semibold outline-none focus:border-primary"
            placeholder="Pad name"
            aria-label="Pad name"
          />
          <button
            type="button"
            aria-label="Duplicate pad"
            onClick={() => { duplicatePad(sceneId, pad.id); setEditingPadId(null); }}
            className="p-0.5 rounded hover:bg-muted transition-colors flex-shrink-0"
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </button>
          <button
            type="button"
            aria-label="Delete pad"
            onClick={() => setConfirmingDelete(true)}
            className="p-0.5 rounded hover:bg-destructive/20 transition-colors flex-shrink-0"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </button>
        </div>

        {/* ── Play / Stop ── */}
        <div className="flex-shrink-0">
          <AnimatePresence mode="wait">
            {isPlaying ? (
              <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
                <Button size="sm" variant="destructive" onClick={handleStartStop} className="w-full gap-1.5">
                  <HugeiconsIcon icon={StopIcon} size={14} />Stop
                </Button>
              </motion.div>
            ) : (
              <motion.div key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
                <Button size="sm" variant="default" onClick={handleStartStop} className="w-full gap-1.5">
                  <HugeiconsIcon icon={PlayIcon} size={14} />Start
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Fade ── */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <div className="flex justify-between text-muted-foreground">
            <span>{isPlaying ? "end" : "start"}</span>
            <span>{isPlaying ? "start (current)" : "end"}</span>
          </div>
          <Slider
            tooltipLabel={(v) => `${v}%`}
            value={fadeLevels}
            onValueChange={(v) => {
              const next = v as [number, number];
              if (isPlaying && next[1] !== fadeLevels[1]) setPadVolume(pad.id, next[1] / 100);
              setFadeLevels(next);
            }}
            onPointerUp={() => {
              startThumbDraggingRef.current = false;
              setPadFadeLevels(sceneId, pad.id, fadeLevels[0] / 100, fadeLevels[1] / 100);
            }}
            onThumbPointerDown={(index) => { if (index === 1) startThumbDraggingRef.current = true; }}
            min={0} max={100} step={1}
          />
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Duration</span>
            <span className="tabular-nums">{(fadeDuration / 1000).toFixed(1)}s</span>
          </div>
          <Slider
            compact
            tooltipLabel={(v) => `${(v / 1000).toFixed(1)}s`}
            value={[fadeDuration]}
            onValueChange={([v]) => updatePad(sceneId, pad.id, { ...padToConfig(pad), fadeDurationMs: v })}
            min={100} max={10000} step={100}
          />
          {pad.fadeDurationMs !== undefined ? (
            <button
              type="button"
              className="text-muted-foreground underline self-start"
              onClick={() => updatePad(sceneId, pad.id, { ...padToConfig(pad), fadeDurationMs: undefined })}
            >
              Reset to default
            </button>
          ) : (
            <p className="text-muted-foreground">Global default ({(globalFadeDurationMs / 1000).toFixed(1)}s)</p>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" onClick={handleFade} className="w-full gap-1.5">
                <HugeiconsIcon icon={VolumeHighIcon} size={14} />
                {isPlaying && !isFadingOut ? "Fade Out" : "Fade In"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><Kbd>F</Kbd></TooltipContent>
          </Tooltip>
        </div>

        {/* ── Layers ── */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-muted-foreground uppercase tracking-wide">Layers</h4>
            <button
              type="button"
              aria-label="Add layer"
              onClick={handleAddLayer}
              className="p-0.5 rounded hover:bg-muted transition-colors"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {pad.layers.map((layer, i) => (
              <BackFaceLayerRow
                key={layer.id}
                pad={pad}
                layer={layer}
                index={i}
                sceneId={sceneId}
                canRemove={pad.layers.length > 1}
                onEditLayer={() => handleEditLayer(i)}
                onRemoveLayer={() => handleRemoveLayer(i)}
              />
            ))}
          </div>
        </div>

        {/* ── Synchronized Fades ── */}
        <div className="flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={handleMultiFade} className="bg-yellow-500 w-full text-xs">
                Synchronized Fades
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top"><><Kbd>F</Kbd> / <Kbd>X</Kbd></></TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Layer config dialog (mounted here, opened by layer edit button) ── */}
      {editingLayerIndex !== null && (
        <LayerConfigDialog
          pad={pad}
          sceneId={sceneId}
          layerIndex={editingLayerIndex}
          onClose={handleLayerDialogClose}
        />
      )}

      <ConfirmDeletePadDialog
        isOpen={confirmingDelete}
        padName={pad.name}
        onConfirm={() => {
          setConfirmingDelete(false);
          stopPad(pad);
          deletePad(sceneId, pad.id);
          setEditingPadId(null);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
});
```

- [ ] **Step 4: Run the tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/PadBackFace.test.tsx
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadBackFace.tsx src/components/composite/SceneView/PadBackFace.test.tsx
git commit -m "feat: add PadBackFace inline edit surface"
```

---

## Task 6: Rewrite `PadButton` — remove popover/drawer, add right-click flip, click-outside close

**Files:**
- Modify: `src/components/composite/SceneView/PadButton.tsx`
- Modify: `src/components/composite/SceneView/PadButton.test.tsx`

The pad button now:
1. Right-click → `setEditingPadId(pad.id)` instead of opening a popover
2. Flips to back face when `editMode === true || editingPadId === pad.id`
3. Click-outside (when individually flipped, not global edit mode) → `setEditingPadId(null)`
4. Back face renders `<PadBackFace>` instead of `<PadControlContent>`
5. All Popover/Drawer/PadControlContent code removed

- [ ] **Step 1: Update `PadButton.test.tsx` mocks**

The existing tests mock `PadControlContent` and the Popover/Drawer. Replace those mocks and update tests:

```typescript
// Remove the PadControlContent, Popover, and Drawer mocks entirely.
// Add a mock for PadBackFace:
vi.mock("./PadBackFace", () => ({
  PadBackFace: ({ pad }: { pad: { name: string } }) => (
    <div data-testid="pad-back-face">{pad.name}</div>
  ),
}));
```

Update or remove tests that previously asserted on `data-testid="live-control-popover"` (those tested the popover that no longer exists). Replace with tests for:
- Right-click sets `editingPadId` in uiStore
- The back face appears when `editingPadId === pad.id`
- Click-outside clears `editingPadId`

Example new tests to add:

```typescript
it("right-click sets editingPadId in uiStore", async () => {
  const { pad } = loadPadInStore();
  render(<PadButton pad={pad} sceneId="scene-1" index={0} />);

  const padEl = screen.getByRole("button", { name: "Kick" });
  fireEvent.contextMenu(padEl);

  expect(useUiStore.getState().editingPadId).toBe("pad-1");
});

it("shows PadBackFace when editingPadId matches this pad", () => {
  const { pad } = loadPadInStore();
  useUiStore.setState({ ...initialUiState, editingPadId: "pad-1" });
  render(<PadButton pad={pad} sceneId="scene-1" index={0} />);

  expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
});

it("shows PadBackFace when editMode is true", () => {
  const { pad } = loadPadInStore();
  useUiStore.setState({ ...initialUiState, editMode: true });
  render(<PadButton pad={pad} sceneId="scene-1" index={0} />);

  expect(screen.getByTestId("pad-back-face")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the updated tests to see what breaks**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/PadButton.test.tsx
```

Expected: Multiple failures — references to removed mocks/behaviour.

- [ ] **Step 3: Rewrite `PadButton.tsx`**

The rewritten file removes the Popover, Drawer, and all `PadControlContent` references. Key structural changes:

```typescript
import React, { memo, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "motion/react";
import type { Pad } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { usePlaybackStore } from "@/state/playbackStore";
import { useUiStore } from "@/state/uiStore";
import { useLibraryStore } from "@/state/libraryStore";
import { useMultiFadeStore } from "@/state/multiFadeStore";
import { usePadGesture } from "@/hooks/usePadGesture";
import { usePadVolumeDisplay } from "@/hooks/usePadVolumeDisplay";
import { getPadSoundState } from "@/lib/projectSoundReconcile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { PadBackFace } from "./PadBackFace";
import { PadButtonProgress } from "./PadButtonProgress";
import { PadButtonFadeOverlay } from "./PadButtonFadeOverlay";
import { PAD_FLIP_DURATION_MS, PAD_FLIP_EASE, PAD_STAGGER_MS } from "./padAnimations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PadButtonProps {
  pad: Pad;
  sceneId: string;
  index?: number;
}

const TILT_SPRING = { stiffness: 1200, damping: 80 } as const;

export const PadButton = memo(function PadButton({ pad, sceneId, index = 0 }: PadButtonProps) {
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(pad.id));
  const editMode = useUiStore((s) => s.editMode);
  const editingPadId = useUiStore((s) => s.editingPadId);
  const setEditingPadId = useUiStore((s) => s.setEditingPadId);
  const toggleEditMode = useUiStore((s) => s.toggleEditMode);

  // A pad shows its back face when global editMode OR it's the individually-flipped pad
  const isFlipped = editMode || editingPadId === pad.id;

  const { gestureHandlers, isDragging, dragVolume } = usePadGesture(pad);
  const { showVolumeDisplay, volumeExiting, displayVolume } = usePadVolumeDisplay(pad.id, isDragging, dragVolume);

  const multiFadeActive = useMultiFadeStore((s) => s.active);
  const isMultiFadeSelected = useMultiFadeStore((s) => s.active && s.selectedPads.has(pad.id));
  const toggleMultiFadePad = useMultiFadeStore((s) => s.toggleMultiFadePad);

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging,
  } = useSortable({ id: pad.id, disabled: !editMode });

  const dndStyle = useMemo(() => ({ transform: CSS.Transform.toString(transform), transition }), [transform, transition]);

  // 3D tilt — disabled when flipped or in multi-fade mode
  const tiltEnabled = !isFlipped && !isSortableDragging && !multiFadeActive;
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [4, -4]), TILT_SPRING);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-4, 4]), TILT_SPRING);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!tiltEnabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleMouseLeave() { mouseX.set(0); mouseY.set(0); }
  function handleWrapperPointerDown() { mouseX.set(0); mouseY.set(0); }

  const missingSoundIds = useLibraryStore((s) => s.missingSoundIds);
  const padSoundState = useMemo(() => getPadSoundState(pad, missingSoundIds), [pad, missingSoundIds]);
  const isUnplayable = padSoundState === "disabled";

  const multiFadeHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      toggleMultiFadePad(pad.id, pad.fadeLowVol ?? 0, pad.fadeHighVol ?? 1);
    },
  }), [toggleMultiFadePad, pad.id, pad.fadeLowVol, pad.fadeHighVol]);

  // Right-click: flip this pad to its edit face individually
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (editMode || multiFadeActive || isUnplayable) return;
    setEditingPadId(editingPadId === pad.id ? null : pad.id);
  }, [editMode, multiFadeActive, isUnplayable, editingPadId, pad.id, setEditingPadId]);

  // Click-outside: when individually flipped (not global editMode), clicking
  // outside this pad wrapper clears editingPadId — unless an overlay is open.
  const padWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingPadId !== pad.id || editMode) return;
    function handlePointerDown(e: PointerEvent) {
      if (useUiStore.getState().hasOpenOverlay()) return;
      if (!padWrapperRef.current?.contains(e.target as Node)) {
        setEditingPadId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [editingPadId, pad.id, editMode, setEditingPadId]);

  // Clear hover and editingPadId if this pad unmounts while it owns the slot
  useEffect(() => {
    return () => {
      const { hoveredPadId, editingPadId: currentEditingId, setHoveredPadId, setEditingPadId: clearId } = useUiStore.getState();
      if (hoveredPadId === pad.id) setHoveredPadId(null);
      if (currentEditingId === pad.id) clearId(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad.id]);

  const multiFadeSelectionClass = useMemo(() => {
    if (!isMultiFadeSelected) return null;
    return isPlaying ? "border-amber-400 ring-2 ring-amber-400" : "border-teal-400 ring-2 ring-teal-400";
  }, [isMultiFadeSelected, isPlaying]);

  return (
    <div
      ref={(el) => { setNodeRef(el); (padWrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      style={dndStyle}
      className={cn("relative w-full h-full", isSortableDragging && "opacity-50")}
      {...(editMode ? attributes : {})}
      onMouseEnter={() => useUiStore.getState().setHoveredPadId(pad.id)}
      onMouseLeave={() => useUiStore.getState().setHoveredPadId(null)}
      onPointerDown={(e) => {
        if (editMode && listeners?.onPointerDown) {
          const target = e.target as HTMLElement;
          if (!target.closest("button, input, a, select, textarea")) {
            listeners.onPointerDown(e);
          }
        }
      }}
      onContextMenu={handleContextMenu}
    >
      <motion.div
        className={cn("w-full h-full", isPlaying && !isFlipped && "drop-shadow-[0_5px_0px_#FACC15]")}
        style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 600, transformStyle: "preserve-3d" }}
        whileTap={!isFlipped && !multiFadeActive ? { scale: 0.95 } : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onPointerDown={!isFlipped ? handleWrapperPointerDown : undefined}
      >
        <AnimatePresence>
          {isPlaying && !isFlipped && !multiFadeActive && (
            <motion.div
              key="pulse"
              className="absolute -inset-1 rounded-xl pointer-events-none border-4 border-white/60 z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
              exit={{ opacity: 0, transition: { duration: 0.2, ease: "easeOut" } }}
            />
          )}
        </AnimatePresence>
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateY(${isFlipped ? 180 : 0}deg)`,
            transition: `transform ${PAD_FLIP_DURATION_MS}ms ${PAD_FLIP_EASE} ${index * PAD_STAGGER_MS}ms`,
          }}
        >
          {/* Front face */}
          <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={isFlipped || undefined}>
            <button
              aria-label={pad.name}
              {...(multiFadeActive ? multiFadeHandlers : gestureHandlers)}
              disabled={isUnplayable && !multiFadeActive}
              className={cn(
                "relative w-full h-full rounded-xl overflow-hidden",
                "flex items-center justify-center p-2",
                "bg-card text-card-foreground",
                "shadow-[3px_3px_0px_rgba(0,0,0,0.3)]",
                "text-sm font-semibold text-center select-none",
                isUnplayable && !multiFadeActive
                  ? "opacity-40 border-2 border-black/20"
                  : multiFadeSelectionClass
                    ? cn("border-2 cursor-pointer", multiFadeSelectionClass)
                    : cn("border-2 transition-all cursor-pointer hover:brightness-110",
                        isPlaying ? "border-yellow-400" : "border-black/20")
              )}
              style={{
                backgroundColor: isPlaying ? "#000" : (pad.color ?? undefined),
                transition: "background-color 0.7s ease",
                color: isPlaying ? "#fff" : undefined,
              }}
            >
              {showVolumeDisplay && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 pointer-events-none bg-yellow-500 border-t-2 border-black"
                  style={{ height: `${displayVolume * 100}%` }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: volumeExiting ? 0 : 1 }}
                  transition={{ duration: volumeExiting ? 0.22 : 0.15 }}
                />
              )}
              <PadButtonProgress padId={pad.id} layers={pad.layers} />
              <div className="relative z-10 flex flex-col items-center gap-0.5">
                <span data-testid="pad-name" className="line-clamp-2 break-words leading-tight text-center">{pad.name}</span>
                {showVolumeDisplay && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: volumeExiting ? 0 : 1, height: volumeExiting ? 0 : "auto" }}
                    transition={{ duration: volumeExiting ? 0.22 : 0.2 }}
                    style={{ overflow: "hidden" }}
                    className="flex justify-center"
                  >
                    <span className="text-xs font-bold tabular-nums">{Math.round(displayVolume * 100)}%</span>
                  </motion.div>
                )}
              </div>
              <PadButtonFadeOverlay pad={pad} sceneId={sceneId} />
            </button>
            {padSoundState === "partial" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="absolute bottom-1 right-1 z-20 pointer-events-auto">
                    <HugeiconsIcon icon={Alert02Icon} size={16} className="text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">Some assigned sounds are missing from the library. Right-click the pad to review.</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Back face */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden bg-card [backface-visibility:hidden]"
            style={{ transform: "rotateY(180deg)", backgroundColor: pad.color ?? undefined }}
            aria-hidden={!isFlipped || undefined}
          >
            <PadBackFace
              pad={pad}
              sceneId={sceneId}
              onMultiFade={toggleEditMode}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
});
```

- [ ] **Step 4: Run tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/PadButton.test.tsx
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SceneView/PadButton.tsx src/components/composite/SceneView/PadButton.test.tsx
git commit -m "feat: rewrite PadButton — right-click flips back face, remove popover/drawer"
```

---

## Task 7: Update `SceneView` — remove drawer, add `handleAddPad`

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`
- Modify: `src/components/composite/SceneView/SceneView.test.tsx`

Remove `editingPad` local state, `handleEditClick`, the `PadConfigDrawer` import and render. The add-pad buttons now call `handleAddPad` which pre-generates a UUID, calls `addPad(sceneId, config, id)`, and sets `editingPadId = id` so the new pad immediately shows its back face.

- [ ] **Step 1: Update SceneView.test.tsx**

Find tests that render `PadConfigDrawer` or test `handleEditClick`. Those tests need to be updated or removed. Look for tests like "opens pad config drawer" and replace with assertions that `editingPadId` is set in uiStore after clicking add-pad.

Run existing tests first to document current state:

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/SceneView.test.tsx
```

Note which tests reference `PadConfigDrawer`, `onEditClick`, or `OVERLAY_ID.PAD_CONFIG_DRAWER` — those need updating.

- [ ] **Step 2: Update `SceneView.tsx`**

Key changes:

```typescript
// REMOVE these imports:
// import { PadConfigDrawer } from "../PadConfigDrawer/PadConfigDrawer";
// OVERLAY_ID.PAD_CONFIG_DRAWER usage

// ADD:
import { createDefaultLayer } from "../PadConfigDrawer/constants";
import type { PadConfig } from "@/lib/schemas";

// REMOVE local state:
// const [editingPad, setEditingPad] = useState<Pad | null>(null);

// REMOVE handleEditClick callback

// ADD handleAddPad:
const addPad = useProjectStore((s) => s.addPad);
const setEditingPadId = useUiStore((s) => s.setEditingPadId);

const handleAddPad = useCallback(() => {
  if (!activeSceneId) return;
  const newId = crypto.randomUUID();
  const config: PadConfig = {
    name: "",
    layers: [createDefaultLayer()],
    muteTargetPadIds: [],
    fadeLowVol: 0,
    fadeHighVol: 1,
  };
  addPad(activeSceneId, config, newId);
  setEditingPadId(newId);
}, [activeSceneId, addPad, setEditingPadId]);
```

Replace all `openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")` calls with `handleAddPad()`.

Remove the `onEditClick` prop from all `<PadButton>` renders (the prop no longer exists on `PadButton`).

Remove the `<PadConfigDrawer>` render from the empty-scene branch and the main grid branch.

- [ ] **Step 3: Run tests**

```bash
npx tsc --noEmit && npm run test:run -- --reporter=verbose src/components/composite/SceneView/SceneView.test.tsx
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx src/components/composite/SceneView/SceneView.test.tsx
git commit -m "feat: SceneView uses handleAddPad to flip new pads into edit mode directly"
```

---

## Task 8: Delete obsolete files and fix remaining TypeScript errors

**Files:**
- Delete: `src/components/composite/SceneView/PadControlContent.tsx`
- Delete: `src/components/composite/SceneView/PadControlContent.test.tsx`
- Delete: `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`
- Delete: `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`
- Delete: `src/components/composite/PadConfigDrawer/LayerAccordion.tsx`
- Delete: `src/components/composite/PadConfigDrawer/LayerAccordion.test.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm "src/components/composite/SceneView/PadControlContent.tsx"
rm "src/components/composite/SceneView/PadControlContent.test.tsx"
rm "src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx"
rm "src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx"
rm "src/components/composite/PadConfigDrawer/LayerAccordion.tsx"
rm "src/components/composite/PadConfigDrawer/LayerAccordion.test.tsx"
```

- [ ] **Step 2: Run TypeScript to find any remaining import errors**

```bash
npx tsc --noEmit
```

Fix any import errors revealed by TypeScript. Common culprits:
- Any file still importing `OVERLAY_ID.PAD_CONFIG_DRAWER` — remove or replace
- Any file still importing `padPopoverOpenId` / `setPadPopoverOpenId` — replace with `editingPadId` / `setEditingPadId`
- Any file still importing from `PadControlContent` — remove

- [ ] **Step 3: Run all tests**

```bash
npm run test:run
```

Expected: Full suite passes. If there are failures, fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: delete PadControlContent, PadConfigDrawer, LayerAccordion — back-face editor is now the sole edit surface"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|-------------|------|
| Right-click flips that pad to back face only | Task 6 (`handleContextMenu` → `setEditingPadId`) |
| Global Ctrl+E flips all pads | Task 6 (`isFlipped = editMode \|\| editingPadId === pad.id`, editMode unchanged) |
| Back face is the only edit surface for add/edit | Tasks 5, 6, 7 |
| Add pad: immediate creation + flip | Task 7 (`handleAddPad`) + Task 3 (`mod+shift+n`) |
| Pad name editable on back face | Task 5 (`localName` + `handleNameBlur`) |
| Color picker on back face | Task 5 (`<input type="color">`) |
| Layer list on back face (play/stop/skip/vol/edit/remove) | Task 5 (`BackFaceLayerRow`) |
| Add layer button | Task 5 (`handleAddLayer`) |
| Layer config dialog (sound selection, modes) | Task 4 (`LayerConfigDialog`) |
| Fade controls on back face | Task 5 (fade sliders + Fade In/Out button) |
| Synchronized Fades button | Task 5 |
| Duplicate/Delete pad | Task 5 |
| Click-outside closes individual flip | Task 6 (`useEffect` document listener) |
| `padPopoverOpenId` fully replaced | Tasks 2, 3, 6 |
| `PadConfigDrawer` deleted | Task 8 |
| `PadControlContent` deleted | Task 8 |
| `LayerAccordion` deleted | Task 8 |
| `OVERLAY_ID.PAD_CONFIG_DRAWER` removed | Task 2 |
| `OVERLAY_ID.LAYER_CONFIG_DIALOG` added | Task 2 |
| F/X hotkeys still work on back face | Task 5 (`useHotkeys` in `PadBackFace`), Task 3 (guard uses `editingPadId`) |
| `mod+shift+n` hotkey uses new add-pad flow | Task 3 |
| Tests updated/added | Tasks 1–7 |

### Placeholder scan

No TBD, TODO, or "implement later" placeholders — all code is explicit and complete in each step.

### Type consistency check

- `padToConfig(pad, layers?)` — defined in Task 5 (`PadBackFace.tsx`) and Task 4 (`LayerConfigDialog.tsx`). Both are local to their file — no cross-file naming conflict.
- `createDefaultLayer()` — imported from `@/components/composite/PadConfigDrawer/constants` in Tasks 3, 5.
- `PadConfig` type — used consistently throughout.
- `editingPadId: string | null` — defined in Task 2, consumed in Tasks 3, 5, 6, 7.
- `setEditingPadId(id: string | null)` — defined in Task 2, called in Tasks 3, 5, 6, 7.
- `addPad(sceneId, config, id?)` — signature updated in Task 1, consumed in Tasks 3, 7.
- `PadButton` `onEditClick` prop — removed in Task 6 from interface, removed in Task 7 from `SceneView` usage. Consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-pad-backface-editor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
