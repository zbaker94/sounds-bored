import { CURRENT_PROJECT_VERSION, CURRENT_LIBRARY_VERSION } from "./constants";
import { logWarn } from "@/lib/logger";

type RawDoc = Record<string, unknown>;

interface VersionedMigration {
  fromVersion: string;
  toVersion: string;
  migrate: (raw: RawDoc) => RawDoc;
}

// Re-exported for backward compatibility — canonical value lives in constants.ts.
export const CURRENT_VERSION = CURRENT_PROJECT_VERSION;

/** Thrown by migrateProject and migrateLibrary when a version is unresolvable. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const UNVERSIONED_DEFAULT = "0.0.0";

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return !!val && typeof val === "object" && !Array.isArray(val);
}

function migrateTagSelectionLayer(layer: unknown): unknown {
  if (!isPlainObject(layer)) return layer;
  const sel = layer.selection;
  if (!isPlainObject(sel)) return layer;
  if (sel.type !== "tag") return layer;
  if (typeof sel.tagId === "string" && !Array.isArray(sel.tagIds)) {
    const { tagId, ...rest } = sel;
    return { ...layer, selection: { ...rest, tagIds: tagId ? [tagId] : [] } };
  }
  return layer;
}

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

// Project migrations
const MIGRATIONS: VersionedMigration[] = [
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

      if (soundCount > 0 || tagCount > 0 || setCount > 0) {
        logWarn(
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

      next.scenes = (next.scenes as unknown[]).map((scene) => {
        if (!isPlainObject(scene)) return scene;
        if (!Array.isArray(scene.pads)) return scene;
        return {
          ...scene,
          pads: (scene.pads as unknown[]).map((pad) => {
            if (!isPlainObject(pad)) return pad;
            if (!Array.isArray(pad.layers)) return pad;
            return { ...pad, layers: (pad.layers as unknown[]).map(migrateTagSelectionLayer) };
          }),
        };
      });

      return next;
    },
  },
  {
    // Rename per-pad fade volume fields to their new simplified UX semantics:
    //   fadeHighVol → volume        (the pad's configured playback volume)
    //   fadeLowVol  → fadeTargetVol (the volume the pad fades TO on toggle)
    // Missing fields are left missing; defaults are applied at playback time.
    fromVersion: "1.2.0",
    toVersion: "1.3.0",
    migrate: (raw) => {
      const next = { ...raw };
      if (!Array.isArray(next.scenes)) return next;

      next.scenes = (next.scenes as unknown[]).map((scene) => {
        if (!scene || typeof scene !== "object" || Array.isArray(scene)) return scene;
        const s = scene as Record<string, unknown>;
        if (!Array.isArray(s.pads)) return s;
        return {
          ...s,
          pads: (s.pads as unknown[]).map((pad) => {
            if (!pad || typeof pad !== "object" || Array.isArray(pad)) return pad;
            const p = { ...(pad as Record<string, unknown>) };
            if ("fadeHighVol" in p) {
              p.volume = p.fadeHighVol;
              delete p.fadeHighVol;
            }
            if ("fadeLowVol" in p) {
              p.fadeTargetVol = p.fadeLowVol;
              delete p.fadeLowVol;
            }
            return p;
          }),
        };
      });

      return next;
    },
  },
  {
    // Rescale per-pad volume and fadeTargetVol from 0–1 to 0–100 to match
    // Layer.volume and SoundInstance.volume conventions. Undefined fields are
    // left undefined (defaults applied at playback time).
    fromVersion: "1.3.0",
    toVersion: "1.4.0",
    migrate: (raw) => {
      const next = { ...raw };
      if (!Array.isArray(next.scenes)) return next;

      next.scenes = (next.scenes as unknown[]).map((scene) => {
        if (!scene || typeof scene !== "object" || Array.isArray(scene)) return scene;
        const s = scene as Record<string, unknown>;
        if (!Array.isArray(s.pads)) return s;
        return {
          ...s,
          pads: (s.pads as unknown[]).map((pad) => {
            if (!pad || typeof pad !== "object" || Array.isArray(pad)) return pad;
            const p = { ...(pad as Record<string, unknown>) };
            if (typeof p.volume === "number" && Number.isFinite(p.volume)) {
              p.volume = Math.round(p.volume * 100);
            }
            if (typeof p.fadeTargetVol === "number" && Number.isFinite(p.fadeTargetVol)) {
              p.fadeTargetVol = Math.round(p.fadeTargetVol * 100);
            }
            return p;
          }),
        };
      });

      return next;
    },
  },
];

// Library migration helpers
/**
 * Deduplicate items in an array by their `id` field, keeping the first
 * occurrence of each id. Non-array input is returned unchanged.
 * Items missing an 'id' field are always kept (not deduped); downstream Zod validation will reject them.
 */
function dedupeById(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<unknown>();
  const result: unknown[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && (item as { id?: unknown }).id !== undefined) {
      const id = (item as { id: unknown }).id;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    result.push(item);
  }
  return result;
}

/**
 * If the given numeric field on `obj` is present but not a finite non-negative
 * number, remove it. Valid values are left untouched.
 */
function stripInvalidNumeric(obj: Record<string, unknown>, field: string): void {
  if (!(field in obj)) return;
  const v = obj[field];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    delete obj[field];
  }
}

// Library migrations
const LIBRARY_MIGRATIONS: VersionedMigration[] = [
  {
    // Seed migration: legacy libraries saved before stricter GlobalLibrarySchema
    // constraints (PR #251) may contain duplicate ids or invalid numeric fields
    // on sounds. Sanitize so Zod parse does not fail on legacy files.
    fromVersion: UNVERSIONED_DEFAULT,
    // The final migration's toVersion must equal CURRENT_LIBRARY_VERSION.
    toVersion: "1.0.0",
    migrate: (raw) => {
      const next = { ...raw };

      // Sounds: invalid fields (durationMs, fileSizeBytes) are stripped but the sound
      // is preserved, because SoundSchema has many optional fields and stripping one bad
      // numeric value is recoverable. A sound with missing required fields (name, tags,
      // sets) is left to fail Zod — there is no sensible default to invent.
      //
      // Tags: tags with missing/empty/non-string names are dropped entirely because a
      // nameless tag is unrenderable and unsearchable — there is no recoverable default.
      // Tags with valid names > 100 chars are truncated to fit the schema constraint.
      if (Array.isArray(next.sounds)) {
        const deduped = dedupeById(next.sounds) as unknown[];
        next.sounds = deduped.map((sound) => {
          if (!sound || typeof sound !== "object") return sound;
          const copy = { ...(sound as Record<string, unknown>) };
          stripInvalidNumeric(copy, "durationMs");
          stripInvalidNumeric(copy, "fileSizeBytes");
          return copy;
        });
      }

      if (Array.isArray(next.tags)) {
        // Filter first so that if duplicates exist, dedup keeps the first VALID occurrence.
        const filtered = (next.tags as unknown[]).filter((tag) => {
          if (!tag || typeof tag !== "object") return true;
          const t = tag as Record<string, unknown>;
          if (!("name" in t)) return false;
          const name = t.name;
          if (typeof name !== "string") return false;
          if (name.trim().length === 0) return false;
          return true;
        });
        const deduped = dedupeById(filtered) as unknown[];
        next.tags = deduped.map((tag) => {
          if (!tag || typeof tag !== "object") return tag;
          const copy = { ...(tag as Record<string, unknown>) };
          if (typeof copy.name === "string" && copy.name.length > 100) {
            copy.name = copy.name.slice(0, 100);
          }
          return copy;
        });
      }

      if (Array.isArray(next.sets)) {
        next.sets = dedupeById(next.sets) as unknown[];
      }

      return next;
    },
  },
];

// Runner
function runMigrations(
  raw: RawDoc,
  chain: VersionedMigration[],
  targetVersion: string,
  docKind: "project" | "library"
): RawDoc {
  // Coerce non-string version to UNVERSIONED_DEFAULT.
  let version = typeof raw.version === "string" ? raw.version : UNVERSIONED_DEFAULT;

  let current = { ...raw };
  current.version = version;

  // Future-version guard: refuse to open files from a newer app version to
  // prevent silent data loss from Zod stripping unknown fields on next save.
  if (compareVersions(version, targetVersion) > 0) {
    throw new MigrationError(
      `This ${docKind} was created with a newer version of SoundsBored (${version}). ` +
      `Please update the app to open it.`
    );
  }

  for (const migration of chain) {
    if (version === migration.fromVersion) {
      current = { ...migration.migrate(current), version: migration.toVersion };
      version = migration.toVersion;
    }
  }

  if (version !== targetVersion) {
    throw new MigrationError(
      `No migration path found for ${docKind} version "${version}". ` +
      `The ${docKind} may be from an unsupported version of SoundsBored.`
    );
  }

  return current;
}

export function migrateProject(raw: RawDoc): RawDoc {
  return runMigrations(raw, MIGRATIONS, CURRENT_VERSION, "project");
}

export function migrateLibrary(raw: RawDoc): RawDoc {
  return runMigrations(raw, LIBRARY_MIGRATIONS, CURRENT_LIBRARY_VERSION, "library");
}
