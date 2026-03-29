import { z } from "zod";
import { CURRENT_SETTINGS_VERSION, CURRENT_LIBRARY_VERSION } from "./constants";

// ─── Project History ────────────────────────────────────────────────────────

export const ProjectHistoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  date: z.string(),
});

export const ProjectHistorySchema = z.array(ProjectHistoryEntrySchema);

export type ProjectHistoryEntry = z.infer<typeof ProjectHistoryEntrySchema>;
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

// ─── Enums ──────────────────────────────────────────────────────────────────

export const PlaybackModeSchema = z.enum(["one-shot", "hold", "loop"]);
export const ArrangementSchema = z.enum(["simultaneous", "sequential", "shuffled"]);
export const RetriggerModeSchema = z.enum(["restart", "continue", "stop", "next"]);

export type PlaybackMode = z.infer<typeof PlaybackModeSchema>;
export type Arrangement = z.infer<typeof ArrangementSchema>;
export type RetriggerMode = z.infer<typeof RetriggerModeSchema>;

// ─── Sound (global library asset) ───────────────────────────────────────────

export const SoundSchema = z.object({
  id: z.string(),
  name: z.string(),
  filePath: z.string().min(1).optional(),  // absolute path when present
  folderId: z.string().optional(),         // GlobalFolder ID — null for manually added sounds
  sourceUrl: z.string().optional(),        // original web URL for yt-dlp re-download
  tags: z.array(z.string()),               // Tag IDs — resolve against global library
  sets: z.array(z.string()),               // Set IDs — resolve against global library
  durationMs: z.number().optional(),
});

export type Sound = z.infer<typeof SoundSchema>;

/**
 * Type guard: narrows Sound to Sound & { filePath: string }.
 * Use in Phase 5 audio engine to avoid scattered null checks.
 */
export function hasFilePath(sound: Sound): sound is Sound & { filePath: string } {
  return typeof sound.filePath === "string" && sound.filePath.length > 0;
}

// ─── Tag / Set ───────────────────────────────────────────────────────────────

export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

export const SetSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type Tag = z.infer<typeof TagSchema>;
export type Set = z.infer<typeof SetSchema>;

// ─── SoundInstance (a specific usage of a Sound within a Layer) ──────────────

export const SoundInstanceSchema = z.object({
  id: z.string(),
  soundId: z.string(),
  volume: z.number(),
  startOffsetMs: z.number().optional(),
});

export type SoundInstance = z.infer<typeof SoundInstanceSchema>;

// ─── Layer Selection ─────────────────────────────────────────────────────────

export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema).min(1, "At least one sound is required"),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: z.string().min(1, "A tag must be selected"),
    defaultVolume: z.number(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string().min(1, "A set must be selected"),
    defaultVolume: z.number(),
  }),
]);

export type LayerSelection = z.infer<typeof LayerSelectionSchema>;

// ─── Layer ────────────────────────────────────────────────────────────────────

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number(),
});

export type Layer = z.infer<typeof LayerSchema>;

// ─── Pad Config Form Schemas ──────────────────────────────────────────────────
// These cover form-validated fields only. LayerConfigFormSchema intentionally
// omits Layer.id — the store action generates it via crypto.randomUUID().

export const LayerConfigFormSchema = z.object({
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number().min(0).max(100),
});

export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layer: LayerConfigFormSchema,
});

export type LayerConfigForm = z.infer<typeof LayerConfigFormSchema>;
export type PadConfigForm = z.infer<typeof PadConfigSchema>;

// ─── Pad ──────────────────────────────────────────────────────────────────────

export const PadSchema = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerSchema),
  muteTargetPadIds: z.array(z.string()),
  muteGroupId: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export type Pad = z.infer<typeof PadSchema>;

/** Writable fields of Pad — used by addPad / updatePad store actions. */
export type PadConfig = Omit<Pad, "id">;

// ─── Scene ────────────────────────────────────────────────────────────────────

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  pads: z.array(PadSchema),
});

export type Scene = z.infer<typeof SceneSchema>;

// ─── Project ──────────────────────────────────────────────────────────────────

export const ProjectSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  lastSaved: z.string().optional(),
  scenes: z.array(SceneSchema).default([]),
  favoritedSetIds: z.array(z.string()).default([]),  // refs to global Set IDs
});

export type Project = z.infer<typeof ProjectSchema>;

// ─── Global Folder ────────────────────────────────────────────────────────────

export const GlobalFolderSchema = z.object({
  id: z.uuid(),
  path: z.string().min(1),   // absolute path on disk
  name: z.string().min(1),   // display name
});

export type GlobalFolder = z.infer<typeof GlobalFolderSchema>;

// ─── App Settings ─────────────────────────────────────────────────────────────

export const AppSettingsSchema = z.object({
  version: z.string().optional().default(CURRENT_SETTINGS_VERSION),
  globalFolders: z.array(GlobalFolderSchema),
  downloadFolderId: z.string().uuid(),   // ID of the yt-dlp download destination folder
  importFolderId: z.string().uuid(),     // ID of the in-app import destination folder
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ─── Global Library ───────────────────────────────────────────────────────────

export const GlobalLibrarySchema = z.object({
  version: z.string().optional().default(CURRENT_LIBRARY_VERSION),
  sounds: z.array(SoundSchema),
  tags: z.array(TagSchema),
  sets: z.array(SetSchema),
});

export type GlobalLibrary = z.infer<typeof GlobalLibrarySchema>;
