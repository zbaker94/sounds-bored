import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useWindowCloseHandler } from "@/hooks/useWindowCloseHandler";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockUnlisten, mockOnCloseRequested } = vi.hoisted(() => {
  const mockUnlisten = vi.fn();
  const mockOnCloseRequested = vi.fn();
  mockOnCloseRequested.mockResolvedValue(mockUnlisten);
  return { mockUnlisten, mockOnCloseRequested };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: mockOnCloseRequested,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type CloseEvent = { preventDefault(): void };
type CloseCallback = (event: CloseEvent) => Promise<void>;

async function getRegisteredCallback(): Promise<CloseCallback> {
  await waitFor(() => expect(mockOnCloseRequested).toHaveBeenCalledTimes(1));
  return mockOnCloseRequested.mock.calls[0][0] as CloseCallback;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWindowCloseHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers onCloseRequested listener on mount", async () => {
    renderHook(() => useWindowCloseHandler(false, vi.fn()));
    await waitFor(() => {
      expect(mockOnCloseRequested).toHaveBeenCalledTimes(1);
      expect(mockOnCloseRequested).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  it("calls unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useWindowCloseHandler(false, vi.fn()));
    await waitFor(() => expect(mockOnCloseRequested).toHaveBeenCalled());
    // Flush the await continuation that assigns unlisten inside setupListener
    await act(async () => {});
    unmount();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("does not prevent close when hasUnsavedChanges is false", async () => {
    renderHook(() => useWindowCloseHandler(false, vi.fn()));
    const cb = await getRegisteredCallback();
    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("prevents close and calls onCloseRequested when hasUnsavedChanges is true", async () => {
    const onCloseRequested = vi.fn();
    renderHook(() => useWindowCloseHandler(true, onCloseRequested));
    const cb = await getRegisteredCallback();
    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCloseRequested).toHaveBeenCalledTimes(1);
  });

  it("does not prevent close when allowClose() has been called", async () => {
    const onCloseRequested = vi.fn();
    const { result } = renderHook(() => useWindowCloseHandler(true, onCloseRequested));
    const cb = await getRegisteredCallback();
    act(() => {
      result.current.allowClose();
    });
    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCloseRequested).not.toHaveBeenCalled();
  });

  it("allows close on subsequent attempt after allowClose() is called", async () => {
    const onCloseRequested = vi.fn();
    const { result } = renderHook(() => useWindowCloseHandler(true, onCloseRequested));
    const cb = await getRegisteredCallback();

    const event1 = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event1);
    });
    expect(event1.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCloseRequested).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.allowClose();
    });

    const event2 = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event2);
    });
    expect(event2.preventDefault).not.toHaveBeenCalled();
    expect(onCloseRequested).toHaveBeenCalledTimes(1);
  });

  it("picks up hasUnsavedChanges changes via ref without re-registering listener", async () => {
    const onCloseRequested = vi.fn();
    const { rerender } = renderHook(
      ({ hasUnsaved }: { hasUnsaved: boolean }) =>
        useWindowCloseHandler(hasUnsaved, onCloseRequested),
      { initialProps: { hasUnsaved: false } },
    );

    const cb = await getRegisteredCallback();

    const event1 = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event1);
    });
    expect(event1.preventDefault).not.toHaveBeenCalled();
    expect(onCloseRequested).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ hasUnsaved: true });
    });
    expect(mockOnCloseRequested).toHaveBeenCalledTimes(1);

    const event2 = { preventDefault: vi.fn() };
    await act(async () => {
      await cb(event2);
    });
    expect(event2.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCloseRequested).toHaveBeenCalledTimes(1);
  });

  it("picks up onCloseRequested changes via ref without re-registering listener", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useWindowCloseHandler(true, cb),
      { initialProps: { cb: first } },
    );

    const registeredCb = await getRegisteredCallback();
    await act(async () => {
      rerender({ cb: second });
    });
    expect(mockOnCloseRequested).toHaveBeenCalledTimes(1);

    const event = { preventDefault: vi.fn() };
    await act(async () => {
      await registeredCb(event);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
