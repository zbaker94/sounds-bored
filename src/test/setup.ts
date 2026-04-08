import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { resetTauriMocks } from "./tauri-mocks";
import { resetSceneCounter } from "./factories";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Mock window.matchMedia — happy-dom does not implement it.
// DrawerDialog uses useIsMd() which calls matchMedia at render time.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  resetTauriMocks();
  resetSceneCounter();
});
