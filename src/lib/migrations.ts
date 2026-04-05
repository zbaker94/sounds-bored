type RawProject = Record<string, unknown>;
type MigrationFn = (raw: RawProject) => RawProject;

interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFn;
}

export const CURRENT_VERSION = "1.2.0";

const MIGRATIONS: Migration[] = [
  {
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    migrate: (raw) => {
      const next = { ...raw };
      const sounds = next.sounds;
      const tags = next.tags;
      const sets = next.sets;

      const soundCount = Array.isArray(sounds) ? sounds.length : 0;
      const tagCount = Array.isArray(tags) ? tags.length : 0;
      const setCount = Array.isArray(sets) ? sets.length : 0;

      // Deliberate diagnostic exception: migration console output helps trace data loss
      // during version upgrades; this is not a user-facing message.
      if (soundCount > 0 || tagCount > 0 || setCount > 0) {
        console.warn(
          `Migration 1.0.0 → 1.1.0: discarding ${soundCount} sound(s), ` +
          `${tagCount} tag(s), ${setCount} set(s) from project. ` +
          `These are now managed in the global sound library.`
        );
      }

      delete next.sounds;
      delete next.tags;
      delete next.sets;
      next.favoritedSetIds = [];

      return next;
    },
  },
  {
    fromVersion: "1.1.0",
    toVersion: "1.2.0",
    migrate: (raw) => {
      const next = { ...raw };
      if (!Array.isArray(next.scenes)) return next;

      next.scenes = (next.scenes as Array<Record<string, unknown>>).map((scene) => {
        if (!Array.isArray(scene.pads)) return scene;
        return {
          ...scene,
          pads: (scene.pads as Array<Record<string, unknown>>).map((pad) => {
            if (!Array.isArray(pad.layers)) return pad;
            return {
              ...pad,
              layers: (pad.layers as Array<Record<string, unknown>>).map((layer) => {
                const sel = layer.selection as Record<string, unknown> | undefined;
                if (!sel || sel.type !== "tag") return layer;
                // Convert old single-tag format { tagId } to multi-tag { tagIds }
                if (typeof sel.tagId === "string" && !Array.isArray(sel.tagIds)) {
                  const { tagId, ...rest } = sel;
                  return { ...layer, selection: { ...rest, tagIds: tagId ? [tagId] : [] } };
                }
                return layer;
              }),
            };
          }),
        };
      });

      return next;
    },
  },
];

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

  const finalVersion = version;
  // Deliberate diagnostic exception: version mismatch is developer-facing info,
  // not a user-facing error. No toast is appropriate here.
  if (finalVersion !== CURRENT_VERSION) {
    console.warn(
      `Project version "${finalVersion}" does not match app version "${CURRENT_VERSION}". ` +
      `The project may have been created with a different version of SoundsBored.`
    );
  }

  return current;
}
