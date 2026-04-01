# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 17 findings from the feature/tag-system code review (2 High, 6 Medium, 7 Low, 2 Info).

**Architecture:** Fixes fall into 9 independent groups: (1) constant extraction + propagation, (2) tagImportedSounds de-duplication, (3) SoundsPanel refactor, (4) schema validation, (5) SoundSelector performance, (6) AddTagsDialog cleanup, (7) LayerConfigSection type guards, (8) padPlayer performance, (9) documentation comments.

**Tech Stack:** React 19 + TypeScript strict + Zustand + Immer + Zod 4 + Vitest + React Testing Library

---

## File Map

| File | Action | Reason |
|---|---|---|
| `src/lib/constants.ts` | Modify | Add `SYSTEM_TAG_IMPORTED` constant |
| `src/lib/schemas.ts` | Modify | Add `.min(1).max(100)` to `TagSchema.name` |
| `src/lib/schemas.test.ts` | Modify | Tests for name validation |
| `src/lib/import.ts` | Modify | Refactor `tagImportedSounds` to pure function (no store coupling) |
| `src/hooks/useImportSounds.ts` | Create | New hook: copy + reconcile + tag + save |
| `src/hooks/useImportSounds.test.ts` | Create | Unit tests for the new hook |
| `src/hooks/useBootLoader.ts` | Modify | Use `SYSTEM_TAG_IMPORTED` constant |
| `src/state/libraryStore.ts` | Modify | Add invariant documentation comments |
| `src/components/composite/SidePanel/SoundsPanel.tsx` | Modify | Use `useImportSounds`, extract `SoundListItem`, memoize arrays |
| `src/components/composite/SidePanel/AddTagsDialog.tsx` | Modify | Hook selectors, remove eslint-disable via ref pattern |
| `src/components/composite/PadConfigDrawer/SoundSelector.tsx` | Modify | Single-pass O(sounds) count maps |
| `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx` | Modify | Runtime guards for tab value casts |
| `src/lib/audio/padPlayer.ts` | Modify | Map for assigned-mode lookup, OR semantics comment |

---

## Task 1: Add `SYSTEM_TAG_IMPORTED` constant and propagate it

Fixes: [High] magic string "imported" in four locations.

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/import.ts`
- Modify: `src/hooks/useBootLoader.ts`

- [ ] **Step 1: Add constant to constants.ts**

In `src/lib/constants.ts`, add after the Audio section:

```typescript
// System tag names
export const SYSTEM_TAG_IMPORTED = "imported";
```

- [ ] **Step 2: Use constant in import.ts**

In `src/lib/import.ts`, update the import line and the `ensureTagExists` call:

```typescript
import { AUDIO_EXTENSIONS, SYSTEM_TAG_IMPORTED } from "@/lib/constants";
```

Then in `tagImportedSounds` (the existing call on line 67):
```typescript
const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
```

- [ ] **Step 3: Use constant in useBootLoader.ts**

In `src/hooks/useBootLoader.ts`, add the import:
```typescript
import { SYSTEM_TAG_IMPORTED } from "@/lib/constants";
```

Replace the two string literals:
```typescript
// Line ~68 — was: (t) => t.name.toLowerCase() === "imported"
const existingImportedTag = currentTags.find(
  (t) => t.name.toLowerCase() === SYSTEM_TAG_IMPORTED,
);
// Line ~79 — was: ensureTagExists("imported", undefined, true)
const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```
Expected: all tests pass (pure rename, no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.ts src/lib/import.ts src/hooks/useBootLoader.ts
git commit -m "refactor: extract SYSTEM_TAG_IMPORTED constant, replace magic strings"
```

---

## Task 2: Refactor `tagImportedSounds` to a pure function

Fixes: [Medium] `import.ts` coupling to Zustand store.

The current `tagImportedSounds` reaches into `useLibraryStore.getState()` directly. By accepting the store functions as parameters it becomes a pure utility testable without mocking the store.

**Files:**
- Modify: `src/lib/import.ts`

- [ ] **Step 1: Rewrite tagImportedSounds signature**

Replace the existing `tagImportedSounds` function in `src/lib/import.ts` with:

```typescript
import { AUDIO_EXTENSIONS, SYSTEM_TAG_IMPORTED } from "@/lib/constants";
import type { Sound, Tag } from "@/lib/schemas";
// Remove: import { useLibraryStore } from "@/state/libraryStore";
```

```typescript
/**
 * Tag newly imported sounds with the system "imported" tag.
 *
 * Pure function — accepts store state and actions as parameters so it
 * can be called from any context (hook, test) without store coupling.
 *
 * @param soundsBeforeImport - snapshot of sounds array taken before reconciliation
 * @param soundsAfterImport  - current sounds array after reconciliation
 * @param ensureTagExists    - from libraryStore
 * @param systemAssignTagsToSounds - from libraryStore (bypasses system-tag guard)
 */
export function tagImportedSounds(
  soundsBeforeImport: Sound[],
  soundsAfterImport: Sound[],
  ensureTagExists: (name: string, color?: string, isSystem?: boolean) => Tag,
  systemAssignTagsToSounds: (soundIds: string[], tagIds: string[]) => void,
): void {
  const previousIds = new Set(soundsBeforeImport.map((s) => s.id));
  const newSoundIds = soundsAfterImport
    .filter((s) => !previousIds.has(s.id))
    .map((s) => s.id);

  if (newSoundIds.length === 0) return;

  const importedTag = ensureTagExists(SYSTEM_TAG_IMPORTED, undefined, true);
  systemAssignTagsToSounds(newSoundIds, [importedTag.id]);
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```
Expected: all tests pass (`tagImportedSounds` wasn't tested directly before; callers will be updated in Task 3).

---

## Task 3: Create `useImportSounds` hook

Fixes: [High] triplicated import-tagging logic; [Medium] SoundsPanel orchestration inline.

The new hook encapsulates copy + reconcile + tag + save. Callers just pass paths; the hook owns all the orchestration.

**Files:**
- Create: `src/hooks/useImportSounds.ts`
- Create: `src/hooks/useImportSounds.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useImportSounds.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImportSounds } from "./useImportSounds";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockGlobalFolder, createMockSound } from "@/test/factories";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/import", () => ({
  copyFilesToFolder: vi.fn(),
  tagImportedSounds: vi.fn(),
}));

vi.mock("@/lib/library.reconcile", () => ({
  reconcileGlobalLibrary: vi.fn(),
}));

const mockMutate = vi.fn();
vi.mock("@/lib/library.queries", () => ({
  useSaveGlobalLibrary: vi.fn(() => ({ mutateAsync: mockMutate })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { copyFilesToFolder, tagImportedSounds } from "@/lib/import";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";

const mockCopy = copyFilesToFolder as ReturnType<typeof vi.fn>;
const mockReconcile = reconcileGlobalLibrary as ReturnType<typeof vi.fn>;
const mockTag = tagImportedSounds as ReturnType<typeof vi.fn>;

function makeFolder() {
  return createMockGlobalFolder({ id: "f1", path: "/sounds" });
}

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
  mockCopy.mockReset();
  mockReconcile.mockReset();
  mockTag.mockReset();
  mockMutate.mockReset();
});

describe("useImportSounds", () => {
  it("returns 0 and does nothing when importFolder is undefined", async () => {
    const { result } = renderHook(() =>
      useImportSounds(undefined, [])
    );
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });
    expect(count!).toBe(0);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("returns 0 when no files were copied", async () => {
    mockCopy.mockResolvedValue([]);
    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });
    expect(count!).toBe(0);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("reconciles, tags, and saves when files are copied and library changed", async () => {
    const sound = createMockSound({ id: "s1" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    mockCopy.mockResolvedValue(["/sounds/file.wav"]);
    const newSound = createMockSound({ id: "s2" });
    mockReconcile.mockResolvedValue({ changed: true, sounds: [sound, newSound] });
    mockMutate.mockResolvedValue(undefined);

    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    let count: number;
    await act(async () => {
      count = await result.current(["/file.wav"]);
    });

    expect(count!).toBe(1);
    expect(mockReconcile).toHaveBeenCalled();
    expect(mockTag).toHaveBeenCalledWith(
      [sound],          // soundsBeforeImport
      [sound, newSound], // soundsAfterImport
      expect.any(Function), // ensureTagExists
      expect.any(Function), // systemAssignTagsToSounds
    );
    expect(mockMutate).toHaveBeenCalled();
  });

  it("does not save when reconcile reports no changes", async () => {
    const sound = createMockSound({ id: "s1" });
    useLibraryStore.setState({ ...initialLibraryState, sounds: [sound] });
    mockCopy.mockResolvedValue(["/sounds/file.wav"]);
    mockReconcile.mockResolvedValue({ changed: false, sounds: [sound] });

    const folder = makeFolder();
    const { result } = renderHook(() => useImportSounds(folder, [folder]));
    await act(async () => {
      await result.current(["/file.wav"]);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/hooks/useImportSounds.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement useImportSounds**

Create `src/hooks/useImportSounds.ts`:

```typescript
import { useCallback } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { useSaveGlobalLibrary } from "@/lib/library.queries";
import { copyFilesToFolder, tagImportedSounds } from "@/lib/import";
import { reconcileGlobalLibrary } from "@/lib/library.reconcile";
import type { GlobalFolder } from "@/lib/schemas";

/**
 * Encapsulates the copy → reconcile → tag → save pipeline for importing audio files.
 *
 * Returns a stable async function that callers invoke with the paths to import.
 * Returns the count of files actually copied (0 means nothing changed).
 */
export function useImportSounds(
  importFolder: GlobalFolder | undefined,
  allFolders: GlobalFolder[],
): (paths: string[]) => Promise<number> {
  const updateLibrary = useLibraryStore((s) => s.updateLibrary);
  const { mutateAsync: saveLibrary } = useSaveGlobalLibrary();

  return useCallback(
    async (paths: string[]) => {
      if (!importFolder) return 0;

      const copied = await copyFilesToFolder(paths, importFolder.path);
      if (copied.length === 0) return 0;

      // Snapshot before reconcile — tagImportedSounds uses this to detect new sounds.
      const soundsBeforeImport = useLibraryStore.getState().sounds;

      const result = await reconcileGlobalLibrary(allFolders, soundsBeforeImport);

      if (result.changed) {
        updateLibrary((draft) => {
          draft.sounds = result.sounds;
        });

        const { sounds: soundsAfterImport, ensureTagExists, systemAssignTagsToSounds } =
          useLibraryStore.getState();

        tagImportedSounds(
          soundsBeforeImport,
          soundsAfterImport,
          ensureTagExists,
          systemAssignTagsToSounds,
        );

        const latest = useLibraryStore.getState();
        await saveLibrary({
          version: "1.0.0",
          sounds: latest.sounds,
          tags: latest.tags,
          sets: latest.sets,
        });
      }

      return copied.length;
    },
    // importFolder and allFolders are stable references from settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importFolder?.id, allFolders, updateLibrary, saveLibrary],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/hooks/useImportSounds.test.ts
```
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/import.ts src/hooks/useImportSounds.ts src/hooks/useImportSounds.test.ts
git commit -m "refactor: extract useImportSounds hook, make tagImportedSounds pure"
```

---

## Task 4: Wire `useImportSounds` into SoundsPanel + extract SoundListItem + memoize arrays

Fixes: [High] triplication of import logic in SoundsPanel; [Medium] 25-line inline orchestration; [Medium] per-item IIFE; [Low] `[...selectedSoundIds]` spread on every render.

**Files:**
- Modify: `src/components/composite/SidePanel/SoundsPanel.tsx`

- [ ] **Step 1: Add useImportSounds import and replace handleDropImport + handleImportSounds**

At the top of `SoundsPanel.tsx`, add to the imports:
```typescript
import { useImportSounds } from "@/hooks/useImportSounds";
```

Remove the `copyFilesToFolder` import (it's now inside the hook) and the `reconcileGlobalLibrary` import if nothing else in the file uses it.

Before the `return` statement in `SoundsPanel`, instantiate the hook. `importFolder` is `settings?.globalFolders.find(f => f.id === settings.importFolderId)`:

```typescript
const importFolder = settings?.globalFolders.find(
  (f) => f.id === settings?.importFolderId,
);
const importSounds = useImportSounds(importFolder, settings?.globalFolders ?? EMPTY_FOLDERS);
```

Replace `handleDropImport`:
```typescript
async function handleDropImport(paths: string[]) {
  setIsImporting(true);
  try {
    const count = await importSounds(paths);
    if (count > 0) toast.success(`${count} sound(s) imported`);
  } finally {
    setIsImporting(false);
  }
}
```

Replace `handleImportSounds`:
```typescript
async function handleImportSounds() {
  if (!settings) return;
  setIsImporting(true);
  try {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS.map((e) => e.replace(".", "")) }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const count = await importSounds(paths);
    if (count > 0) toast.success(`${count} sound(s) imported`);
  } finally {
    setIsImporting(false);
  }
}
```

Note: `handleAddFolder` has its own reconcile-and-save pattern that does NOT involve tagging, so leave it as-is.

- [ ] **Step 2: Extract memoized SoundListItem**

Add a memoized component above `SoundsPanel` (in the same file — no new file needed since it's tightly coupled to the panel's styling):

```typescript
import { memo } from "react";
import type { Tag as TagType } from "@/lib/schemas";

interface SoundListItemTagsProps {
  soundTagIds: string[];
  allTags: TagType[];
}

const SoundListItemTags = memo(function SoundListItemTags({ soundTagIds, allTags }: SoundListItemTagsProps) {
  if (soundTagIds.length === 0) return null;
  const soundTags = allTags.filter((t) => soundTagIds.includes(t.id));
  if (soundTags.length === 0) return null;
  const systemTags = soundTags.filter((t) => t.isSystem);
  const userTags = soundTags.filter((t) => !t.isSystem);
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {systemTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-0.5 rounded-full bg-white/10 text-white/50 border border-white/20 drop-shadow-[0_2px_0px_rgba(255,255,255,0.05)] px-1.5 py-0 text-[10px] leading-4"
        >
          <HugeiconsIcon icon={LockIcon} size={8} />
          {tag.name}
        </span>
      ))}
      {userTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full bg-primary text-primary-foreground border border-[rgba(194,67,113,1)] drop-shadow-[0_2px_0px_rgba(194,67,113,1)] px-1.5 py-0 text-[10px] leading-4"
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
});
```

In the render loop, replace the IIFE inside `<ItemContent>`:
```tsx
<ItemTitle>{sound.name}</ItemTitle>
<SoundListItemTags soundTagIds={sound.tags} allTags={tags} />
```

- [ ] **Step 3: Memoize the selectedSoundIds arrays**

Replace the raw spreads in the `return` JSX at the bottom:
```tsx
// Before the return statement, add:
const selectedSoundIdsArray = useMemo(
  () => [...selectedSoundIds],
  [selectedSoundIds],
);
```

Then in JSX:
```tsx
<AddToSetDialog open={addToSetOpen} onOpenChange={setAddToSetOpen} soundIds={selectedSoundIdsArray} />
<AddTagsDialog open={addTagsOpen} onOpenChange={setAddTagsOpen} selectedSoundIds={selectedSoundIdsArray} />
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/SidePanel/SoundsPanel.tsx
git commit -m "refactor: use useImportSounds in SoundsPanel, extract SoundListItemTags, memoize arrays"
```

---

## Task 5: Add `TagSchema.name` validation

Fixes: [Medium] tag name has no length bounds.

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/schemas.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/lib/schemas.test.ts`, add a `describe("TagSchema")` block:

```typescript
import { TagSchema } from "@/lib/schemas";

describe("TagSchema", () => {
  it("accepts a valid tag", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "drums" });
    expect(result.success).toBe(true);
  });

  it("rejects a tag with an empty name", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a tag name longer than 100 characters", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts a tag name of exactly 100 characters", () => {
    const result = TagSchema.safeParse({ id: "t1", name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- src/lib/schemas.test.ts
```
Expected: the empty-name and 101-char tests fail.

- [ ] **Step 3: Update TagSchema**

In `src/lib/schemas.ts`, change:
```typescript
export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  isSystem: z.boolean().optional(),
});
```
To:
```typescript
export const TagSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  isSystem: z.boolean().optional(),
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- src/lib/schemas.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "fix: add min(1)/max(100) validation to TagSchema.name"
```

---

## Task 6: Optimize SoundSelector count maps to a single pass

Fixes: [Medium] O(tags × sounds) + O(sets × sounds) computed even in "assigned" mode.

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/SoundSelector.tsx`

- [ ] **Step 1: Replace two useMemo blocks with one**

In `src/components/composite/PadConfigDrawer/SoundSelector.tsx`, replace:

```typescript
const tagCountMap = useMemo(
  () =>
    Object.fromEntries(
      tags.map((t) => [t.id, sounds.filter((s) => s.tags.includes(t.id)).length])
    ),
  [tags, sounds]
);

const setCountMap = useMemo(
  () =>
    Object.fromEntries(
      sets.map((st) => [st.id, sounds.filter((s) => s.sets.includes(st.id)).length])
    ),
  [sets, sounds]
);
```

With:

```typescript
// Single pass over sounds: O(sounds × (avgTagsPerSound + avgSetsPerSound))
const { tagCountMap, setCountMap } = useMemo(() => {
  const tc: Record<string, number> = {};
  const sc: Record<string, number> = {};
  for (const s of sounds) {
    for (const tid of s.tags) tc[tid] = (tc[tid] ?? 0) + 1;
    for (const sid of s.sets) sc[sid] = (sc[sid] ?? 0) + 1;
  }
  return { tagCountMap: tc, setCountMap: sc };
}, [sounds]);
```

Note: tags and sets arrays are no longer needed as dependencies because we're iterating sound.tags/sound.sets IDs directly.

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer
```
Expected: all pass (behavior unchanged, just faster).

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/PadConfigDrawer/SoundSelector.tsx
git commit -m "perf: single-pass O(sounds) count maps in SoundSelector"
```

---

## Task 7: Fix AddTagsDialog — hook selectors + remove eslint-disable

Fixes: [Medium] `getState()` in event handlers inconsistent with project pattern; [Low] `eslint-disable react-hooks/exhaustive-deps`.

**Files:**
- Modify: `src/components/composite/SidePanel/AddTagsDialog.tsx`

- [ ] **Step 1: Replace getState() calls with hook selectors**

At the top of `AddTagsDialog`, add these selectors (after the existing hook calls):
```typescript
const assignTagsToSounds = useLibraryStore((s) => s.assignTagsToSounds);
const removeTagFromSounds = useLibraryStore((s) => s.removeTagFromSounds);
const ensureTagExists = useLibraryStore((s) => s.ensureTagExists);
```

In `handleValueChange`, replace:
```typescript
const { ensureTagExists } = useLibraryStore.getState();
```
with just:
```typescript
// ensureTagExists is now selected via hook above
```
(no `getState()` call needed — use the `ensureTagExists` selector directly)

In `handleConfirm`, replace:
```typescript
const { assignTagsToSounds, removeTagFromSounds } = useLibraryStore.getState();
```
with nothing (already have them as selectors). Then the remaining `useLibraryStore.getState()` call for the `saveLibrary` payload (latest snapshot) stays as-is — that's a legitimate read-after-mutation.

- [ ] **Step 2: Remove eslint-disable via ref pattern**

Replace the entire `useEffect` block (including the disable comment) with a ref-based pattern:

```typescript
// Keep a live ref to the values we need at open time.
// This avoids listing them as effect deps (which would re-snapshot while open)
// without needing an eslint-disable.
const snapshotRef = useRef({ sounds, selectedSoundIds, userTags });
snapshotRef.current = { sounds, selectedSoundIds, userTags };

useEffect(() => {
  if (!open) return;
  const { sounds: s, selectedSoundIds: ids, userTags: ut } = snapshotRef.current;
  const selectedSounds = s.filter((sound) => ids.includes(sound.id));
  const fullIds =
    selectedSounds.length === 0
      ? []
      : ut
          .filter((tag) => selectedSounds.every((sound) => sound.tags.includes(tag.id)))
          .map((t) => t.id);
  const partialIds = ut
    .filter(
      (tag) =>
        selectedSounds.some((sound) => sound.tags.includes(tag.id)) &&
        !selectedSounds.every((sound) => sound.tags.includes(tag.id)),
    )
    .map((t) => t.id);

  setSelectedTagIds(fullIds);
  setPartialTagIds(partialIds);
  setOriginalFullTagIds(fullIds);
  setOriginalPartialTagIds(partialIds);
  setInputValue("");
}, [open]);
```

Add `useRef` to the import:
```typescript
import { useState, useEffect, useMemo, useRef } from "react";
```

- [ ] **Step 3: Run tests**

```bash
npm run test:run -- src/components/composite/SidePanel/AddTagsDialog.test.tsx
```
Expected: all 11 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SidePanel/AddTagsDialog.tsx
git commit -m "refactor: hook selectors in AddTagsDialog, remove eslint-disable via ref pattern"
```

---

## Task 8: Add runtime guards for tab value casts in LayerConfigSection

Fixes: [Low] unsafe `v as Arrangement` / `v as PlaybackMode` / `v as RetriggerMode` casts.

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`

- [ ] **Step 1: Replace all three bare casts with guarded setValues**

The options arrays are already `as const`, so `.map(o => o.value)` gives us a `readonly` tuple we can use for runtime checks. Replace each `onValueChange`:

```typescript
// Arrangement (was: v as Arrangement)
onValueChange={(v) => {
  if (ARRANGEMENT_OPTIONS.some((o) => o.value === v))
    setValue("layer.arrangement", v as Arrangement, { shouldDirty: true });
}}

// Playback Mode (was: v as PlaybackMode)
onValueChange={(v) => {
  if (PLAYBACK_MODE_OPTIONS.some((o) => o.value === v))
    setValue("layer.playbackMode", v as PlaybackMode, { shouldDirty: true });
}}

// Retrigger Mode (was: v as RetriggerMode)
onValueChange={(v) => {
  if (RETRIGGER_MODE_OPTIONS.some((o) => o.value === v))
    setValue("layer.retriggerMode", v as RetriggerMode, { shouldDirty: true });
}}
```

The `as Arrangement` cast is still needed after the guard because TypeScript can't narrow from `.some()`. The guard makes the cast safe at runtime.

Also apply the same guard to the selection-type tab (which uses `LayerSelection["type"]`):
```typescript
// Selection type tab (was: v as LayerSelection["type"])
onValueChange={(v) => {
  if (v === "assigned" || v === "tag" || v === "set")
    handleSelectionTypeChange(v);
}}
```

The `Controller` import can be removed if it's no longer used for anything except the `layer.selection` Controller (which IS still used — check line 65–71 in the current file). Keep `Controller` import.

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- src/components/composite/PadConfigDrawer
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/composite/PadConfigDrawer/LayerConfigSection.tsx
git commit -m "fix: runtime guards for Radix Tabs value casts in LayerConfigSection"
```

---

## Task 9: padPlayer — Map for assigned lookup + OR semantics comment

Fixes: [Low] O(instances × sounds) linear scan in `resolveSounds`; [Low] OR semantics undocumented.

**Files:**
- Modify: `src/lib/audio/padPlayer.ts`

- [ ] **Step 1: Build a soundById Map and add the semantics comment**

In `src/lib/audio/padPlayer.ts`, replace the `resolveSounds` function:

```typescript
function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  // Build a lookup map once per call — O(sounds) build, O(1) per lookup.
  const soundById = new Map(sounds.map((s) => [s.id, s]));
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => soundById.get(inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      // Union/OR semantics: a sound matches if it has ANY of the selected tagIds.
      return sounds.filter(
        (s) => sel.tagIds.some((tid) => s.tags.includes(tid)) && !!s.filePath
      );
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio/padPlayer.ts
git commit -m "perf: Map-based lookup in resolveSounds, document OR semantics for tag mode"
```

---

## Task 10: Add invariant documentation to libraryStore

Fixes: [Low] `updateLibrary` bypass of system-tag guards; [Low] `isSystem` escalation.

**Files:**
- Modify: `src/state/libraryStore.ts`

- [ ] **Step 1: Add comments to updateLibrary and ensureTagExists**

In `updateLibrary`:
```typescript
updateLibrary: (updater) =>
  set((draft) => {
    // INVARIANT: Do NOT mutate sound.tags directly via this action — use
    // assignTagsToSounds / removeTagFromSounds / systemAssignTagsToSounds
    // so system-tag guards are enforced. updateLibrary is for structural
    // changes (sounds list, sets) not tag assignments.
    updater(draft);
    draft.isDirty = true;
  }),
```

In `ensureTagExists`, before the `if (isSystem && !existing.isSystem)` block:
```typescript
// NOTE: If a user has already created a tag with the same name as a system
// tag (e.g., "imported"), and isSystem:true is requested, the existing tag
// is silently promoted to system status and becomes non-removable by the user.
// This is an acceptable tradeoff for a desktop app, but callers should be
// aware. Use SYSTEM_TAG_IMPORTED (a known name) to reduce collision risk.
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```
Expected: all pass (comment-only changes).

- [ ] **Step 3: Commit**

```bash
git add src/state/libraryStore.ts
git commit -m "docs: document updateLibrary invariant and isSystem escalation risk"
```

---

## Self-Review

**Spec coverage:**
- [High] Magic string → Task 1 ✅
- [High] Triplicated logic → Tasks 2, 3, 4 ✅
- [Medium] Tag name validation → Task 5 ✅
- [Medium] O(tags×sounds) count maps → Task 6 ✅
- [Medium] Per-item IIFE → Task 4 (SoundListItemTags) ✅
- [Medium] import.ts store coupling → Task 2 ✅
- [Medium] SoundsPanel orchestration → Tasks 3, 4 ✅
- [Medium] AddTagsDialog getState() → Task 7 ✅
- [Low] [...selectedSoundIds] spread → Task 4 ✅
- [Low] Linear scan padPlayer → Task 9 ✅
- [Low] Unsafe casts → Task 8 ✅
- [Low] eslint-disable → Task 7 ✅
- [Low] OR semantics undocumented → Task 9 ✅
- [Low] updateLibrary bypass docs → Task 10 ✅
- [Low] isSystem escalation docs → Task 10 ✅
- [Info] orphaned tagId field → no action needed ✅
- [Info] multiple getState() in sync block → no action needed ✅

**No placeholders detected.**

**Type consistency:** `tagImportedSounds` parameters match across Tasks 2, 3, 4. `useImportSounds` return type used consistently in Task 4.
