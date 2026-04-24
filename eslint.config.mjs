import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/state/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    // Enforce the coupling direction: domain stores (project/library/playback)
    // may import uiStore, but uiStore and other peripheral stores must never
    // import from domain stores — doing so would create a Vite module evaluation
    // cycle. This mirrors the documented invariant in projectStore.ts.
    //
    // Applied to the whole src/state/ folder so new stores are automatically
    // covered without requiring a config edit. Domain stores are the ignores.
    files: ["src/state/**/*.ts"],
    ignores: [
      "src/state/projectStore.ts",
      "src/state/libraryStore.ts",
      "src/state/playbackStore.ts",
      "src/state/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
