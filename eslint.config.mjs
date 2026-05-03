import tsParser from "@typescript-eslint/parser";

// Used in two blocks: once for all src files, once merged into the state-files block.
// ESLint flat config: when multiple configs match the same file, the last one wins per
// rule key — so the state-files block must repeat this pattern or it would be dropped.
const AUDIO_SUBPATH_PATTERN = {
  group: ["@/lib/audio/*"],
  message:
    "Import from '@/lib/audio' (the public facade) instead of internal audio submodules. Direct subpath imports bypass the enforced boundary.",
};

export default [
  {
    files: ["src/state/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    // Enforce audio engine public boundary: all code outside src/lib/audio/ must import
    // from @/lib/audio (the facade), never from internal submodules like audioState or
    // padPlayer directly.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/audio/**"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: [AUDIO_SUBPATH_PATTERN] }],
    },
  },
  {
    // Enforce store coupling direction: no store may import from domain stores
    // (projectStore, libraryStore, playbackStore). This prevents circular deps
    // and keeps the architecture layered. Domain stores themselves are exempt so
    // they can import from each other if ever needed; test files are exempt since
    // they need to set up and inspect store state directly.
    //
    // Applied to the whole src/state/ folder so new stores are automatically
    // covered without requiring a config edit.
    //
    // AUDIO_SUBPATH_PATTERN is repeated here because this block matches the same
    // files as the audio boundary block above — the last matching config wins per
    // rule key in flat config, so both sets of patterns must live together.
    files: ["src/state/**/*.ts"],
    ignores: [
      "src/state/libraryStore.ts",
      "src/state/playbackStore.ts",
      "src/state/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            AUDIO_SUBPATH_PATTERN,
            {
              group: ["*/projectStore", "*projectStore*"],
              message:
                "uiStore/peripheral stores must not import from projectStore — this inverts the coupling direction and creates a circular dep. See projectStore.ts header.",
            },
            {
              group: ["*/libraryStore", "*libraryStore*"],
              message:
                "uiStore/peripheral stores must not import from libraryStore — this inverts the coupling direction and creates a circular dep. See projectStore.ts header.",
            },
            {
              group: ["*/playbackStore", "*playbackStore*"],
              message:
                "uiStore/peripheral stores must not import from playbackStore — this inverts the coupling direction and creates a circular dep. See projectStore.ts header.",
            },
          ],
        },
      ],
    },
  },
];
