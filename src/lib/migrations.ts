type RawProject = Record<string, unknown>;
type MigrationFn = (raw: RawProject) => RawProject;

interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFn;
}

export const CURRENT_VERSION = "1.0.0";

// Register future migrations here in order.
// Each migration transforms a project from one version to the next.
const MIGRATIONS: Migration[] = [];

export function migrateProject(raw: RawProject): RawProject {
  let current = { ...raw };
  let version = (current.version as string | undefined) ?? "0.0.0";

  for (const migration of MIGRATIONS) {
    if (version === migration.fromVersion) {
      current = migration.migrate(current);
      version = migration.toVersion;
      current.version = version;
    }
  }

  // Warn (don't throw) if the final version doesn't match this app's expected version.
  // This happens when opening a project created by a newer version of SoundsBored.
  const finalVersion = version;
  if (finalVersion !== CURRENT_VERSION) {
    console.warn(
      `Project version "${finalVersion}" does not match app version "${CURRENT_VERSION}". ` +
      `The project may have been created with a different version of SoundsBored.`
    );
  }

  return current;
}
