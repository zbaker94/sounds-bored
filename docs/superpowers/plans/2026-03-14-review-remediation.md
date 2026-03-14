# Review Remediation Plan — 2026-03-14

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all findings from the multi-reviewer parallel code review — security hardening, correctness fixes, and code cleanup.

**Architecture:** Changes span the Tauri capability permissions (fs:scope narrowing), Zod schema validation (filePath traversal guard), project CRUD layer (discardTemporaryProject guard), Zustand store (remove dead code), and React hooks (auto-save efficiency). No new files needed — all changes are modifications to existing files.

**Tech Stack:** React 19, TypeScript (strict), Vite 7, Tauri 2.x, Zustand + Immer, Zod 4, Sonner (toasts), Vitest + Testing Library + happy-dom

**Test command:** `npm run test:run`
**Dev command:** `npm run tauri dev`

---

## Files Modified

| File | Findings |
|---|---|
| `src/lib/schemas.ts` | M1: filePath refinement + hasFilePath type guard |
| `src/lib/schemas.test.ts` | M1: tests for filePath validation + hasFilePath |
| `src/lib/project.ts` | M2, M3, L3: discardTemporaryProject, temp_ guard in saveProjectAs, unified sanitization |
| `src/lib/project.test.ts` | M2, M3, L3: tests for discardTemporaryProject, saveProjectAs guard, sanitization |
| `src/lib/migrations.ts` | M4: console.warn on version mismatch |
| `src/lib/migrations.test.ts` | M4: test for version warning |
| `src/state/projectStore.ts` | M5, M6: remove hasUnsavedChanges, JSDoc on updateProject |
| `src/state/projectStore.test.ts` | M5: remove hasUnsavedChanges tests |
| `src/hooks/useAutoSave.ts` | M7, L4: isDirty gate, toast for errors |
| `src/components/screens/main/MainPage.tsx` | M2, L4: use discardTemporaryProject, toast for errors |
| `src/components/screens/start/StartScreen.tsx` | L2, L4: validate openPath target, toast for errors |
| `src-tauri/capabilities/default.json` | H1: narrow fs:scope |

---

## Task 1: Safe Recursive Delete — discardTemporaryProject (M2 + M3)

**Rationale:** `remove(folderPath, { recursive: true })` is called in two places with insufficient guards. A single reusable function with a `temp_` prefix check prevents accidental deletion of user project folders.

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/lib/project.test.ts`
- Modify: `src/components/screens/main/MainPage.tsx`

- [ ] **Step 1.1 — Write failing tests for discardTemporaryProject**

Add a new `describe("discardTemporaryProject")` block at the end of `src/lib/project.test.ts`:

```typescript
describe("discardTemporaryProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should remove a folder whose path contains temp_", async () => {
    mockFs.remove.mockResolvedValue(undefined);

    await discardTemporaryProject("/app-local-data/SoundsBored/temp_MyProject_1234567890");

    expect(mockFs.remove).toHaveBeenCalledWith(
      "/app-local-data/SoundsBored/temp_MyProject_1234567890",
      { recursive: true }
    );
  });

  it("should throw if the path does not contain temp_", async () => {
    await expect(
      discardTemporaryProject("/users/zack/projects/MyProject")
    ).rejects.toThrow("Cannot discard");

    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it("should throw if the path is empty", async () => {
    await expect(
      discardTemporaryProject("")
    ).rejects.toThrow("Cannot discard");
  });

  it("should not throw if remove fails (swallows and warns)", async () => {
    mockFs.remove.mockRejectedValue(new Error("Permission denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      discardTemporaryProject("/app-local-data/SoundsBored/temp_Test_123")
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

Also add `discardTemporaryProject` to the import from `@/lib/project` at the top of the test file.

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/lib/project.test.ts
```
Expected: 4 new tests fail with "discardTemporaryProject is not a function" or similar.

- [ ] **Step 1.3 — Implement discardTemporaryProject in project.ts**

Add this exported function at the end of `src/lib/project.ts`:

```typescript
/**
 * Safely removes a temporary project folder.
 * Only deletes folders whose path contains "temp_" as a safety guard against
 * accidentally deleting user project folders.
 * Swallows removal errors (logs a warning) — callers should not fail if cleanup fails.
 *
 * @throws {Error} If the path does not appear to be a temporary folder
 */
export async function discardTemporaryProject(folderPath: string): Promise<void> {
  if (!folderPath || !folderPath.includes("temp_")) {
    throw new Error(
      `Cannot discard folder — path does not appear to be a temporary project: "${folderPath}"`
    );
  }

  try {
    await remove(folderPath, { recursive: true });
  } catch (error) {
    console.warn("Failed to remove temporary folder:", error);
  }
}
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/lib/project.test.ts
```
Expected: All tests pass including the 4 new ones.

- [ ] **Step 1.5 — Use discardTemporaryProject in saveProjectAs (M3)**

In `src/lib/project.ts`, find the `saveProjectAs` function. Locate the try/catch block that calls `remove(currentPath, { recursive: true })` and replace it with:

```typescript
  // Clean up the temporary folder (safe: validates temp_ prefix internally)
  await discardTemporaryProject(currentPath);
```

Update any `saveProjectAs` tests in `src/lib/project.test.ts` that pass a `currentPath` like `"/old/path"` — change those to `"/app-local-data/SoundsBored/temp_Test_123"` so they pass the `temp_` guard.

- [ ] **Step 1.6 — Use discardTemporaryProject in MainPage (M2)**

In `src/components/screens/main/MainPage.tsx`:

1. Add: `import { discardTemporaryProject } from "@/lib/project";`
2. Remove `remove` from the `@tauri-apps/plugin-fs` import.
3. In `handleDiscardAndClose`, replace:
   ```typescript
   if (isTemporary && folderPath) {
     try {
       await remove(folderPath, { recursive: true });
     } catch (error) {
       console.error("Failed to remove temporary folder:", error);
     }
   }
   ```
   with:
   ```typescript
   if (isTemporary && folderPath) {
     await discardTemporaryProject(folderPath);
   }
   ```

- [ ] **Step 1.7 — Run full test suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 1.8 — Commit**

```bash
git add src/lib/project.ts src/lib/project.test.ts src/components/screens/main/MainPage.tsx
git commit -m "feat: add discardTemporaryProject with temp_ guard (M2, M3)"
```

---

## Task 2: Sound.filePath Path Traversal Guard + Type Guard (M1)

**Rationale:** A malicious or corrupted `project.json` could contain `filePath: "../../.ssh/id_rsa"`. Rejecting traversal sequences at parse time prevents this. The `hasFilePath` type guard prepares for Phase 5 audio loading.

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/schemas.test.ts`

- [ ] **Step 2.1 — Write failing tests**

In `src/lib/schemas.test.ts`, add two new describe blocks:

```typescript
describe("SoundSchema — filePath validation", () => {
  const validSound = { id: "s1", name: "Kick", tags: [], sets: [] };

  it("should accept a sound with no filePath", () => {
    expect(SoundSchema.safeParse(validSound).success).toBe(true);
  });

  it("should accept a relative filePath", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "sounds/kick.wav" }).success).toBe(true);
  });

  it("should reject filePath containing ..", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "../etc/passwd" }).success).toBe(false);
  });

  it("should reject filePath containing .. in the middle", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "sounds/../../secrets/key" }).success).toBe(false);
  });

  it("should reject absolute Unix path", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/etc/passwd" }).success).toBe(false);
  });

  it("should reject absolute Windows path with backslash", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "C:\\Windows\\file.wav" }).success).toBe(false);
  });

  it("should reject Windows drive path with forward slash", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "D:/music/file.wav" }).success).toBe(false);
  });
});

describe("hasFilePath", () => {
  it("should return true when filePath is a non-empty string", () => {
    const sound: Sound = { id: "s1", name: "Kick", filePath: "sounds/kick.wav", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(true);
  });

  it("should return false when filePath is undefined", () => {
    const sound: Sound = { id: "s1", name: "Kick", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(false);
  });

  it("should return false when filePath is empty string", () => {
    const sound: Sound = { id: "s1", name: "Kick", filePath: "", tags: [], sets: [] };
    expect(hasFilePath(sound)).toBe(false);
  });
});
```

Add `hasFilePath` and `SoundSchema` to the import from `@/lib/schemas`.

- [ ] **Step 2.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/lib/schemas.test.ts
```
Expected: Path traversal tests fail (no refinement), hasFilePath tests fail (not exported).

- [ ] **Step 2.3 — Implement filePath refinement and hasFilePath**

In `src/lib/schemas.ts`, replace the `filePath` field in `SoundSchema`:

```typescript
// Before:
filePath: z.string().optional(),

// After:
filePath: z.string()
  .refine((p) => !p.includes(".."), { message: "filePath must not contain '..'" })
  .refine(
    (p) => !/^[A-Za-z]:/.test(p) && !p.startsWith("/"),
    { message: "filePath must be a relative path (no drive letters or leading slashes)" }
  )
  .optional(),
```

Then add the `hasFilePath` export after the `Sound` type:

```typescript
/**
 * Type guard: narrows Sound to Sound & { filePath: string }.
 * Use in Phase 5 audio engine to avoid scattered null checks.
 */
export function hasFilePath(sound: Sound): sound is Sound & { filePath: string } {
  return typeof sound.filePath === "string" && sound.filePath.length > 0;
}
```

- [ ] **Step 2.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/lib/schemas.test.ts
```
Expected: All tests pass.

- [ ] **Step 2.5 — Run full suite**

```bash
npm run test:run
```
Expected: All tests pass. Existing round-trip tests use `filePath: "sounds/kick.wav"` which is valid.

- [ ] **Step 2.6 — Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat: add filePath path-traversal guard and hasFilePath type guard (M1)"
```

---

## Task 3: Migration Version Warning (M4)

**Rationale:** `migrateProject()` silently passes through projects whose version is unrecognized (e.g., from a newer app). A console.warn (not throw) makes this detectable without breaking loading.

**Files:**
- Modify: `src/lib/migrations.ts`
- Modify: `src/lib/migrations.test.ts`

- [ ] **Step 3.1 — Write failing tests**

In `src/lib/migrations.test.ts`, add:

```typescript
import { vi } from "vitest";

describe("migrateProject — version warnings", () => {
  it("should warn when final version does not match CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = migrateProject({ name: "Future Project", version: "99.0.0" });

    expect(result.version).toBe("99.0.0");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("99.0.0")
    );

    warnSpy.mockRestore();
  });

  it("should not warn when version matches CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    migrateProject({ name: "Current Project", version: CURRENT_VERSION });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should warn when version is absent (defaults to 0.0.0 which is not CURRENT_VERSION)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    migrateProject({ name: "Old Project" });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

Import `CURRENT_VERSION` from `@/lib/migrations`.

- [ ] **Step 3.2 — Run tests to verify they fail**

```bash
npm run test:run -- src/lib/migrations.test.ts
```
Expected: Warning tests fail (no warn emitted).

- [ ] **Step 3.3 — Implement version warning**

In `src/lib/migrations.ts`, add after the `for` loop and before `return current;`:

```typescript
  // Warn (don't throw) if the final version doesn't match the current app version.
  // This happens when opening a project created by a newer version of SoundsBored.
  const finalVersion = (current.version as string | undefined) ?? version;
  if (finalVersion !== CURRENT_VERSION) {
    console.warn(
      `Project version "${finalVersion}" does not match app version "${CURRENT_VERSION}". ` +
      `The project may have been created with a different version of SoundsBored.`
    );
  }
```

- [ ] **Step 3.4 — Run tests to verify they pass**

```bash
npm run test:run -- src/lib/migrations.test.ts
```
Expected: All tests pass.

- [ ] **Step 3.5 — Commit**

```bash
git add src/lib/migrations.ts src/lib/migrations.test.ts
git commit -m "feat: warn on unrecognized project version after migration (M4)"
```

---

## Task 4: projectStore Cleanup (M5 + M6)

**Files:**
- Modify: `src/state/projectStore.ts`
- Modify: `src/state/projectStore.test.ts`

- [ ] **Step 4.1 — Remove hasUnsavedChanges from store (M5)**

In `src/state/projectStore.ts`:
1. Remove `hasUnsavedChanges: () => boolean;` from the `ProjectActions` interface.
2. Remove the `hasUnsavedChanges` implementation from the store body.

In `src/state/projectStore.test.ts`:
- Remove the entire `describe("hasUnsavedChanges")` test block.

- [ ] **Step 4.2 — Add JSDoc to updateProject (M6)**

In `src/state/projectStore.ts`, add a JSDoc comment in the `ProjectActions` interface above `updateProject`:

```typescript
  /**
   * Replaces the entire project object and marks state as dirty.
   * @transitional This generic setter will be replaced by specific actions
   * (e.g., addScene, updatePad, renamePad) in Phase 3+. Prefer specific actions
   * for any new mutation work. Do not remove until specific actions are in place.
   */
  updateProject: (project: Project) => void;
```

- [ ] **Step 4.3 — Run tests**

```bash
npm run test:run
```
Expected: All tests pass. No file should reference `hasUnsavedChanges` anymore.

- [ ] **Step 4.4 — Commit**

```bash
git add src/state/projectStore.ts src/state/projectStore.test.ts
git commit -m "refactor: remove dead hasUnsavedChanges, add JSDoc to updateProject (M5, M6)"
```

---

## Task 5: Auto-Save Efficiency + Toast on Failure (M7 + L4 partial)

**Files:**
- Modify: `src/hooks/useAutoSave.ts`

- [ ] **Step 5.1 — Rewrite useAutoSave**

Replace the full content of `src/hooks/useAutoSave.ts`:

```typescript
import { useEffect, useRef } from "react";
import { useProjectStore } from "@/state/projectStore";
import { saveProject } from "@/lib/project";
import { AUTOSAVE_INTERVAL } from "@/lib/constants";
import { toast } from "sonner";

/**
 * Hook to periodically save the current project.
 * Only serializes and saves when isDirty is true (or on the first tick after load).
 * The interval is stable across project mutations — only restarts when folderPath changes.
 */
export function useAutoSave(interval: number = AUTOSAVE_INTERVAL) {
  const folderPath = useProjectStore((s) => s.folderPath);
  const clearDirtyFlag = useProjectStore((s) => s.clearDirtyFlag);
  const projectRef = useRef(useProjectStore.getState().project);
  const isDirtyRef = useRef(useProjectStore.getState().isDirty);
  const lastSaveRef = useRef<string>("");

  // Keep refs current without triggering effect re-runs
  useEffect(() => {
    return useProjectStore.subscribe((state) => {
      projectRef.current = state.project;
      isDirtyRef.current = state.isDirty;
    });
  }, []);

  useEffect(() => {
    if (!folderPath) return;

    // Reset so first interval tick always saves the newly loaded project
    lastSaveRef.current = "";

    const saveCurrentProject = async () => {
      const project = projectRef.current;
      if (!project || !folderPath) return;

      // Skip if clean and not the first tick — avoids unnecessary JSON.stringify
      if (!isDirtyRef.current && lastSaveRef.current !== "") return;

      try {
        const projectJson = JSON.stringify(project);

        // Secondary guard: skip if data is identical to last save
        if (projectJson !== lastSaveRef.current) {
          await saveProject(folderPath, project);
          lastSaveRef.current = projectJson;
          clearDirtyFlag();
        }
      } catch (error) {
        toast.error("Auto-save failed. Your changes may not be saved.");
        console.error("Auto-save error:", error);
      }
    };

    saveCurrentProject();

    const intervalId = setInterval(saveCurrentProject, interval);
    return () => clearInterval(intervalId);
  }, [folderPath, interval, clearDirtyFlag]);
}
```

- [ ] **Step 5.2 — Run full test suite**

```bash
npm run test:run
```
Expected: All tests pass. (useAutoSave has no unit tests; behavior is equivalent to previous version.)

- [ ] **Step 5.3 — Commit**

```bash
git add src/hooks/useAutoSave.ts
git commit -m "perf: gate auto-save on isDirty, add toast on failure (M7, L4)"
```

---

## Task 6: Consistent Sanitization (L3)

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/lib/project.test.ts`

- [ ] **Step 6.1 — Write test exposing the inconsistency**

In `src/lib/project.test.ts`, inside `describe("saveProjectAs")`, add:

```typescript
it("should not allow spaces in sanitized folder name", async () => {
  mockDialog.open.mockResolvedValue("/new/location");
  mockFs.exists.mockResolvedValue(false);
  mockFs.readDir.mockResolvedValue([]);
  const project = createMockProject();

  const result = await saveProjectAs(
    "My Project",
    "/app-local-data/SoundsBored/temp_Test_123",
    project
  );

  // Spaces should be replaced, matching createProjectFolder behavior
  expect(result?.newPath).toContain("My_Project");
  expect(result?.newPath).not.toContain("My Project");
});
```

- [ ] **Step 6.2 — Run test to verify it fails**

```bash
npm run test:run -- src/lib/project.test.ts
```
Expected: New test fails — current regex allows spaces.

- [ ] **Step 6.3 — Fix sanitization in saveProjectAs**

In `src/lib/project.ts`, find `saveProjectAs` and update the sanitization line:

```typescript
// Before:
const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_ ]/g, "_");
// After:
const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
```

Also update any existing test assertions in the `saveProjectAs` describe block that expected paths with spaces (e.g., `"New Name"` → `"New_Name"`).

- [ ] **Step 6.4 — Run tests**

```bash
npm run test:run -- src/lib/project.test.ts
```
Expected: All tests pass including the new one.

- [ ] **Step 6.5 — Commit**

```bash
git add src/lib/project.ts src/lib/project.test.ts
git commit -m "fix: unify path sanitization regex in createProjectFolder and saveProjectAs (L3)"
```

---

## Task 7: Console.error → Toast for User-Facing Failures (L4 remaining)

**Files:**
- Modify: `src/components/screens/main/MainPage.tsx`
- Modify: `src/components/screens/start/StartScreen.tsx`

- [ ] **Step 7.1 — Fix MainPage error handling**

In `src/components/screens/main/MainPage.tsx`, in the `handleSave` catch block (where save mutation fails):

```typescript
// Before:
console.error("Failed to save project:", error);
// After:
toast.error("Failed to save project. Please try again.");
```

The `toast` import is already present. Remove the `console.error` line — the error is user-actionable (they should retry).

The `catch` in the `handleDiscardAndClose` setTimeout block (internal Tauri window close error) can keep `console.error` — it's not user-actionable.

- [ ] **Step 7.2 — Fix StartScreen error handling**

In `src/components/screens/start/StartScreen.tsx`:

1. Add import: `import { toast } from "sonner";`

2. In `handleLoad` catch:
   ```typescript
   // Before:
   console.error("Failed to load project:", error);
   // After:
   toast.error("Failed to load project. The file may be missing or corrupted.");
   ```

3. In `handleCreateProject` catch:
   ```typescript
   // Before:
   console.error("Failed to create project:", error);
   // After:
   toast.error("Failed to create project. Please try again.");
   ```

- [ ] **Step 7.3 — Run tests**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 7.4 — Commit**

```bash
git add src/components/screens/main/MainPage.tsx src/components/screens/start/StartScreen.tsx
git commit -m "fix: replace console.error with toast.error for user-facing failures (L4)"
```

---

## Task 8: Validate openPath Target (L2)

**Files:**
- Modify: `src/components/screens/start/StartScreen.tsx`

- [ ] **Step 8.1 — Add exists check before openPath**

In `src/components/screens/start/StartScreen.tsx`:

1. Add import: `import { exists } from "@tauri-apps/plugin-fs";`

2. Find the open-folder icon button's `onClick` handler (currently `onClick={() => openPath(entry.path)}`). Replace it with an async handler:

```typescript
onClick={async (e) => {
  e.stopPropagation();
  try {
    const pathExists = await exists(entry.path);
    if (!pathExists) {
      toast.error("Project folder no longer exists at this location.");
      return;
    }
    await openPath(entry.path);
  } catch {
    toast.error("Could not open project folder.");
  }
}}
```

- [ ] **Step 8.2 — Run tests**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Step 8.3 — Commit**

```bash
git add src/components/screens/start/StartScreen.tsx
git commit -m "fix: validate folder exists before openPath in recent projects list (L2)"
```

---

## Task 9: Narrow fs:scope (H1)

**Rationale:** The `fs:scope` currently includes `$TEMP/**`. Temp projects now use `$APPLOCALDATA`, not `$TEMP`, so this can be removed. The broad `$HOME/**`, `$DOCUMENT/**` etc. scopes are unfortunately required because users can place projects anywhere — Tauri's dialog plugin grants temporary access, but `readDir`, `copyFile`, `writeTextFile`, etc. need the path in scope. This is a partial hardening; full dynamic scope granting is deferred to Phase 6+.

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 9.1 — Read and understand current capabilities**

Read `src-tauri/capabilities/default.json` fully before editing.

- [ ] **Step 9.2 — Remove temp-related permissions**

In `src-tauri/capabilities/default.json`:

1. Remove `"fs:scope-temp-recursive"` from the permissions array (if present).
2. Remove `"fs:allow-temp-read-recursive"` (if present).
3. Remove `"fs:allow-temp-write-recursive"` (if present).
4. In the `fs:scope` allow list, remove `{ "path": "$TEMP/**" }`.

Keep all `$HOME/**`, `$DOCUMENT/**`, `$DOWNLOAD/**`, `$DESKTOP/**`, `$MUSIC/**` entries — they are needed for user-chosen project locations.

- [ ] **Step 9.3 — Manual smoke test**

```bash
npm run tauri dev
```

Verify:
1. Create a new project — should succeed (uses APPLOCALDATA).
2. Save As to Documents folder — should succeed.
3. Load from Documents folder — should succeed.
4. Click the folder-open icon on a recent project — should open the folder.
5. Discard a temporary project — should succeed and clean up.

- [ ] **Step 9.4 — Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "security: remove temp fs:scope entries — temp projects use APPLOCALDATA (H1)"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
npm run test:run
```
Expected: All tests pass.

- [ ] **Run dev build and manual smoke test**

```bash
npm run tauri dev
```

Full flow: create project → make a change → wait for auto-save → Save As → load from recent → open folder icon → close with unsaved changes (save path) → close with unsaved changes (discard path).

---

## Summary of Commits

| # | Commit | Findings |
|---|---|---|
| 1 | `feat: add discardTemporaryProject with temp_ guard` | M2, M3 |
| 2 | `feat: add filePath path-traversal guard and hasFilePath type guard` | M1 |
| 3 | `feat: warn on unrecognized project version after migration` | M4 |
| 4 | `refactor: remove dead hasUnsavedChanges, add JSDoc to updateProject` | M5, M6 |
| 5 | `perf: gate auto-save on isDirty, add toast on failure` | M7, L4 partial |
| 6 | `fix: unify path sanitization regex in createProjectFolder and saveProjectAs` | L3 |
| 7 | `fix: replace console.error with toast.error for user-facing failures` | L4 remaining |
| 8 | `fix: validate folder exists before openPath in recent projects list` | L2 |
| 9 | `security: remove temp fs:scope entries — temp projects use APPLOCALDATA` | H1 |

## Deferred

- **L1** (sync `lastSaved` back to store after auto-save): Defer to Phase 3 when the "last saved at" UI indicator is implemented. The `lastSaved` drift between memory and disk is cosmetic only.
- **H1 full scope reduction** (dynamic scope granting from dialog results): Requires Tauri runtime scope APIs. Defer to Phase 6+.
