import { ProjectHistoryEntry } from "./schemas";
import { loadProjectHistory, saveProjectHistory } from "./history";

/**
 * Creates a project history entry with the current timestamp
 */
export function createHistoryEntry(
  name: string,
  path: string
): ProjectHistoryEntry {
  return {
    name,
    path,
    date: new Date().toISOString(),
  };
}

/**
 * Adds or updates a project in history
 * If the project path already exists, updates it. Otherwise, adds it to the front
 */
export async function addOrUpdateProjectInHistory(
  name: string,
  path: string
): Promise<void> {
  const history = await loadProjectHistory();
  const existingIndex = history.findIndex((entry) => entry.path === path);

  const newEntry = createHistoryEntry(name, path);

  if (existingIndex !== -1) {
    // Update existing entry
    history[existingIndex] = newEntry;
  } else {
    // Add new entry at the beginning
    history.unshift(newEntry);
  }

  await saveProjectHistory(history);
}

/**
 * Adds a saved project to history, removing any temp entries first
 */
export async function addSavedProjectToHistory(
  name: string,
  path: string,
  tempFolderIdentifier: string
): Promise<void> {
  const history = await loadProjectHistory();

  // Remove any existing temp entries
  const filteredHistory = history.filter(
    (entry) => !entry.path.includes(tempFolderIdentifier)
  );

  // Add the new permanent entry
  filteredHistory.unshift(createHistoryEntry(name, path));

  await saveProjectHistory(filteredHistory);
}

/**
 * Removes a project from history by path
 */
export async function removeProjectFromHistory(path: string): Promise<void> {
  const history = await loadProjectHistory();
  const filteredHistory = history.filter((entry) => entry.path !== path);
  await saveProjectHistory(filteredHistory);
}
