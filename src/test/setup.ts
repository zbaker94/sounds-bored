import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { resetTauriMocks } from "./tauri-mocks";
import { resetSceneCounter } from "./factories";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
  resetTauriMocks();
  resetSceneCounter();
});
