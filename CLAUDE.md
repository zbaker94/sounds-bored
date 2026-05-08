# SoundsBored — AI Assistant Context

Pad-based desktop soundboard (Tauri). Pads trigger sounds in scenes. Supports layered playback rules, mute groups, yt-dlp import.

---

## Tech Stack

- **Frontend**: React 19 + TypeScript (strict) + Vite 7 + Shadcn + Tailwind 4 + TanStack Query 5
- **Backend**: Tauri 2.x + Rust
- **State**: Zustand + Immer
- **Validation**: Zod 4
- **UI**: shadcn/ui + Sonner (toasts) + HugeIcons (`@hugeicons/react`)
- **Testing**: Vitest + Testing Library + happy-dom
- **Audio**: Web Audio API (no Rust plugin)

---

## Domain Model

See `CONTEXT.md` for authoritative definitions. Summary:

**Sound** → **SoundInstance** → **Layer** → **Pad** → **Scene**

- **Sound**: audio file asset in global library, shared across pads
- **SoundInstance**: Sound reference with per-use config (volume, startOffsetMs); lives in an assigned Layer
- **Layer**: independent playback unit — owns selection, arrangement, playbackMode, retriggerMode
- **Pad**: all layers fire simultaneously on trigger
- **Scene**: CSS grid of pads

Key rules:
- `Sound.filePath` is project-relative (not absolute)
- `missing: true` is runtime-only — never persisted
- AudioBuffer cache keyed by `Sound.id` — one load, reused everywhere
- Sounds/tags/sets live in `libraryStore`, NOT `projectStore`

### Muting

- `muteTargetPadIds` — triggering pad stops specific named pads
- `muteGroupId` — exclusive group, only one plays at once (hi-hat style)

---

## File Structure

```
src/
├── components/
│   ├── composite/
│   │   ├── DownloadManager/
│   │   │   ├── DownloadItem.tsx           # Single yt-dlp download row
│   │   │   └── DownloadManager.tsx        # Download queue panel
│   │   ├── PadConfigDrawer/
│   │   │   ├── LayerAccordion.tsx         # Collapsible layer list
│   │   │   ├── LayerConfigSection.tsx     # Per-layer settings
│   │   │   ├── PadConfigDrawer.tsx        # Pad editing drawer
│   │   │   ├── SoundFolderTree.tsx        # File-tree view of library
│   │   │   ├── SoundSelector.tsx          # Sound picker (search + tree)
│   │   │   └── soundTreeUtils.ts
│   │   ├── SceneTabBar/
│   │   │   ├── MenuDrawer.tsx             # Hamburger menu (project actions)
│   │   │   ├── SceneTab.tsx
│   │   │   └── SceneTabBar.tsx            # Tab bar + add/delete scene
│   │   ├── SceneView/
│   │   │   ├── PadButton.tsx              # Triggerable pad button
│   │   │   └── SceneView.tsx              # CSS grid of pads
│   │   └── SidePanel/
│   │       ├── AddSetDialog.tsx
│   │       ├── AddTagsDialog.tsx
│   │       ├── AddToSetDialog.tsx
│   │       ├── EditSection.tsx            # Sound metadata edit
│   │       ├── PlaySection.tsx            # Sound preview controls
│   │       ├── SidePanel.tsx
│   │       ├── SoundsPanel.tsx            # Library list + filter
│   │       └── VolumeSection.tsx
│   ├── modals/
│   │   ├── ConfirmCloseDialog.tsx
│   │   ├── ConfirmDeletePadDialog.tsx
│   │   ├── ConfirmDeleteSceneDialog.tsx
│   │   ├── DownloadDialog.tsx             # yt-dlp URL input
│   │   ├── ResolveMissingDialog.tsx       # Locate missing sound file
│   │   ├── ResolveMissingFolderDialog.tsx # Re-point sounds folder
│   │   ├── SaveProjectDialog.tsx
│   │   └── SettingsDialog.tsx
│   ├── screens/
│   │   ├── main/MainPage.tsx              # Main editor
│   │   └── start/StartScreen.tsx          # New/Load project screen
│   ├── ui/                                # shadcn/ui primitives
│   │   ├── drawer-dialog.tsx              # Responsive drawer-or-dialog
│   │   ├── empty.tsx                      # Empty state placeholder
│   │   ├── input-group.tsx
│   │   ├── item.tsx                       # Generic list item
│   │   ├── kbd.tsx                        # Keyboard shortcut badge
│   │   ├── sonner.tsx                     # Toast wrapper — only toast impl
│   │   ├── truncated-path.tsx             # Path display, truncates middle
│   │   └── [standard shadcn primitives]
│   └── ErrorBoundary.tsx                  # AppErrorBoundary + RouteErrorElement
├── contexts/
│   └── ProjectActionsContext.tsx          # Project-level actions (save, close)
├── hooks/
│   ├── useAutoSave.ts
│   ├── useBootLoader.ts                   # Startup: load settings, history, library
│   ├── useBreakpoint.ts
│   ├── useFadeMode.ts                     # Resolve active fade duration
│   ├── useGlobalHotkeys.ts
│   ├── useImportSounds.ts                 # Drag-drop / file-picker import
│   ├── usePadGesture.ts                   # Pointer events for pads
│   ├── usePreloadImages.ts
│   ├── useProjectLifecycle.ts             # Window close / save-discard flow
│   ├── useSoundPreview.ts
│   ├── useUpdater.ts
│   └── useWindowCloseHandler.ts
├── lib/
│   ├── audio/
│   │   ├── arrangement.ts                 # Build play order (simultaneous/sequential/shuffled)
│   │   ├── audioContext.ts                # Singleton AudioContext
│   │   ├── audioEvents.ts                 # Error event bus
│   │   ├── audioState.ts                  # Non-serializable engine Maps (voices, gains, chains)
│   │   ├── audioTick.ts                   # RAF loop: audioState → padMetricsStore/layerMetricsStore
│   │   ├── audioVoice.ts                  # AudioVoice interface + buffer/streaming factories
│   │   ├── bufferCache.ts                 # AudioBuffer cache keyed by Sound.id
│   │   ├── fadeMixer.ts                   # Pad fade/crossfade orchestration
│   │   ├── gainManager.ts                 # Gain ramp helpers
│   │   ├── gainNormalization.ts           # EBU R128 loudness normalization
│   │   ├── layerTrigger.ts                # Per-layer trigger, retrigger, chain, skip logic
│   │   ├── padPlayer.ts                   # Public API: trigger/stop pads, fades
│   │   ├── preview.ts                     # One-shot preview (sound library)
│   │   ├── resolveSounds.ts               # Resolve LayerSelection → Sound[]
│   │   └── streamingCache.ts              # Streaming element cache (yt-dlp / large files)
│   ├── appSettings.ts
│   ├── appSettings.queries.ts
│   ├── constants.ts                       # APP_FOLDER, AUDIO_EXTENSIONS, etc.
│   ├── history.ts
│   ├── history.queries.ts
│   ├── history.helpers.ts
│   ├── import.ts                          # Copy file to sounds/, reconcile library
│   ├── library.ts                         # Library CRUD (library.json)
│   ├── library.queries.ts
│   ├── library.reconcile.ts              # Folder scan, missing detection, analysis scheduling
│   ├── migrations.ts                      # Versioned project migration registry
│   ├── project.ts                         # Project CRUD
│   ├── project.queries.ts
│   ├── queryClient.ts
│   ├── schemas.ts                         # Zod schemas — full domain model
│   ├── utils.ts
│   ├── ytdlp.ts                           # yt-dlp sidecar integration
│   └── ytdlp.queries.ts
├── state/
│   ├── analysisStore.ts                   # Zustand — loudness analysis queue/status
│   ├── appSettingsStore.ts                # Zustand — app-level settings
│   ├── downloadStore.ts                   # Zustand — yt-dlp download queue (runtime)
│   ├── layerMetricsStore.ts               # Zustand — per-layer volumes, progress, chain (tick-managed)
│   ├── libraryStore.ts                    # Zustand + Immer — sounds, tags, sets
│   ├── padDisplayStore.ts                 # Zustand — pad metadata overlay (sound name, cover art)
│   ├── padMetricsStore.ts                 # Zustand — per-pad volumes, progress (tick-managed)
│   ├── playbackStore.ts                   # Zustand — playingPadIds, fading state, master volume
│   ├── projectStore.ts                    # Zustand + Immer — current project (scenes, pads)
│   ├── uiStore.ts                         # Zustand — selected pad, open overlays
│   └── updaterStore.ts
├── test/
│   ├── factories.ts                       # createMockProject, createMockHistoryEntry, etc.
│   ├── setup.ts                           # Vitest global setup
│   └── tauri-mocks.ts                     # Mock Tauri APIs
├── App.tsx                                # Router setup
└── main.tsx                               # React entry point (reuses root across HMR)

src-tauri/
├── src/
│   ├── commands.rs                        # Tauri IPC commands
│   ├── lib.rs                             # Tauri app setup + plugins
│   └── main.rs
├── capabilities/default.json             # Tauri permissions
└── Cargo.toml
```

Path alias: `@/*` → `./src/*`

---

## State Management

### projectStore (`src/state/projectStore.ts`)

Zustand + Immer. No Provider needed.

- `project: Project | null`, `folderPath`, `historyEntry`, `isTemporary`, `isDirty`
- `loadProject()` — resets `isDirty`
- `updateProject()` — marks `isDirty=true`
- `markAsPermanent()` — after Save As; clears both flags
- `hasUnsavedChanges()` → `isTemporary || isDirty`

```typescript
const project = useProjectStore((s) => s.project);
```

### libraryStore (`src/state/libraryStore.ts`)

Zustand + Immer. Sounds, tags, sets live here — NOT in projectStore.

- `updateLibrary(updater)` — immer updater fn, marks `isDirty=true`

```typescript
const sounds = useLibraryStore((s) => s.sounds);
```

### playbackStore (`src/state/playbackStore.ts`)

Zustand. Push-based reactive UI signals written by padPlayer/fadeMixer on discrete events:
- `playingPadIds`, `fadingPadIds`, `fadingOutPadIds`, `reversingPadIds`
- `masterVolume` — synced to AudioContext master gain by audioTick

Tick-managed fields (written by `audioTick.ts` each RAF frame) live in `padMetricsStore` and `layerMetricsStore`.

### audioState (`src/lib/audio/audioState.ts`)

Non-serializable engine runtime — all Web Audio Maps live here (padGainMap, voiceMap, layerGainMap, chain queues, fade tracking, etc.). Does NOT import playbackStore. Callers mirror state to playbackStore.

---

## Project Storage

```
<UserChosen>/
  <ProjectName>/
    project.json       # scenes + pads only (no sounds/tags/sets)
    sounds/            # auto-discovered on load
```

`project.json` shape:
```typescript
{ name, version?, description?, lastSaved?, scenes: Scene[] }
```

File locations:
- **Temp**: `$APPLOCALDATA/SoundsBored/temp_<name>_<timestamp>/`
- **User**: chosen via Save As
- **History**: `$APPLOCALDATA/SoundsBored/history.json`
- **Library/Settings**: `$APPDATA/com.beeswax.sounds-bored/SoundsBored/`

Migrations: `src/lib/migrations.ts` — called before Zod parse in `loadProjectFile()`.

---

## Routing

- `/` → StartScreen (New Project, Load Recent, Open Folder)
- `/main` → MainPage (toolbar + SceneTabBar + SceneView + SidePanel)

`MainPage` redirects to `/` when `project === null`.

---

## Anti-Patterns

- No `debugger;` in production
- No absolute file paths in project.json — project-relative only
- No new toast implementations — Sonner only
- No `console.*` — use `logError`/`logInfo`/`logWarn` from `@/lib/logger`
- No `CurrentProjectProvider` / `useCurrentProject` — deleted; use `useProjectStore`
- No `missing: true` in persisted data — runtime flag only
- Domain components connect to Zustand directly — don't thread store state as props

### Vite HMR Blank Screen (fixed 2026-04-13)

HMR full reload re-ran `main.tsx` → second `createRoot` → unmounted tree → blank screen on `/main`.

Fixes:
- `main.tsx` — caches root on `rootEl.__reactRoot`, reuses across HMR
- `MainPage` — `<Navigate to="/" replace />` when `project === null`

Recovery: navigate to `http://localhost:1420/`.

### MCP / Automated Testing

`tauri-plugin-mcp-bridge` active in debug builds. Connect via Hypothesi MCP tools.

- Pads use `pointerdown`/`pointerup` — simulate via `dispatchEvent(new PointerEvent(...))`
- Native OS dialogs are outside webview — MCP can't interact with them
- Manual tests: `docs/manual-tests/`

---

## Commands

```bash
# Dev
npm run dev              # Frontend dev server
npm run tauri dev        # Full Tauri app

# Test
npm test                 # Watch mode
npm run test:run         # CI (once)
npm run test:coverage
npm run test:rust

# Build
npm run build
```

### Releasing

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (including `bundle.windows.wix.version`)
2. `git commit -m "chore: bump version to vX.X.X"`
3. `git tag vX.X.X && git push && git push origin vX.X.X`

### Project API

```typescript
import { createNewProject, selectAndLoadProject, saveProject, saveProjectAs } from "@/lib/project";

const { project, folderPath } = await createNewProject("My Project");
const result = await selectAndLoadProject();
await saveProject(folderPath, project);
const result = await saveProjectAs(projectName, currentPath, project);
```

```typescript
import { openPath } from "@tauri-apps/plugin-opener";
await openPath(folderPath); // requires opener:allow-open-path capability
```

---

## Testing Conventions

- Test files colocated: `*.test.ts` / `*.test.tsx`
- Setup: `src/test/setup.ts`
- Factories: `src/test/factories.ts`
- Tauri mocks: `src/test/tauri-mocks.ts` (auto-imported)
- Reset stores in `beforeEach`: `useProjectStore.setState({ ...initialProjectState })`
- `_` prefix on exports = test introspection only (WeakMaps, internal Maps)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockProject } from '@/test/factories';
import { useProjectStore, initialProjectState } from '@/state/projectStore';

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({ ...initialProjectState });
  });

  it('loads a project', () => {
    const project = createMockProject({ name: 'Test' });
    // ...
  });
});
```

---

## Code Style

- Imports: `@/*` alias
- Icons: `HugeiconsIcon` from `@hugeicons/react` + imports from `@hugeicons/core-free-icons`
- Errors: custom classes (`ProjectNotFoundError`, `ProjectValidationError`)
- Validation: Zod for all external data (file I/O, user input)
- Logging: `logError`/`logInfo`/`logWarn` from `@/lib/logger` — not `console.*`
- Audio files: `Sound.filePath` is project-relative; use `convertFileSrc()` for WebView URL

---

## Remaining Work (Phase 6)

- [ ] Undo/redo (Zustand + Immer middleware)
- [ ] Auto-save failure toast + "last saved at" indicator

---

## Architecture Decision Records (ADRs)

Decisions live in `docs/adr/NNNN-slug.md`. Create directory if needed.

**Write one when all three true:**
1. Hard to reverse
2. Surprising without context
3. Real trade-off between alternatives

**Format** — single paragraph:
```
# Short title

1–3 sentences: context, decision, why, what was rejected.
```

Offer an ADR when a candidate is rejected with a load-bearing reason (e.g. during `/improve-codebase-architecture`) or a non-obvious constraint is established.

---

## External Resources

- Full architecture analysis: `C:\Users\Zack\.claude\plans\delegated-hugging-treasure.md`
- Auto memory: `C:\Users\Zack\.claude\projects\c--Repos-sounds-bored\memory\MEMORY.md`
- Domain vocabulary: `CONTEXT.md` (repo root)

---

**Last Updated**: 2026-05-08
**Phase Complete**: Phase 5 + partial Phase 6 (audio engine, yt-dlp, full UI)
**Next**: Phase 6 — Undo/redo, auto-save failure UX
