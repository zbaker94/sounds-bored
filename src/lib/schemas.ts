import { z } from "zod";

export const ProjectHistoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  date: z.string(), // ISO string
});

export const ProjectHistorySchema = z.array(ProjectHistoryEntrySchema);

export type ProjectHistoryEntry = z.infer<typeof ProjectHistoryEntrySchema>;
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

export const ProjectSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  lastSaved: z.string().optional(), // ISO timestamp of last save
  // Add other project fields as needed
});

export type Project = z.infer<typeof ProjectSchema>;
