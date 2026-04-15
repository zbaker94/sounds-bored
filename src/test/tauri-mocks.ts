import { vi } from "vitest";

/**
 * Mock implementation of Tauri's dialog plugin
 */
export const mockDialog = {
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
};

/**
 * Mock implementation of Tauri's fs plugin
 */
export const mockFs = {
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  copyFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
};

/**
 * Mock implementation of Tauri's path API
 */
export const mockPath = {
  join: vi.fn((...paths: string[]) => paths.join("/")),
  basename: vi.fn((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  }),
  dirname: vi.fn((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx > 0 ? normalized.substring(0, idx) : "/";
  }),
  tempDir: vi.fn(() => Promise.resolve("/tmp")),
  appDataDir: vi.fn(() => Promise.resolve("/app-data")),
  appLocalDataDir: vi.fn(() => Promise.resolve("/app-local-data")),
  audioDir: vi.fn(() => Promise.resolve("/music")),
};

/**
 * Mock implementation of Tauri's core invoke API
 */
export const mockCore = {
  invoke: vi.fn(),
};

/**
 * Mock implementation of Tauri's event API
 */
export const mockEvent = {
  listen: vi.fn(() => Promise.resolve(vi.fn())), // returns an unlisten fn
  emit: vi.fn(() => Promise.resolve()),
};

// Mock modules at the top level
vi.mock("@tauri-apps/plugin-dialog", () => mockDialog);
vi.mock("@tauri-apps/plugin-fs", () => mockFs);
vi.mock("@tauri-apps/api/path", () => mockPath);
vi.mock("@tauri-apps/api/core", () => mockCore);
vi.mock("@tauri-apps/api/event", () => mockEvent);

/**
 * Reset all Tauri mocks to their initial state
 */
export function resetTauriMocks() {
  Object.values(mockDialog).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
    }
  });
  Object.values(mockFs).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
    }
  });
  Object.values(mockPath).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
    }
  });
  Object.values(mockCore).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
    }
  });
  Object.values(mockEvent).forEach((fn) => {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
      if (fn === mockEvent.listen) {
        fn.mockReturnValue(Promise.resolve(vi.fn()));
      }
    }
  });
}

/**
 * Create a mock file system structure for testing
 */
export function createMockFileSystem(structure: Record<string, string | null>) {
  mockFs.exists.mockImplementation((path: string) => {
    return Promise.resolve(path in structure);
  });

  mockFs.readTextFile.mockImplementation((path: string) => {
    if (path in structure && structure[path] !== null) {
      return Promise.resolve(structure[path]);
    }
    throw new Error(`File not found: ${path}`);
  });

  const files: Record<string, string> = {};

  mockFs.writeTextFile.mockImplementation((path: string, content: string) => {
    files[path] = content;
    structure[path] = content;
    return Promise.resolve();
  });

  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.copyFile.mockResolvedValue(undefined);
  mockFs.remove.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);

  return files;
}

