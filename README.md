# SoundsBored

A pad-based desktop soundboard built with Tauri and React. Trigger sounds via customizable pads organized into scenes, with support for complex playback rules, mute groups, and web audio import via yt-dlp.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Architecture](#project-architecture)
- [Core Domain Model](#core-domain-model)
- [State Management](#state-management)
- [Audio Engine](#audio-engine)
- [File Structure](#file-structure)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)

## Features

- **Pad-based interface**: Trigger sounds instantly with customizable pads
- **Scene management**: Organize pads into scenes for different contexts
- **Complex playback rules**: 
  - Multiple playback modes: one-shot, hold, loop
  - Layer arrangements: simultaneous, sequential, shuffled
  - Retrigger modes: restart, continue, stop, next
- **Sound library**: Global library with tags and sets for flexible sound organization
- **Muting system**:
  - Directional mute: trigger one pad to mute specific others
  - Exclusive mute groups: hi-hat style (only one plays at a time)
- **Web audio import**: Download and convert audio from YouTube and other sources via yt-dlp
- **Auto-discovery**: Automatically detect audio files in the sounds folder
- **Sound preview**: Listen to sounds before adding them to pads
- **Project management**: Create, load, and save projects with auto-save support

## Prerequisites

Ensure you have the following installed on your system:

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | LTS (18+) | JavaScript runtime |
| npm or yarn | Latest | Package manager |
| Rust | Stable 1.70+ | Backend compilation |
| Tauri CLI | v2 | Desktop app scaffolding |
| yt-dlp | Latest (optional) | Web audio download feature |

### Installation

**Node.js & npm**: Download from [nodejs.org](https://nodejs.org/)

**Rust**: Install from [rustup.rs](https://rustup.rs/)

**Tauri CLI**:
```bash
npm install -g @tauri-apps/cli@next
```

**yt-dlp** (optional, for download feature):
```bash
# macOS
brew install yt-dlp

# Windows (with chocolatey)
choco install yt-dlp

# Or download from: https://github.com/yt-dlp/yt-dlp
```

## Quick Start

### Clone and Install

```bash
git clone https://github.com/yourusername/sounds-bored.git
cd sounds-bored
npm install
npm run prepare  # Set up git hooks
```

### Development Mode

Run the app in development with hot reload:

```bash
npm run tauri dev
```

This launches the Tauri app with:
- Vite dev server on port 1420
- Rust backend with live compilation
- Full DevTools support

### Create a Build

```bash
npm run build       # Build frontend (TypeScript check + Vite)
npm run tauri build # Package for your platform (Windows .msi, macOS .app, Linux .deb)
```

The built executable is available in `src-tauri/target/release/`.

### Run Tests

```bash
npm test             # Watch mode with Vitest UI
npm run test:ui      # Open interactive Vitest dashboard
npm run test:run     # Run once (CI mode)
npm run test:coverage # Generate coverage report
npm run test:rust    # Run Rust tests in src-tauri/
```

### Download yt-dlp Sidecar

To use the web audio download feature in development:

```bash
npm run download-yt-dlp       # Download for current platform
npm run download-yt-dlp:all   # Download for Windows, macOS, Linux
```

The sidecar is stored in `src-tauri/binaries/yt-dlp/`.

## Project Architecture

### High-Level Overview

```
User Action (Pad Click)
         ↓
  usePadGesture (pointer events)
         ↓
  padPlayer.triggerPad(padId)
         ↓
  For each layer in pad:
    - Resolve sounds (assigned/tag/set)
    - Create voices (audioVoice)
    - Apply playback logic (arrangement, playback mode, retrigger)
         ↓
  Web Audio Context (oscillators, buffers, gain nodes)
         ↓
  Speaker Output
```

### Key Principles

1. **Single Source of Truth**: State lives in Zustand stores (`projectStore`, `libraryStore`, `playbackStore`)
2. **Separation of Concerns**: 
   - UI layer (React components)
   - Business logic (audio engine, store actions)
   - Data persistence (Tauri IPC + filesystem)
3. **Type Safety**: Full TypeScript strict mode + Zod validation
4. **Reactive Subscriptions**: React components use Zustand selector pattern for efficiency
5. **Audio Buffer Caching**: One buffer per sound, reused across all playback instances

## Core Domain Model

The following hierarchy defines the app's data structure:

```
Scene (collection of pads, displayed as CSS grid)
  ├─ Pad (triggerable button)
  │   ├─ Layer (independent playback unit)
  │   │   ├─ LayerSelection (which sounds to play)
  │   │   │   ├─ assigned: explicit SoundInstance[] with volumes
  │   │   │   ├─ tag: TagId[] (all sounds tagged with these)
  │   │   │   └─ set: SetId (all sounds in a set)
  │   │   ├─ Arrangement (how layers play together)
  │   │   │   ├─ simultaneous (all at once)
  │   │   │   ├─ sequential (one after another)
  │   │   │   └─ shuffled (random order)
  │   │   ├─ PlaybackMode (how a sound plays)
  │   │   │   ├─ one-shot (plays once, auto-stops)
  │   │   │   ├─ hold (plays while held, stops on release)
  │   │   │   └─ loop (repeats until stopped)
  │   │   └─ RetriggerMode (what happens if pad is pressed again)
  │   │       ├─ restart (sound restarts from beginning)
  │   │       ├─ continue (continues playing)
  │   │       ├─ stop (stops all playback)
  │   │       └─ next (plays next sound in sequence)
  │   ├─ muteTargetPadIds (directional mute)
  │   └─ muteGroupId (exclusive mute group)
  └─ ...

Sound (global asset in library)
  ├─ id, name, filePath, durationMs
  ├─ tags: TagId[] (for tag-based selection)
  ├─ sets: SetId[] (for set-based selection)
  ├─ sourceUrl (original web URL for re-download)
  └─ folderId (folder in global library structure)

SoundInstance (usage of a Sound within a Layer)
  ├─ soundId (reference to Sound)
  ├─ volume (mixing level)
  └─ startOffsetMs (trim audio)

Tag & Set (global library organization)
  ├─ Tag: id, name, color, isSystem
  └─ Set: id, name
```

### Design Rationale

- **Sound vs SoundInstance**: A Sound is the asset; a SoundInstance is that asset with mixing config. Enables the same file to be used multiple times with different volumes.
- **Per-Layer Playback Config**: Playback rules live on Layers, not Pads. This allows the same pad to trigger different behaviors by using multiple layers.
- **Global Library**: Sounds, Tags, and Sets are stored globally (`libraryStore`), not per-project. One sound file can be used across multiple projects.
- **AudioBuffer Cache**: Keyed by `Sound.id`. One buffer load, shared by all layers/pads referencing it. Critical for performance.
- **Auto-Discovery**: Files in the `sounds/` folder are discovered on project load. Missing files get a runtime flag but are not persisted.

## State Management

The app uses **Zustand + Immer** for reactive state. Three main stores:

### projectStore

Persisted to disk. Loaded/saved via Tauri filesystem APIs.

```typescript
interface ProjectState {
  project: Project | null;              // Loaded project
  folderPath: string | null;            // Path to project folder
  historyEntry: ProjectHistoryEntry | null;
  isTemporary: boolean;                 // true until "Save As"
  isDirty: boolean;                     // true after updateProject()
  
  loadProject(entry, project, isTemp);  // Load from disk
  updateProject(project);               // Update + mark dirty
  clearDirtyFlag();                     // Called after save
  markAsPermanent(entry);               // Called after "Save As"
  clearProject();                       // Unload
}
```

**Usage in components**:
```typescript
const project = useProjectStore((s) => s.project);
const updateProject = useProjectStore((s) => s.updateProject);
updateProject({ ...project, name: 'New Name' });
```

### libraryStore

Persisted to disk in global library file (`$APPLOCALDATA/SoundsBored/library.json`).

```typescript
interface LibraryState {
  sounds: Sound[];                      // Global sound library
  tags: Tag[];
  sets: Set[];
  isDirty: boolean;
  
  loadLibrary(library);
  updateLibrary(immer_updater_fn);
  clearDirtyFlag();
}
```

**Usage in components**:
```typescript
const sets = useLibraryStore((s) => s.sets);
useLibraryStore((s) => s.updateLibrary((draft) => {
  draft.sounds.push(newSound);
}));
```

### playbackStore

Runtime-only. NOT persisted.

```typescript
interface PlaybackState {
  activeVoices: AudioVoice[];           // Currently playing voices
  buffers: Map<string, AudioBuffer>;    // Sound.id -> AudioBuffer
  masterVolume: number;
  
  // To be implemented
  addVoice(voice);
  removeVoice(voiceId);
}
```

## Audio Engine

The audio engine is built on Web Audio API with no Rust plugins. Located in `src/lib/audio/`.

### Components

**audioContext.ts**: Singleton Web Audio AudioContext.
```typescript
export const audioCtx = getOrCreateAudioContext();
```

**bufferCache.ts**: Caches AudioBuffers keyed by `Sound.id`. Handles decoding.
```typescript
const buffer = await bufferCache.getOrLoad(sound);
```

**audioVoice.ts**: Represents one playing sound instance.
```typescript
const voice = new AudioVoice(buffer, startTime, config);
voice.play();
voice.fade(duration);
voice.stop();
```

**padPlayer.ts**: Main playback coordinator. Triggers pads, handles layers, muting.
```typescript
await padPlayer.triggerPad(padId, pointerDown);  // Press/hold
await padPlayer.releasePad(padId);               // Release
```

**arrangement.ts**: Implements layer arrangement logic (simultaneous, sequential, shuffled).
```typescript
const scheduledTimes = calculateArrangement(arrangement, layerDurations);
```

**preview.ts**: One-shot preview playback for sound library.
```typescript
await preview.playSound(sound);
```

**streamingCache.ts**: Streams audio while downloading via yt-dlp.

### How Playback Works

1. **Pointer Event**: User clicks pad
2. **usePadGesture Hook**: Detects press/hold/release via pointer events
3. **padPlayer.triggerPad(padId, isDown)**: Called with pressed state
4. **For each Layer in Pad**:
   - Resolve LayerSelection to actual sounds
   - Call `arrangement.calculateArrangement()` for timing
   - Create AudioVoice for each sound
   - Schedule voices with Web Audio's `AudioContext.currentTime`
5. **AudioVoice Playback**:
   - Create BufferSource from cached AudioBuffer
   - Apply gain node for volume/fading
   - Connect to AudioContext.destination
   - Start/stop via Web Audio methods
6. **Fade Out**: Before stopping, fade to prevent clicks (configurable duration)

### Key Concepts

**AudioBuffer Caching**: Critical for performance.
```typescript
// Same buffer, reused
const buffer = await bufferCache.getOrLoad(sound);
const source1 = audioCtx.createBufferSource();
source1.buffer = buffer;
const source2 = audioCtx.createBufferSource();
source2.buffer = buffer;  // Reused, not re-decoded
```

**Gain Nodes**: For volume control and fading.
```typescript
const gain = audioCtx.createGain();
gain.gain.setValueAtTime(1.0, audioCtx.currentTime);
gain.gain.linearRampToValueAtTime(0.0, audioCtx.currentTime + fadeDuration);
source.connect(gain);
gain.connect(audioCtx.destination);
```

**Web Audio Timeline**: Precise scheduling via currentTime.
```typescript
// Schedule a sound to play in 0.5 seconds
source.start(audioCtx.currentTime + 0.5);
```

## File Structure

```
src/
├── components/
│   ├── composite/
│   │   ├── DownloadManager/
│   │   │   ├── DownloadItem.tsx       # Single yt-dlp download progress
│   │   │   └── DownloadManager.tsx    # Download queue panel
│   │   ├── PadConfigDrawer/
│   │   │   ├── LayerAccordion.tsx     # Collapsible layer list
│   │   │   ├── LayerConfigSection.tsx # Per-layer settings
│   │   │   ├── PadConfigDrawer.tsx    # Pad editor (layers, muting)
│   │   │   ├── SoundFolderTree.tsx    # File tree of sounds
│   │   │   ├── SoundSelector.tsx      # Sound picker
│   │   │   └── soundTreeUtils.ts      # Tree building helpers
│   │   ├── SceneTabBar/
│   │   │   ├── MenuDrawer.tsx         # Hamburger menu (save, close)
│   │   │   ├── SceneTab.tsx           # Single scene tab button
│   │   │   └── SceneTabBar.tsx        # Tab bar + add/delete
│   │   ├── SceneView/
│   │   │   ├── PadButton.tsx          # Triggerable pad button
│   │   │   └── SceneView.tsx          # CSS grid of pads
│   │   └── SidePanel/
│   │       ├── AddSetDialog.tsx       # New set dialog
│   │       ├── AddTagsDialog.tsx      # Tag assignment dialog
│   │       ├── AddToSetDialog.tsx     # Add to set dialog
│   │       ├── EditSection.tsx        # Sound metadata edit
│   │       ├── PlaySection.tsx        # Preview controls
│   │       ├── SidePanel.tsx          # Right-side panel shell
│   │       ├── SoundsPanel.tsx        # Sound library list
│   │       └── VolumeSection.tsx      # Global volume slider
│   ├── modals/
│   │   ├── ConfirmCloseDialog.tsx
│   │   ├── ConfirmDeletePadDialog.tsx
│   │   ├── ConfirmDeleteSceneDialog.tsx
│   │   ├── DownloadDialog.tsx         # yt-dlp URL input
│   │   ├── ResolveMissingDialog.tsx   # Single missing file
│   │   ├── ResolveMissingFolderDialog.tsx # Re-point sounds folder
│   │   ├── SaveProjectDialog.tsx      # Save As dialog
│   │   └── SettingsDialog.tsx         # App settings (fade time)
│   ├── screens/
│   │   ├── main/MainPage.tsx          # Main editor view
│   │   ├── start/StartScreen.tsx      # Project selection
│   │   └── LoadingScreen.tsx          # Preload screen
│   ├── ui/                            # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── drawer.tsx
│   │   ├── input.tsx
│   │   ├── slider.tsx
│   │   ├── sonner.tsx                 # Toast notifications (Sonner)
│   │   └── ... (other primitives)
│   └── ErrorBoundary.tsx              # Error handling wrapper
├── contexts/
│   └── ProjectActionsContext.tsx      # Project-level actions provider
├── hooks/
│   ├── useAutoSave.ts                 # Auto-save logic
│   ├── useBootLoader.ts               # App startup initialization
│   ├── useBreakpoint.ts               # Responsive breakpoint detection
│   ├── useFadeMode.ts                 # Compute active fade duration
│   ├── useGlobalHotkeys.ts            # Global keyboard shortcuts
│   ├── useImportSounds.ts             # Drag-drop sound import
│   ├── usePadGesture.ts               # Pointer event handling for pads
│   ├── usePreloadImages.ts            # Image preloading
│   ├── useProjectLifecycle.ts         # Project open/save/close orchestration
│   ├── useSoundPreview.ts             # Sound library preview playback
│   ├── useUpdater.ts                  # Tauri auto-updater
│   └── useWindowCloseHandler.ts       # OS window close intercept
├── lib/
│   ├── audio/
│   │   ├── arrangement.ts             # Layer arrangement timing
│   │   ├── audioContext.ts            # Web Audio AudioContext singleton
│   │   ├── audioVoice.ts              # Single voice instance
│   │   ├── bufferCache.ts             # AudioBuffer cache
│   │   ├── padPlayer.ts               # Pad triggering coordination
│   │   ├── preview.ts                 # Preview playback
│   │   └── streamingCache.ts          # Streaming audio during download
│   ├── appSettings.ts                 # App settings persistence
│   ├── appSettings.queries.ts         # TanStack Query hooks for settings
│   ├── constants.ts                   # App-wide constants
│   ├── history.ts                     # Recent projects list
│   ├── history.queries.ts             # TanStack Query hooks
│   ├── history.helpers.ts             # History helpers
│   ├── import.ts                      # Sound import logic
│   ├── library.ts                     # Library CRUD
│   ├── library.queries.ts             # TanStack Query hooks
│   ├── library.reconcile.ts           # Auto-discovery of sounds/
│   ├── migrations.ts                  # Project versioning
│   ├── project.ts                     # Project CRUD
│   ├── project.queries.ts             # TanStack Query hooks
│   ├── queryClient.ts                 # TanStack Query client
│   ├── schemas.ts                     # Zod schemas (domain model)
│   ├── utils.ts                       # Helper functions
│   ├── ytdlp.ts                       # yt-dlp sidecar integration
│   └── ytdlp.queries.ts               # TanStack Query hooks
├── state/
│   ├── appSettingsStore.ts            # App-wide settings (Zustand)
│   ├── downloadStore.ts               # yt-dlp queue (Zustand)
│   ├── libraryStore.ts                # Global library (Zustand + Immer)
│   ├── playbackStore.ts               # Active voices (Zustand, runtime)
│   ├── projectStore.ts                # Current project (Zustand + Immer)
│   ├── uiStore.ts                     # UI state (Zustand)
│   └── updaterStore.ts                # Tauri updater state (Zustand)
├── test/
│   ├── factories.ts                   # Test data builders
│   ├── setup.ts                       # Vitest global setup
│   └── tauri-mocks.ts                 # Tauri API mocks
├── App.tsx                            # Router + layout
└── main.tsx                           # React entry point

src-tauri/
├── src/
│   ├── commands.rs                    # Tauri IPC commands (file I/O, shell)
│   ├── lib.rs                         # Tauri setup
│   └── main.rs                        # Entry point
├── capabilities/
│   └── default.json                   # Tauri permissions
├── binaries/
│   └── yt-dlp/                        # yt-dlp sidecar binaries
├── Cargo.toml                         # Rust dependencies
└── Cargo.lock

vite.config.ts                         # Vite configuration
tsconfig.json                          # TypeScript configuration
tailwind.config.js                     # Tailwind CSS configuration
vitest.config.ts                       # Vitest configuration
```

### Path Alias

- `@/*` maps to `./src/*` for clean imports

## Development

### Code Style

- **TypeScript**: Strict mode enabled (`strict: true`)
- **Imports**: Use `@/*` alias for src imports
- **Components**: Functional with React hooks
- **Icons**: Use `HugeiconsIcon` from `@hugeicons/react`
- **Styling**: Tailwind CSS via shadcn/ui
- **Validation**: Zod for all external data

### Git Workflow

1. Work on `master` branch (no worktrees)
2. Commit changes manually (no auto-commit)
3. Git hooks run on pre-commit and pre-push

### Store Updates

Prefer specific actions over generic updates:

```typescript
// Good: specific action
updateProject((draft) => {
  draft.scenes.push(newScene);
});

// Avoid: generic update
updateProject({ ...project, scenes: [...project.scenes, newScene] });
```

### Error Handling

Tauri command errors use custom error classes:

```typescript
export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found');
    this.name = 'ProjectNotFoundError';
  }
}
```

Catch and display as toasts:

```typescript
import { toast } from 'sonner';

try {
  await saveProject(folderPath, project);
} catch (err) {
  toast.error('Failed to save project: ' + err.message);
}
```

### Building & Packaging

```bash
# Build frontend + backend
npm run build

# Package for distribution
npm run tauri build

# Output locations:
# Windows: src-tauri/target/release/sounds-bored.exe
# macOS: src-tauri/target/release/bundle/macos/SoundsBored.app
# Linux: src-tauri/target/release/bundle/deb/sounds-bored_*.deb
```

## Testing

### Test Organization

- **Test files**: `*.test.ts` or `*.test.tsx` colocated with source
- **Factories**: `src/test/factories.ts` for test data
- **Setup**: `src/test/setup.ts` provides global mocks and matchers
- **Tauri mocks**: `src/test/tauri-mocks.ts` (auto-imported)

### Running Tests

```bash
# Watch mode
npm test

# Run once (CI mode)
npm run test:run

# Coverage report
npm run test:coverage

# Open UI dashboard
npm run test:ui

# Rust tests
npm run test:rust
```

### Test Pattern

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
    useProjectStore.setState({ project });
    expect(useProjectStore.getState().project.name).toBe('Test');
  });
});
```

### Available Factories

```typescript
createMockProject(overrides)
createMockScene(overrides)
createMockPad(overrides)
createMockSound(overrides)
createMockHistoryEntry(overrides)
createProjectJson(overrides)
createHistoryJson(overrides)
```

## Project Storage

### Folder Structure

```
<UserChosenPath>/
  <ProjectName>/
    project.json       # Scenes and pads (serialized)
    sounds/            # Audio files (auto-discovered on load)
      kick.wav
      snare.mp3
      ambience.ogg
```

### project.json Schema

```json
{
  "name": "My Soundboard",
  "version": "1.0.0",
  "description": "Description here",
  "lastSaved": "2026-04-05T12:34:56.789Z",
  "scenes": [
    {
      "id": "scene-1",
      "name": "Main",
      "pads": [
        {
          "id": "pad-1",
          "name": "Kick",
          "position": { "row": 0, "col": 0 },
          "layers": [
            {
              "id": "layer-1",
              "selection": {
                "type": "assigned",
                "instances": [
                  {
                    "id": "inst-1",
                    "soundId": "sound-1",
                    "volume": 0.8,
                    "startOffsetMs": 0
                  }
                ]
              },
              "arrangement": "simultaneous",
              "playbackMode": "one-shot",
              "retriggerMode": "restart"
            }
          ],
          "muteTargetPadIds": [],
          "muteGroupId": null
        }
      ]
    }
  ]
}
```

### File Paths

- **Relative paths**: Audio files stored as relative to project folder (e.g., `kick.wav`, not `/full/path/kick.wav`)
- **Web URLs**: For yt-dlp downloads, original URL persisted in `Sound.sourceUrl` for re-download
- **Missing files**: Runtime `missing: true` flag, not persisted to disk

## Migrations

Version your project.json with `version` field. Register migrations in `src/lib/migrations.ts`:

```typescript
export const MIGRATIONS = [
  {
    version: '1.0.0',
    up: (projectJson) => {
      // Transform projectJson from 0.9.0 to 1.0.0
      return projectJson;
    }
  }
];
```

Migrations run automatically on project load before Zod validation.

## Contributing

### Before Starting

1. Read `CLAUDE.md` (AI assistant context)
2. Check existing issues and PRs
3. Create an issue for feature requests

### Development Checklist

- [ ] Read the file before editing (use Read tool)
- [ ] Write tests alongside implementation
- [ ] Test with `npm test`
- [ ] Check types with `tsc` (run via build)
- [ ] Keep files focused and well-organized
- [ ] Use descriptive commit messages
- [ ] No console.log in production code (use toast notifications)
- [ ] No debugger statements

### PR Requirements

- Tests pass: `npm run test:run`
- Types pass: `npm run build` (includes tsc check)
- No new dependencies without discussion
- Code follows project style (TypeScript strict, Tauri best practices)

### Anti-Patterns to Avoid

- Don't add `debugger;` statements
- Don't use generic `updateProject()` — prefer specific domain actions
- Don't persist runtime flags like `missing: true`
- Don't store absolute paths in project.json
- Don't create multiple toast implementations (use Sonner only)
- Don't use deleted patterns like `useCurrentProject` (use `useProjectStore`)

## Roadmap

- [x] Phase 1-4: Core UI and sound import
- [x] Phase 5: Audio engine and playback
- [x] Phase 6 (partial): yt-dlp integration and download UI
- [ ] Phase 6 (continued): Undo/redo and auto-save failure UX
- [ ] Audio output device selection (requires Rust `cpal` migration)

## Resources

- **Tauri Docs**: https://tauri.app/
- **React Docs**: https://react.dev/
- **Web Audio API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- **Zustand**: https://github.com/pmndrs/zustand
- **Zod**: https://zod.dev/
- **TanStack Query**: https://tanstack.com/query/latest

## IDE Setup

Recommended setup for this project:

- **VS Code** with:
  - [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
  - [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
  - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

## License

MIT

## Support

For issues, feature requests, or questions:
- Check existing GitHub issues
- Create a new issue with detailed description and reproduction steps
- Include relevant logs and screenshots

---

**Last Updated**: 2026-04-05  
**Current Version**: 1.1.8
