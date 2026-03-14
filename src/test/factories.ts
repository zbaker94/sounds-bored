import { Project, ProjectHistoryEntry } from "@/lib/schemas";

/**
 * Factory for creating test Projects
 */
export function createMockProject(overrides?: Partial<Project>): Project {
  return {
    name: "Test Project",
    version: "1.0.0",
    description: "A test project",
    lastSaved: new Date().toISOString(),
    scenes: [],
    sounds: [],
    tags: [],
    sets: [],
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
