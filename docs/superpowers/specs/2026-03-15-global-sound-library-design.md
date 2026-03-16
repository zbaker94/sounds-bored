# Global Sound Library — Design Spec

**Date**: 2026-03-15
**Status**: Approved
**Scope**: Data model + cascading infrastructure changes to support a global sound library. No new UI features are implemented.

---

## Overview

Currently, `sounds`, `tags`, and `sets` are scoped to individual projects. This spec moves them to a global app-level library so any project can reference any sound. Projects become lightweight: they own scenes/pads/layers and a list of favorited sets, but all sound data lives globally.

---

## Goals

- Move `sounds`, `tags`, and `sets` out of `Project` and into a global library
- Add a global `AppSettings` file for configuring sound source folders and special-purpose folder destinations
- Keep all existing project functionality (scenes, pads, layers, auto-save, dirty flag) unchanged
- Prepare the data structure for future sound library UI, yt-dlp downloads, and in-app imports
- No new features are implemented — only structural changes to support them

---

## Non-Goals

- Sound library UI (Phase 4)
- Audio engine changes (Phase 5)
- yt-dlp integration (Phase 6)
- In-app sound import UI
- Export / project packaging UI
- Global folder scanning implementation (`reconcileSoundLibrary()` is a Phase 4 concern)
- `libraryStore` auto-save hook wiring (Phase 4 — `isDirty` is tracked but not consumed in this phase)

---

## File Storage

All app-level files use `appDataDir()` (same as the existing `history.ts`) to keep all three files in the same directory. On Windows this is `%APPDATA%\SoundsBored\`.

```
%APPDATA%/SoundsBored/         ← appDataDir() + APP_FOLDER
  history.json      ← unchanged
  settings.json     ← NEW: global folders, special-purpose folder refs
  library.json      ← NEW: global sounds, tags, sets
```

> **Note**: The existing `history.ts` uses `appDataDir()` throughout. `appSettings.ts` and `library.ts` must use the same API for consistency.

### Default Global Folders

On first launch (when `settings.json` does not exist), three folders are registered and created on disk:

| Purpose | Default Path | Default Name |
|---|---|---|
| General scan | `$MUSIC/SoundsBored/` | "SoundsBored" |
| yt-dlp downloads | `$MUSIC/SoundsBored/downloads/` | "Downloads" |
| In-app imports | `$MUSIC/SoundsBored/imported/` | "Imported" |

`$MUSIC` is resolved at runtime via Tauri's `musicDir()` API. Already in Tauri fs scope (`$MUSIC/**`).

**Folder creation failure handling**: If any default folder cannot be created on disk (permissions error, disk full, etc.), show a Sonner warning toast and proceed — the folder entry is still registered in `settings.json`. The app must not block startup on this failure. Missing folders will surface as "no sounds found" when scanning is implemented.

All global folder scanning is **recursive** — files in subdirectories are included.

---

## Schema Changes (`src/lib/schemas.ts`)

### New Schemas

```typescript
GlobalFolderSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1),   // absolute path
  name: z.string().min(1),   // display name
})

AppSettingsSchema = z.object({
  version: z.string().optional().default("1.0.0"),
  globalFolders: z.array(GlobalFolderSchema),
  downloadFolderId: z.string().uuid(),   // must ref a globalFolders entry
  importFolderId: z.string().uuid(),     // must ref a globalFolders entry
})

GlobalLibrarySchema = z.object({
  version: z.string().optional().default("1.0.0"),
  sounds: z.array(SoundSchema),
  tags: z.array(TagSchema),
  sets: z.array(SetSchema),
})
```

Both `AppSettingsSchema` and `GlobalLibrarySchema` include a `version` field from the start to support future migrations, following the same pattern as `ProjectSchema`.

### Modified: `SoundSchema`

`filePath` changes from project-relative to absolute. The relative-path refines are removed. `filePath` remains `.optional()` to handle the case where a sound exists as a URL-only entry (e.g., pending yt-dlp download with no local file yet). The `hasFilePath()` type guard is unchanged — it already checks for a non-empty string.

```typescript
// Before
filePath: z.string()
  .refine(p => !p.includes('..'), ...)
  .refine(p => !isAbsolute(p), ...)
  .optional()

// After
filePath: z.string().min(1).optional()   // absolute path when present
```

`Sound.tags` and `Sound.sets` remain as `z.array(z.string())` — they store `Tag.id` and `Set.id` values respectively, which now resolve against the global library instead of the project. No structural change needed.

### Modified: `ProjectSchema`

- **Remove**: `sounds`, `tags`, `sets`
- **Add**: `favoritedSetIds: z.array(z.string().uuid()).default([])`
- **Bump default version**: `"1.0.0"` → `"1.1.0"`

```typescript
// Before
Project: { name, version, description, lastSaved, scenes, sounds, tags, sets }

// After
Project: { name, version, description, lastSaved, scenes, favoritedSetIds }
```

`Layer.selection` references (`tagId`, `setId`, `soundId`) are **structurally unchanged** — they resolve against the global library at runtime instead of the project.

**`favoritedSetIds` referential integrity**: Stale IDs (referencing sets that no longer exist in the global library) are silently ignored at runtime. No cleanup or validation required in this phase.

---

## State Management

### New: `src/state/appSettingsStore.ts`

Zustand + Immer. No dirty flag — settings are saved immediately on change (same pattern as future settings UI would expect).

```typescript
interface AppSettingsState {
  settings: AppSettings | null

  loadSettings(settings: AppSettings): void
  updateSettings(updater: (draft: AppSettings) => void): void
  addGlobalFolder(folder: GlobalFolder): void
  removeGlobalFolder(folderId: string): void   // see invariant below
  setDownloadFolder(folderId: string): void
  setImportFolder(folderId: string): void
}
```

**`removeGlobalFolder` invariant**: If the folder being removed is currently referenced by `downloadFolderId` or `importFolderId`, the action must throw (or be a no-op with a toast warning). A folder designated as a special-purpose destination cannot be removed while it holds that role. The caller must reassign `downloadFolderId`/`importFolderId` first.

### New: `src/state/libraryStore.ts`

Zustand + Immer. Tracks `isDirty` for future auto-save wiring, but **the auto-save hook is NOT wired in this phase**. `isDirty` will accumulate silently until Phase 4 connects it.

```typescript
interface LibraryState {
  sounds: Sound[]
  tags: Tag[]
  sets: Set[]
  isDirty: boolean   // tracked but not consumed until Phase 4

  loadLibrary(library: GlobalLibrary): void
  updateLibrary(updater: (draft: GlobalLibrary) => void): void
  clearDirtyFlag(): void
}
```

### Modified: `src/state/projectStore.ts`

- Remove `sounds`, `tags`, `sets` from project state (no longer part of `Project`)
- TypeScript types update automatically via `z.infer<typeof ProjectSchema>` — no manual field handling needed
- All other state, actions, dirty flag, and auto-save behavior is **unchanged**

---

## File I/O Layer

### New: `src/lib/appSettings.ts`

```typescript
// File: appDataDir()/SoundsBored/settings.json
getSettingsFilePath(): Promise<string>   // mirrors getHistoryFilePath() pattern

loadAppSettings(): Promise<AppSettings>
// If file missing → createDefaultAppSettings() → write file → return
// createDefaultAppSettings():
//   1. Resolve $MUSIC via musicDir()
//   2. Attempt to create three default folders on disk (warn toast on failure, continue)
//   3. Return AppSettings with three GlobalFolder entries and valid downloadFolderId/importFolderId

saveAppSettings(settings: AppSettings): Promise<void>
```

### New: `src/lib/library.ts`

```typescript
// File: appDataDir()/SoundsBored/library.json
getLibraryFilePath(): Promise<string>

loadGlobalLibrary(): Promise<GlobalLibrary>
// If file missing → return { version: "1.0.0", sounds: [], tags: [], sets: [] }

saveGlobalLibrary(library: GlobalLibrary): Promise<void>
```

### New: `src/lib/appSettings.queries.ts`

```typescript
useAppSettings()       // TanStack Query — loads and caches app settings
useSaveAppSettings()   // mutation — saves and invalidates query
```

Follows the same query key convention, stale time, and error handling pattern as `project.queries.ts`. Initialization timing mirrors the existing pattern — no blocking of app render; components handle `null` settings state during load.

### New: `src/lib/library.queries.ts`

```typescript
useGlobalLibrary()       // TanStack Query — loads and caches global library
useSaveGlobalLibrary()   // mutation — saves and invalidates query
```

Same conventions as `appSettings.queries.ts`.

---

## Migration

**`1.0.0 → 1.1.0`** registered in `src/lib/migrations.ts`:

1. Strip `sounds`, `tags`, `sets` from raw project JSON
2. Add `favoritedSetIds: []`
3. Set `version: "1.1.0"`

**This migration is lossy by design** — `sounds`, `tags`, and `sets` are discarded from the project file. In practice these arrays are always `[]` since the sound library UI has not been built. If a migration encounters non-empty arrays (e.g., hand-edited project files), a `console.warn` is emitted listing the count of discarded entries. The data is not migrated to the global library automatically.

---

## Project `sounds/` Subfolder

The per-project `sounds/` subfolder is **preserved for export purposes only**. It is not auto-scanned as a sound source. When a project export feature is implemented (future), referenced global sounds will be copied here. No changes to project creation or loading are needed for this folder beyond removing the `sounds: []` initialization from `createProjectFile`.

---

## Test Factory Updates (`src/test/factories.ts`)

- **`createMockProject()`** — remove `sounds`, `tags`, `sets`; add `favoritedSetIds: []`
- **`createMockGlobalFolder(overrides?)`** — new
- **`createMockAppSettings(overrides?)`** — new, three default folders with valid `downloadFolderId` + `importFolderId`
- **`createMockGlobalLibrary(overrides?)`** — new, `{ version: "1.0.0", sounds: [], tags: [], sets: [] }`

---

## Future Considerations (not in scope)

- **`reconcileSoundLibrary()`** (Phase 4): Will scan all `globalFolders` recursively and reconcile against `library.json`. The project's `sounds/` folder is **not** a scan target. Missing files get a runtime `missing: true` flag (not persisted).
- **`libraryStore` auto-save hook** (Phase 4): Wire up a `useLibraryAutoSave` hook following the same pattern as `useAutoSave`.
- **Broader Tauri fs scope**: If users configure global folders outside the existing scoped paths (`$HOME`, `$MUSIC`, `$DOCUMENTS`, etc.), the Tauri capability scope in `default.json` will need expansion.

---

## Files Affected

### New Files
| File | Purpose |
|---|---|
| `src/lib/appSettings.ts` | CRUD for `settings.json` |
| `src/lib/appSettings.queries.ts` | TanStack Query hooks for settings |
| `src/lib/library.ts` | CRUD for `library.json` |
| `src/lib/library.queries.ts` | TanStack Query hooks for library |
| `src/state/appSettingsStore.ts` | Zustand store for app settings |
| `src/state/libraryStore.ts` | Zustand store for global library |

### Modified Files
| File | Change |
|---|---|
| `src/lib/schemas.ts` | New schemas; modified `SoundSchema`, `ProjectSchema` |
| `src/lib/project.ts` | Remove `sounds`, `tags`, `sets` from `createProjectFile` |
| `src/state/projectStore.ts` | Types update automatically; no manual field changes needed |
| `src/lib/migrations.ts` | Add `1.0.0 → 1.1.0` migration |
| `src/test/factories.ts` | Update `createMockProject`; add three new factory helpers |
