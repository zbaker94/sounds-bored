# Scene Data Flow to MainPage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire scene data from `projectStore` into `MainPage` via a `SceneTabBar` component that lets users switch between scenes and add new ones.

**Architecture:** Add `activeSceneId` runtime state and `addScene` action to `projectStore`. Create a controlled `SceneTabBar` component (shadcn Tabs + add button) that accepts scenes and callbacks as props. Wire it into `MainPage` which reads from the store and renders `SceneTabBar` above a placeholder content area.

**Tech Stack:** React 19, TypeScript strict, Zustand + Immer, shadcn Tabs, HugeIcons (`Add02Icon`), Vitest + Testing Library + happy-dom

---

## Files Modified / Created

| File | Change |
|---|---|
| `src/test/factories.ts` | Add `createMockScene` factory |
| `src/state/projectStore.ts` | Add `activeSceneId` state, `setActiveSceneId` + `addScene` actions; update `loadProject` / `clearProject` |
| `src/state/projectStore.test.ts` | Tests for `activeSceneId`, `setActiveSceneId`, `addScene` |
| `src/components/composite/SceneTabBar/SceneTabBar.tsx` | New controlled component |
| `src/components/composite/SceneTabBar/SceneTabBar.test.tsx` | Component tests |
| `src/components/screens/main/MainPage.tsx` | Wire `SceneTabBar` + placeholder content area |

---

## Task 1: Add `createMockScene` factory

**Files:**
- Modify: `src/test/factories.ts`

- [ ] **Step 1.1 — Add `createMockScene` to factories**

In `src/test/factories.ts`, add the `Scene` import and factory:

```typescript
import { Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";

// ... existing factories ...

/**
 * Factory for creating test Scenes
 */
export function createMockScene(overrides?: Partial<Scene>): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    pads: [],
    ...overrides,
  };
}
```

- [ ] **Step 1.2 — Run full test suite to verify nothing broke**

```bash
npm run test:run
```
Expected: All existing tests pass.

- [ ] **Step 1.3 — Commit**

```bash
git add src/test/factories.ts
git commit -m "test: add createMockScene factory"
```

---

## Task 2: Add `activeSceneId` state + `setActiveSceneId` action to projectStore

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

- [ ] **Step 2.1 — Write failing tests**

In `src/state/projectStore.test.ts`, add this import at the top alongside the existing imports:

```typescript
import { createMockScene } from "@/test/factories";
```

Then add a new `describe("activeSceneId")` block after the existing `describe("clearDirtyFlag")` block:

```typescript
describe("activeSceneId", () => {
  it("should start as null", () => {
    expect(getState().activeSceneId).toBeNull();
  });

  it("should auto-select first scene on loadProject when scenes exist", () => {
    const entry = createMockHistoryEntry();
    const project = createMockProject({
      scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
    });

    getState().loadProject(entry, project, false);

    expect(getState().activeSceneId).toBe("s1");
  });

  it("should remain null on loadProject when scenes is empty", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);

    expect(getState().activeSceneId).toBeNull();
  });

  it("should update on setActiveSceneId", () => {
    const entry = createMockHistoryEntry();
    const project = createMockProject({
      scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
    });
    getState().loadProject(entry, project, false);

    getState().setActiveSceneId("s2");

    expect(getState().activeSceneId).toBe("s2");
  });

  it("should reset to null on clearProject", () => {
    const entry = createMockHistoryEntry();
    const project = createMockProject({
      scenes: [createMockScene({ id: "s1" })],
    });
    getState().loadProject(entry, project, false);

    getState().clearProject();

    expect(getState().activeSceneId).toBeNull();
  });

  it("should preserve activeSceneId through markAsPermanent", () => {
    const tempEntry = createMockHistoryEntry({ path: "/temp/temp_Test_123" });
    const project = createMockProject({
      scenes: [createMockScene({ id: "s1" }), createMockScene({ id: "s2" })],
    });
    getState().loadProject(tempEntry, project, true);
    getState().setActiveSceneId("s2");

    const permEntry = createMockHistoryEntry({ path: "/projects/My Project" });
    getState().markAsPermanent(permEntry, project);

    expect(getState().activeSceneId).toBe("s2");
  });
});
```

- [ ] **Step 2.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/state/projectStore.test.ts
```
Expected: 6 new tests fail — `activeSceneId` is undefined, `setActiveSceneId` is not a function.

- [ ] **Step 2.3 — Implement in projectStore.ts**

In `src/state/projectStore.ts`:

1. Add `Scene` to the schema import:
```typescript
import { Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";
```

2. Add `activeSceneId` to `ProjectState`:
```typescript
interface ProjectState {
  project: Project | null;
  folderPath: string | null;
  historyEntry: ProjectHistoryEntry | null;
  isTemporary: boolean;
  isDirty: boolean;
  activeSceneId: string | null;
}
```

3. Add `setActiveSceneId` to `ProjectActions`:
```typescript
interface ProjectActions {
  loadProject: (historyEntry: ProjectHistoryEntry, project: Project, isTemporary: boolean) => void;
  /**
   * Replaces the entire project object and marks state as dirty.
   * @transitional This generic setter will be replaced by specific actions
   * (e.g., addScene, updatePad, renamePad) in Phase 3+. Prefer specific actions
   * for any new mutation work. Do not remove until specific actions are in place.
   */
  updateProject: (project: Project) => void;
  clearDirtyFlag: () => void;
  markAsPermanent: (historyEntry: ProjectHistoryEntry, project: Project) => void;
  clearProject: () => void;
  setActiveSceneId: (sceneId: string) => void;
}
```

4. Add `activeSceneId: null` to `initialProjectState`:
```typescript
export const initialProjectState: ProjectState = {
  project: null,
  folderPath: null,
  historyEntry: null,
  isTemporary: false,
  isDirty: false,
  activeSceneId: null,
};
```

5. Update `loadProject` to auto-select the first scene:
```typescript
loadProject: (historyEntry, project, isTemporary) =>
  set((draft) => {
    draft.historyEntry = historyEntry;
    draft.project = project;
    draft.folderPath = historyEntry.path;
    draft.isTemporary = isTemporary;
    draft.isDirty = false;
    draft.activeSceneId = project.scenes.length > 0 ? project.scenes[0].id : null;
  }),
```

6. Add the `setActiveSceneId` implementation (after `clearDirtyFlag`):
```typescript
setActiveSceneId: (sceneId) =>
  set((draft) => {
    draft.activeSceneId = sceneId;
  }),
```

Note: `clearProject` already resets via `set(() => ({ ...initialProjectState }))` which covers `activeSceneId`. `markAsPermanent` does not touch `activeSceneId`, preserving it through Save As.

- [ ] **Step 2.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/state/projectStore.test.ts
```
Expected: All tests pass.

- [ ] **Step 2.5 — Run full suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 2.6 — Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "feat: add activeSceneId state and setActiveSceneId action to projectStore"
```

---

## Task 3: Add `addScene` action to projectStore

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

- [ ] **Step 3.1 — Write failing tests**

In `src/state/projectStore.test.ts`, add a new `describe("addScene")` block after the `activeSceneId` block:

```typescript
describe("addScene", () => {
  it("should do nothing if no project is loaded", () => {
    getState().addScene();

    expect(getState().project).toBeNull();
    expect(getState().activeSceneId).toBeNull();
  });

  it("should add a scene with default 4x4 grid to an empty project", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);

    getState().addScene();

    expect(getState().project?.scenes).toHaveLength(1);
    expect(getState().project?.scenes[0].pads).toEqual([]);
  });

  it("should auto-name scenes sequentially based on current count", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(
      entry,
      createMockProject({ scenes: [createMockScene({ id: "s1", name: "Scene 1" })] }),
      false
    );

    getState().addScene();

    expect(getState().project?.scenes[1].name).toBe("Scene 2");
  });

  it("should use provided name when given", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);

    getState().addScene("Ambient Sounds");

    expect(getState().project?.scenes[0].name).toBe("Ambient Sounds");
  });

  it("should set activeSceneId to the new scene's id", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);

    getState().addScene();

    const newSceneId = getState().project?.scenes[0].id;
    expect(newSceneId).toBeTruthy();
    expect(getState().activeSceneId).toBe(newSceneId);
  });

  it("should generate unique ids for each scene", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);

    getState().addScene();
    getState().addScene();

    const ids = getState().project?.scenes.map((s) => s.id);
    expect(ids?.[0]).not.toBe(ids?.[1]);
  });

  it("should mark project as dirty", () => {
    const entry = createMockHistoryEntry();
    getState().loadProject(entry, createMockProject({ scenes: [] }), false);
    expect(getState().isDirty).toBe(false);

    getState().addScene();

    expect(getState().isDirty).toBe(true);
  });
});
```

- [ ] **Step 3.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/state/projectStore.test.ts
```
Expected: 7 new tests fail — `addScene` is not a function.

- [ ] **Step 3.3 — Implement addScene in projectStore.ts**

1. Add `addScene` to the `ProjectActions` interface (after `setActiveSceneId`):
```typescript
addScene: (name?: string) => void;
```

2. Add the implementation in the store body (after `setActiveSceneId`):
```typescript
addScene: (name) =>
  set((draft) => {
    if (!draft.project) return;
    const newScene: Scene = {
      id: crypto.randomUUID(),
      name: name ?? `Scene ${draft.project.scenes.length + 1}`,
      pads: [],
    };
    draft.project.scenes.push(newScene);
    draft.activeSceneId = newScene.id;
    draft.isDirty = true;
  }),
```

- [ ] **Step 3.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/state/projectStore.test.ts
```
Expected: All tests pass including the 7 new ones.

- [ ] **Step 3.5 — Run full suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 3.6 — Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "feat: add addScene action to projectStore (default 4x4 grid, auto-names, sets active)"
```

---

## Task 4: Create SceneTabBar component

**Files:**
- Create: `src/components/composite/SceneTabBar/SceneTabBar.tsx`
- Create: `src/components/composite/SceneTabBar/SceneTabBar.test.tsx`

- [ ] **Step 4.1 — Write failing tests**

Create `src/components/composite/SceneTabBar/SceneTabBar.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneTabBar } from "./SceneTabBar";
import { createMockScene } from "@/test/factories";

describe("SceneTabBar", () => {
  const defaultProps = {
    scenes: [],
    activeSceneId: null,
    onSceneChange: vi.fn(),
    onAddScene: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render an add scene button", () => {
    render(<SceneTabBar {...defaultProps} />);

    expect(screen.getByRole("button", { name: /add scene/i })).toBeInTheDocument();
  });

  it("should render no tabs when scenes list is empty", () => {
    render(<SceneTabBar {...defaultProps} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("should render a tab for each scene", () => {
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...defaultProps} scenes={scenes} activeSceneId="s1" />);

    expect(screen.getByRole("tab", { name: "Scene 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scene 2" })).toBeInTheDocument();
  });

  it("should render data-state=active on the tab whose id matches activeSceneId", () => {
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(<SceneTabBar {...defaultProps} scenes={scenes} activeSceneId="s2" />);

    expect(screen.getByRole("tab", { name: "Scene 2" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByRole("tab", { name: "Scene 1" })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("should call onAddScene when the add button is clicked", () => {
    const onAddScene = vi.fn();

    render(<SceneTabBar {...defaultProps} onAddScene={onAddScene} />);
    fireEvent.click(screen.getByRole("button", { name: /add scene/i }));

    expect(onAddScene).toHaveBeenCalledOnce();
  });

  it("should call onSceneChange with the scene id when a tab is clicked", () => {
    const onSceneChange = vi.fn();
    const scenes = [
      createMockScene({ id: "s1", name: "Scene 1" }),
      createMockScene({ id: "s2", name: "Scene 2" }),
    ];

    render(
      <SceneTabBar
        {...defaultProps}
        scenes={scenes}
        activeSceneId="s1"
        onSceneChange={onSceneChange}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "Scene 2" }));

    expect(onSceneChange).toHaveBeenCalledWith("s2");
  });
});
```

- [ ] **Step 4.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/SceneTabBar/SceneTabBar.test.tsx
```
Expected: All tests fail — module not found.

- [ ] **Step 4.3 — Create SceneTabBar component**

Create `src/components/composite/SceneTabBar/SceneTabBar.tsx`:

```typescript
import { Scene } from "@/lib/schemas";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add02Icon } from "@hugeicons/core-free-icons";

interface SceneTabBarProps {
  scenes: Scene[];
  activeSceneId: string | null;
  onSceneChange: (sceneId: string) => void;
  onAddScene: () => void;
}

export function SceneTabBar({
  scenes,
  activeSceneId,
  onSceneChange,
  onAddScene,
}: SceneTabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b px-3 py-1">
      <Tabs value={activeSceneId ?? undefined} onValueChange={onSceneChange}>
        <TabsList variant="line">
          {scenes.map((scene) => (
            <TabsTrigger key={scene.id} value={scene.id}>
              {scene.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onAddScene}
        aria-label="Add scene"
      >
        <HugeiconsIcon icon={Add02Icon} size={16} />
      </Button>
    </div>
  );
}
```

- [ ] **Step 4.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/SceneTabBar/SceneTabBar.test.tsx
```
Expected: All 6 tests pass.

- [ ] **Step 4.5 — Run full suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 4.6 — Commit**

```bash
git add src/components/composite/SceneTabBar/SceneTabBar.tsx src/components/composite/SceneTabBar/SceneTabBar.test.tsx
git commit -m "feat: add SceneTabBar component (shadcn Tabs + add button)"
```

---

## Task 5: Wire SceneTabBar into MainPage

**Files:**
- Modify: `src/components/screens/main/MainPage.tsx`

No new tests needed — `MainPage` is a wiring component; behavior is covered by store and `SceneTabBar` tests. The rendering guard (`if (!project) return null`) remains intact.

- [ ] **Step 5.1 — Update MainPage**

Replace the contents of `src/components/screens/main/MainPage.tsx` with:

```typescript
import { useProjectStore } from "@/state/projectStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";
import { useSaveProjectAs } from "@/lib/project.queries";
import { discardTemporaryProject } from "@/lib/project";
import { SaveProjectDialog } from "@/components/modals/SaveProjectDialog";
import { ConfirmCloseDialog } from "@/components/modals/ConfirmCloseDialog";
import { SceneTabBar } from "@/components/composite/SceneTabBar/SceneTabBar";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_CLOSE_DELAY } from "@/lib/constants";
import { toast } from "sonner";

export function MainPage() {
  const project = useProjectStore((s) => s.project);
  const folderPath = useProjectStore((s) => s.folderPath);
  const isTemporary = useProjectStore((s) => s.isTemporary);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markAsPermanent = useProjectStore((s) => s.markAsPermanent);
  const scenes = useProjectStore((s) => s.project?.scenes ?? []);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveSceneId = useProjectStore((s) => s.setActiveSceneId);
  const addScene = useProjectStore((s) => s.addScene);
  const navigate = useNavigate();
  const saveProjectMutation = useSaveProjectAs();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [shouldCloseAfterSave, setShouldCloseAfterSave] = useState(false);

  // Enable auto-save for the current project
  useAutoSave();

  // Memoize the close requested callback to prevent effect re-runs
  const handleCloseRequested = useCallback(() => {
    setShowConfirmClose(true);
  }, []);

  // Handle window close requests
  const { allowClose } = useWindowCloseHandler(
    isTemporary || isDirty,
    handleCloseRequested
  );

  useEffect(() => {
    // Redirect to start screen if no project is loaded
    if (!project) {
      toast.error("No project loaded. Returning to start screen.");
      navigate("/");
    }
  }, [project, navigate]);

  const handleSave = async (projectName: string) => {
    if (!project || !folderPath) return;

    try {
      const result = await saveProjectMutation.mutateAsync({
        projectName,
        currentPath: folderPath,
        project,
      });

      if (result) {
        markAsPermanent(
          { name: result.project.name, path: result.newPath, date: new Date().toISOString() },
          result.project
        );
        setShowSaveDialog(false);

        if (shouldCloseAfterSave) {
          allowClose();
          setTimeout(async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }, WINDOW_CLOSE_DELAY);
        }
      }
    } catch (error) {
      toast.error("Failed to save project. Please try again.");
      setShouldCloseAfterSave(false);
    }
  };

  const handleSaveAndClose = () => {
    setShowConfirmClose(false);
    setShouldCloseAfterSave(true);
    setShowSaveDialog(true);
  };

  const handleDiscardAndClose = async () => {
    if (isTemporary && folderPath) {
      try {
        await discardTemporaryProject(folderPath);
      } catch (error) {
        console.warn("Could not discard temporary project:", error);
      }
    }

    allowClose();

    setTimeout(async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.close();
      } catch (error) {
        console.error("Failed to close window:", error);
      }
    }, WINDOW_CLOSE_DELAY);
  };

  const handleCancelClose = () => {
    setShowConfirmClose(false);
  };

  if (!project) {
    return null;
  }

  return (
    <>
      <div id="main-page" className="w-full h-full flex flex-col">
        <SceneTabBar
          scenes={scenes}
          activeSceneId={activeSceneId}
          onSceneChange={setActiveSceneId}
          onAddScene={addScene}
        />
        <div className="flex-1" />
      </div>
      <SaveProjectDialog
        isOpen={showSaveDialog}
        onSave={handleSave}
        onCancel={() => {
          setShowSaveDialog(false);
          setShouldCloseAfterSave(false);
        }}
        defaultName={project.name}
        isPending={saveProjectMutation.isPending}
      />

      <ConfirmCloseDialog
        isOpen={showConfirmClose}
        onSave={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}
```

- [ ] **Step 5.2 — Run full test suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 5.3 — Commit**

```bash
git add src/components/screens/main/MainPage.tsx
git commit -m "feat: wire SceneTabBar into MainPage with scene store selectors"
```

---

## Final Verification

- [ ] **Run full test suite one more time**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Manual smoke test**

```bash
npm run tauri dev
```

Verify:
1. Create a new project → lands on MainPage → SceneTabBar is visible with no tabs (new project has no scenes).
2. Click the "+" button → a "Scene 1" tab appears and is active.
3. Click "+" again → a "Scene 2" tab appears and becomes active.
4. Click "Scene 1" tab → it becomes active.
5. Close without saving → discard dialog works as before.

---

## Summary of Commits

| # | Commit |
|---|---|
| 1 | `test: add createMockScene factory` |
| 2 | `feat: add activeSceneId state and setActiveSceneId action to projectStore` |
| 3 | `feat: add addScene action to projectStore` |
| 4 | `feat: add SceneTabBar component` |
| 5 | `feat: wire SceneTabBar into MainPage with scene store selectors` |
