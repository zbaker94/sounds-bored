# Pad Sound & Layer Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user adds a pad, a DrawerDialog opens immediately for them to name the pad and configure its first layer's sound selection, arrangement, and playback settings.

**Architecture:** A `PadConfigDrawer` component (locally mounted in `SceneView`) uses React Hook Form + Zod for form validation. The "Add Pad" button no longer calls `addPad` directly — instead it opens the overlay, and the drawer calls `addPad(sceneId, config)` on submit. The drawer is designed for reuse in a future "edit pad" flow via an `initialConfig` prop.

**Tech Stack:** React Hook Form + `@hookform/resolvers/zod`, Zod, Zustand + Immer, shadcn/ui `DrawerDialog`, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-24-pad-sound-layer-config-design.md`

---

## File Map

### New Files
- `src/components/composite/PadConfigDrawer/SoundSelector.tsx` — conditional selection UI (assigned/tag/set)
- `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx`
- `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx` — all layer config fields
- `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx`
- `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx` — root component wrapping DrawerDialog, owns RHF
- `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`

### Modified Files
- `src/lib/schemas.ts` — add `LayerConfigFormSchema`, `PadConfigSchema`, `PadConfig` type
- `src/lib/schemas.test.ts` — add schema validation tests
- `src/state/projectStore.ts` — update `addPad` signature, add `updatePad`
- `src/state/projectStore.test.ts` — add `addPad` and `updatePad` tests
- `src/state/uiStore.ts` — add `PAD_CONFIG_DRAWER` to `OVERLAY_ID`
- `src/test/factories.ts` — add `createMockPad`, `createMockLayer` factories
- `src/components/composite/SceneView/SceneView.tsx` — replace direct `addPad` calls with overlay open, mount `PadConfigDrawer`
- `src/components/composite/SceneView/SceneView.test.tsx` — new file, verify Add Pad opens overlay

---

## Task 1: Install dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install react-hook-form and resolver**

```bash
npm install react-hook-form @hookform/resolvers
```

- [ ] **Step 2: Verify install**

```bash
npm ls react-hook-form @hookform/resolvers
```

Expected: both packages listed with versions.

- [ ] **Step 3: Add shadcn select component**

```bash
npx shadcn@latest add select
```

Expected: `src/components/ui/select.tsx` created.

- [ ] **Step 4: Add `window.matchMedia` mock to test setup**

`DrawerDialog` uses `useIsMd()` which calls `window.matchMedia`. happy-dom (the Vitest test environment) does not implement `matchMedia`, so any test that renders `DrawerDialog` will throw. Add a global stub to `src/test/setup.ts`:

```typescript
// Mock window.matchMedia — happy-dom does not implement it.
// DrawerDialog uses useIsMd() which calls matchMedia at render time.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
```

Add the `vi` import from `vitest` to `setup.ts` if not already present:
```typescript
import { expect, afterEach, vi } from "vitest";
```

- [ ] **Step 5: Run existing tests to verify mock doesn't break anything**

```bash
npm run test:run
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/ui/select.tsx src/test/setup.ts
git commit -m "chore: install react-hook-form, add shadcn select, mock matchMedia in tests"
```

---

## Task 2: Add test factories for Pad and Layer

**Files:**
- Modify: `src/test/factories.ts`

- [ ] **Step 1: Add `createMockLayer` and `createMockPad` to factories**

In `src/test/factories.ts`, merge `Layer, Pad, Sound, Tag, Set` into the **existing** import from `@/lib/schemas` (line 1) — do not add a second import statement. Then add the factory functions at the bottom of the file:

```typescript
export function createMockLayer(overrides?: Partial<Layer>): Layer {
  return {
    id: crypto.randomUUID(),
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
    ...overrides,
  };
}

export function createMockPad(overrides?: Partial<Pad>): Pad {
  return {
    id: crypto.randomUUID(),
    name: "Test Pad",
    layers: [],
    muteTargetPadIds: [],
    ...overrides,
  };
}

export function createMockSound(overrides?: Partial<Sound>): Sound {
  return {
    id: crypto.randomUUID(),
    name: "Test Sound",
    tags: [],
    sets: [],
    ...overrides,
  };
}

export function createMockTag(overrides?: Partial<Tag>): Tag {
  return {
    id: crypto.randomUUID(),
    name: "Test Tag",
    ...overrides,
  };
}

export function createMockSet(overrides?: Partial<Set>): Set {
  return {
    id: crypto.randomUUID(),
    name: "Test Set",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to confirm no breakage**

```bash
npm run test:run
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/test/factories.ts
git commit -m "test: add createMockPad, createMockLayer, createMockSound, createMockTag, createMockSet factories"
```

---

## Task 3: Add form schemas

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `src/lib/schemas.test.ts`:

```typescript
import { LayerConfigFormSchema, PadConfigSchema } from "@/lib/schemas";

describe("LayerConfigFormSchema", () => {
  it("accepts a valid assigned selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid tag selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "tag", tagId: "tag-1", defaultVolume: 100 },
      arrangement: "sequential",
      playbackMode: "loop",
      retriggerMode: "continue",
      volume: 80,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid set selection", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "set", setId: "set-1", defaultVolume: 75 },
      arrangement: "shuffled",
      playbackMode: "hold",
      retriggerMode: "stop",
      volume: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects volume below 0", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects volume above 100", () => {
    const result = LayerConfigFormSchema.safeParse({
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 101,
    });
    expect(result.success).toBe(false);
  });
});

describe("PadConfigSchema", () => {
  const validLayer = {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  };

  it("accepts a valid pad config", () => {
    const result = PadConfigSchema.safeParse({ name: "My Pad", layer: validLayer });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = PadConfigSchema.safeParse({ name: "", layer: validLayer });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = PadConfigSchema.safeParse({ layer: validLayer });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/lib/schemas.test.ts
```

Expected: FAIL — `LayerConfigFormSchema` and `PadConfigSchema` not found.

- [ ] **Step 3: Add schemas to `src/lib/schemas.ts`**

Add after the `LayerSchema` block (around line 110):

```typescript
// ─── Pad Config Form Schemas ──────────────────────────────────────────────────
// These cover form-validated fields only. LayerConfigFormSchema intentionally
// omits Layer.id — the store action generates it via crypto.randomUUID().

export const LayerConfigFormSchema = z.object({
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number().min(0).max(100),
});

export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layer: LayerConfigFormSchema,
});

export type LayerConfigForm = z.infer<typeof LayerConfigFormSchema>;
export type PadConfigForm = z.infer<typeof PadConfigSchema>;
```

Also add the `PadConfig` runtime type (not validated by form, used by the store) after `PadSchema`:

```typescript
/** Writable fields of Pad — used by addPad / updatePad store actions. */
export type PadConfig = Omit<Pad, "id">;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/lib/schemas.test.ts
```

Expected: all new tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat: add LayerConfigFormSchema, PadConfigSchema, PadConfig type"
```

---

## Task 4: Update uiStore — add PAD_CONFIG_DRAWER

**Files:**
- Modify: `src/state/uiStore.ts`

- [ ] **Step 1: Add PAD_CONFIG_DRAWER to OVERLAY_ID**

In `src/state/uiStore.ts`, add to the `OVERLAY_ID` object:

```typescript
export const OVERLAY_ID = {
  MENU_DRAWER: "menu-drawer",
  SOUNDS_PANEL: "sounds-panel",
  SAVE_PROJECT_DIALOG: "save-project-dialog",
  CONFIRM_NAVIGATE_DIALOG: "confirm-navigate-dialog",
  CONFIRM_CLOSE_DIALOG: "confirm-close-dialog",
  PAD_CONFIG_DRAWER: "pad-config-drawer",  // add this line
} as const;
```

- [ ] **Step 2: Run tests to verify no breakage**

```bash
npm run test:run -- src/state/uiStore.test.ts
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/state/uiStore.ts
git commit -m "feat: add PAD_CONFIG_DRAWER overlay ID"
```

---

## Task 5: Update projectStore — addPad and updatePad

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/state/projectStore.test.ts` (after the `addScene` describe block):

```typescript
import { createMockPad, createMockLayer } from "@/test/factories";
import type { PadConfig } from "@/lib/schemas";

describe("addPad", () => {
  function loadWithScene() {
    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1" });
    getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    return scene.id;
  }

  it("should do nothing if no project is loaded", () => {
    const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
    getState().addPad("any-scene", config);
    expect(getState().project).toBeNull();
  });

  it("should do nothing if sceneId does not exist", () => {
    loadWithScene();
    const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };
    getState().addPad("nonexistent", config);
    expect(getState().project?.scenes[0].pads).toHaveLength(0);
  });

  it("should add a pad with the given name to the scene", () => {
    const sceneId = loadWithScene();
    const layer = createMockLayer();
    const config: PadConfig = {
      name: "Kick",
      layers: [layer],
      muteTargetPadIds: [],
    };

    getState().addPad(sceneId, config);

    expect(getState().project?.scenes[0].pads).toHaveLength(1);
    expect(getState().project?.scenes[0].pads[0].name).toBe("Kick");
  });

  it("should assign a generated id to the pad", () => {
    const sceneId = loadWithScene();
    const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };

    getState().addPad(sceneId, config);

    expect(getState().project?.scenes[0].pads[0].id).toBeTruthy();
  });

  it("should mark project as dirty", () => {
    const sceneId = loadWithScene();
    const config: PadConfig = { name: "Kick", layers: [], muteTargetPadIds: [] };

    getState().addPad(sceneId, config);

    expect(getState().isDirty).toBe(true);
  });
});

describe("updatePad", () => {
  function loadWithPad() {
    const entry = createMockHistoryEntry();
    const pad = createMockPad({ id: "pad-1", name: "Original" });
    const scene = createMockScene({ id: "scene-1", pads: [pad] });
    getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
    return { sceneId: scene.id, padId: pad.id };
  }

  it("should do nothing if no project is loaded", () => {
    const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };
    getState().updatePad("any-scene", "any-pad", config);
    expect(getState().project).toBeNull();
  });

  it("should do nothing if padId does not exist in the scene", () => {
    const { sceneId } = loadWithPad();
    const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };
    getState().updatePad(sceneId, "nonexistent-pad", config);
    expect(getState().project?.scenes[0].pads[0].name).toBe("Original");
  });

  it("should update the pad fields, leaving id unchanged", () => {
    const { sceneId, padId } = loadWithPad();
    const config: PadConfig = { name: "Updated Name", layers: [], muteTargetPadIds: [] };

    getState().updatePad(sceneId, padId, config);

    const pad = getState().project?.scenes[0].pads[0];
    expect(pad?.id).toBe("pad-1");       // id preserved
    expect(pad?.name).toBe("Updated Name");
  });

  it("should mark project as dirty", () => {
    const { sceneId, padId } = loadWithPad();
    const config: PadConfig = { name: "Updated", layers: [], muteTargetPadIds: [] };

    getState().updatePad(sceneId, padId, config);

    expect(getState().isDirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/state/projectStore.test.ts
```

Expected: FAIL — `addPad` has wrong signature, `updatePad` does not exist.

- [ ] **Step 3: Update projectStore**

In `src/state/projectStore.ts`:

1. Add `PadConfig` to imports:
```typescript
import { Pad, PadConfig, Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";
```

2. Update the `addPad` signature in the interface:
```typescript
addPad: (sceneId: string, config: PadConfig) => void;
```

3. Add `updatePad` to the interface:
```typescript
updatePad: (sceneId: string, padId: string, config: PadConfig) => void;
```

4. Replace the `addPad` implementation:
```typescript
addPad: (sceneId, config) =>
  set((draft) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const newPad: Pad = {
      id: crypto.randomUUID(),
      ...config,
    };
    scene.pads.push(newPad);
    draft.isDirty = true;
  }),
```

5. Add `updatePad` implementation after `addPad`:
```typescript
updatePad: (sceneId, padId, config) =>
  set((draft) => {
    if (!draft.project) return;
    const scene = draft.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const pad = scene.pads.find((p) => p.id === padId);
    if (!pad) return;
    Object.assign(pad, config);
    draft.isDirty = true;
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/state/projectStore.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Fix useGlobalHotkeys — update Ctrl+Shift+N to open overlay**

`src/hooks/useGlobalHotkeys.ts` has a `mod+shift+n` hotkey (lines 40–45) that calls `addPad(activeSceneId)` directly. After changing `addPad`'s signature to require a `PadConfig`, this call is now a TypeScript compile error (missing required argument). Replace it with an overlay open call.

In `src/hooks/useGlobalHotkeys.ts`, replace the `mod+shift+n` handler and remove `addPad` from the `useProjectStore.getState()` destructure:

```typescript
// Mod+Shift+N: open the pad config drawer for the active scene.
useHotkeys("mod+shift+n", () => {
  const { project, activeSceneId } = useProjectStore.getState();
  if (activeSceneId && project?.scenes.some((s) => s.id === activeSceneId)) {
    useUiStore.getState().openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  }
});
```

(`useUiStore` and `OVERLAY_ID` are already imported in this file.)

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts src/hooks/useGlobalHotkeys.ts
git commit -m "feat: update addPad to accept PadConfig, add updatePad action, update hotkey"
```

---

## Task 6: Create SoundSelector component

**Files:**
- Create: `src/components/composite/PadConfigDrawer/SoundSelector.tsx`
- Create: `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx`

This component renders different UI based on the current selection type. It connects to `useLibraryStore` directly (no props for library data).

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSound, createMockTag, createMockSet } from "@/test/factories";
import { SoundSelector } from "./SoundSelector";
import type { LayerSelection } from "@/lib/schemas";

// SoundSelector uses react-hook-form context — wrap in a form provider for tests
import { useForm, FormProvider } from "react-hook-form";

function Wrapper({ value, onChange }: { value: LayerSelection; onChange: (v: LayerSelection) => void }) {
  const methods = useForm({ defaultValues: { selection: value } });
  return (
    <FormProvider {...methods}>
      <SoundSelector value={value} onChange={onChange} />
    </FormProvider>
  );
}

describe("SoundSelector", () => {
  const noopChange = vi.fn();

  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    noopChange.mockClear();
  });

  it("shows a sound list when selection type is assigned", () => {
    const sound = createMockSound({ name: "Kick Drum" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

    render(
      <Wrapper
        value={{ type: "assigned", instances: [] }}
        onChange={noopChange}
      />
    );

    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
  });

  it("shows a tag dropdown when selection type is tag", () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });

    render(
      <Wrapper
        value={{ type: "tag", tagId: "", defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/tag/i)).toBeInTheDocument();
  });

  it("shows a set dropdown when selection type is set", () => {
    const set = createMockSet({ id: "s1", name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });

    render(
      <Wrapper
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={noopChange}
      />
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/set/i)).toBeInTheDocument();
  });

  it("shows empty state message when library has no sounds (assigned type)", () => {
    render(
      <Wrapper
        value={{ type: "assigned", instances: [] }}
        onChange={noopChange}
      />
    );

    expect(screen.getByText(/no sounds/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create SoundSelector component**

Create `src/components/composite/PadConfigDrawer/SoundSelector.tsx`:

```typescript
import { useLibraryStore } from "@/state/libraryStore";
import type { LayerSelection, SoundInstance } from "@/lib/schemas";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface SoundSelectorProps {
  value: LayerSelection;
  onChange: (value: LayerSelection) => void;
}

export function SoundSelector({ value, onChange }: SoundSelectorProps) {
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  if (value.type === "assigned") {
    const selectedIds = new Set(value.instances.map((i) => i.soundId));

    function toggleSound(soundId: string) {
      if (selectedIds.has(soundId)) {
        onChange({
          type: "assigned",
          instances: value.instances.filter((i) => i.soundId !== soundId),
        });
      } else {
        const newInstance: SoundInstance = {
          id: crypto.randomUUID(),
          soundId,
          volume: 100,
        };
        onChange({ type: "assigned", instances: [...value.instances, newInstance] });
      }
    }

    if (sounds.length === 0) {
      return <p className="text-sm text-muted-foreground">No sounds in library yet.</p>;
    }

    return (
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {sounds.map((sound) => (
          <label key={sound.id} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={selectedIds.has(sound.id)}
              onChange={() => toggleSound(sound.id)}
              className="accent-primary"
            />
            {sound.name}
          </label>
        ))}
      </div>
    );
  }

  if (value.type === "tag") {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Select tag</Label>
        <Select
          value={value.tagId}
          onValueChange={(tagId) => onChange({ type: "tag", tagId, defaultVolume: value.defaultVolume })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a tag…" />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // value.type === "set"
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">Select set</Label>
      <Select
        value={value.setId}
        onValueChange={(setId) => onChange({ type: "set", setId, defaultVolume: value.defaultVolume })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a set…" />
        </SelectTrigger>
        <SelectContent>
          {sets.map((set) => (
            <SelectItem key={set.id} value={set.id}>
              {set.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/SoundSelector.tsx src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
git commit -m "feat: add SoundSelector component (assigned/tag/set)"
```

---

## Task 7: Create LayerConfigSection component

**Files:**
- Create: `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`
- Create: `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx`

This component renders all layer fields. It uses `useFormContext` from React Hook Form — it must be rendered inside a `FormProvider`.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PadConfigSchema } from "@/lib/schemas";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { LayerConfigSection } from "./LayerConfigSection";
import type { PadConfigForm } from "@/lib/schemas";

const defaultValues: PadConfigForm = {
  name: "",
  layer: {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  },
};

function Wrapper({ onSubmit = () => {} }: { onSubmit?: (data: PadConfigForm) => void }) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues,
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <LayerConfigSection />
      </form>
    </FormProvider>
  );
}

describe("LayerConfigSection", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
  });

  it("renders the selection type toggle with all three options", () => {
    render(<Wrapper />);
    expect(screen.getByRole("tab", { name: /assigned/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tag/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /set/i })).toBeInTheDocument();
  });

  it("renders the arrangement control", () => {
    render(<Wrapper />);
    expect(screen.getByText(/arrangement/i)).toBeInTheDocument();
  });

  it("renders the playback mode control", () => {
    render(<Wrapper />);
    expect(screen.getByText(/playback/i)).toBeInTheDocument();
  });

  it("renders the retrigger mode control", () => {
    render(<Wrapper />);
    expect(screen.getByText(/retrigger/i)).toBeInTheDocument();
  });

  it("renders the volume slider", () => {
    render(<Wrapper />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("switching to tag type shows tag selector", async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /tag/i }));
    expect(screen.getByText(/select tag/i)).toBeInTheDocument();
  });

  it("switching to set type shows set selector", async () => {
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /set/i }));
    expect(screen.getByText(/select set/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create LayerConfigSection component**

Create `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`:

```typescript
import { useFormContext, Controller } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SoundSelector } from "./SoundSelector";
import type { PadConfigForm, LayerSelection } from "@/lib/schemas";

const SELECTION_TYPE_DEFAULTS: Record<LayerSelection["type"], LayerSelection> = {
  assigned: { type: "assigned", instances: [] },
  tag: { type: "tag", tagId: "", defaultVolume: 100 },
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

export function LayerConfigSection() {
  const { control, watch, setValue } = useFormContext<PadConfigForm>();
  const selectionType = watch("layer.selection.type");

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue("layer.selection", SELECTION_TYPE_DEFAULTS[type], { shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selection Type */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sound Selection
        </Label>
        <Tabs value={selectionType} onValueChange={(v) => handleSelectionTypeChange(v as LayerSelection["type"])}>
          <TabsList className="w-full">
            <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
            <TabsTrigger value="tag" className="flex-1">Tag</TabsTrigger>
            <TabsTrigger value="set" className="flex-1">Set</TabsTrigger>
          </TabsList>
        </Tabs>

        <Controller
          control={control}
          name="layer.selection"
          render={({ field }) => (
            <SoundSelector value={field.value} onChange={field.onChange} />
          )}
        />
      </div>

      {/* Arrangement */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Arrangement
        </Label>
        <Controller
          control={control}
          name="layer.arrangement"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {ARRANGEMENT_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Playback Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Playback Mode
        </Label>
        <Controller
          control={control}
          name="layer.playbackMode"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {PLAYBACK_MODE_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Retrigger Mode */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Retrigger Mode
        </Label>
        <Controller
          control={control}
          name="layer.retriggerMode"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList className="w-full">
                {RETRIGGER_MODE_OPTIONS.map((opt) => (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex-1">
                    {opt.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Volume
        </Label>
        <Controller
          control={control}
          name="layer.volume"
          render={({ field }) => (
            <Slider
              min={0}
              max={100}
              step={1}
              value={[field.value]}
              onValueChange={([v]) => field.onChange(v)}
            />
          )}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerConfigSection.tsx src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
git commit -m "feat: add LayerConfigSection component"
```

---

## Task 8: Create PadConfigDrawer component

**Files:**
- Create: `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`
- Create: `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`

Root component. Wraps `DrawerDialog`, owns the RHF form, reads open state from `uiStore`, calls `addPad` on submit.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { PadConfigDrawer } from "./PadConfigDrawer";

function renderDrawer(sceneId = "scene-1") {
  return render(<PadConfigDrawer sceneId={sceneId} />);
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

    // Load a project with a scene so addPad works
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

  it("shows a validation error when name is empty and Save is clicked", async () => {
    renderDrawer();
    openDrawer();

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it("calls addPad with form data and closes overlay on valid submit", async () => {
    renderDrawer("scene-1");
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const pads = useProjectStore.getState().project?.scenes[0].pads;
      expect(pads).toHaveLength(1);
      expect(pads![0].name).toBe("Kick");
    });

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
  });

  it("closes overlay without saving when Cancel is clicked", async () => {
    renderDrawer("scene-1");
    openDrawer();

    await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create PadConfigDrawer component**

Create `src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx`:

```typescript
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm, PadConfig } from "@/lib/schemas";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LayerConfigSection } from "./LayerConfigSection";

const DEFAULT_VALUES: PadConfigForm = {
  name: "",
  layer: {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  },
};

interface PadConfigDrawerProps {
  sceneId: string;
  initialConfig?: Partial<PadConfig>;
}

export function PadConfigDrawer({ sceneId, initialConfig }: PadConfigDrawerProps) {
  const isOpen = useUiStore((s) => s.isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER));
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const addPad = useProjectStore((s) => s.addPad);

  const isEditing = initialConfig !== undefined;

  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues: initialConfig
      ? {
          name: initialConfig.name ?? "",
          layer: initialConfig.layers?.[0]
            ? {
                selection: initialConfig.layers[0].selection,
                arrangement: initialConfig.layers[0].arrangement,
                playbackMode: initialConfig.layers[0].playbackMode,
                retriggerMode: initialConfig.layers[0].retriggerMode,
                volume: initialConfig.layers[0].volume,
              }
            : DEFAULT_VALUES.layer,
        }
      : DEFAULT_VALUES,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = methods;

  function handleClose() {
    reset(DEFAULT_VALUES);
    closeOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER);
  }

  function onSubmit(data: PadConfigForm) {
    const config: PadConfig = {
      name: data.name,
      layers: [
        {
          id: crypto.randomUUID(),
          selection: data.layer.selection,
          arrangement: data.layer.arrangement,
          playbackMode: data.layer.playbackMode,
          retriggerMode: data.layer.retriggerMode,
          volume: data.layer.volume,
        },
      ],
      muteTargetPadIds: [],
    };
    addPad(sceneId, config);
    handleClose();
  }

  return (
    <FormProvider {...methods}>
      <DrawerDialog
        open={isOpen}
        onOpenChange={(open) => { if (!open) handleClose(); }}
        title={isEditing ? "Edit Pad" : "Configure Pad"}
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
            <LayerConfigSection />
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/PadConfigDrawer.tsx src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
git commit -m "feat: add PadConfigDrawer component"
```

---

## Task 9: Wire SceneView — open overlay instead of direct addPad

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`
- Create: `src/components/composite/SceneView/SceneView.test.tsx`

Replace both `addPad(activeScene.id)` calls with `openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")`. Mount `<PadConfigDrawer>` inside `SceneView`.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/SceneView/SceneView.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { useUiStore, initialUiState, OVERLAY_ID } from "@/state/uiStore";
import { createMockHistoryEntry, createMockProject, createMockScene } from "@/test/factories";
import { SceneView } from "./SceneView";

describe("SceneView", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
    useUiStore.setState({ ...initialUiState });

    const entry = createMockHistoryEntry();
    const scene = createMockScene({ id: "scene-1", name: "Scene 1" });
    useProjectStore.getState().loadProject(entry, createMockProject({ scenes: [scene] }), false);
  });

  it("renders the Add Pad button when scene has no pads", () => {
    render(<SceneView />);
    expect(screen.getByRole("button", { name: /add pad/i })).toBeInTheDocument();
  });

  it("clicking Add Pad opens the PAD_CONFIG_DRAWER overlay", async () => {
    render(<SceneView />);

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(true);
  });

  it("does NOT call addPad directly when Add Pad is clicked (overlay opens first)", async () => {
    render(<SceneView />);

    await userEvent.click(screen.getByRole("button", { name: /add pad/i }));

    // No pad created yet — it's created by PadConfigDrawer on form submit
    expect(useProjectStore.getState().project?.scenes[0].pads).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/SceneView/SceneView.test.tsx
```

Expected: FAIL — Add Pad still calls `addPad` directly, overlay not opened.

- [ ] **Step 3: Update SceneView**

In `src/components/composite/SceneView/SceneView.tsx`:

1. Replace `useProjectStore` `addPad` selector with `useUiStore` `openOverlay`.
2. Replace both `addPad(activeScene.id)` calls with `openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog")`.
3. Mount `<PadConfigDrawer>` at the bottom of the returned JSX (before the final closing `</div>`).

Full updated file:

```typescript
import { useState, useMemo } from "react";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore, OVERLAY_ID } from "@/state/uiStore";
import { PadButton } from "./PadButton";
import { PadConfigDrawer } from "@/components/composite/PadConfigDrawer/PadConfigDrawer";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon, ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useHotkeys } from "react-hotkeys-hook";

const PADS_PER_PAGE = 12;

export function SceneView() {
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const project = useProjectStore((s) => s.project);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const [pageByScene, setPageByScene] = useState<Record<string, number>>({});

  const activeScene = useMemo(
    () => project?.scenes.find((s) => s.id === activeSceneId) ?? null,
    [project, activeSceneId]
  );

  const page = activeScene ? (pageByScene[activeScene.id] ?? 0) : 0;

  function setPage(updater: (prev: number) => number) {
    if (!activeScene) return;
    setPageByScene((prev) => ({
      ...prev,
      [activeScene.id]: updater(prev[activeScene.id] ?? 0),
    }));
  }

  function handleAddPad() {
    openOverlay(OVERLAY_ID.PAD_CONFIG_DRAWER, "dialog");
  }

  const pads = activeScene?.pads ?? [];
  const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const isLastPage = safePage === totalPages - 1;

  useHotkeys("shift+left", () => { if (safePage > 0) setPage((p) => p - 1); else setPage(() => totalPages - 1); }, { preventDefault: true });
  useHotkeys("shift+right", () => { if (!isLastPage) setPage((p) => p + 1); else setPage(() => 0); }, { preventDefault: true });

  if (!activeScene) {
    return <div className="flex-1" />;
  }

  if (pads.length === 0) {
    return (
      <>
        <div className="flex-1 flex items-center justify-center p-8">
          <button
            onClick={handleAddPad}
            className="aspect-square w-40 rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
            aria-label="Add pad"
          >
            <HugeiconsIcon icon={Add02Icon} size={48} className="text-foreground/60" />
          </button>
        </div>
        <PadConfigDrawer sceneId={activeScene.id} />
      </>
    );
  }

  const pagePads = pads.slice(safePage * PADS_PER_PAGE, (safePage + 1) * PADS_PER_PAGE);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      <div className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 auto-rows-fr gap-3">
        {pagePads.map((pad) => (
          <PadButton key={pad.id} pad={pad} />
        ))}
        {isLastPage && (
          <button
            onClick={handleAddPad}
            className="w-full h-full rounded-xl border-2 border-dashed border-foreground/40 bg-card/80 flex items-center justify-center hover:border-foreground/70 hover:bg-card transition-all cursor-pointer shadow-[3px_3px_0px_rgba(0,0,0,0.3)]"
            aria-label="Add pad"
          >
            <HugeiconsIcon icon={Add02Icon} size={32} className="text-foreground/60" />
          </button>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <span className="text-white tabular-nums [font-family:DeathLetter]">
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isLastPage}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
        </div>
      )}

      <PadConfigDrawer sceneId={activeScene.id} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/SceneView/SceneView.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx src/components/composite/SceneView/SceneView.test.tsx
git commit -m "feat: wire SceneView to open PadConfigDrawer on Add Pad"
```

---

## Done

After all tasks complete, run `npm run tauri dev` and verify end-to-end:
1. Open or create a project → navigate to `/main`
2. Add a scene
3. Click "Add Pad" → `DrawerDialog` opens
4. Fill in a name, optionally assign sounds, configure layer settings
5. Click Save → pad appears in the grid with the given name
6. Click "Add Pad" again → drawer opens fresh with empty defaults
7. Click Cancel → no pad is added
