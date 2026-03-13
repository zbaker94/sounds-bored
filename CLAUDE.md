# SoundsBored — AI Assistant Context

> **Purpose**: Pad-based desktop soundboard built with Tauri. Users trigger sounds via pads organized into scenes. Supports complex playback rules, mute groups, and web audio import.

---

## Tech Stack

- **Frontend**: React 19 + TypeScript (strict) + Vite 7 + Shadcn with Tailwind 4 + TanStack Query 5
- **Backend**: Tauri 2.x with Rust
- **State**: React Context (migrating to Zustand + Immer)
- **Validation**: Zod 4
- **UI**: shadcn/ui components + Sonner (toast notifications)
- **Testing**: Vitest + Testing Library + happy-dom
- **Audio**: Web Audio API (no Rust audio plugin initially)

---

## Architecture Overview

### Core Domain Model

**Sound** → **SoundInstance** → **Layer** → **Pad** → **Scene**

- **Sound**: An audio file asset in the library (`.wav`, `.mp3`, etc.)
- **SoundInstance**: A reference to a Sound with usage-specific config (volume, startOffsetMs)
- **Layer**: An independent playback unit within a pad
  - Contains one or more SoundInstances
  - Has selection rules (Arrangement: sequential/simultaneous/shuffled)
  - Has playback config (PlaybackMode: one-shot/hold/loop)
  - Has retrigger behavior (RetriggerMode: restart/continue/stop/next)
- **Pad**: A triggerable button containing multiple Layers (with rules to trigger layers all at once, sequentially, shuffled, etc.)
- **Scene**: A collection of pads with shared context

### Key Design Principles

1. **AudioBuffer Cache**: Keyed by `Sound.id` — one buffer load, shared by all layers/pads
2. **Auto-Discovery**: Files in `sounds/` folder are auto-discovered on project load via `reconcileSoundLibrary()`
3. **Missing Files**: Get runtime `missing: true` flag (not persisted to disk)
4. **Playback Config**: Per-layer (not per-sound or per-instance)
5. **State Split**:
   - `projectStore` (Zustand) — serializable, saved to disk
   - `playbackStore` (Zustand) — runtime-only (AudioBuffers, active voices)
   - `downloadStore` (Zustand) — runtime-only (yt-dlp downloads)

### Muting System

- **Directional Mute**: `muteTargetPadIds` on a pad — triggering this pad mutes specific other pads
- **Exclusive Mute**: `muteGroupId` — only one pad in group can play at once (hi-hat style)

### File Paths

Audio file paths are **relative to project folder**, stored as `Sound.filePath`. The project folder location is tracked separately in state.

---

## File Structure

```
src/
├── components/
│   ├── composite/
│   │   └── MenuBar/          # RENAME TO: SceneTabBar/
│   ├── modals/
│   │   ├── ConfirmCloseDialog.tsx
│   │   └── SaveProjectDialog.tsx
│   ├── screens/
│   │   ├── main/MainPage.tsx      # Main editor (currently empty)
│   │   └── start/StartScreen.tsx  # New/Load project screen
│   └── ui/                    # shadcn/ui components
├── hooks/
│   ├── useAutoSave.ts         # Auto-save logic
│   └── useWindowCloseHandler.ts
├── lib/
│   ├── audio/                 # PLANNED: audioEngine, soundLoader, padPlayer, muteManager
│   ├── constants.ts           # APP_FOLDER, PROJECT_FILE_NAME, etc.
│   ├── history.ts             # Manages recent projects file
│   ├── history.queries.ts     # TanStack Query hooks
│   ├── history.helpers.ts
│   ├── project.ts             # Project CRUD operations
│   ├── project.queries.ts     # TanStack Query hooks
│   ├── schemas.ts             # Zod schemas (Project, ProjectHistory)
│   ├── queryClient.ts
│   └── utils.ts               # cn() helper
├── state/
│   └── currentProjectStore.tsx  # Context managing CURRENT project (was historyStore.tsx)
├── test/
│   ├── factories.ts           # Test data factories
│   ├── setup.ts               # Vitest config
│   └── tauri-mocks.ts         # Mock Tauri APIs
├── App.tsx                    # Router setup
└── main.tsx                   # React entry point

src-tauri/
├── src/
│   ├── lib.rs                 # Tauri app setup + plugins
│   └── main.rs                # Entry point
├── capabilities/
│   └── default.json           # Tauri permissions (⚠️ has security issue)
└── Cargo.toml
```

### Important Path Aliases

- `@/*` → `./src/*` (configured in `tsconfig.json`)

---

## State Management (In Progress)

### Current (Context-based)

- `src/state/currentProjectStore.tsx` — React Context
- Uses `updateProject()` to set `isDirty=true` on any change

### Planned (Zustand + Immer)

Migrating to three stores:

1. **projectStore.ts** (serializable, includes isDirty/isSaved)
   - Contains: Project data, scenes, pads, layers, sound library
   - Saved to `project.json` on disk

2. **playbackStore.ts** (runtime-only)
   - Contains: AudioBuffers, active voices, playback state

3. **downloadStore.ts** (runtime-only)
   - Contains: yt-dlp download progress, temporary streams

**Pattern**: Use specific action methods (e.g., `updatePadName()`, `addLayer()`) instead of generic `updateProject()`. Each action auto-marks `isDirty=true` via Immer's `produce()`.

---

## Project Storage

### Project Structure

```
MyProject/
├── project.json           # Project metadata + domain model
└── sounds/                # Audio files (auto-discovered)
    ├── kick.wav
    └── snare.wav
```

### Project.json Schema

```typescript
{
  name: string
  version?: string           // default: "0.1.0"
  description?: string       // default: ""
  lastSaved?: string         // ISO timestamp
  // Future: scenes, pads, layers, sounds, muteGroups
}
```

### File Locations

- **Temp Projects**: `$APPLOCALDATA/SoundsBored/temp_*_<timestamp>` (⚠️ should use `appLocalDataDir()`, not `tempDir()`)
- **User Projects**: User-selected location via Save As dialog
- **Recent Projects List**: `$APPLOCALDATA/SoundsBored/history.json`

---

## Routing

- `/` → StartScreen (New Project, Load Recent, Open Folder)
- `/main` → MainPage (main editor — currently empty shell)

---

## Known Issues & Anti-Patterns

### Critical Bugs (as of commit b2ef9fb)

1. **Temporary project location**: Uses `tempDir()` instead of `appLocalDataDir()` — temp files get cleaned up on reboot
2. **debugger statement**: Left at `project.ts:145`
3. **saveProjectAs loses data**: Reconstructs Project from defaults, discards description
4. **Fragile instanceof check**: `project.ts:76` uses string comparison instead of proper instanceof
5. **Path guard bug**: Discard check uses `path.includes("SoundsBored")` — should only use `!isSaved`
6. **Security risk**: `fs:scope` has `{ "path": "**" }` catch-all in capabilities — too permissive
7. **Dead toast code**: `use-toast.ts`, `toast.tsx`, `toaster.tsx` are unused — only `sonner.tsx` is active

### What NOT to Do

- ❌ Don't add `debugger;` statements to production code
- ❌ Don't use generic `updateProject()` — use specific zustand actions instead
- ❌ Don't persist `missing: true` flags in project.json
- ❌ Don't store absolute file paths — use project-relative paths
- ❌ Don't create new toast implementations — use Sonner
- ❌ Don't create documentation files or READMEs unless explicitly requested
- ❌ Don't add emojis to code or output unless explicitly requested

---

## Common Tasks / Commands

### Development

```bash
npm run dev              # Start dev server
npm run tauri dev        # Start Tauri app in dev mode
npm run build            # Build for production
```

### Testing

```bash
npm test                 # Run tests in watch mode
npm run test:ui          # Open Vitest UI
npm run test:run         # Run tests once (CI mode)
npm run test:coverage    # Generate coverage report
npm run test:rust        # Run Rust tests
```

### Project Operations (via Tauri APIs)

```typescript
import { createNewProject, selectAndLoadProject, saveProject, saveProjectAs } from "@/lib/project";

// Create new project
const { project, folderPath } = await createNewProject("My Project");

// Load existing project
const result = await selectAndLoadProject();
if (result) {
  const { project, folderPath } = result;
}

// Save current project
await saveProject(folderPath, project);

// Save as (prompts for location, copies files, cleans up temp)
const result = await saveProjectAs(projectName, currentPath, project);
```

---

## Testing Conventions

- **Test files**: `*.test.ts` or `*.test.tsx` colocated with source
- **Test setup**: `src/test/setup.ts` (global mocks + matchers)
- **Factories**: `src/test/factories.ts` for creating test data
- **Tauri mocks**: `src/test/tauri-mocks.ts` (automatically imported in setup)

### Example Test Pattern

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createTestProject } from '@/test/factories';

describe('MyComponent', () => {
  it('should do something', () => {
    const project = createTestProject({ name: 'Test' });
    expect(project.name).toBe('Test');
  });
});
```

---

## Planned Features (Not Yet Implemented)

- [ ] Pad UI with layer management
- [ ] Audio playback engine (`src/lib/audio/`)
- [ ] Mute group management
- [ ] Tag/set-based sound selection
- [ ] yt-dlp integration (as Tauri sidecar)
- [ ] Web audio import with stream-while-downloading
- [ ] Multiple RetriggerModes per layer

---

## Code Style & Conventions

- **TypeScript**: Strict mode enabled
- **Formatting**: Use project's Prettier/ESLint config (if present)
- **Imports**: Use `@/*` alias for src imports
- **Components**: Functional components with hooks
- **Error handling**: Use custom error classes (ProjectNotFoundError, ProjectValidationError)
- **Validation**: Use Zod schemas for all external data (file I/O, user input)
- **Toast notifications**: Use `sonner` only (not shadcn toast components)

---

## Important Context for AI

### When Making Changes

1. **Always read files before editing** — don't modify blindly
2. **Prefer editing over creating** — avoid file bloat
3. **Use specific state actions** — not generic `updateProject()`
4. **Validate with Zod** — all external data must be validated
5. **Test your changes** — write/update tests for new functionality BEFORE implementation
6. **Check for known bugs** — don't reintroduce fixed issues

### When Planning Migrations

The Zustand + Immer migration should happen **before** implementing complex nested editing (pad UI, layer management). Current Context-based state will be hard to maintain with deep updates.

### When Working with Audio

Web Audio API first. No Rust plugins needed initially. AudioBuffer caching is critical for performance — never load the same sound file multiple times.

---

## External Resources

- Full architecture analysis: `C:\Users\Zack\.claude\plans\delegated-hugging-treasure.md`
- Auto memory: `C:\Users\Zack\.claude\projects\c--Repos-sounds-bored\memory\MEMORY.md`

---

**Last Updated**: 2026-03-13
**Current Git Branch**: master
**Latest Commit**: e89f489 "add tests, begin fixing bugs / refactoring names. Full create / save as/ load flow works."
