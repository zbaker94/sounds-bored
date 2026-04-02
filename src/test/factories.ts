import { AppSettings, DownloadJob, GlobalFolder, GlobalLibrary, Layer, Pad, Project, ProjectHistoryEntry, Scene, Sound, Tag, Set } from "@/lib/schemas";
import { CURRENT_LIBRARY_VERSION, CURRENT_SETTINGS_VERSION } from "@/lib/constants";

/**
 * Factory for creating test Projects
 */
export function createMockProject(overrides?: Partial<Project>): Project {
  return {
    name: "Test Project",
    version: "1.2.0",
    description: "A test project",
    lastSaved: new Date().toISOString(),
    scenes: [],
    favoritedSetIds: [],
    ...overrides,
  };
}

/**
 * Factory for creating test ProjectHistoryEntry
 */
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

/**
 * Factory for creating test Scenes
 */
export function createMockScene(overrides?: Partial<Scene>): Scene {
  _sceneCounter++;
  return {
    id: `scene-${_sceneCounter}`,
    name: `Scene ${_sceneCounter}`,
    pads: [],
    ...overrides,
  };
}

/**
 * Factory for creating test GlobalFolder
 */
export function createMockGlobalFolder(overrides?: Partial<GlobalFolder>): GlobalFolder {
  return {
    id: crypto.randomUUID(),
    path: "/music/SoundsBored",
    name: "SoundsBored",
    ...overrides,
  };
}

/**
 * Factory for creating test AppSettings
 */
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
    version: CURRENT_SETTINGS_VERSION,
    globalFolders: [rootFolder, downloadFolder, importFolder],
    downloadFolderId: downloadFolder.id,
    importFolderId: importFolder.id,
    ...overrides,
  };
}

/**
 * Factory for creating test GlobalLibrary
 */
export function createMockGlobalLibrary(overrides?: Partial<GlobalLibrary>): GlobalLibrary {
  return {
    version: CURRENT_LIBRARY_VERSION,
    sounds: [],
    tags: [],
    sets: [],
    ...overrides,
  };
}

/**
 * Helper to create a valid project.json string
 */
export function createProjectJson(project?: Partial<Project>): string {
  return JSON.stringify(createMockProject(project), null, 2);
}

/**
 * Helper to create a valid history.json string
 */
export function createHistoryJson(
  entries?: Partial<ProjectHistoryEntry>[]
): string {
  const historyEntries = entries
    ? entries.map((entry) => createMockHistoryEntry(entry))
    : [createMockHistoryEntry()];
  return JSON.stringify(historyEntries, null, 2);
}

/**
 * Helper to wait for async operations
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to assert that a promise rejects with a specific error
 */
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

/**
 * Factory for creating test Layers
 */
export function createMockLayer(overrides?: Partial<Layer>): Layer {
  return {
    id: crypto.randomUUID(),
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
    ...overrides,
  };
}

/**
 * Factory for creating test Pads
 */
export function createMockPad(overrides?: Partial<Pad>): Pad {
  return {
    id: crypto.randomUUID(),
    name: "Test Pad",
    layers: [],
    muteTargetPadIds: [],
    ...overrides,
  };
}

/**
 * Factory for creating test Sounds
 */
export function createMockSound(overrides?: Partial<Sound>): Sound {
  return {
    id: crypto.randomUUID(),
    name: "Test Sound",
    tags: [],
    sets: [],
    ...overrides,
  };
}

/**
 * Factory for creating test Tags
 */
export function createMockTag(overrides?: Partial<Tag>): Tag {
  return {
    id: crypto.randomUUID(),
    name: "Test Tag",
    ...overrides,
  };
}

/**
 * Factory for creating test Sets
 */
export function createMockSet(overrides?: Partial<Set>): Set {
  return {
    id: crypto.randomUUID(),
    name: "Test Set",
    ...overrides,
  };
}

/**
 * Factory for creating test DownloadJobs
 */
export function createMockDownloadJob(overrides?: Partial<DownloadJob>): DownloadJob {
  return {
    id: crypto.randomUUID(),
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    outputName: "test-sound",
    status: "queued",
    percent: 0,
    ...overrides,
  };
}
