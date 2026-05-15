import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUpdaterStore, initialUpdaterState } from '@/state/updaterStore';
import { useUpdater, _resetUpdateChecked } from './useUpdater';

const { mockToast, mockToastLoading, mockToastSuccess, mockToastError, mockToastDismiss, mockRelaunch, mockLogError, mockCheckForUpdates } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockToastLoading: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastDismiss: vi.fn(),
  mockRelaunch: vi.fn().mockResolvedValue(undefined),
  mockLogError: vi.fn(),
  mockCheckForUpdates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(mockToast, {
    loading: mockToastLoading,
    success: mockToastSuccess,
    error: mockToastError,
    dismiss: mockToastDismiss,
  }),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

vi.mock('@/lib/logger', () => ({
  logError: mockLogError,
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheckForUpdates,
}));

beforeEach(() => {
  useUpdaterStore.setState({ ...initialUpdaterState });
  _resetUpdateChecked();
  vi.restoreAllMocks();
  mockToast.mockReset();
  mockToastLoading.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockToastDismiss.mockReset();
  mockRelaunch.mockReset().mockResolvedValue(undefined);
  mockLogError.mockReset();
  mockCheckForUpdates.mockReset().mockResolvedValue({ available: false });
});

describe('useUpdater', () => {
  it('fires checkForUpdates once on first mount', () => {
    const spy = vi.spyOn(useUpdaterStore.getState(), 'checkForUpdates').mockResolvedValue(undefined);
    renderHook(() => useUpdater());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not fire checkForUpdates on remount without _resetUpdateChecked', () => {
    const spy = vi.spyOn(useUpdaterStore.getState(), 'checkForUpdates').mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useUpdater());
    unmount();
    renderHook(() => useUpdater());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires checkForUpdates again after _resetUpdateChecked', () => {
    const spy = vi.spyOn(useUpdaterStore.getState(), 'checkForUpdates').mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useUpdater());
    unmount();
    _resetUpdateChecked();
    renderHook(() => useUpdater());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shows "Update available" toast when status transitions to available', () => {
    renderHook(() => useUpdater());

    act(() => {
      useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0', hasChecked: true });
    });

    expect(mockToast).toHaveBeenCalledWith(
      'Update 2.0.0 available',
      expect.objectContaining({
        id: 'app-updater',
        description: expect.stringContaining('SoundsBored'),
        action: expect.objectContaining({ label: 'Install now' }),
      })
    );
  });

  it('shows loading toast with "Starting download…" when progress is null on entry', () => {
    renderHook(() => useUpdater());

    act(() => {
      useUpdaterStore.setState({ status: 'downloading', progress: null });
    });

    expect(mockToastLoading).toHaveBeenCalledWith(
      'Downloading update…',
      expect.objectContaining({ id: 'app-updater', description: 'Starting download…' })
    );
  });

  it('updates loading toast with percentage as progress increases', () => {
    renderHook(() => useUpdater());
    act(() => { useUpdaterStore.setState({ status: 'downloading', progress: null }); });
    act(() => { useUpdaterStore.setState({ progress: 42 }); });

    const calls = mockToastLoading.mock.calls;
    const progressCall = calls.find(([, opts]) => (opts as { description?: string }).description?.includes('42%'));
    expect(progressCall).toBeDefined();
  });

  it('shows success toast when status transitions to ready', () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'downloading', progress: null }); });
    act(() => { useUpdaterStore.setState({ status: 'ready', progress: null }); });

    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Update ready',
      expect.objectContaining({
        id: 'app-updater',
        action: expect.objectContaining({ label: 'Restart now' }),
      })
    );
  });

  it('calls relaunch when Restart now action is clicked', async () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'downloading', progress: null }); });
    act(() => { useUpdaterStore.setState({ status: 'ready', progress: null }); });

    const successArgs = mockToastSuccess.mock.calls[0];
    const action = (successArgs[1] as { action: { onClick: () => void } }).action;
    act(() => { action.onClick(); });

    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it('logs error when relaunch rejects', async () => {
    mockRelaunch.mockRejectedValueOnce(new Error('process error'));
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'ready', progress: null }); });

    const successArgs = mockToastSuccess.mock.calls[0];
    const action = (successArgs[1] as { action: { onClick: () => void } }).action;
    // act() flushes sync state updates; vi.waitFor polls until the async rejection resolves.
    act(() => { action.onClick(); });

    await vi.waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith('updater relaunch failed', expect.any(Error));
    });
  });

  it('shows error toast when status transitions to error', () => {
    renderHook(() => useUpdater());

    act(() => {
      useUpdaterStore.setState({ status: 'error', hasChecked: true });
    });

    expect(mockToastError).toHaveBeenCalledWith(
      'Update failed',
      expect.objectContaining({ id: 'app-updater', duration: 8000 })
    );
  });

  it('does not re-emit error toast when status stays error and another field changes', () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'error', hasChecked: true }); });
    act(() => { useUpdaterStore.setState({ hasChecked: true }); }); // same status, different field write

    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('does not fire available toast for status already set before mount', () => {
    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0' }); });
    renderHook(() => useUpdater());

    // prevStatus seeded from current store state — no transition observed
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does not fire available toast when available status is set twice post-mount', () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0' }); });
    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0' }); });

    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('dismisses stale toast when status transitions to checking', () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0' }); });
    act(() => { useUpdaterStore.setState({ status: 'checking' }); });

    expect(mockToastDismiss).toHaveBeenCalledWith('app-updater');
  });

  it('dismisses stale toast when status transitions to idle (no update found)', () => {
    renderHook(() => useUpdater());

    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0' }); });
    act(() => { useUpdaterStore.setState({ status: 'checking' }); });
    act(() => { useUpdaterStore.setState({ status: 'idle', hasChecked: true }); });

    expect(mockToastDismiss).toHaveBeenCalledWith('app-updater');
  });

  it('unsubscribes from store on unmount', () => {
    const { unmount } = renderHook(() => useUpdater());
    unmount();

    act(() => { useUpdaterStore.setState({ status: 'available', availableVersion: '3.0.0' }); });
    expect(mockToast).not.toHaveBeenCalled();
  });
});
