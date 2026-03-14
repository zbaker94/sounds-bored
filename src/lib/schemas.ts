import { z } from "zod";

// ─── Project History ───────────────────────────────────────────────────────────

export const ProjectHistoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  date: z.string(), // ISO string
});

export const ProjectHistorySchema = z.array(ProjectHistoryEntrySchema);

export type ProjectHistoryEntry = z.infer<typeof ProjectHistoryEntrySchema>;
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

// ─── Enums ────────────────────────────────────────────────────────────────────

export const PlaybackModeSchema = z.enum(["one-shot", "hold", "loop"]);
export const ArrangementSchema = z.enum(["simultaneous", "sequential", "shuffled"]);
export const RetriggerModeSchema = z.enum(["restart", "continue", "stop", "next"]);

export type PlaybackMode = z.infer<typeof PlaybackModeSchema>;
export type Arrangement = z.infer<typeof ArrangementSchema>;
export type RetriggerMode = z.infer<typeof RetriggerModeSchema>;

// ─── Sound (project-level asset, shared across pads) ──────────────────────────

export const SoundSchema = z.object({
  id: z.string(),
  name: z.string(),
  filePath: z.string()
    .refine((p) => !p.includes(".."), { message: "filePath must not contain '..'" })
    .refine(
      (p) => !/^[A-Za-z]:/.test(p) && !p.startsWith("/"),
      { message: "filePath must be a relative path (no drive letters or leading slashes)" }
    )
    .optional(),   // relative to project folder
  sourceUrl: z.string().optional(),  // original web URL for yt-dlp re-download
  tags: z.array(z.string()),
  sets: z.array(z.string()),
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

// ─── Tag / Set ────────────────────────────────────────────────────────────────

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

// ─── SoundInstance (a specific usage of a Sound within a Layer) ───────────────

export const SoundInstanceSchema = z.object({
  id: z.string(),
  soundId: z.string(),    // reference to Sound.id in the project library
  volume: z.number(),     // 0–1 per-instance volume
  startOffsetMs: z.number().optional(),
});

export type SoundInstance = z.infer<typeof SoundInstanceSchema>;

// ─── Layer Selection (how a layer resolves its sounds at trigger time) ─────────

export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: z.string(),
    defaultVolume: z.number(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string(),
    defaultVolume: z.number(),
  }),
]);

export type LayerSelection = z.infer<typeof LayerSelectionSchema>;

// ─── Layer (independent playback unit within a pad) ───────────────────────────

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  selection: LayerSelectionSchema,
  arrangement: ArrangementSchema,
  playbackMode: PlaybackModeSchema,
  retriggerMode: RetriggerModeSchema,
  volume: z.number(),  // 0–1 layer-level volume (multiplied with instance volume)
});

export type Layer = z.infer<typeof LayerSchema>;

// ─── Pad ──────────────────────────────────────────────────────────────────────

export const PadSchema = z.object({
  id: z.string(),
  name: z.string(),
  layers: z.array(LayerSchema),
  muteTargetPadIds: z.array(z.string()),  // explicit: this pad stops these pads on trigger
  muteGroupId: z.string().optional(),      // exclusive group (hi-hat style)
  color: z.string().optional(),
  icon: z.string().optional(),
});

export type Pad = z.infer<typeof PadSchema>;

// ─── Scene ────────────────────────────────────────────────────────────────────

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  pads: z.array(PadSchema),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
});

export type Scene = z.infer<typeof SceneSchema>;

// ─── Project ──────────────────────────────────────────────────────────────────

export const ProjectSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  lastSaved: z.string().optional(),
  scenes: z.array(SceneSchema).default([]),
  sounds: z.array(SoundSchema).default([]),
  tags: z.array(TagSchema).default([]),
  sets: z.array(SetSchema).default([]),
});

export type Project = z.infer<typeof ProjectSchema>;
