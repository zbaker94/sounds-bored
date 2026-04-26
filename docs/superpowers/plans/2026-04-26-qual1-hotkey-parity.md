# QUAL1 Hotkey Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `mod+shift+n` hotkey so it correctly navigates to the new pad's page and plays the flip animation, by lifting `pageByScene` state into `uiStore` and centralizing all scene-view hotkeys in `useGlobalHotkeys`.

**Architecture:** `pageByScene: Record<string, number>` and `setScenePage(sceneId, page)` move from `SceneView` local `useState` into `uiStore`. With page state in the store, `useGlobalHotkeys` can implement `shift+left`, `shift+right`, and the fixed `mod+shift+n` entirely via `getState()` calls — no React state setters needed. `PADS_PER_PAGE` moves to `constants.ts` so both `SceneView` and `useGlobalHotkeys` share the single source of truth.

**Tech Stack:** React 19, Zustand (no Immer for uiStore), react-hotkeys-hook, TypeScript strict, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/constants.ts` | Add `export const PADS_PER_PAGE = 12` |
| `src/state/uiStore.ts` | Add `pageByScene` state field + `setScenePage` action |
| `src/state/uiStore.test.ts` | Add `setScenePage` tests |
| `src/components/composite/SceneView/SceneView.tsx` | Remove `pageByScene` useState, remove `shift+left`/`shift+right` hotkeys, read page from uiStore |
| `src/hooks/useGlobalHotkeys.ts` | Add `shift+left`/`shift+right`, fix `mod+shift+n` |
| `docs/review-HEAD.md` | Mark QUAL1 ✅ FIXED |

---

## Task 1: Add `PADS_PER_PAGE` to `constants.ts`

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add the constant**

Open `src/lib/constants.ts` and add under the `// Audio` section (after `AUDIO_FILE_FILTERS`):

```typescript
// UI Layout
export const PADS_PER_PAGE = 12;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "refactor(QUAL1): move PADS_PER_PAGE to constants.ts"
```

---

## Task 2: Add `pageByScene` state and `setScenePage` action to `uiStore`

**Files:**
- Modify: `src/state/uiStore.ts`
- Test: `src/state/uiStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe("pageByScene", ...)` block to the end of `src/state/uiStore.test.ts`, just before the closing `});` of the outer `describe("uiStore", ...)`:

```typescript
  describe("pageByScene", () => {
    it("starts as an empty record", () => {
      expect(useUiStore.getState().pageByScene).toEqual({});
    });

    it("setScenePage sets the page for a given scene", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(2);
    });

    it("setScenePage does not affect other scenes", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      useUiStore.getState().setScenePage("scene-2", 5);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(2);
      expect(useUiStore.getState().pageByScene["scene-2"]).toBe(5);
    });

    it("setScenePage overwrites an existing page value", () => {
      useUiStore.getState().setScenePage("scene-1", 2);
      useUiStore.getState().setScenePage("scene-1", 0);
      expect(useUiStore.getState().pageByScene["scene-1"]).toBe(0);
    });

    it("unset scene ids default to 0 via nullish coalescing at read sites", () => {
      expect(useUiStore.getState().pageByScene["unknown-scene"] ?? 0).toBe(0);
    });

    it("resets to empty when initialUiState is applied", () => {
      useUiStore.getState().setScenePage("scene-1", 3);
      useUiStore.setState({ ...initialUiState });
      expect(useUiStore.getState().pageByScene).toEqual({});
    });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx tsc --noEmit && npx vitest run src/state/uiStore.test.ts
```

Expected: TypeScript error — `pageByScene` and `setScenePage` do not exist yet.

- [ ] **Step 3: Implement in `uiStore.ts`**

In `src/state/uiStore.ts`:

**Add to `UiState` interface** (after `fadePopoverTarget`):
```typescript
  /** Current page index per scene, keyed by scene id. Missing keys default to 0. */
  pageByScene: Record<string, number>;
```

**Add to `UiActions` interface** (after `setFadePopoverTarget`):
```typescript
  /** Set the current page for a scene's pad grid. */
  setScenePage: (sceneId: string, page: number) => void;
```

**Update `initialUiState`** (add after `fadePopoverTarget: null`):
```typescript
  pageByScene: {},
```

**Add the action implementation** in the `create()` call (after `setFadePopoverTarget`):
```typescript
  setScenePage: (sceneId, page) =>
    set((state) => ({ pageByScene: { ...state.pageByScene, [sceneId]: page } })),
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx tsc --noEmit && npx vitest run src/state/uiStore.test.ts
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/state/uiStore.ts src/state/uiStore.test.ts
git commit -m "feat(QUAL1): add pageByScene state and setScenePage action to uiStore"
```

---

## Task 3: Migrate `SceneView` page state from `useState` to `uiStore`

**Files:**
- Modify: `src/components/composite/SceneView/SceneView.tsx`

- [ ] **Step 1: Update imports**

In `src/components/composite/SceneView/SceneView.tsx`:

Replace the import line:
```typescript
import { PADS_PER_PAGE } from "@/lib/constants";
```
(It doesn't exist yet — add it to the existing constants import block.)

Add to the `@/lib/constants` import (it's not imported yet; add a new import line near the top with the other `@/lib/*` imports):
```typescript
import { PADS_PER_PAGE } from "@/lib/constants";
```

Remove the local constant at line 44:
```typescript
const PADS_PER_PAGE = 12;
```

Remove the `useHotkeys` import (line 31) — it is only used by the two hotkeys being removed in Step 3:
```typescript
import { useHotkeys } from "react-hotkeys-hook";
```

- [ ] **Step 2: Replace `useState` page tracking with `uiStore` subscription**

Find and remove this line (around line 116):
```typescript
const [pageByScene, setPageByScene] = useState<Record<string, number>>({});
```

Add in its place (after the `addScene` line, or near the other `useUiStore` reads at the top of the component):
```typescript
const pageByScene = useUiStore((s) => s.pageByScene);
```

- [ ] **Step 3: Update `setPage` helper**

Replace the current `setPage` useCallback (around line 130):
```typescript
const setPage = useCallback((updater: (prev: number) => number) => {
  if (!activeScene) return;
  setPageByScene((prev) => ({
    ...prev,
    [activeScene.id]: updater(prev[activeScene.id] ?? 0),
  }));
}, [activeScene]);
```

With:
```typescript
const setPage = useCallback((updater: (prev: number) => number) => {
  if (!activeScene) return;
  const currentPage = useUiStore.getState().pageByScene[activeScene.id] ?? 0;
  useUiStore.getState().setScenePage(activeScene.id, updater(currentPage));
}, [activeScene]);
```

- [ ] **Step 4: Update `handleAddPad` to call `setScenePage` directly**

Replace the current `handleAddPad` (around line 141):
```typescript
const handleAddPad = useCallback(() => {
  if (!activeSceneId) return;
  const newId = crypto.randomUUID();
  const config: PadConfig = {
    name: "",
    layers: [createDefaultStoreLayer()],
    muteTargetPadIds: [],
  };
  addPad(activeSceneId, config, newId);
  const updatedScene = useProjectStore.getState().project?.scenes.find(s => s.id === activeSceneId);
  if (updatedScene) {
    setPage(() => Math.floor((updatedScene.pads.length - 1) / PADS_PER_PAGE));
  }
  setTimeout(() => setEditingPadId(newId), 0);
}, [activeSceneId, addPad, setEditingPadId, setPage]);
```

With:
```typescript
const handleAddPad = useCallback(() => {
  if (!activeSceneId) return;
  const newId = crypto.randomUUID();
  const config: PadConfig = {
    name: "",
    layers: [createDefaultStoreLayer()],
    muteTargetPadIds: [],
  };
  addPad(activeSceneId, config, newId);
  const updatedScene = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId);
  if (updatedScene) {
    useUiStore.getState().setScenePage(activeSceneId, Math.floor((updatedScene.pads.length - 1) / PADS_PER_PAGE));
  }
  setTimeout(() => setEditingPadId(newId), 0);
}, [activeSceneId, addPad, setEditingPadId]);
```

Note: `setPage` removed from the dependency array since `useUiStore.getState()` is a stable reference.

- [ ] **Step 5: Update `handleDragEnd` to call `setScenePage` directly**

Replace the `setPage` call inside `handleDragEnd`:
```typescript
      setPage(() => Math.floor(toIndex / PADS_PER_PAGE));
```

With:
```typescript
      useUiStore.getState().setScenePage(activeScene.id, Math.floor(toIndex / PADS_PER_PAGE));
```

- [ ] **Step 6: Remove `shift+left` and `shift+right` hotkey registrations**

Delete these two `useHotkeys` blocks entirely (around lines 187–202):
```typescript
  useHotkeys(
    "shift+left",
    () => {
      if (safePage > 0) setPage((p) => p - 1);
      else setPage(() => totalPages - 1);
    },
    { preventDefault: true },
  );
  useHotkeys(
    "shift+right",
    () => {
      if (!isLastPage) setPage((p) => p + 1);
      else setPage(() => 0);
    },
    { preventDefault: true },
  );
```

- [ ] **Step 7: Type-check and run tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no TypeScript errors, all existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/composite/SceneView/SceneView.tsx
git commit -m "refactor(QUAL1): migrate SceneView page state to uiStore, remove local hotkeys"
```

---

## Task 4: Consolidate all page hotkeys in `useGlobalHotkeys` and fix `mod+shift+n`

**Files:**
- Modify: `src/hooks/useGlobalHotkeys.ts`

- [ ] **Step 1: Add `PADS_PER_PAGE` import**

In `src/hooks/useGlobalHotkeys.ts`, add to the imports block:
```typescript
import { PADS_PER_PAGE } from "@/lib/constants";
```

- [ ] **Step 2: Add `shift+left` hotkey**

Insert the following block directly before the `// Mod+Shift+N` comment (around line 147). This mirrors the SceneView logic: wraps around (last page → page 0) and clamps `safePage` to handle stale page values:

```typescript
  // Shift+Left: go to previous page of the active scene's pad grid (wraps).
  useHotkeys("shift+left", () => {
    const { activeSceneId, pageByScene, setScenePage } = useUiStore.getState();
    if (!activeSceneId) return;
    const pads = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId)?.pads ?? [];
    const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
    const page = pageByScene[activeSceneId] ?? 0;
    setScenePage(activeSceneId, page > 0 ? page - 1 : totalPages - 1);
  }, { preventDefault: true });

  // Shift+Right: go to next page of the active scene's pad grid (wraps).
  useHotkeys("shift+right", () => {
    const { activeSceneId, pageByScene, setScenePage } = useUiStore.getState();
    if (!activeSceneId) return;
    const pads = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId)?.pads ?? [];
    const totalPages = Math.max(1, Math.ceil(pads.length / PADS_PER_PAGE));
    const page = pageByScene[activeSceneId] ?? 0;
    const safePage = Math.min(page, totalPages - 1);
    setScenePage(activeSceneId, safePage < totalPages - 1 ? safePage + 1 : 0);
  }, { preventDefault: true });
```

- [ ] **Step 3: Fix `mod+shift+n`**

Replace the existing `mod+shift+n` block (around line 147):
```typescript
  // Mod+Shift+N: add a new pad to the active scene and flip it into edit mode.
  useHotkeys("mod+shift+n", () => {
    const { project, addPad } = useProjectStore.getState();
    const { activeSceneId, setEditingPadId } = useUiStore.getState();
    if (!activeSceneId || !project?.scenes.some((s) => s.id === activeSceneId)) return;
    const newId = crypto.randomUUID();
    const config: PadConfig = {
      name: "",
      layers: [createDefaultStoreLayer()],
      muteTargetPadIds: [],
    };
    addPad(activeSceneId, config, newId);
    setEditingPadId(newId);
  });
```

With:
```typescript
  // Mod+Shift+N: add a new pad to the active scene, navigate to its page, and flip it into edit mode.
  useHotkeys("mod+shift+n", () => {
    const { project, addPad } = useProjectStore.getState();
    const { activeSceneId, setEditingPadId, setScenePage } = useUiStore.getState();
    if (!activeSceneId || !project?.scenes.some((s) => s.id === activeSceneId)) return;
    const newId = crypto.randomUUID();
    const config: PadConfig = {
      name: "",
      layers: [createDefaultStoreLayer()],
      muteTargetPadIds: [],
    };
    addPad(activeSceneId, config, newId);
    const updatedScene = useProjectStore.getState().project?.scenes.find((s) => s.id === activeSceneId);
    if (updatedScene) {
      setScenePage(activeSceneId, Math.floor((updatedScene.pads.length - 1) / PADS_PER_PAGE));
    }
    setTimeout(() => setEditingPadId(newId), 0);
  });
```

Key changes vs the old version:
- After `addPad`, re-reads `useProjectStore.getState()` to get the post-mutation scene with the new pad
- Calls `setScenePage` with the computed page so the grid navigates before the pad tries to mount
- Wraps `setEditingPadId` in `setTimeout(..., 0)` so the pad mounts at `rotateY(0deg)` first and the CSS flip transition has a start state to animate from

- [ ] **Step 4: Type-check and run tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no TypeScript errors, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalHotkeys.ts src/lib/constants.ts
git commit -m "fix(QUAL1): centralize page hotkeys in useGlobalHotkeys; fix mod+shift+n page nav and flip defer"
```

---

## Task 5: Mark QUAL1 fixed in `docs/review-HEAD.md`

**Files:**
- Modify: `docs/review-HEAD.md`

- [ ] **Step 1: Update the summary table**

Find the Medium row in the summary table:
```markdown
| Medium | 16 (6 fixed) |
```

Change to:
```markdown
| Medium | 16 (7 fixed) |
```

- [ ] **Step 2: Strike through the QUAL1 heading and add fix description**

Find the QUAL1 heading:
```markdown
### [QUAL1] `addPad + flip` logic duplicated between `SceneView.handleAddPad` and `mod+shift+n` hotkey
```

Replace with:
```markdown
### ~~[QUAL1] `addPad + flip` logic duplicated between `SceneView.handleAddPad` and `mod+shift+n` hotkey~~ ✅ FIXED
```

At the end of the QUAL1 block (after the `- **Recommendation**: ...` line), add:
```markdown
- **Fix applied**: Lifted `pageByScene: Record<string, number>` and `setScenePage(sceneId, page)` from `SceneView` local `useState` into `uiStore`. Moved `PADS_PER_PAGE` constant to `constants.ts`. Removed `shift+left` / `shift+right` `useHotkeys` registrations from `SceneView` — they now live in `useGlobalHotkeys` alongside all other hotkeys, using `useUiStore.getState()` to read and write page state. Fixed `mod+shift+n`: after `addPad`, re-reads post-mutation store state to compute the new pad's page, calls `setScenePage`, and wraps `setEditingPadId` in `setTimeout(..., 0)` so the pad mounts at `rotateY(0deg)` before flipping. 6 tests added to `uiStore.test.ts` covering `setScenePage` behavior.
```

- [ ] **Step 3: Add QUAL1 to the Fixed Items table**

Find the Fixed Items table at the bottom of the document and add a new row:
```markdown
| QUAL1 | `mod+shift+n` hotkey now navigates to new pad's page and plays flip animation; all page hotkeys centralized in `useGlobalHotkeys` |
```

- [ ] **Step 4: Commit**

```bash
git add docs/review-HEAD.md
git commit -m "docs: mark QUAL1 fixed in review-HEAD.md"
```

---

## Self-Review

**Spec coverage:**
- ✅ `pageByScene` lifted to `uiStore` with `setScenePage` action
- ✅ `PADS_PER_PAGE` moved to `constants.ts`
- ✅ `shift+left` / `shift+right` moved from `SceneView` to `useGlobalHotkeys`
- ✅ `mod+shift+n` fixed with page navigation + `setTimeout` defer
- ✅ `useHotkeys` import removed from `SceneView` (no longer used after removing both hotkeys)
- ✅ `setPage` helper updated to use `useUiStore.getState()` (used by pagination prev/next buttons in JSX)
- ✅ `handleAddPad` deps array updated (removed stale `setPage` dep)
- ✅ Tests added for `setScenePage`
- ✅ `docs/review-HEAD.md` updated

**Placeholder scan:** No TBDs or vague steps — all code is explicit.

**Type consistency:** `setScenePage(sceneId: string, page: number)` defined in Task 2, called identically in Tasks 3 and 4. `pageByScene: Record<string, number>` defined in Task 2, read via `useUiStore.getState().pageByScene[id] ?? 0` in Tasks 3 and 4. `PADS_PER_PAGE` added as `number` in Task 1, imported and used as a numeric divisor in Tasks 3 and 4.
