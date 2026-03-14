# SoundsBored — AI Assistant Context

> **Purpose**: Pad-based desktop soundboard built with Tauri. Users trigger sounds via pads organized into scenes. Supports complex playback rules, mute groups, and web audio import.

---

## Tech Stack

- **Frontend**: React 19 + TypeScript (strict) + Vite 7 + Shadcn with Tailwind 4 + TanStack Query 5
- **Backend**: Tauri 2.x with Rust
- **State**: Zustand + Immer (`projectStore`, `playbackStore`)
- **Validation**: Zod 4
- **UI**: shadcn/ui components + Sonner (toast notifications) + HugeIcons (`@hugeicons/react`)
- **Testing**: Vitest + Testing Library + happy-dom
- **Audio**: Web Audio API (no Rust audio plugin initially)

---

## Architecture Overview

### Core Domain Model

**Sound** → **SoundInstance** → **Layer** → **Pad** → **Scene**

- **Sound**: An audio file asset in the library (`.wav`, `.mp3`, etc.) — project-level, shared across pads
- **SoundInstance**: A reference to a Sound with usage-specific config (volume, startOffsetMs)
- **Layer**: An independent playback unit within a pad
  - Has selection rules (LayerSelection: assigned/tag/set)
  - Has arrangement (simultaneous/sequential/shuffled)
  - Has playback config (PlaybackMode: one-shot/hold/loop)
  - Has retrigger behavior (RetriggerMode: restart/continue/stop/next)
- **Pad**: A triggerable button containing multiple Layers (all fire simultaneously on trigger)
- **Scene**: A collection of pads with a rows/cols grid layout

### Key Design Principles

1. **AudioBuffer Cache**: Keyed by `Sound.id` — one buffer load, shared by all layers/pads
2. **Auto-Discovery**: Files in `sounds/` folder are auto-discovered on project load via `reconcileSoundLibrary()`
3. **Missing Files**: Get runtime `missing: true` flag (not persisted to disk)
4. **Playback Config**: Per-layer (not per-sound or per-instance)
5. **State Split**:
   - `projectStore` (Zustand + Immer) — serializable, saved to disk
   - `playbackStore` (Zustand) — runtime-only (AudioBuffers, active voices) — currently empty shell
   - `downloadStore` (Zustand) — runtime-only (yt-dlp downloads) — not yet created

### Muting System

- **Directional Mute**: `muteTargetPadIds` on a pad — triggering this pad mutes specific other pads
- **Exclusive Mute**: `muteGroupId` — only one pad in group can play at once (hi-hat style)

### File Paths

Audio file paths are **relative to project folder**, stored as `Sound.filePath`. The project folder location is tracked separately in state (`folderPath` in `projectStore`).

---

## File Structure

```
src/
├── components/
│   ├── composite/
│   │   └── MenuBar/               # TODO: rename to SceneTabBar/
│   ├── modals/
│   │   ├── ConfirmCloseDialog.tsx
│   │   └── SaveProjectDialog.tsx
│   ├── screens/
│   │   ├── main/MainPage.tsx      # Main editor (currently empty shell — Phase 3)
│   │   └── start/StartScreen.tsx  # New/Load project screen
│   ├── ui/                        # shadcn/ui components
│   └── ErrorBoundary.tsx          # AppErrorBoundary + RouteErrorElement
├── hooks/
│   ├── useAutoSave.ts             # Auto-save logic (uses projectStore)
│   └── useWindowCloseHandler.ts
├── lib/
│   ├── audio/                     # PLANNED: audioEngine, soundLoader, padPlayer, muteManager
│   ├── constants.ts               # APP_FOLDER, PROJECT_FILE_NAME, SOUNDS_SUBFOLDER, AUDIO_EXTENSIONS, etc.
│   ├── history.ts                 # Manages recent projects file
│   ├── history.queries.ts         # TanStack Query hooks
│   ├── history.helpers.ts
│   ├── migrations.ts              # Versioned project migration registry
│   ├── project.ts                 # Project CRUD operations
│   ├── project.queries.ts         # TanStack Query hooks
│   ├── schemas.ts                 # Zod schemas — full domain model
│   ├── queryClient.ts
│   └── utils.ts                   # cn() helper
├── state/
│   ├── projectStore.ts            # Zustand + Immer — current project state
│   └── playbackStore.ts           # Zustand — runtime-only (empty shell)
├── test/
│   ├── factories.ts               # Test data factories (createMockProject, createMockHistoryEntry, etc.)
│   ├── setup.ts                   # Vitest config
│   └── tauri-mocks.ts             # Mock Tauri APIs
├── App.tsx                        # Router setup (no Provider needed — Zustand is module-level)
└── main.tsx                       # React entry point

src-tauri/
├── src/
│   ├── lib.rs                     # Tauri app setup + plugins
│   └── main.rs                    # Entry point
├── capabilities/
│   └── default.json               # Tauri permissions
└── Cargo.toml
```

### Important Path Aliases

- `@/*` → `./src/*` (configured in `tsconfig.json`)

---

## State Management

### projectStore (`src/state/projectStore.ts`)

Zustand + Immer store. Module-level singleton — no Provider needed.

**State fields:**
- `project: Project | null` — the loaded project data
- `folderPath: string | null` — derived from `historyEntry.path`
- `historyEntry: ProjectHistoryEntry | null`
- `isTemporary: boolean` — true until "Save As" is completed
- `isDirty: boolean` — true after any `updateProject()` call

**Actions:**
- `loadProject(historyEntry, project, isTemporary)` — load a project, resets `isDirty` to false
- `updateProject(project)` — sets new project data + marks `isDirty=true`
- `clearDirtyFlag()` — called after auto-save to disk (does NOT change `isTemporary`)
- `markAsPermanent(historyEntry)` — called after Save As; sets `isTemporary=false`, `isDirty=false`
- `clearProject()` — resets all state to null/false
- `hasUnsavedChanges()` — returns `isTemporary || isDirty` (use selector `s.isTemporary || s.isDirty` in components)

**Usage pattern:**
```typescript
const project = useProjectStore((s) => s.project);
const loadProject = useProjectStore((s) => s.loadProject);
```

### playbackStore (`src/state/playbackStore.ts`)

Empty shell. Will hold AudioBuffers, active voices, master volume in Phase 5.

---

## Project Storage

### Project Folder Structure

```
<UserChosen>/
  <ProjectName>/
    project.json       # All metadata + scene/pad/sound/tag/set definitions
    sounds/            # Audio files (mp3, wav, ogg, flac, aiff, m4a) — auto-discovered on load
      kick.wav
      ambience.mp3
```

### Project.json Schema (current)

```typescript
{
  name: string
  version?: string           // default: "1.0.0"
  description?: string       // default: ""
  lastSaved?: string         // ISO timestamp
  scenes: Scene[]            // default: []
  sounds: Sound[]            // default: []
  tags: Tag[]                // default: []
  sets: Set[]                // default: []
}
```

All domain model types are fully defined in `src/lib/schemas.ts`.

### File Locations

- **Temp Projects**: `$APPLOCALDATA/SoundsBored/temp_<name>_<timestamp>/`
- **User Projects**: User-selected location via Save As dialog
- **Recent Projects List**: `$APPLOCALDATA/SoundsBored/history.json`

### Migrations

`src/lib/migrations.ts` — versioned migration registry. Called in `loadProjectFile()` before Zod parse. Currently empty (no migrations needed yet). Register future migrations in the `MIGRATIONS` array.

---

## Routing

- `/` → StartScreen (New Project, Load Recent, Open Folder)
- `/main` → MainPage (main editor — currently empty shell)

---

## Known Issues & Anti-Patterns

### What NOT to Do

- ❌ Don't add `debugger;` statements to production code
- ❌ Don't use generic `updateProject()` for everything — prefer specific actions (e.g., `addScene()`, `updatePad()`) as the domain grows
- ❌ Don't persist `missing: true` flags in project.json
- ❌ Don't store absolute file paths in project.json — use project-relative paths
- ❌ Don't create new toast implementations — use Sonner only
- ❌ Don't create documentation files or READMEs unless explicitly requested
- ❌ Don't add emojis to code or output unless explicitly requested
- ❌ Don't use `CurrentProjectProvider` or `useCurrentProject` — deleted; use `useProjectStore` instead

### Remaining TODOs

- `src/components/composite/MenuBar/` — rename to `SceneTabBar/`
- `src/lib/audio/` — implement in Phase 5
- `downloadStore.ts` — implement in Phase 6 (yt-dlp)
- `MainPage` — needs real UI (Phase 3: toolbar, scene tab bar, pad grid)

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

// Create new project (also creates sounds/ subfolder)
const { project, folderPath } = await createNewProject("My Project");

// Load existing project (runs migrations, defaults arrays, auto-discovers sounds/)
const result = await selectAndLoadProject();

// Save current project
await saveProject(folderPath, project);

// Save as (prompts for location, copies files, cleans up temp)
const result = await saveProjectAs(projectName, currentPath, project);
```

### Open folder in file browser

```typescript
import { openPath } from "@tauri-apps/plugin-opener";
await openPath(folderPath); // requires opener:allow-open-path + opener scope in capabilities
```

---

## Testing Conventions

- **Test files**: `*.test.ts` or `*.test.tsx` colocated with source
- **Test setup**: `src/test/setup.ts` (global mocks + matchers)
- **Factories**: `src/test/factories.ts` — `createMockProject`, `createMockHistoryEntry`, `createProjectJson`, `createHistoryJson`
- **Tauri mocks**: `src/test/tauri-mocks.ts` (automatically imported in setup)
- **Store tests**: Use `useProjectStore.setState(initialProjectState)` in `beforeEach` to reset between tests

### Example Test Pattern

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockProject } from '@/test/factories';
import { useProjectStore, initialProjectState } from '@/state/projectStore';

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
  });

  it('should load a project', () => {
    const project = createMockProject({ name: 'Test' });
    // ...
  });
});
```

---

## Planned Features (Not Yet Implemented)

- [ ] Phase 3: MainPage UI shell (toolbar, scene tab bar, pad grid placeholder)
- [ ] Phase 4: Sound import UI, sound library panel, pad assignment
- [ ] Phase 5: Audio engine (`src/lib/audio/`: audioEngine, soundLoader, padPlayer, muteManager)
- [ ] Phase 5: `playbackStore.ts` — AudioBuffers, active voices, master volume
- [ ] Phase 6: yt-dlp integration (Tauri sidecar), `downloadStore.ts`
- [ ] Phase 6: Web audio import with stream-while-downloading
- [ ] Phase 6: Undo/redo (Zustand + Immer middleware)
- [ ] Phase 6: Auto-save failure warning toast + "last saved at" indicator

---

## Code Style & Conventions

- **TypeScript**: Strict mode enabled
- **Imports**: Use `@/*` alias for src imports
- **Components**: Functional components with hooks
- **Icons**: Use `HugeiconsIcon` from `@hugeicons/react` + icon imports from `@hugeicons/core-free-icons`
- **Error handling**: Use custom error classes (`ProjectNotFoundError`, `ProjectValidationError`)
- **Validation**: Use Zod schemas for all external data (file I/O, user input)
- **Toast notifications**: Use `sonner` only
- **State**: Use `useProjectStore((s) => s.field)` selector pattern in components

---

## Important Context for AI

### When Making Changes

1. **Always read files before editing** — don't modify blindly
2. **Prefer editing over creating** — avoid file bloat
3. **Use projectStore actions** — not ad-hoc state manipulation
4. **Validate with Zod** — all external data must be validated
5. **Write tests before or alongside implementation**
6. **No console.log in production code** — use toast notifications for user-facing messages

### When Working with Audio (Phase 5)

Web Audio API first. No Rust plugins needed initially. AudioBuffer caching is critical — never load the same sound file twice. `Sound.filePath` is relative to project folder; use `convertFileSrc()` to get a loadable URL in the WebView.

---

## External Resources

- Full architecture analysis: `C:\Users\Zack\.claude\plans\delegated-hugging-treasure.md`
- Auto memory: `C:\Users\Zack\.claude\projects\c--Repos-sounds-bored\memory\MEMORY.md`

---

**Last Updated**: 2026-03-14
**Current Git Branch**: master
**Phase Complete**: Phase 2 (Data Model + Zustand migration)
**Next Phase**: Phase 3 — UI Shell (MainPage layout, scene tab bar, pad grid)
