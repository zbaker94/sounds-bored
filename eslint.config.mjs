import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/state/**/*.ts"],
    languageOptions: {
      parser: tsParser,
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
