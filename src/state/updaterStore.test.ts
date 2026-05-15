import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Update } from '@tauri-apps/plugin-updater';
import { useUpdaterStore, initialUpdaterState } from './updaterStore';

const { mockCheck, mockDownloadAndInstall } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockDownloadAndInstall: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

beforeEach(() => {
  useUpdaterStore.setState({ ...initialUpdaterState });
  mockCheck.mockReset();
  mockDownloadAndInstall.mockReset();
});

describe('checkForUpdates', () => {
  it('sets status to checking then idle when no update available', async () => {
    mockCheck.mockResolvedValueOnce({ available: false });

    const { checkForUpdates } = useUpdaterStore.getState();
    const promise = checkForUpdates();

    expect(useUpdaterStore.getState().status).toBe('checking');

    await promise;

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('idle');
    expect(state.hasChecked).toBe(true);
    expect(state.availableVersion).toBeNull();
    expect(state._pendingUpdate).toBeNull();
  });

  it('sets status to available with version when update exists', async () => {
    const mockUpdate = { available: true, version: '2.0.0', downloadAndInstall: mockDownloadAndInstall };
    mockCheck.mockResolvedValueOnce(mockUpdate as unknown as Update);

    await useUpdaterStore.getState().checkForUpdates();

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('available');
    expect(state.availableVersion).toBe('2.0.0');
    expect(state._pendingUpdate).toBe(mockUpdate);
    expect(state.hasChecked).toBe(true);
  });

  it('sets status to error and clears update data when check throws', async () => {
    mockCheck.mockRejectedValueOnce(new Error('network error'));

    await useUpdaterStore.getState().checkForUpdates();

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('error');
    expect(state.hasChecked).toBe(true);
    expect(state.availableVersion).toBeNull();
    expect(state._pendingUpdate).toBeNull();
  });

  it('clears stale availableVersion, progress, and _pendingUpdate when re-checking', async () => {
    useUpdaterStore.setState({ availableVersion: '1.5.0', progress: 50, status: 'available' });
    mockCheck.mockResolvedValueOnce({ available: false });

    const promise = useUpdaterStore.getState().checkForUpdates();
    const mid = useUpdaterStore.getState();
    expect(mid.availableVersion).toBeNull();
    expect(mid.progress).toBeNull();
    expect(mid._pendingUpdate).toBeNull();

    await promise;

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('idle');
    expect(state.hasChecked).toBe(true);
  });

  it('handles null return from check()', async () => {
    mockCheck.mockResolvedValueOnce(null);

    await useUpdaterStore.getState().checkForUpdates();

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('idle');
    expect(state.hasChecked).toBe(true);
    expect(state.availableVersion).toBeNull();
    expect(state._pendingUpdate).toBeNull();
  });

  it('preserves hasChecked=true across re-check that errors', async () => {
    useUpdaterStore.setState({ hasChecked: true, status: 'available', availableVersion: '1.5.0' });
    mockCheck.mockRejectedValueOnce(new Error('timeout'));

    await useUpdaterStore.getState().checkForUpdates();

    expect(useUpdaterStore.getState().hasChecked).toBe(true);
    expect(useUpdaterStore.getState().availableVersion).toBeNull();
  });

  it('is a no-op when status is already checking (concurrency guard)', async () => {
    useUpdaterStore.setState({ status: 'checking' });

    await useUpdaterStore.getState().checkForUpdates();

    expect(mockCheck).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe('checking');
  });
});

describe('install', () => {
  function setupPendingUpdate() {
    const mockUpdate = { available: true, version: '2.0.0', downloadAndInstall: mockDownloadAndInstall };
    useUpdaterStore.setState({ status: 'available', availableVersion: '2.0.0', _pendingUpdate: mockUpdate as unknown as Update });
    return mockUpdate;
  }

  it('does nothing when no update is pending', async () => {
    useUpdaterStore.setState({ _pendingUpdate: null });
    await useUpdaterStore.getState().install();
    expect(useUpdaterStore.getState().status).toBe('idle');
    expect(mockDownloadAndInstall).not.toHaveBeenCalled();
  });

  it('is a no-op when status is already downloading (re-entry guard)', async () => {
    setupPendingUpdate();
    useUpdaterStore.setState({ status: 'downloading' });

    await useUpdaterStore.getState().install();

    expect(mockDownloadAndInstall).not.toHaveBeenCalled();
  });

  it('is a no-op when status is ready (re-entry guard)', async () => {
    setupPendingUpdate();
    useUpdaterStore.setState({ status: 'ready' });

    await useUpdaterStore.getState().install();

    expect(mockDownloadAndInstall).not.toHaveBeenCalled();
  });

  it('sets status to downloading immediately', async () => {
    setupPendingUpdate();
    mockDownloadAndInstall.mockResolvedValueOnce(undefined);

    const promise = useUpdaterStore.getState().install();
    expect(useUpdaterStore.getState().status).toBe('downloading');
    expect(useUpdaterStore.getState().progress).toBeNull();

    await promise;
  });

  it('calls downloadAndInstall with a progress callback', async () => {
    setupPendingUpdate();
    mockDownloadAndInstall.mockResolvedValueOnce(undefined);

    await useUpdaterStore.getState().install();

    expect(mockDownloadAndInstall).toHaveBeenCalledWith(expect.any(Function));
  });

  it('sets status to ready after successful download', async () => {
    setupPendingUpdate();
    let statusDuringDownload: string | undefined;

    mockDownloadAndInstall.mockImplementationOnce(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: 1024 } });
      statusDuringDownload = useUpdaterStore.getState().status;
      cb({ event: 'Progress', data: { chunkLength: 512 } });
    });

    await useUpdaterStore.getState().install();

    expect(statusDuringDownload).toBe('downloading');
    const state = useUpdaterStore.getState();
    expect(state.status).toBe('ready');
    expect(state.progress).toBeNull();
  });

  it('tracks percentage progress when content-length is known', async () => {
    setupPendingUpdate();
    const progressValues: (number | null)[] = [];

    mockDownloadAndInstall.mockImplementationOnce(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: 1000 } });
      cb({ event: 'Progress', data: { chunkLength: 250 } });
      progressValues.push(useUpdaterStore.getState().progress);
      cb({ event: 'Progress', data: { chunkLength: 500 } });
      progressValues.push(useUpdaterStore.getState().progress);
      cb({ event: 'Progress', data: { chunkLength: 83 } }); // 833/1000 = 83.3 → 83
      progressValues.push(useUpdaterStore.getState().progress);
    });

    await useUpdaterStore.getState().install();

    expect(progressValues[0]).toBe(25);
    expect(progressValues[1]).toBe(75);
    expect(progressValues[2]).toBe(83);
  });

  it('sets progress to null when content-length is unknown', async () => {
    setupPendingUpdate();
    const progressValues: (number | null)[] = [];

    mockDownloadAndInstall.mockImplementationOnce(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: undefined } });
      cb({ event: 'Progress', data: { chunkLength: 512 } });
      progressValues.push(useUpdaterStore.getState().progress);
    });

    await useUpdaterStore.getState().install();

    expect(progressValues[0]).toBeNull();
  });

  it('sets progress to null when content-length is null', async () => {
    setupPendingUpdate();
    const progressValues: (number | null)[] = [];

    mockDownloadAndInstall.mockImplementationOnce(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: null } });
      cb({ event: 'Progress', data: { chunkLength: 256 } });
      progressValues.push(useUpdaterStore.getState().progress);
    });

    await useUpdaterStore.getState().install();

    expect(progressValues[0]).toBeNull();
  });

  it('sets status to error when downloadAndInstall throws', async () => {
    setupPendingUpdate();
    mockDownloadAndInstall.mockRejectedValueOnce(new Error('disk full'));

    await useUpdaterStore.getState().install();

    const state = useUpdaterStore.getState();
    expect(state.status).toBe('error');
    expect(state.progress).toBeNull();
  });

  it('clears non-null progress on error mid-download', async () => {
    setupPendingUpdate();

    mockDownloadAndInstall.mockImplementationOnce(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: 1000 } });
      cb({ event: 'Progress', data: { chunkLength: 250 } });
      throw new Error('connection dropped');
    });

    await useUpdaterStore.getState().install();

    expect(useUpdaterStore.getState().progress).toBeNull();
  });

  it('preserves _pendingUpdate after a failed install so retry is possible', async () => {
    const mockUpdate = setupPendingUpdate();
    mockDownloadAndInstall.mockRejectedValueOnce(new Error('write error'));

    await useUpdaterStore.getState().install();

    expect(useUpdaterStore.getState()._pendingUpdate).toBe(mockUpdate);
  });

  it('preserves hasChecked=true through the install flow', async () => {
    setupPendingUpdate();
    useUpdaterStore.setState({ hasChecked: true });
    mockDownloadAndInstall.mockResolvedValueOnce(undefined);

    await useUpdaterStore.getState().install();

    expect(useUpdaterStore.getState().hasChecked).toBe(true);
  });
});
