# Sound Selector Search & Folder Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat assigned-sound list in `SoundSelector` with a searchable folder tree, and add search filtering to tag/set modes.

**Architecture:** Pure tree-building logic lives in `soundTreeUtils.ts` (no React, fully testable). `SoundFolderTree` is a React component that reads `globalFolders` from `appSettingsStore` and renders the tree using shadcn `Collapsible` nodes. `SoundSelector` gains a search input (Fuse.js for assigned, substring for tag/set) and swaps the flat list for `SoundFolderTree` when there is no active query.

**Tech Stack:** Fuse.js (fuzzy search), shadcn `Collapsible`, Zustand `useShallow` (reference-stable selectors), Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-24-sound-selector-search-tree-design.md`

---

## File Map

### New Files
- `src/components/composite/PadConfigDrawer/soundTreeUtils.ts` — pure functions: `normalizePath`, `buildTree`, `findFolderNode`, `getSoundsInSubtree`; exports `TreeNode` type
- `src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts` — unit tests for tree logic
- `src/components/composite/PadConfigDrawer/SoundFolderTree.tsx` — React tree component using `Collapsible`
- `src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx` — component tests

### Modified Files
- `src/components/composite/PadConfigDrawer/SoundSelector.tsx` — add search input + Fuse.js + tree integration
- `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx` — add search and tree tests

---

## Task 1: Install dependencies

**Files:** `package.json`, `package-lock.json`, `src/components/ui/collapsible.tsx`

- [ ] **Step 1: Install fuse.js**

```bash
npm install fuse.js
```

- [ ] **Step 2: Add shadcn collapsible component**

```bash
npx shadcn@latest add collapsible
```

Expected: `src/components/ui/collapsible.tsx` created.

- [ ] **Step 3: Verify installs**

```bash
npm ls fuse.js
```

Expected: `fuse.js@x.x.x` listed.

- [ ] **Step 4: Run existing tests to verify nothing broke**

```bash
npm run test:run
```

Expected: all 256 tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ui/collapsible.tsx
git commit -m "chore: install fuse.js, add shadcn collapsible"
```

---

## Task 2: Create soundTreeUtils — pure tree logic

**Files:**
- Create: `src/components/composite/PadConfigDrawer/soundTreeUtils.ts`
- Create: `src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts`

This module is pure TypeScript — no React, no store access. It exports functions for building and traversing the folder tree.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildTree, findFolderNode, getSoundsInSubtree, normalizePath } from "./soundTreeUtils";
import type { GlobalFolder, Sound } from "@/lib/schemas";

function folder(id: string, path: string, name?: string): GlobalFolder {
  return { id, path, name: name ?? id };
}

function sound(id: string, name: string, folderId?: string): Sound {
  return { id, name, tags: [], sets: [], folderId };
}

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\sounds\\drums")).toBe("C:/sounds/drums");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizePath("/sounds/drums")).toBe("/sounds/drums");
  });

  it("handles mixed separators", () => {
    expect(normalizePath("C:/sounds\\drums/kicks")).toBe("C:/sounds/drums/kicks");
  });
});

describe("buildTree", () => {
  it("returns sound nodes at root when no folders exist", () => {
    const result = buildTree([sound("s1", "Kick")], []);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("sound");
  });

  it("places sounds with no folderId at root", () => {
    const result = buildTree([sound("s1", "Kick")], [folder("f1", "/sounds")]);
    const rootSounds = result.filter((n) => n.kind === "sound");
    expect(rootSounds).toHaveLength(1);
  });

  it("places sounds with an unknown folderId at root", () => {
    const result = buildTree([sound("s1", "Kick", "nonexistent")], []);
    expect(result[0].kind).toBe("sound");
  });

  it("places sounds inside their matching folder", () => {
    const f1 = folder("f1", "/sounds");
    const s1 = sound("s1", "Kick", "f1");
    const result = buildTree([s1], [f1]);
    expect(result).toHaveLength(1);
    const folderNode = result[0];
    expect(folderNode.kind).toBe("folder");
    if (folderNode.kind === "folder") {
      const sounds = folderNode.children.filter((c) => c.kind === "sound");
      expect(sounds).toHaveLength(1);
    }
  });

  it("nests a child folder under its parent based on path prefix", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const result = buildTree([], [parent, child]);
    expect(result).toHaveLength(1); // only parent at root
    const parentNode = result[0];
    expect(parentNode.kind).toBe("folder");
    if (parentNode.kind === "folder") {
      expect(parentNode.children).toHaveLength(1);
      expect(parentNode.children[0].kind).toBe("folder");
    }
  });

  it("handles grandchild folders (multi-level nesting)", () => {
    const root = folder("f1", "/sounds");
    const mid = folder("f2", "/sounds/drums");
    const leaf = folder("f3", "/sounds/drums/kicks");
    const result = buildTree([], [root, mid, leaf]);
    expect(result).toHaveLength(1);
    const rootNode = result[0];
    if (rootNode.kind === "folder") {
      expect(rootNode.children).toHaveLength(1);
      const midNode = rootNode.children[0];
      if (midNode.kind === "folder") {
        expect(midNode.children).toHaveLength(1);
        expect(midNode.children[0].kind).toBe("folder");
      }
    }
  });

  it("normalizes backslash paths when determining parent-child relationships", () => {
    const parent = folder("f1", "C:\\sounds");
    const child = folder("f2", "C:\\sounds\\drums");
    const result = buildTree([], [parent, child]);
    expect(result).toHaveLength(1); // child is nested under parent
    const parentNode = result[0];
    if (parentNode.kind === "folder") {
      expect(parentNode.children).toHaveLength(1);
    }
  });

  it("returns an empty array when given no sounds and no folders", () => {
    expect(buildTree([], [])).toHaveLength(0);
  });
});

describe("findFolderNode", () => {
  it("finds a root-level folder by id", () => {
    const f1 = folder("f1", "/sounds", "Sounds");
    const tree = buildTree([], [f1]);
    const found = findFolderNode(tree, "f1");
    expect(found).not.toBeNull();
    expect(found?.folder.id).toBe("f1");
  });

  it("finds a nested folder by id", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const tree = buildTree([], [parent, child]);
    const found = findFolderNode(tree, "f2");
    expect(found).not.toBeNull();
    expect(found?.folder.id).toBe("f2");
  });

  it("returns null when folder id is not in tree", () => {
    const tree = buildTree([], [folder("f1", "/sounds")]);
    expect(findFolderNode(tree, "nonexistent")).toBeNull();
  });
});

describe("getSoundsInSubtree", () => {
  it("returns all sounds directly in a folder", () => {
    const f1 = folder("f1", "/sounds");
    const s1 = sound("s1", "Kick", "f1");
    const tree = buildTree([s1], [f1]);
    const folderNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(folderNode)).toHaveLength(1);
  });

  it("returns sounds from nested subfolders recursively", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const s1 = sound("s1", "Kick", "f1");
    const s2 = sound("s2", "Snare", "f2");
    const tree = buildTree([s1, s2], [parent, child]);
    const parentNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(parentNode)).toHaveLength(2);
  });

  it("returns empty array for a folder with no sounds", () => {
    const f1 = folder("f1", "/sounds");
    const tree = buildTree([], [f1]);
    const folderNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(folderNode)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create soundTreeUtils.ts**

Create `src/components/composite/PadConfigDrawer/soundTreeUtils.ts`:

```typescript
import type { GlobalFolder, Sound } from "@/lib/schemas";

export type TreeNode =
  | { kind: "folder"; folder: GlobalFolder; children: TreeNode[] }
  | { kind: "sound"; sound: Sound };

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function buildTree(sounds: Sound[], folders: GlobalFolder[]): TreeNode[] {
  // Normalize all folder paths for comparison
  const normalized = folders.map((f) => ({ ...f, path: normalizePath(f.path) }));

  // Find the parent of a folder: the registered folder with the longest path that is a strict prefix
  function findParentId(folder: GlobalFolder & { path: string }): string | null {
    let best: (GlobalFolder & { path: string }) | null = null;
    for (const other of normalized) {
      if (other.id === folder.id) continue;
      if (folder.path.startsWith(other.path + "/")) {
        if (!best || other.path.length > best.path.length) {
          best = other;
        }
      }
    }
    return best?.id ?? null;
  }

  // Build folder node map
  const folderNodes = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const f of normalized) {
    folderNodes.set(f.id, { kind: "folder", folder: f, children: [] });
  }

  // Wire folder nodes into the tree
  const roots: TreeNode[] = [];
  for (const f of normalized) {
    const parentId = findParentId(f);
    const node = folderNodes.get(f.id)!;
    if (parentId && folderNodes.has(parentId)) {
      folderNodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Attach sounds to their folder or root
  for (const sound of sounds) {
    const soundNode: TreeNode = { kind: "sound", sound };
    if (sound.folderId && folderNodes.has(sound.folderId)) {
      folderNodes.get(sound.folderId)!.children.push(soundNode);
    } else {
      roots.push(soundNode);
    }
  }

  return roots;
}

export function findFolderNode(
  nodes: TreeNode[],
  folderId: string
): Extract<TreeNode, { kind: "folder" }> | null {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.folder.id === folderId) return node;
      const found = findFolderNode(node.children, folderId);
      if (found) return found;
    }
  }
  return null;
}

export function getSoundsInSubtree(
  node: Extract<TreeNode, { kind: "folder" }>
): Sound[] {
  const result: Sound[] = [];
  function collect(n: TreeNode) {
    if (n.kind === "sound") {
      result.push(n.sound);
    } else {
      for (const child of n.children) collect(child);
    }
  }
  collect(node);
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/soundTreeUtils.ts src/components/composite/PadConfigDrawer/soundTreeUtils.test.ts
git commit -m "feat: add soundTreeUtils — normalizePath, buildTree, findFolderNode, getSoundsInSubtree"
```

---

## Task 3: Create SoundFolderTree component

**Files:**
- Create: `src/components/composite/PadConfigDrawer/SoundFolderTree.tsx`
- Create: `src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx`

Renders the tree built by `buildTree`. Reads `globalFolders` from `appSettingsStore` internally. Uses `Collapsible` for expandable folder nodes with checkbox selection.

- [ ] **Step 1: Write failing tests**

Create `src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { createMockSound, createMockGlobalFolder, createMockAppSettings } from "@/test/factories";
import { SoundFolderTree } from "./SoundFolderTree";

function setFolders(folders: ReturnType<typeof createMockGlobalFolder>[]) {
  useAppSettingsStore.setState({
    settings: createMockAppSettings({ globalFolders: folders }),
  });
}

describe("SoundFolderTree", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders sounds with no folderId at root level", () => {
    const sound = createMockSound({ name: "Kick Drum" });
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
  });

  it("renders a folder node when a folder exists", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(screen.getByText("Drums")).toBeInTheDocument();
  });

  it("calls onToggleSound with the sound id when a sound checkbox is clicked", async () => {
    const onToggleSound = vi.fn();
    const sound = createMockSound({ id: "s1", name: "Kick" });
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={onToggleSound}
        onToggleFolder={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onToggleSound).toHaveBeenCalledWith("s1");
  });

  it("calls onToggleFolder with the folder id when a folder checkbox is clicked", async () => {
    const onToggleFolder = vi.fn();
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const sound = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={onToggleFolder}
      />
    );
    // First checkbox belongs to the folder row
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    expect(onToggleFolder).toHaveBeenCalledWith("f1");
  });

  it("shows folder checkbox as checked when all subtree sounds are selected", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const sound = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[sound]}
        selectedIds={new Set(["s1"])}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it("shows folder checkbox as indeterminate when some (not all) subtree sounds are selected", () => {
    const folder = createMockGlobalFolder({ id: "f1", path: "/sounds", name: "Drums" });
    const s1 = createMockSound({ id: "s1", name: "Kick", folderId: "f1" });
    const s2 = createMockSound({ id: "s2", name: "Snare", folderId: "f1" });
    setFolders([folder]);
    render(
      <SoundFolderTree
        sounds={[s1, s2]}
        selectedIds={new Set(["s1"])}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect((checkboxes[0] as HTMLInputElement).indeterminate).toBe(true);
  });

  it("renders nothing when sounds and folders are both empty", () => {
    const { container } = render(
      <SoundFolderTree
        sounds={[]}
        selectedIds={new Set()}
        onToggleSound={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create SoundFolderTree.tsx**

Create `src/components/composite/PadConfigDrawer/SoundFolderTree.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { buildTree, getSoundsInSubtree, type TreeNode } from "./soundTreeUtils";
import type { Sound } from "@/lib/schemas";

interface SoundFolderTreeProps {
  sounds: Sound[];
  selectedIds: Set<string>;
  onToggleSound: (soundId: string) => void;
  onToggleFolder: (folderId: string) => void;
}

function SoundNodeRow({
  sound,
  selected,
  onToggle,
}: {
  sound: Sound;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="accent-primary"
      />
      {sound.name}
    </label>
  );
}

function FolderNodeRow({
  node,
  selectedIds,
  onToggleSound,
  onToggleFolder,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  selectedIds: Set<string>;
  onToggleSound: (soundId: string) => void;
  onToggleFolder: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const checkboxRef = useRef<HTMLInputElement>(null);

  const subtreeSounds = useMemo(() => getSoundsInSubtree(node), [node]);
  const selectedCount = subtreeSounds.filter((s) => selectedIds.has(s.id)).length;
  const isChecked = subtreeSounds.length > 0 && selectedCount === subtreeSounds.length;
  const isIndeterminate = selectedCount > 0 && selectedCount < subtreeSounds.length;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleFolder(node.folder.id)}
          className="accent-primary"
        />
        <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium hover:text-foreground/80">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {node.folder.name}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pl-5 flex flex-col gap-1 mt-1">
        {node.children.map((child) =>
          child.kind === "folder" ? (
            <FolderNodeRow
              key={child.folder.id}
              node={child}
              selectedIds={selectedIds}
              onToggleSound={onToggleSound}
              onToggleFolder={onToggleFolder}
            />
          ) : (
            <SoundNodeRow
              key={child.sound.id}
              sound={child.sound}
              selected={selectedIds.has(child.sound.id)}
              onToggle={() => onToggleSound(child.sound.id)}
            />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SoundFolderTree({
  sounds,
  selectedIds,
  onToggleSound,
  onToggleFolder,
}: SoundFolderTreeProps) {
  const globalFolders = useAppSettingsStore(
    useShallow((s) => s.settings?.globalFolders ?? [])
  );

  const roots = useMemo(
    () => buildTree(sounds, globalFolders),
    [sounds, globalFolders]
  );

  if (roots.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
      {roots.map((node) =>
        node.kind === "folder" ? (
          <FolderNodeRow
            key={node.folder.id}
            node={node}
            selectedIds={selectedIds}
            onToggleSound={onToggleSound}
            onToggleFolder={onToggleFolder}
          />
        ) : (
          <SoundNodeRow
            key={node.sound.id}
            sound={node.sound}
            selected={selectedIds.has(node.sound.id)}
            onToggle={() => onToggleSound(node.sound.id)}
          />
        )
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/SoundFolderTree.tsx src/components/composite/PadConfigDrawer/SoundFolderTree.test.tsx
git commit -m "feat: add SoundFolderTree component with collapsible folder nodes"
```

---

## Task 4: Update SoundSelector — search + tree integration

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/SoundSelector.tsx`
- Modify: `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx`

Replace the flat sound list with `SoundFolderTree` (no query) or Fuse.js flat results (active query). Add search input to all three modes. Tag/set modes use substring filter.

- [ ] **Step 1: Add new failing tests**

Add to `src/components/composite/PadConfigDrawer/SoundSelector.test.tsx` — append after the existing tests (do not remove any existing tests):

```typescript
import userEvent from "@testing-library/user-event";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import { createMockAppSettings } from "@/test/factories";

// Add this to the existing beforeEach or add a new beforeEach for the new describes:
// useAppSettingsStore.setState({ settings: null });

describe("SoundSelector — assigned mode — search", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input", () => {
    const sound = createMockSound({ name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("filters sounds by name when a query is typed", async () => {
    const kick = createMockSound({ name: "Kick Drum" });
    const snare = createMockSound({ name: "Snare" });
    useLibraryStore.setState({ sounds: [kick, snare], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Kick");
    expect(screen.getByText("Kick Drum")).toBeInTheDocument();
    expect(screen.queryByText("Snare")).not.toBeInTheDocument();
  });

  it("shows 'No results.' when search query matches nothing", async () => {
    const sound = createMockSound({ name: "Kick" });
    useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "zzzzxxx");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("finds sounds by tag name", async () => {
    const tag = createMockTag({ id: "t1", name: "Percussion" });
    const kick = createMockSound({ name: "Kick", tags: ["t1"] });
    const ambient = createMockSound({ name: "Ambient Pad", tags: [] });
    useLibraryStore.setState({ sounds: [kick, ambient], tags: [tag], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "assigned", instances: [] }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Percussion");
    expect(screen.getByText("Kick")).toBeInTheDocument();
    expect(screen.queryByText("Ambient Pad")).not.toBeInTheDocument();
  });
});

describe("SoundSelector — tag mode — search", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input for tag mode", () => {
    const tag = createMockTag({ name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "tag", tagId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("shows 'No results.' when tag search matches nothing", async () => {
    const tag = createMockTag({ name: "Percussion" });
    useLibraryStore.setState({ sounds: [], tags: [tag], sets: [], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "tag", tagId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "zzzzxxx");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });
});

describe("SoundSelector — set mode — search", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
    useAppSettingsStore.setState({ settings: null });
  });

  it("renders a search input for set mode", () => {
    const set = createMockSet({ name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("shows 'No results.' when set search matches nothing", async () => {
    const set = createMockSet({ name: "My Drums" });
    useLibraryStore.setState({ sounds: [], tags: [], sets: [set], isDirty: false });
    render(
      <SoundSelector
        value={{ type: "set", setId: "", defaultVolume: 100 }}
        onChange={vi.fn()}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/search/i), "zzzzxxx");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
```

Expected: new tests FAIL, existing 6 tests still PASS.

- [ ] **Step 3: Replace SoundSelector.tsx**

Replace the entire contents of `src/components/composite/PadConfigDrawer/SoundSelector.tsx`:

```typescript
import { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import Fuse from "fuse.js";
import { useLibraryStore } from "@/state/libraryStore";
import { useAppSettingsStore } from "@/state/appSettingsStore";
import type { LayerSelection, Sound, SoundInstance } from "@/lib/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SoundFolderTree } from "./SoundFolderTree";
import { buildTree, findFolderNode, getSoundsInSubtree } from "./soundTreeUtils";

type SoundSearchDoc = { sound: Sound; tagNames: string[] };

interface SoundSelectorProps {
  value: LayerSelection;
  onChange: (value: LayerSelection) => void;
}

export function SoundSelector({ value, onChange }: SoundSelectorProps) {
  const [query, setQuery] = useState("");

  const sounds = useLibraryStore(useShallow((s) => s.sounds));
  const tags = useLibraryStore(useShallow((s) => s.tags));
  const sets = useLibraryStore(useShallow((s) => s.sets));
  const globalFolders = useAppSettingsStore(
    useShallow((s) => s.settings?.globalFolders ?? [])
  );

  // Build denormalized search docs: sound + resolved tag names
  const searchDocs: SoundSearchDoc[] = useMemo(
    () =>
      sounds.map((sound) => ({
        sound,
        tagNames: sound.tags.map(
          (tid) => tags.find((t) => t.id === tid)?.name ?? ""
        ),
      })),
    [sounds, tags]
  );

  const fuse = useMemo(
    () =>
      new Fuse(searchDocs, {
        keys: ["sound.name", "tagNames"],
        threshold: 0.4,
      }),
    [searchDocs]
  );

  if (value.type === "assigned") {
    const selectedIds = new Set(value.instances.map((i) => i.soundId));

    function toggleSound(soundId: string) {
      if (value.type !== "assigned") return;
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
        onChange({
          type: "assigned",
          instances: [...value.instances, newInstance],
        });
      }
    }

    function toggleFolder(folderId: string) {
      if (value.type !== "assigned") return;
      const tree = buildTree(sounds, globalFolders);
      const folderNode = findFolderNode(tree, folderId);
      if (!folderNode) return;
      const subtreeSounds = getSoundsInSubtree(folderNode);
      const allSelected = subtreeSounds.every((s) => selectedIds.has(s.id));
      if (allSelected) {
        const subtreeIds = new Set(subtreeSounds.map((s) => s.id));
        onChange({
          type: "assigned",
          instances: value.instances.filter((i) => !subtreeIds.has(i.soundId)),
        });
      } else {
        const existing = new Set(value.instances.map((i) => i.soundId));
        const newInstances: SoundInstance[] = subtreeSounds
          .filter((s) => !existing.has(s.id))
          .map((s) => ({ id: crypto.randomUUID(), soundId: s.id, volume: 100 }));
        onChange({
          type: "assigned",
          instances: [...value.instances, ...newInstances],
        });
      }
    }

    if (sounds.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">No sounds in library yet.</p>
      );
    }

    const trimmed = query.trim();
    const searchResults = trimmed
      ? fuse.search(trimmed).map((r) => r.item.sound)
      : null;

    return (
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Search sounds or tags..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No results.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {searchResults.map((sound) => (
                <label
                  key={sound.id}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                >
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
          )
        ) : (
          <SoundFolderTree
            sounds={sounds}
            selectedIds={selectedIds}
            onToggleSound={toggleSound}
            onToggleFolder={toggleFolder}
          />
        )}
      </div>
    );
  }

  if (value.type === "tag") {
    const trimmed = query.trim();
    const filteredTags = trimmed
      ? tags.filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()))
      : tags;

    return (
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Search tags..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filteredTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {trimmed ? "No results." : "No tags in library yet."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Select tag</Label>
            <Select
              value={value.tagId}
              onValueChange={(tagId) =>
                onChange({ type: "tag", tagId, defaultVolume: value.defaultVolume })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a tag..." />
              </SelectTrigger>
              <SelectContent>
                {filteredTags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  }

  // value.type === "set"
  const trimmed = query.trim();
  const filteredSets = trimmed
    ? sets.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()))
    : sets;

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Search sets..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filteredSets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {trimmed ? "No results." : "No sets in library yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Select set</Label>
          <Select
            value={value.setId}
            onValueChange={(setId) =>
              onChange({ type: "set", setId, defaultVolume: value.defaultVolume })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a set..." />
            </SelectTrigger>
            <SelectContent>
              {filteredSets.map((set) => (
                <SelectItem key={set.id} value={set.id}>
                  {set.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
```

**Important:** The existing `SoundSelector.test.tsx` tests that check `screen.getByText("Select tag")` and `screen.getByText("Select set")` will now FAIL — those label texts changed. Update those two assertions in the existing tests to match the new labels (`"Select tag"` → still present as a `<Label>` element, so the tests should still pass). Run tests to verify.

- [ ] **Step 4: Run all SoundSelector tests**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
```

Expected: all tests PASS (existing + new). If any existing tests fail due to the label changes, update their assertions to match the new rendered output before continuing.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/composite/PadConfigDrawer/SoundSelector.tsx src/components/composite/PadConfigDrawer/SoundSelector.test.tsx
git commit -m "feat: add search and folder tree to SoundSelector"
```
