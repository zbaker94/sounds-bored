/**
 * Application-wide constants
 */

import type { GlobalFolder } from "@/lib/schemas";

// Application identifiers
export const APP_FOLDER = "SoundsBored";

// File names
export const PROJECT_FILE_NAME = "project.json";
export const HISTORY_FILE_NAME = "history.json";
export const SETTINGS_FILE_NAME = "settings.json";
export const LIBRARY_FILE_NAME = "library.json";
export const DOWNLOADS_FILE_NAME = "downloads.json";

// Timing constants (in milliseconds)
export const AUTOSAVE_INTERVAL = 30000; // 30 seconds
export const WINDOW_CLOSE_DELAY = 50; // Small delay for state updates
export const QUERY_STALE_TIME = 5 * 60 * 1000; // 5 minutes

// Project defaults
// Single source of truth for the current project format version.
// DEFAULT_PROJECT_VERSION is kept as an alias so project.ts reads naturally ("this is the default version for new projects").
export const CURRENT_PROJECT_VERSION = "1.4.0";
export const DEFAULT_PROJECT_VERSION = CURRENT_PROJECT_VERSION;
export const DEFAULT_PROJECT_DESCRIPTION = "";

// Global file format versions (independent of project version)
export const CURRENT_SETTINGS_VERSION = "1.0.0";
export const CURRENT_LIBRARY_VERSION = "1.0.0";

// Audio
export const SOUNDS_SUBFOLDER = "sounds";
export const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".m4a"] as const;

// File dialog filter for audio file pickers. Shared by every "pick an audio file" call site.
export const AUDIO_FILE_FILTERS = [
  { name: "Audio", extensions: AUDIO_EXTENSIONS.map((e) => e.replace(".", "")) },
];

// UI Layout
export const PADS_PER_PAGE = 12;

// System tag names
export const SYSTEM_TAG_IMPORTED = "imported";

// Download events
export const DOWNLOAD_EVENT = "download://progress";

// Analysis events (must match Rust emit names in commands.rs)
export const ANALYSIS_COMPLETE_EVENT = "audio::analysis::complete";
export const ANALYSIS_STARTED_EVENT = "audio::analysis::started";

// Analysis size thresholds for the large-file warning dialog
export const ANALYSIS_LARGE_FILE_BYTES = 50_000_000;  // 50 MB
export const ANALYSIS_LARGE_TOTAL_BYTES = 200_000_000; // 200 MB

// Shared empty-reference sentinels — use to keep useMemo/useCallback deps stable
// when `settings?.globalFolders` is undefined. DO NOT mutate.
export const EMPTY_GLOBAL_FOLDERS: GlobalFolder[] = [];
