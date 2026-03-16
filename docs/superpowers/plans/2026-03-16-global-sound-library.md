# Global Sound Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sounds, tags, and sets out of Project and into a global app-level library backed by `settings.json` and `library.json`, with Zustand stores and TanStack Query hooks following existing patterns.

**Architecture:** `AppSettings` (global folders + special-purpose folder IDs) and `GlobalLibrary` (sounds, tags, sets) each get their own file in `appDataDir()/SoundsBored/`, their own Zustand+Immer store, and their own TanStack Query hooks. Project loses `sounds`/`tags`/`sets` and gains `favoritedSetIds`. A `1.0.0 → 1.1.0` migration strips the removed fields from existing project files.

**Tech Stack:** Zod 4, Zustand + Immer, TanStack Query 5, Tauri 2.x (`@tauri-apps/api/path`, `@tauri-apps/plugin-fs`), Vitest + Testing Library

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `src/lib/appSettings.ts` | CRUD for `settings.json` (load, save, create defaults) |
| `src/lib/appSettings.queries.ts` | TanStack Query hooks for app settings |
| `src/lib/appSettings.test.ts` | Tests for appSettings.ts |
| `src/lib/library.ts` | CRUD for `library.json` (load, save) |
| `src/lib/library.queries.ts` | TanStack Query hooks for global library |
| `src/lib/library.test.ts` | Tests for library.ts |
| `src/state/appSettingsStore.ts` | Zustand+Immer store for app settings |
| `src/state/appSettingsStore.test.ts` | Tests for appSettingsStore |
| `src/state/libraryStore.ts` | Zustand+Immer store for global library |
| `src/state/libraryStore.test.ts` | Tests for libraryStore |

### Modified Files
| File | Change |
|---|---|
| `src/lib/constants.ts` | Add `SETTINGS_FILE_NAME`, `LIBRARY_FILE_NAME`; bump `DEFAULT_PROJECT_VERSION` to `"1.1.0"` |
| `src/lib/schemas.ts` | New schemas; update `SoundSchema`, `ProjectSchema` |
| `src/lib/schemas.test.ts` | Update tests to match new schema shapes |
| `src/lib/migrations.ts` | Add `1.0.0 → 1.1.0` migration; bump `CURRENT_VERSION` |
| `src/lib/migrations.test.ts` | Update tests for new migration |
| `src/lib/project.ts` | Remove `sounds`/`tags`/`sets` from `createProjectFile` |
| `src/lib/project.test.ts` | Update test that checks for removed fields |
| `src/test/factories.ts` | Remove `sounds`/`tags`/`sets` from `createMockProject`; add three new factories |
| `src/test/tauri-mocks.ts` | Add `musicDir` to `mockPath` |

---

## Chunk 1: Schema + Constants + Migration

### Task 1: Update constants

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add new constants to `constants.ts`**

```typescript
// File names
export const PROJECT_FILE_NAME = "project.json";
export const HISTORY_FILE_NAME = "history.json";
export const SETTINGS_FILE_NAME = "settings.json";  // NEW
export const LIBRARY_FILE_NAME = "library.json";    // NEW

// Project defaults
export const DEFAULT_PROJECT_VERSION = "1.1.0";  // bumped from "1.0.0"
export const DEFAULT_PROJECT_DESCRIPTION = "";
```

- [ ] **Step 2: Run existing tests to confirm no breakage yet**

```bash
npm run test:run
```

Expected: all tests pass. The new constants are not yet consumed by anything. `DEFAULT_PROJECT_VERSION` is only used in `project.ts` at runtime — no tests import it directly, so bumping it has no effect on tests until Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat: add settings/library file name constants; bump default project version"
```

---

### Task 2: Update schemas

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/schemas.test.ts`

- [ ] **Step 1: Update `schemas.test.ts` to reflect new shapes**

Replace the `SoundSchema — filePath validation` describe block and update `ProjectSchema` tests:

```typescript
// In schemas.test.ts — replace the entire "SoundSchema — filePath validation" block:
describe("SoundSchema — filePath validation", () => {
  const validSound = { id: "s1", name: "Kick", tags: [], sets: [] };

  it("should accept a sound with no filePath", () => {
    expect(SoundSchema.safeParse(validSound).success).toBe(true);
  });

  it("should accept an absolute Unix path", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/home/user/music/kick.wav" }).success).toBe(true);
  });

  it("should accept an absolute Windows path", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "C:/Users/user/Music/kick.wav" }).success).toBe(true);
  });

  it("should accept a path containing ..", () => {
    // filePath is now just a non-empty string — path validation is filesystem-level
    expect(SoundSchema.safeParse({ ...validSound, filePath: "/music/../sounds/kick.wav" }).success).toBe(true);
  });

  it("should reject an empty string filePath", () => {
    expect(SoundSchema.safeParse({ ...validSound, filePath: "" }).success).toBe(false);
  });
});
```

Also update these tests in the `ProjectSchema` blocks:

```typescript
// Replace "should validate a project with all fields" with:
it("should validate a project with all fields", () => {
  const fullProject = {
    name: "Full Project",
    version: "2.0.0",
    description: "A complete project",
    lastSaved: "2026-03-13T10:00:00.000Z",
    scenes: [],
    favoritedSetIds: [],
  };

  const result = ProjectSchema.safeParse(fullProject);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual(fullProject);
  }
});

// Replace "should default scenes, sounds, tags, sets to empty arrays when missing" with:
it("should default scenes and favoritedSetIds to empty arrays when missing", () => {
  const result = ProjectSchema.safeParse({ name: "Old Project" });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.scenes).toEqual([]);
    expect(result.data.favoritedSetIds).toEqual([]);
    expect((result.data as Record<string, unknown>).sounds).toBeUndefined();
    expect((result.data as Record<string, unknown>).tags).toBeUndefined();
    expect((result.data as Record<string, unknown>).sets).toBeUndefined();
  }
});

// Replace the round-trip test — remove sounds from raw input and expected output:
it("should round-trip a project with a full scene/pad/layer", () => {
  const raw = {
    name: "Full Project",
    scenes: [{
      id: "scene-1",
      name: "Scene 1",
      pads: [{
        id: "pad-1",
        name: "Kick",
        layers: [{
          id: "layer-1",
          selection: { type: "assigned", instances: [{ id: "si-1", soundId: "s-1", volume: 0.9 }] },
          arrangement: "simultaneous",
          playbackMode: "one-shot",
          retriggerMode: "restart",
          volume: 1.0,
        }],
        muteTargetPadIds: [],
      }],
    }],
  };

  const result = ProjectSchema.safeParse(raw);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.scenes[0].pads[0].layers[0].playbackMode).toBe("one-shot");
  }
});

// Replace the "Type exports" compile-time test:
it("should infer correct types from schemas", () => {
  const entry: ProjectHistoryEntry = {
    name: "test",
    path: "/test",
    date: "2026-03-13T10:00:00.000Z",
  };

  const history: ProjectHistory = [entry];

  const project: Project = {
    name: "test",
    scenes: [],
    favoritedSetIds: [],
  };

  expect(entry).toBeDefined();
  expect(history).toBeDefined();
  expect(project).toBeDefined();
});
```

Also add new describe blocks for the new schemas — add these at the bottom of `schemas.test.ts`. **Merge** the new imports into the existing import block at the top of the file — do not replace the existing imports. Add only the new names:

```typescript
// Merge these into the existing import from "@/lib/schemas" — keep all current imports:
import {
  // ... all existing imports stay ...
  GlobalFolderSchema,   // add
  AppSettingsSchema,    // add
  GlobalLibrarySchema,  // add
  type GlobalFolder,    // add
  type AppSettings,     // add
  type GlobalLibrary,   // add
} from "@/lib/schemas";

describe("GlobalFolderSchema", () => {
  it("should accept a valid global folder", () => {
    const folder = {
      id: crypto.randomUUID(),
      path: "/music/SoundsBored",
      name: "SoundsBored",
    };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(true);
  });

  it("should reject a folder with empty path", () => {
    const folder = { id: crypto.randomUUID(), path: "", name: "Test" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });

  it("should reject a folder with empty name", () => {
    const folder = { id: crypto.randomUUID(), path: "/music/test", name: "" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });

  it("should reject a folder with invalid UUID id", () => {
    const folder = { id: "not-a-uuid", path: "/music/test", name: "Test" };
    expect(GlobalFolderSchema.safeParse(folder).success).toBe(false);
  });
});

describe("AppSettingsSchema", () => {
  const makeValidSettings = (): AppSettings => {
    const dlId = crypto.randomUUID();
    const impId = crypto.randomUUID();
    return {
      version: "1.0.0",
      globalFolders: [
        { id: dlId, path: "/music/downloads", name: "Downloads" },
        { id: impId, path: "/music/imported", name: "Imported" },
      ],
      downloadFolderId: dlId,
      importFolderId: impId,
    };
  };

  it("should accept valid settings", () => {
    expect(AppSettingsSchema.safeParse(makeValidSettings()).success).toBe(true);
  });

  it("should default version to 1.0.0 when missing", () => {
    const settings = makeValidSettings();
    const { version: _v, ...withoutVersion } = settings;
    const result = AppSettingsSchema.safeParse(withoutVersion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
    }
  });

  it("should reject when downloadFolderId is not a valid UUID", () => {
    const settings = { ...makeValidSettings(), downloadFolderId: "not-a-uuid" };
    expect(AppSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("should reject when globalFolders is missing", () => {
    const { globalFolders: _gf, ...withoutFolders } = makeValidSettings();
    expect(AppSettingsSchema.safeParse(withoutFolders).success).toBe(false);
  });
});

describe("GlobalLibrarySchema", () => {
  it("should accept an empty library", () => {
    const lib = { version: "1.0.0", sounds: [], tags: [], sets: [] };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });

  it("should default version to 1.0.0 when missing", () => {
    const lib = { sounds: [], tags: [], sets: [] };
    const result = GlobalLibrarySchema.safeParse(lib);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
    }
  });

  it("should accept a library with sounds, tags, and sets", () => {
    const lib: GlobalLibrary = {
      version: "1.0.0",
      sounds: [{ id: "s1", name: "Kick", filePath: "/music/kick.wav", tags: [], sets: [] }],
      tags: [{ id: "t1", name: "Drums" }],
      sets: [{ id: "set1", name: "My Set" }],
    };
    expect(GlobalLibrarySchema.safeParse(lib).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/lib/schemas.test.ts
```

Expected: multiple failures — the new imports don't exist yet; old tests for removed schema fields still pass currently.

- [ ] **Step 3: Update `schemas.ts`**

```typescript
import { z } from "zod";

// ─── Project History ────────────────────────────────────────────────────────

export const ProjectHistoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  date: z.string(),
});

export const ProjectHistorySchema = z.array(ProjectHistoryEntrySchema);

export type ProjectHistoryEntry = z.infer<typeof ProjectHistoryEntrySchema>;
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

// ─── Enums ──────────────────────────────────────────────────────────────────

export const PlaybackModeSchema = z.enum(["one-shot", "hold", "loop"]);
export const ArrangementSchema = z.enum(["simultaneous", "sequential", "shuffled"]);
export const RetriggerModeSchema = z.enum(["restart", "continue", "stop", "next"]);

export type PlaybackMode = z.infer<typeof PlaybackModeSchema>;
export type Arrangement = z.infer<typeof ArrangementSchema>;
export type RetriggerMode = z.infer<typeof RetriggerModeSchema>;

// ─── Sound (global library asset) ───────────────────────────────────────────

export const SoundSchema = z.object({
  id: z.string(),
  name: z.string(),
  filePath: z.string().min(1).optional(),  // absolute path when present
  sourceUrl: z.string().optional(),        // original web URL for yt-dlp re-download
  tags: z.array(z.string()),               // Tag IDs — resolve against global library
  sets: z.array(z.string()),               // Set IDs — resolve against global library
  durationMs: z.number().optional(),
});

export type Sound = z.infer<typeof SoundSchema>;

/**
 * Type guard: narrows Sound to Sound & { filePath: string }.
 * Use in Phase 5 audio engine to avoid scattered null checks.
 */
export function hasFilePath(sound: Sound): sound is Sound & { filePath: string } {
  return typeof sound.filePath === "string" && sound.filePath.length > 0;
}

// ─── Tag / Set ───────────────────────────────────────────────────────────────

export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

export const SetSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type Tag = z.infer<typeof TagSchema>;
export type Set = z.infer<typeof SetSchema>;

// ─── SoundInstance (a specific usage of a Sound within a Layer) ──────────────

export const SoundInstanceSchema = z.object({
  id: z.string(),
  soundId: z.string(),
  volume: z.number(),
  startOffsetMs: z.number().optional(),
});

export type SoundInstance = z.infer<typeof SoundInstanceSchema>;

// ─── Layer Selection ─────────────────────────────────────────────────────────

export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: z.string(),
    defaultVolume: z.number(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string(),
    defaultVolume: z.number(),
  }),
]);

export type LayerSelection = z.infer<typeof LayerSelectionSchema>;

// ─── Layer ────────────────────────────────────────────────────────────────────

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number(),
});

export type Layer = z.infer<typeof LayerSchema>;

// ─── Pad ──────────────────────────────────────────────────────────────────────

export const PadSchema = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerSchema),
  muteTargetPadIds: z.array(z.string()),
  muteGroupId: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export type Pad = z.infer<typeof PadSchema>;

// ─── Scene ────────────────────────────────────────────────────────────────────

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  pads: z.array(PadSchema),
});

export type Scene = z.infer<typeof SceneSchema>;

// ─── Project ──────────────────────────────────────────────────────────────────

export const ProjectSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  lastSaved: z.string().optional(),
  scenes: z.array(SceneSchema).default([]),
  favoritedSetIds: z.array(z.string()).default([]),  // refs to global Set IDs
});

export type Project = z.infer<typeof ProjectSchema>;

// ─── Global Folder ────────────────────────────────────────────────────────────

export const GlobalFolderSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1),   // absolute path on disk
  name: z.string().min(1),   // display name
});

export type GlobalFolder = z.infer<typeof GlobalFolderSchema>;

// ─── App Settings ─────────────────────────────────────────────────────────────

export const AppSettingsSchema = z.object({
  version: z.string().optional().default("1.0.0"),
  globalFolders: z.array(GlobalFolderSchema),
  downloadFolderId: z.string().uuid(),   // ID of the yt-dlp download destination folder
  importFolderId: z.string().uuid(),     // ID of the in-app import destination folder
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ─── Global Library ───────────────────────────────────────────────────────────

export const GlobalLibrarySchema = z.object({
  version: z.string().optional().default("1.0.0"),
  sounds: z.array(SoundSchema),
  tags: z.array(TagSchema),
  sets: z.array(SetSchema),
});

export type GlobalLibrary = z.infer<typeof GlobalLibrarySchema>;
```

- [ ] **Step 4: Run schema tests**

```bash
npm run test:run -- src/lib/schemas.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run full test suite to see what else broke**

```bash
npm run test:run
```

Expected: failures in `migrations.test.ts`, `project.test.ts`, and `projectStore.test.ts` (TypeScript errors on `sounds`/`tags`/`sets` in `Project`). Note all failing tests — they will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat: update schemas — global library types, project loses sounds/tags/sets"
```

---

### Task 3: Update migrations

**Files:**
- Modify: `src/lib/migrations.ts`
- Modify: `src/lib/migrations.test.ts`

- [ ] **Step 1: Update `migrations.test.ts`**

**Replace the entire contents** of `migrations.test.ts` with the following (the existing tests are superseded by the updated versions below):

```typescript
import { describe, it, expect, vi } from "vitest";
import { migrateProject, CURRENT_VERSION } from "./migrations";

describe("migrateProject", () => {
  it("should pass through a project already at CURRENT_VERSION unchanged", () => {
    const raw = { name: "My Project", version: CURRENT_VERSION };
    const result = migrateProject(raw);
    expect(result).toEqual({ name: "My Project", version: CURRENT_VERSION });
  });

  it("should handle a project with no version field", () => {
    const raw = { name: "Old Project" };
    const result = migrateProject(raw);
    expect(result.name).toBe("Old Project");
  });

  it("should not mutate the original object", () => {
    const raw = { name: "My Project", version: "1.0.0" };
    const original = { ...raw };
    migrateProject(raw);
    expect(raw).toEqual(original);
  });
});

describe("migrateProject — 1.0.0 → 1.1.0", () => {
  it("should strip sounds, tags, sets and add favoritedSetIds", () => {
    const raw = {
      name: "My Project",
      version: "1.0.0",
      scenes: [],
      sounds: [],
      tags: [],
      sets: [],
    };
    const result = migrateProject(raw);
    expect(result.version).toBe("1.1.0");
    expect(result.favoritedSetIds).toEqual([]);
    expect(result.sounds).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.sets).toBeUndefined();
  });

  it("should preserve scenes and other fields during migration", () => {
    const raw = {
      name: "My Project",
      version: "1.0.0",
      description: "A project",
      scenes: [{ id: "s1", name: "Scene 1", pads: [] }],
      sounds: [],
      tags: [],
      sets: [],
    };
    const result = migrateProject(raw);
    expect(result.name).toBe("My Project");
    expect(result.description).toBe("A project");
    expect(result.scenes).toEqual([{ id: "s1", name: "Scene 1", pads: [] }]);
  });

  it("should warn when stripping non-empty sounds/tags/sets", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = {
      name: "My Project",
      version: "1.0.0",
      sounds: [{ id: "s1", name: "Kick" }],
      tags: [],
      sets: [],
    };
    migrateProject(raw);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1 sound"));
    warnSpy.mockRestore();
  });

  it("should not warn when sounds/tags/sets are empty arrays", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "My Project", version: "1.0.0", sounds: [], tags: [], sets: [] });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should not warn when sounds/tags/sets are absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "My Project", version: "1.0.0" });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("migrateProject — version warnings", () => {
  it("should warn when final version does not match CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = migrateProject({ name: "Future Project", version: "99.0.0" });
    expect(result.version).toBe("99.0.0");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("99.0.0"));
    warnSpy.mockRestore();
  });

  it("should not warn when version matches CURRENT_VERSION", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "Current Project", version: CURRENT_VERSION });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should warn when version is absent (defaults to 0.0.0)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrateProject({ name: "Old Project" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("0.0.0"));
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run migration tests to verify they fail**

```bash
npm run test:run -- src/lib/migrations.test.ts
```

Expected: failures on the new `1.0.0 → 1.1.0` tests.

- [ ] **Step 3: Update `migrations.ts`**

```typescript
type RawProject = Record<string, unknown>;
type MigrationFn = (raw: RawProject) => RawProject;

interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFn;
}

export const CURRENT_VERSION = "1.1.0";

const MIGRATIONS: Migration[] = [
  {
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    migrate: (raw) => {
      const next = { ...raw };
      const sounds = next.sounds;
      const tags = next.tags;
      const sets = next.sets;

      const soundCount = Array.isArray(sounds) ? sounds.length : 0;
      const tagCount = Array.isArray(tags) ? tags.length : 0;
      const setCount = Array.isArray(sets) ? sets.length : 0;

      if (soundCount > 0 || tagCount > 0 || setCount > 0) {
        console.warn(
          `Migration 1.0.0 → 1.1.0: discarding ${soundCount} sound(s), ` +
          `${tagCount} tag(s), ${setCount} set(s) from project. ` +
          `These are now managed in the global sound library.`
        );
      }

      delete next.sounds;
      delete next.tags;
      delete next.sets;
      next.favoritedSetIds = [];

      return next;
    },
  },
];

export function migrateProject(raw: RawProject): RawProject {
  let current = { ...raw };
  let version = (current.version as string | undefined) ?? "0.0.0";

  for (const migration of MIGRATIONS) {
    if (version === migration.fromVersion) {
      current = migration.migrate(current);
      version = migration.toVersion;
      current.version = version;
    }
  }

  const finalVersion = version;
  if (finalVersion !== CURRENT_VERSION) {
    console.warn(
      `Project version "${finalVersion}" does not match app version "${CURRENT_VERSION}". ` +
      `The project may have been created with a different version of SoundsBored.`
    );
  }

  return current;
}
```

- [ ] **Step 4: Run migration tests**

```bash
npm run test:run -- src/lib/migrations.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrations.ts src/lib/migrations.test.ts
git commit -m "feat: add 1.0.0→1.1.0 migration — move sounds/tags/sets to global library"
```

---

## Chunk 2: App Settings Infrastructure

### Task 4: Add `musicDir` to Tauri mocks

**Files:**
- Modify: `src/test/tauri-mocks.ts`

- [ ] **Step 1: Add `musicDir` to `mockPath`**

```typescript
export const mockPath = {
  join: vi.fn((...paths: string[]) => paths.join("/")),
  tempDir: vi.fn(() => Promise.resolve("/tmp")),
  appDataDir: vi.fn(() => Promise.resolve("/app-data")),
  appLocalDataDir: vi.fn(() => Promise.resolve("/app-local-data")),
  musicDir: vi.fn(() => Promise.resolve("/music")),  // NEW
};
```

The `resetTauriMocks` function iterates `Object.values(mockPath)` so `musicDir` is automatically reset. No other changes needed.

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: same failures as before (from schema changes to Project type); no new failures.

- [ ] **Step 3: Commit**

```bash
git add src/test/tauri-mocks.ts
git commit -m "test: add musicDir mock to tauri path mocks"
```

---

### Task 4a: Add new factory helpers to `factories.ts`

**Files:**
- Modify: `src/test/factories.ts`

These factories are needed by tests in Tasks 5–9. Add them now so those tests can import them immediately.

- [ ] **Step 1: Add three new factories to `src/test/factories.ts`**

Add the following imports and functions. Keep all existing code — only add:

```typescript
// Add to the import at the top of factories.ts:
import { AppSettings, GlobalFolder, GlobalLibrary, Project, ProjectHistoryEntry, Scene } from "@/lib/schemas";
// (Replace the existing import line that has Project, ProjectHistoryEntry, Scene)

// Add these three factory functions anywhere after createMockScene:

export function createMockGlobalFolder(overrides?: Partial<GlobalFolder>): GlobalFolder {
  return {
    id: crypto.randomUUID(),
    path: "/music/SoundsBored",
    name: "SoundsBored",
    ...overrides,
  };
}

export function createMockAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  const downloadFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/downloads",
    name: "Downloads",
  });
  const importFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/imported",
    name: "Imported",
  });
  const rootFolder = createMockGlobalFolder({
    path: "/music/SoundsBored",
    name: "SoundsBored",
  });
  return {
    version: "1.0.0",
    globalFolders: [rootFolder, downloadFolder, importFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
    ...overrides,
  };
}

export function createMockGlobalLibrary(overrides?: Partial<GlobalLibrary>): GlobalLibrary {
  return {
    version: "1.0.0",
    sounds: [],
    tags: [],
    sets: [],
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
npm run test:run
```

Expected: same failures as before — only pre-existing breakage from schema changes.

- [ ] **Step 3: Commit**

```bash
git add src/test/factories.ts
git commit -m "test: add createMockGlobalFolder, createMockAppSettings, createMockGlobalLibrary factories"
```

---

### Task 5: Create `appSettings.ts`

**Files:**
- Create: `src/lib/appSettings.ts`
- Create: `src/lib/appSettings.test.ts`

- [ ] **Step 1: Write the failing tests in `src/lib/appSettings.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { loadAppSettings, saveAppSettings, getSettingsFilePath } from "./appSettings";
import { mockFs, mockPath, createMockFileSystem } from "@/test/tauri-mocks";
import { createMockAppSettings } from "@/test/factories";
import { AppSettings } from "./schemas";

describe("getSettingsFilePath", () => {
  it("should return the path under appDataDir/SoundsBored/settings.json", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const path = await getSettingsFilePath();
    expect(path).toBe("/app-data/SoundsBored/settings.json");
  });
});

describe("loadAppSettings", () => {
  beforeEach(() => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    mockPath.musicDir.mockResolvedValue("/music");
    mockFs.mkdir.mockResolvedValue(undefined);
  });

  it("should parse and return settings when the file exists", async () => {
    const settings = createMockAppSettings();
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      "/app-data/SoundsBored/settings.json": JSON.stringify(settings),
    });

    const result = await loadAppSettings();
    expect(result.globalFolders).toHaveLength(settings.globalFolders.length);
    expect(result.downloadFolderId).toBe(settings.downloadFolderId);
    expect(result.importFolderId).toBe(settings.importFolderId);
  });

  it("should create default settings and write them when file is missing", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      // settings.json is intentionally absent
    });

    const result = await loadAppSettings();

    expect(result.globalFolders).toHaveLength(3);
    expect(result.version).toBe("1.0.0");
    expect(result.downloadFolderId).toBeTruthy();
    expect(result.importFolderId).toBeTruthy();
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      "/app-data/SoundsBored/settings.json",
      expect.stringContaining("globalFolders")
    );
  });

  it("default settings should have downloads and imported subfolders under /music/SoundsBored", async () => {
    createMockFileSystem({ "/app-data/SoundsBored": null });

    const result = await loadAppSettings();

    const paths = result.globalFolders.map((f) => f.path);
    expect(paths).toContain("/music/SoundsBored");
    expect(paths).toContain("/music/SoundsBored/downloads");
    expect(paths).toContain("/music/SoundsBored/imported");
  });

  it("should proceed and return defaults even when folder creation fails", async () => {
    // /app-data/SoundsBored already exists, so mkdir for the app folder is never called.
    // createDefaultAppSettings calls mkdir three times (once per default music folder) — all fail.
    createMockFileSystem({ "/app-data/SoundsBored": null });
    mockFs.mkdir.mockRejectedValue(new Error("Permission denied"));

    // Should not throw — warnings are logged but defaults are still returned
    const result = await loadAppSettings();
    expect(result.globalFolders).toHaveLength(3);
  });

  it("should throw a ZodError if the file contains invalid JSON structure", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored": null,
      "/app-data/SoundsBored/settings.json": JSON.stringify({ version: "1.0.0" }),  // missing required fields
    });

    await expect(loadAppSettings()).rejects.toThrow();
  });
});

describe("saveAppSettings", () => {
  it("should write settings as JSON to the correct path", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const files = createMockFileSystem({ "/app-data/SoundsBored": null });
    const settings = createMockAppSettings();

    await saveAppSettings(settings);

    const written = files["/app-data/SoundsBored/settings.json"];
    expect(written).toBeDefined();
    const parsed: AppSettings = JSON.parse(written);
    expect(parsed.downloadFolderId).toBe(settings.downloadFolderId);
    expect(parsed.globalFolders).toHaveLength(settings.globalFolders.length);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:run -- src/lib/appSettings.test.ts
```

Expected: all fail — module not found.

- [ ] **Step 3: Create `src/lib/appSettings.ts`**

```typescript
import { AppSettings, AppSettingsSchema, GlobalFolder } from "./schemas";
import { appDataDir, join, musicDir } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, SETTINGS_FILE_NAME } from "./constants";

export async function getSettingsFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, SETTINGS_FILE_NAME);
}

async function createDefaultAppSettings(): Promise<AppSettings> {
  const music = await musicDir();
  const rootPath = await join(music, "SoundsBored");
  const downloadsPath = await join(music, "SoundsBored", "downloads");
  const importedPath = await join(music, "SoundsBored", "imported");

  const rootFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: rootPath,
    name: "SoundsBored",
  };
  const downloadsFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: downloadsPath,
    name: "Downloads",
  };
  const importedFolder: GlobalFolder = {
    id: crypto.randomUUID(),
    path: importedPath,
    name: "Imported",
  };

  for (const folder of [rootFolder, downloadsFolder, importedFolder]) {
    try {
      await mkdir(folder.path, { recursive: true });
    } catch {
      console.warn(`Could not create default folder on disk: ${folder.path}`);
    }
  }

  return {
    version: "1.0.0",
    globalFolders: [rootFolder, downloadsFolder, importedFolder],
    downloadFolderId: downloadsFolder.id,
    importFolderId: importedFolder.id,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  const dir = await appDataDir();
  const folderPath = await join(dir, APP_FOLDER);
  const filePath = await join(folderPath, SETTINGS_FILE_NAME);

  if (!(await exists(folderPath))) {
    await mkdir(folderPath, { recursive: true });
  }

  if (!(await exists(filePath))) {
    const defaults = await createDefaultAppSettings();
    await writeTextFile(filePath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return AppSettingsSchema.parse(parsed);
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const filePath = await getSettingsFilePath();
  await writeTextFile(filePath, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run app settings tests**

```bash
npm run test:run -- src/lib/appSettings.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/appSettings.ts src/lib/appSettings.test.ts
git commit -m "feat: add appSettings I/O — load/save settings.json with default folder init"
```

---

### Task 6: Create `appSettingsStore.ts`

**Files:**
- Create: `src/state/appSettingsStore.ts`
- Create: `src/state/appSettingsStore.test.ts`

- [ ] **Step 1: Write the failing tests in `src/state/appSettingsStore.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAppSettingsStore, initialAppSettingsState } from "./appSettingsStore";
import { createMockAppSettings, createMockGlobalFolder } from "@/test/factories";

function getState() {
  return useAppSettingsStore.getState();
}

describe("appSettingsStore", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ ...initialAppSettingsState });
  });

  describe("initial state", () => {
    it("should start with null settings", () => {
      expect(getState().settings).toBeNull();
    });
  });

  describe("loadSettings", () => {
    it("should set settings", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(getState().settings).toEqual(settings);
    });

    it("should replace previous settings on re-load", () => {
      getState().loadSettings(createMockAppSettings());
      const updated = createMockAppSettings({ version: "2.0.0" });
      getState().loadSettings(updated);
      expect(getState().settings?.version).toBe("2.0.0");
    });
  });

  describe("addGlobalFolder", () => {
    it("should append a folder to globalFolders", () => {
      getState().loadSettings(createMockAppSettings());
      const initialCount = getState().settings!.globalFolders.length;
      const newFolder = createMockGlobalFolder({ name: "Extra" });
      getState().addGlobalFolder(newFolder);
      expect(getState().settings!.globalFolders).toHaveLength(initialCount + 1);
      expect(getState().settings!.globalFolders.at(-1)?.name).toBe("Extra");
    });

    it("should do nothing when settings is null", () => {
      expect(() => getState().addGlobalFolder(createMockGlobalFolder())).not.toThrow();
    });
  });

  describe("removeGlobalFolder", () => {
    it("should remove a folder by id", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const rootFolder = settings.globalFolders[0];
      getState().removeGlobalFolder(rootFolder.id);
      expect(getState().settings!.globalFolders.some((f) => f.id === rootFolder.id)).toBe(false);
    });

    it("should throw when removing the downloadFolderId folder", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(() => getState().removeGlobalFolder(settings.downloadFolderId)).toThrow(
        /download or import destination/
      );
    });

    it("should throw when removing the importFolderId folder", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      expect(() => getState().removeGlobalFolder(settings.importFolderId)).toThrow(
        /download or import destination/
      );
    });

    it("should not change state when throw occurs", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const countBefore = getState().settings!.globalFolders.length;
      try {
        getState().removeGlobalFolder(settings.downloadFolderId);
      } catch {
        // expected
      }
      expect(getState().settings!.globalFolders).toHaveLength(countBefore);
    });
  });

  describe("setDownloadFolder", () => {
    it("should update downloadFolderId", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const newId = settings.globalFolders[0].id;
      getState().setDownloadFolder(newId);
      expect(getState().settings!.downloadFolderId).toBe(newId);
    });
  });

  describe("setImportFolder", () => {
    it("should update importFolderId", () => {
      const settings = createMockAppSettings();
      getState().loadSettings(settings);
      const newId = settings.globalFolders[0].id;
      getState().setImportFolder(newId);
      expect(getState().settings!.importFolderId).toBe(newId);
    });
  });

  describe("updateSettings", () => {
    it("should apply an immer updater to settings", () => {
      getState().loadSettings(createMockAppSettings());
      getState().updateSettings((draft) => {
        draft.version = "9.9.9";
      });
      expect(getState().settings?.version).toBe("9.9.9");
    });

    it("should do nothing when settings is null", () => {
      expect(() =>
        getState().updateSettings((draft) => {
          draft.version = "9.9.9";
        })
      ).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:run -- src/state/appSettingsStore.test.ts
```

Expected: all fail — module not found.

- [ ] **Step 3: Create `src/state/appSettingsStore.ts`**

```typescript
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { AppSettings, GlobalFolder } from "@/lib/schemas";

interface AppSettingsState {
  settings: AppSettings | null;
}

interface AppSettingsActions {
  loadSettings: (settings: AppSettings) => void;
  updateSettings: (updater: (draft: AppSettings) => void) => void;
  addGlobalFolder: (folder: GlobalFolder) => void;
  removeGlobalFolder: (folderId: string) => void;
  setDownloadFolder: (folderId: string) => void;
  setImportFolder: (folderId: string) => void;
}

export type AppSettingsStore = AppSettingsState & AppSettingsActions;

export const initialAppSettingsState: AppSettingsState = {
  settings: null,
};

export const useAppSettingsStore = create<AppSettingsStore>()(
  immer((set) => ({
    ...initialAppSettingsState,

    loadSettings: (settings) =>
      set((draft) => {
        draft.settings = settings;
      }),

    updateSettings: (updater) =>
      set((draft) => {
        if (draft.settings) {
          updater(draft.settings);
        }
      }),

    addGlobalFolder: (folder) =>
      set((draft) => {
        draft.settings?.globalFolders.push(folder);
      }),

    removeGlobalFolder: (folderId) => {
      // Check invariant BEFORE entering the Immer set callback to ensure
      // the error propagates synchronously to the caller.
      const { settings } = useAppSettingsStore.getState();
      if (
        settings?.downloadFolderId === folderId ||
        settings?.importFolderId === folderId
      ) {
        throw new Error(
          `Cannot remove folder: it is currently used as a download or import destination. Reassign it first.`
        );
      }
      set((draft) => {
        draft.settings?.globalFolders &&
          (draft.settings.globalFolders = draft.settings.globalFolders.filter(
            (f) => f.id !== folderId
          ));
      });
    },

    setDownloadFolder: (folderId) =>
      set((draft) => {
        if (!draft.settings) return;
        draft.settings.downloadFolderId = folderId;
      }),

    setImportFolder: (folderId) =>
      set((draft) => {
        if (!draft.settings) return;
        draft.settings.importFolderId = folderId;
      }),
  }))
);
```

- [ ] **Step 4: Run store tests**

```bash
npm run test:run -- src/state/appSettingsStore.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/appSettingsStore.ts src/state/appSettingsStore.test.ts
git commit -m "feat: add appSettingsStore — Zustand+Immer store for global app settings"
```

---

### Task 7: Create `appSettings.queries.ts`

**Files:**
- Create: `src/lib/appSettings.queries.ts`

No test file — query hooks are thin wiring over existing tested functions. Manual verification is sufficient.

- [ ] **Step 1: Create `src/lib/appSettings.queries.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadAppSettings, saveAppSettings } from "./appSettings";
import { AppSettings } from "./schemas";
import { QUERY_STALE_TIME } from "./constants";

export function useAppSettings() {
  return useQuery<AppSettings, Error>({
    queryKey: ["appSettings"],
    queryFn: loadAppSettings,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AppSettings) => {
      await saveAppSettings(settings);
      return settings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] });
    },
  });
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: same failures as before (project.ts and factories.ts not yet updated).

- [ ] **Step 3: Commit**

```bash
git add src/lib/appSettings.queries.ts
git commit -m "feat: add appSettings TanStack Query hooks"
```

---

## Chunk 3: Library Infrastructure

### Task 8: Create `library.ts`

**Files:**
- Create: `src/lib/library.ts`
- Create: `src/lib/library.test.ts`

- [ ] **Step 1: Write the failing tests in `src/lib/library.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { loadGlobalLibrary, saveGlobalLibrary, getLibraryFilePath } from "./library";
import { mockFs, mockPath, createMockFileSystem } from "@/test/tauri-mocks";
import { createMockGlobalLibrary } from "@/test/factories";
import { GlobalLibrary } from "./schemas";

describe("getLibraryFilePath", () => {
  it("should return the path under appDataDir/SoundsBored/library.json", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const path = await getLibraryFilePath();
    expect(path).toBe("/app-data/SoundsBored/library.json");
  });
});

describe("loadGlobalLibrary", () => {
  beforeEach(() => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
  });

  it("should return an empty library when file does not exist", async () => {
    createMockFileSystem({});  // no files

    const result = await loadGlobalLibrary();
    expect(result.sounds).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.sets).toEqual([]);
    expect(result.version).toBe("1.0.0");
  });

  it("should parse and return the library when file exists", async () => {
    const lib = createMockGlobalLibrary({
      tags: [{ id: "t1", name: "Drums" }],
    });
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify(lib),
    });

    const result = await loadGlobalLibrary();
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].name).toBe("Drums");
  });

  it("should throw a ZodError when the file contains an invalid structure", async () => {
    createMockFileSystem({
      "/app-data/SoundsBored/library.json": JSON.stringify({ invalid: true }),
    });

    await expect(loadGlobalLibrary()).rejects.toThrow();
  });
});

describe("saveGlobalLibrary", () => {
  it("should write the library as JSON to the correct path", async () => {
    mockPath.appDataDir.mockResolvedValue("/app-data");
    const files = createMockFileSystem({});
    const lib = createMockGlobalLibrary({
      sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
    });

    await saveGlobalLibrary(lib);

    const written = files["/app-data/SoundsBored/library.json"];
    expect(written).toBeDefined();
    const parsed: GlobalLibrary = JSON.parse(written);
    expect(parsed.sounds).toHaveLength(1);
    expect(parsed.sounds[0].name).toBe("Kick");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:run -- src/lib/library.test.ts
```

Expected: all fail — module not found.

- [ ] **Step 3: Create `src/lib/library.ts`**

```typescript
import { GlobalLibrary, GlobalLibrarySchema } from "./schemas";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { APP_FOLDER, LIBRARY_FILE_NAME } from "./constants";

export async function getLibraryFilePath(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, APP_FOLDER, LIBRARY_FILE_NAME);
}

export async function loadGlobalLibrary(): Promise<GlobalLibrary> {
  const filePath = await getLibraryFilePath();

  if (!(await exists(filePath))) {
    return { version: "1.0.0", sounds: [], tags: [], sets: [] };
  }

  const text = await readTextFile(filePath);
  const parsed = JSON.parse(text);
  return GlobalLibrarySchema.parse(parsed);
}

export async function saveGlobalLibrary(library: GlobalLibrary): Promise<void> {
  const filePath = await getLibraryFilePath();
  await writeTextFile(filePath, JSON.stringify(library, null, 2));
}
```

- [ ] **Step 4: Run library tests**

```bash
npm run test:run -- src/lib/library.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/library.ts src/lib/library.test.ts
git commit -m "feat: add library I/O — load/save library.json for global sound library"
```

---

### Task 9: Create `libraryStore.ts`

**Files:**
- Create: `src/state/libraryStore.ts`
- Create: `src/state/libraryStore.test.ts`

- [ ] **Step 1: Write the failing tests in `src/state/libraryStore.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useLibraryStore, initialLibraryState } from "./libraryStore";
import { createMockGlobalLibrary } from "@/test/factories";
import { Sound, Tag, Set } from "@/lib/schemas";

function getState() {
  return useLibraryStore.getState();
}

describe("libraryStore", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
  });

  describe("initial state", () => {
    it("should start with empty arrays and isDirty false", () => {
      expect(getState().sounds).toEqual([]);
      expect(getState().tags).toEqual([]);
      expect(getState().sets).toEqual([]);
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("loadLibrary", () => {
    it("should populate sounds, tags, sets from library", () => {
      const lib = createMockGlobalLibrary({
        sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
        tags: [{ id: "t1", name: "Drums" }],
        sets: [{ id: "set1", name: "My Set" }],
      });
      getState().loadLibrary(lib);
      expect(getState().sounds).toHaveLength(1);
      expect(getState().tags).toHaveLength(1);
      expect(getState().sets).toHaveLength(1);
    });

    it("should reset isDirty to false on load", () => {
      getState().loadLibrary(createMockGlobalLibrary());
      // manually set dirty
      useLibraryStore.setState({ isDirty: true });
      getState().loadLibrary(createMockGlobalLibrary());
      expect(getState().isDirty).toBe(false);
    });
  });

  describe("updateLibrary", () => {
    it("should apply an immer updater and set isDirty", () => {
      getState().loadLibrary(createMockGlobalLibrary());
      getState().updateLibrary((draft) => {
        draft.sounds.push({ id: "s1", name: "Kick", tags: [], sets: [] });
      });
      expect(getState().sounds).toHaveLength(1);
      expect(getState().isDirty).toBe(true);
    });
  });

  describe("clearDirtyFlag", () => {
    it("should set isDirty to false", () => {
      useLibraryStore.setState({ isDirty: true });
      getState().clearDirtyFlag();
      expect(getState().isDirty).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:run -- src/state/libraryStore.test.ts
```

Expected: all fail — module not found.

- [ ] **Step 3: Create `src/state/libraryStore.ts`**

```typescript
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { Sound, Tag, Set, GlobalLibrary } from "@/lib/schemas";

interface LibraryState {
  sounds: Sound[];
  tags: Tag[];
  sets: Set[];
  isDirty: boolean;  // tracked; auto-save hook wired in Phase 4
}

type LibraryData = Pick<LibraryState, "sounds" | "tags" | "sets">;

interface LibraryActions {
  loadLibrary: (library: GlobalLibrary) => void;
  updateLibrary: (updater: (draft: LibraryData) => void) => void;
  clearDirtyFlag: () => void;
}

export type LibraryStore = LibraryState & LibraryActions;

export const initialLibraryState: LibraryState = {
  sounds: [],
  tags: [],
  sets: [],
  isDirty: false,
};

export const useLibraryStore = create<LibraryStore>()(
  immer((set) => ({
    ...initialLibraryState,

    loadLibrary: (library) =>
      set((draft) => {
        draft.sounds = library.sounds;
        draft.tags = library.tags;
        draft.sets = library.sets;
        draft.isDirty = false;
      }),

    updateLibrary: (updater) =>
      set((draft) => {
        // Pass only the library-data fields to the updater so callers
        // cannot directly mutate isDirty — that is managed by this action.
        updater(draft);
        draft.isDirty = true;
      }),

    clearDirtyFlag: () =>
      set((draft) => {
        draft.isDirty = false;
      }),
  }))
);
```

- [ ] **Step 4: Run library store tests**

```bash
npm run test:run -- src/state/libraryStore.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/libraryStore.ts src/state/libraryStore.test.ts
git commit -m "feat: add libraryStore — Zustand+Immer store for global sound library"
```

---

### Task 10: Create `library.queries.ts`

**Files:**
- Create: `src/lib/library.queries.ts`

- [ ] **Step 1: Create `src/lib/library.queries.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadGlobalLibrary, saveGlobalLibrary } from "./library";
import { GlobalLibrary } from "./schemas";
import { QUERY_STALE_TIME } from "./constants";

export function useGlobalLibrary() {
  return useQuery<GlobalLibrary, Error>({
    queryKey: ["globalLibrary"],
    queryFn: loadGlobalLibrary,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useSaveGlobalLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (library: GlobalLibrary) => {
      await saveGlobalLibrary(library);
      return library;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["globalLibrary"] });
    },
  });
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test:run
```

Expected: same remaining failures (project.ts and factories.ts).

- [ ] **Step 3: Commit**

```bash
git add src/lib/library.queries.ts
git commit -m "feat: add library TanStack Query hooks"
```

---

## Chunk 4: Project + Factories + Integration

### Task 11: Update `project.ts` and `project.test.ts`

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/lib/project.test.ts`

- [ ] **Step 1: Update the failing test in `project.test.ts`**

First, add these imports to the top of `project.test.ts` if not already present:

```typescript
import { migrateProject } from "./migrations";
import { ProjectSchema } from "./schemas";
```

Then find the test named "should default scenes, sounds, tags, sets to empty arrays for old projects" and replace it entirely with:

```typescript
it("should default scenes and favoritedSetIds to empty arrays after migration", () => {
  // Simulate a 1.0.0 project being migrated — sounds/tags/sets are stripped,
  // favoritedSetIds is added, and the schema defaults scenes to [].
  const oldProject = { name: "Old Project", version: "1.0.0", sounds: [], tags: [], sets: [] };
  const migrated = migrateProject(oldProject);
  const result = ProjectSchema.safeParse(migrated);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.scenes).toEqual([]);
    expect(result.data.favoritedSetIds).toEqual([]);
    expect((result.data as Record<string, unknown>).sounds).toBeUndefined();
  }
});
```

- [ ] **Step 2: Update `createProjectFile` in `project.ts`**

Replace lines 166–175:

```typescript
const projectData: Project = {
  name: projectName,
  version: DEFAULT_PROJECT_VERSION,
  description: DEFAULT_PROJECT_DESCRIPTION,
  lastSaved: new Date().toISOString(),
  scenes: [],
  favoritedSetIds: [],
};
```

- [ ] **Step 3: Run project tests**

```bash
npm run test:run -- src/lib/project.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/project.ts src/lib/project.test.ts
git commit -m "feat: remove sounds/tags/sets from createProjectFile; add favoritedSetIds"
```

---

### Task 12: Update `createMockProject` and fix all remaining test failures

**Files:**
- Modify: `src/test/factories.ts`

> **Note:** `createMockGlobalFolder`, `createMockAppSettings`, and `createMockGlobalLibrary` were already added in Task 4a. Only `createMockProject` needs to change here. Do NOT re-add those three functions — it will cause duplicate export errors.

- [ ] **Step 1: Update `createMockProject` in `src/test/factories.ts`**

Find `createMockProject` and replace only its return object (remove `sounds`, `tags`, `sets`; add `favoritedSetIds`; bump version to `"1.1.0"`):

```typescript
export function createMockProject(overrides?: Partial<Project>): Project {
  return {
    name: "Test Project",
    version: "1.1.0",
    description: "A test project",
    lastSaved: new Date().toISOString(),
    scenes: [],
    favoritedSetIds: [],
    ...overrides,
  };
}

export function createMockHistoryEntry(
  overrides?: Partial<ProjectHistoryEntry>
): ProjectHistoryEntry {
  return {
    name: "Test Project",
    path: "/test/path/project",
    date: new Date().toISOString(),
    ...overrides,
  };
}

let _sceneCounter = 0;

export function resetSceneCounter(): void {
  _sceneCounter = 0;
}

export function createMockScene(overrides?: Partial<Scene>): Scene {
  _sceneCounter++;
  return {
    id: `scene-${_sceneCounter}`,
    name: `Scene ${_sceneCounter}`,
    pads: [],
    ...overrides,
  };
}

export function createMockGlobalFolder(overrides?: Partial<GlobalFolder>): GlobalFolder {
  return {
    id: crypto.randomUUID(),
    path: "/music/SoundsBored",
    name: "SoundsBored",
    ...overrides,
  };
}

export function createMockAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  const downloadFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/downloads",
    name: "Downloads",
  });
  const importFolder = createMockGlobalFolder({
    path: "/music/SoundsBored/imported",
    name: "Imported",
  });
  const rootFolder = createMockGlobalFolder({
    path: "/music/SoundsBored",
    name: "SoundsBored",
  });
  return {
    version: "1.0.0",
    globalFolders: [rootFolder, downloadFolder, importFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
    ...overrides,
  };
}

export function createMockGlobalLibrary(overrides?: Partial<GlobalLibrary>): GlobalLibrary {
  return {
    version: "1.0.0",
    sounds: [],
    tags: [],
    sets: [],
    ...overrides,
  };
}

export function createProjectJson(project?: Partial<Project>): string {
  return JSON.stringify(createMockProject(project), null, 2);
}

export function createHistoryJson(
  entries?: Partial<ProjectHistoryEntry>[]
): string {
  const historyEntries = entries
    ? entries.map((entry) => createMockHistoryEntry(entry))
    : [createMockHistoryEntry()];
  return JSON.stringify(historyEntries, null, 2);
}

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function expectToReject<T>(
  promise: Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorType?: new (...args: any[]) => Error
): Promise<Error> {
  try {
    await promise;
    throw new Error("Expected promise to reject, but it resolved");
  } catch (error) {
    if (errorType && !(error instanceof errorType)) {
      throw new Error(
        `Expected error to be instance of ${errorType.name}, but got ${
          error instanceof Error ? error.constructor.name : typeof error
        }`
      );
    }
    return error as Error;
  }
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm run test:run
```

Expected: **all tests pass**. If any failures remain, investigate and fix before committing.

- [ ] **Step 3: Run TypeScript compiler to confirm no type errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/test/factories.ts
git commit -m "feat: update factories — remove sounds/tags/sets from createMockProject; add global library factories"
```

---

## Final Verification

- [ ] **Run the full test suite one last time**

```bash
npm run test:run
```

Expected: all tests pass, zero failures.

- [ ] **Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: no errors.
