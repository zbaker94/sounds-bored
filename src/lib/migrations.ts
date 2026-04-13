type RawProject = Record<string, unknown>;
type MigrationFn = (raw: RawProject) => RawProject;

interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFn;
}

export const CURRENT_VERSION = "1.2.0";

/** Thrown by migrateProject when the project version is unresolvable. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const UNVERSIONED_DEFAULT = "0.0.0";

/** Compare two "X.Y.Z" version strings. Returns <0, 0, or >0. Throws MigrationError for malformed input. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split(".").map((s) => Number.parseInt(s, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      throw new MigrationError(`Invalid version string: "${v}"`);
    }
    return [parts[0], parts[1], parts[2]];
  };
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

const MIGRATIONS: Migration[] = [
  {
    // Seed migration: projects saved before versioning was introduced default to
    // UNVERSIONED_DEFAULT. Their data model is identical to 1.0.0, so we just
    // bump the version.
    fromVersion: UNVERSIONED_DEFAULT,
    toVersion: "1.0.0",
    migrate: (raw) => ({ ...raw }),
  },
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
  let version = (current.version as string | undefined) ?? UNVERSIONED_DEFAULT;

  // Future-version guard: refuse to open files from a newer app version to
  // prevent silent data loss from Zod stripping unknown fields on next save.
  if (compareVersions(version, CURRENT_VERSION) > 0) {
    throw new MigrationError(
      `This project was created with a newer version of SoundsBored (${version}). ` +
      `Please update the app to open it.`
    );
  }

  for (const migration of MIGRATIONS) {
    if (version === migration.fromVersion) {
      current = migration.migrate(current);
      version = migration.toVersion;
      current.version = version;
    }
  }

  // If the version is still not current after running all applicable migrations,
  // there is no migration path for this version (unknown past version).
  if (version !== CURRENT_VERSION) {
    throw new MigrationError(
      `No migration path found for project version "${version}". ` +
      `The project may be from an unsupported version of SoundsBored.`
    );
  }

  return current;
}
