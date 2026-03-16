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
};

/**
 * Mock implementation of Tauri's path API
 */
export const mockPath = {
  join: vi.fn((...paths: string[]) => paths.join("/")),
  tempDir: vi.fn(() => Promise.resolve("/tmp")),
  appDataDir: vi.fn(() => Promise.resolve("/app-data")),
  appLocalDataDir: vi.fn(() => Promise.resolve("/app-local-data")),
  audioDir: vi.fn(() => Promise.resolve("/music")),
};

// Mock modules at the top level
vi.mock("@tauri-apps/plugin-dialog", () => mockDialog);
vi.mock("@tauri-apps/plugin-fs", () => mockFs);
vi.mock("@tauri-apps/api/path", () => mockPath);

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

  return files;
}

