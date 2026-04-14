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
  filePath: z
    .string()
    .min(1)
    .refine((p) => !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p), {
      message: "filePath must not contain path traversal sequences (..)",
    })
    .optional(),  // absolute path on disk; optional for sounds awaiting download
  folderId: z.string().optional(),         // GlobalFolder ID — null for manually added sounds
  sourceUrl: z.string().optional(),        // original web URL for yt-dlp re-download
  tags: z.array(z.string()),               // Tag IDs — resolve against global library
  sets: z.array(z.string()),               // Set IDs — resolve against global library
  durationMs: z.number().min(0).finite().optional(),
  fileSizeBytes: z.number().min(0).finite().optional(),   // file size in bytes — populated at reconcile/download time
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
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  isSystem: z.boolean().optional(),
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
  volume: z.number().min(0).max(100),
  startOffsetMs: z.number().min(0).finite().optional(),
});

export type SoundInstance = z.infer<typeof SoundInstanceSchema>;

// ─── Layer Selection ─────────────────────────────────────────────────────────
// Permissive schema for persistence/loading — allows empty selections.
// See LayerSelectionFormSchema below for the stricter form-validation variant.

export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema),
  }),
  z.object({
    type: z.literal("tag"),
    tagIds: z.array(z.string()),
    matchMode: z.enum(["any", "all"]).default("any"),
    defaultVolume: z.number().min(0).max(100).finite(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string(),
    defaultVolume: z.number().min(0).max(100).finite(),
  }),
]);

export type LayerSelection = z.infer<typeof LayerSelectionSchema>;

// Strict variant used only in form schemas — rejects empty selections.
export const LayerSelectionFormSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema).min(1, "At least one sound is required"),
  }),
  z.object({
    type: z.literal("tag"),
    tagIds: z.array(z.string()).min(1, "At least one tag is required"),
    matchMode: z.enum(["any", "all"]).default("any"),
    defaultVolume: z.number().min(0).max(100).finite(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string().min(1, "A set must be selected"),
    defaultVolume: z.number().min(0).max(100).finite(),
  }),
]);

// ─── Layer ────────────────────────────────────────────────────────────────────

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  cycleMode: z.boolean().default(false),
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number().min(0).max(100),
});

export type Layer = z.infer<typeof LayerSchema>;

// ─── Pad Config Form Schemas ──────────────────────────────────────────────────
// Layer.id is embedded so each layer carries its stable ID through
// add/delete/reorder operations in useFieldArray — no positional ref needed.

export const LayerConfigFormSchema = z.object({
  id: z.string(),
  selection: LayerSelectionFormSchema,
  arrangement: ArrangementSchema,
  cycleMode: z.boolean().default(false),
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number().min(0).max(100),
});

export const PadConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  layers: z.array(LayerConfigFormSchema).min(1, "At least one layer is required"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fadeDurationMs: z.number().min(100).max(10000).optional(),
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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9]*$/, { message: "icon must be an alphanumeric identifier starting with a letter" }).optional(),
  fadeDurationMs: z.number().min(100).max(10000).optional(),
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
  path: z
    .string()
    .min(1)
    .refine((p) => !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p), {
      message: "path must not contain path traversal sequences (..)",
    }),  // absolute path on disk
  name: z.string().min(1),   // display name
});

export type GlobalFolder = z.infer<typeof GlobalFolderSchema>;

// ─── App Settings ─────────────────────────────────────────────────────────────

export const AppSettingsSchema = z.object({
  version: z.string().optional().default(CURRENT_SETTINGS_VERSION),
  globalFolders: z.array(GlobalFolderSchema),
  downloadFolderId: z.string().uuid(),   // ID of the yt-dlp download destination folder
  importFolderId: z.string().uuid(),     // ID of the in-app import destination folder
  globalFadeDurationMs: z.number().min(100).max(10000).default(2000),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

// ─── Global Library ───────────────────────────────────────────────────────────

export const GlobalLibrarySchema = z.object({
  version: z.string().optional().default(CURRENT_LIBRARY_VERSION),
  sounds: z.array(SoundSchema),
  tags: z.array(TagSchema),
  sets: z.array(SetSchema),
}).superRefine((data, ctx) => {
  const checkUnique = (ids: string[], arrayPath: string, label: string) => {
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (seen.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [arrayPath, i, "id"], message: `Duplicate ${label} ID: "${id}"` });
      }
      seen.add(id);
    }
  };
  checkUnique(data.sounds.map((s) => s.id), "sounds", "sound");
  checkUnique(data.tags.map((t) => t.id), "tags", "tag");
  checkUnique(data.sets.map((s) => s.id), "sets", "set");
});

export type GlobalLibrary = z.infer<typeof GlobalLibrarySchema>;

// ─── Download types ─────────────────────────────────────────────────────────

export type DownloadStatus = "queued" | "downloading" | "processing" | "completed" | "failed" | "cancelled"

export const DownloadProgressEventSchema = z.object({
  id: z.string(),
  percent: z.number().min(0).max(100),
  speed: z.string().optional(),
  eta: z.string().optional(),
  status: z.enum(["queued", "downloading", "processing", "completed", "failed", "cancelled"]),
  outputPath: z.string().optional(),
  error: z.string().optional(),
});
export type DownloadProgressEvent = z.infer<typeof DownloadProgressEventSchema>;

export const DownloadJobSchema = z.object({
  id: z.string(),
  url: z.string(),
  outputName: z.string(),
  status: z.enum(["queued", "downloading", "processing", "completed", "failed", "cancelled"]),
  percent: z.number().min(0).max(100).default(0),
  speed: z.string().optional(),
  eta: z.string().optional(),
  error: z.string().optional(),
  outputPath: z.string().optional(),
  soundId: z.string().optional(),
});
export type DownloadJob = z.infer<typeof DownloadJobSchema>;
