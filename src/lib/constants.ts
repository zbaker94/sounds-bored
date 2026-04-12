/**
 * Application-wide constants
 */

import type { GlobalFolder } from "@/lib/schemas";

// Application identifiers
export const APP_NAME = "SoundsBored";
export const APP_FOLDER = "SoundsBored";

// File names
export const PROJECT_FILE_NAME = "project.json";
export const HISTORY_FILE_NAME = "history.json";
export const SETTINGS_FILE_NAME = "settings.json";
export const LIBRARY_FILE_NAME = "library.json";

// Timing constants (in milliseconds)
export const AUTOSAVE_INTERVAL = 30000; // 30 seconds
export const WINDOW_CLOSE_DELAY = 50; // Small delay for state updates
export const QUERY_STALE_TIME = 5 * 60 * 1000; // 5 minutes

// Project defaults
export const DEFAULT_PROJECT_VERSION = "1.2.0";
export const DEFAULT_PROJECT_DESCRIPTION = "";

// Global file format versions (independent of project version)
export const CURRENT_SETTINGS_VERSION = "1.0.0";
export const CURRENT_LIBRARY_VERSION = "1.0.0";

// Audio
export const SOUNDS_SUBFOLDER = "sounds";
export const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".m4a"] as const;
export type AudioExtension = typeof AUDIO_EXTENSIONS[number];

// System tag names
export const SYSTEM_TAG_IMPORTED = "imported";

// Download events
export const DOWNLOAD_EVENT = "download://progress";

// Shared empty-reference sentinels — use to keep useMemo/useCallback deps stable
// when `settings?.globalFolders` is undefined. DO NOT mutate.
export const EMPTY_GLOBAL_FOLDERS: GlobalFolder[] = [];
