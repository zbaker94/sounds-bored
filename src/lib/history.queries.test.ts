import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useProjectHistory } from "./history.queries";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockLoadProjectHistory = vi.fn();
vi.mock("./history", () => ({
  loadProjectHistory: (options?: { onCorruption?: (msg: string) => void }) =>
    mockLoadProjectHistory(options),
  saveProjectHistory: vi.fn(() => Promise.resolve()),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  mockLoadProjectHistory.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useProjectHistory", () => {
  it("calls toast.warning via onCorruption when history file is corrupt", async () => {
    const { toast } = await import("sonner");
    const corruptionMessage =
      "history.json was corrupt and has been reset. Your recent projects list has been cleared.";

    mockLoadProjectHistory.mockImplementation(
      (options?: { onCorruption?: (msg: string) => void }) => {
        options?.onCorruption?.(corruptionMessage);
        return Promise.resolve([]);
      },
    );

    const { result } = renderHook(() => useProjectHistory(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.warning).toHaveBeenCalledWith(corruptionMessage);
  });

  it("passes onCorruption callback to loadProjectHistory", async () => {
    mockLoadProjectHistory.mockResolvedValue([]);

    const { result } = renderHook(() => useProjectHistory(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify loadProjectHistory was called with an options object containing onCorruption
    expect(mockLoadProjectHistory).toHaveBeenCalledWith(
      expect.objectContaining({ onCorruption: expect.any(Function) }),
    );
  });
});
