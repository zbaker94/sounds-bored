import { useProjectStore } from "@/state/projectStore";
import { useLibraryStore } from "@/state/libraryStore";
import { reconcileProjectSounds } from "@/lib/projectSoundReconcile";

/**
 * Reads the current project and library from the store, removes any sound
 * references that no longer exist in the library, and persists the result.
 * No-op if no project is loaded or no sounds need removing.
 *
 * Called from two paths:
 *   - useProjectLifecycle: reactively, on project load
 *   - useReconcileLibrary: explicitly, after a manual library scan
 */
export function applyProjectSoundReconcile(): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const sounds = useLibraryStore.getState().sounds;
  const { project: cleaned, removedCount } = reconcileProjectSounds(project, sounds);
  if (removedCount > 0) {
    useProjectStore.getState().updateProject(cleaned);
  }
}
