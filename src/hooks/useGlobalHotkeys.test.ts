import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { useProjectStore, initialProjectState } from "@/state/projectStore";
import { createMockProject } from "@/test/factories";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockUseHotkeys } = vi.hoisted(() => ({
  mockUseHotkeys: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Capture hotkey registrations by key name so tests can invoke callbacks and
// assert configuration (e.g., { preventDefault: true }).
const hotkeyRegistrations: Record<string, { cb: () => void; options?: object }> = {};
vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: (key: string, cb: () => void, options?: object) => {
    mockUseHotkeys(key, cb, options);
    hotkeyRegistrations[key] = { cb, options };
  },
}));

vi.mock("@/contexts/ProjectActionsContext", () => ({
  useProjectActions: () => ({
    handleSaveClick: vi.fn(),
    handleSaveAsMenuClick: vi.fn(),
    handleExportClick: vi.fn(),
  }),
}));

const mockUiState = {
  editMode: false,
  hoveredPadId: null as string | null,
  padPopoverOpenId: null as string | null,
  overlayStack: [] as object[],
  closeOverlay: vi.fn(),
  toggleOverlay: vi.fn(),
  openOverlay: vi.fn(),
  hasOpenOverlay: vi.fn(() => false),
  isTopOverlay: vi.fn(() => false),
  isOverlayOpen: vi.fn(() => false),
  toggleEditMode: vi.fn(),
  setActiveSceneId: vi.fn(),
  setHoveredPadId: vi.fn(),
};

vi.mock("@/state/uiStore", () => ({
  useUiStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => mockUiState),
  }),
  OVERLAY_ID: {
    EXPORT_PROGRESS_DIALOG: "EXPORT_PROGRESS_DIALOG",
    MENU_DRAWER: "MENU_DRAWER",
    SOUNDS_PANEL: "SOUNDS_PANEL",
    PAD_CONFIG_DRAWER: "PAD_CONFIG_DRAWER",
    SAVE_PROJECT_DIALOG: "SAVE_PROJECT_DIALOG",
  },
}));

vi.mock("@/state/multiFadeStore", () => ({
  useMultiFadeStore: { getState: vi.fn(() => ({ active: false })) },
}));

vi.mock("@/state/playbackStore", () => ({
  usePlaybackStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn(() => false),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  fadePadWithLevels: vi.fn(),
  resolveFadeDuration: vi.fn(() => 300),
}));

vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: vi.fn(() => ({ settings: { defaultFadeMs: 300 } })) },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerKey(key: string) {
  const reg = hotkeyRegistrations[key];
  if (!reg) throw new Error(`No hotkey registered for "${key}"`);
  reg.cb();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useGlobalHotkeys — hotkey configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(hotkeyRegistrations).forEach((k) => delete hotkeyRegistrations[k]);
    useProjectStore.setState({ ...initialProjectState });
    // Reset mutable fields on the shared mockUiState object
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = null;
    mockUiState.padPopoverOpenId = null;
    mockUiState.overlayStack = [];
  });

  it('registers "f" with enableOnFormTags: true so fade fires even when a slider or input is focused', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["f"]?.options).toMatchObject({ enableOnFormTags: true });
  });

  it('registers "x" with enableOnFormTags: true so multi-fade fires even when a slider or input is focused', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["x"]?.options).toMatchObject({ enableOnFormTags: true });
  });

  it('registers "esc" with enableOnFormTags: true (existing behaviour)', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["esc"]?.options).toMatchObject({ enableOnFormTags: true });
  });

  it("does not register left/right with enableOnFormTags (arrows must navigate within sliders, not jump scenes)", () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["left"]?.options).not.toMatchObject({ enableOnFormTags: true });
    expect(hotkeyRegistrations["right"]?.options).not.toMatchObject({ enableOnFormTags: true });
  });

  it("F callback is a no-op when no pad is hovered (prevents accidental fire while typing)", async () => {
    const { fadePadWithLevels } = await import("@/lib/audio/padPlayer");
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = null;
    renderHook(() => useGlobalHotkeys());
    triggerKey("f");
    expect(fadePadWithLevels).not.toHaveBeenCalled();
  });

  it("X callback is a no-op when no pad is hovered (prevents accidental fire while typing)", async () => {
    const { useMultiFadeStore } = await import("@/state/multiFadeStore");
    const mockEnterMultiFade = vi.fn();
    vi.mocked(useMultiFadeStore.getState).mockReturnValue({
      active: false,
      enterMultiFade: mockEnterMultiFade,
      enterMultiFadeEmpty: vi.fn(),
    } as unknown as ReturnType<typeof useMultiFadeStore.getState>);
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = null;
    renderHook(() => useGlobalHotkeys());
    triggerKey("x");
    expect(mockEnterMultiFade).not.toHaveBeenCalled();
  });
});

describe("useGlobalHotkeys — arrow-key scene navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(hotkeyRegistrations).forEach((k) => delete hotkeyRegistrations[k]);
    useProjectStore.setState({ ...initialProjectState });
  });

  function setupScenes(count: number, activeIdx: number | null) {
    const project = createMockProject({
      scenes: Array.from({ length: count }, (_, i) => ({
        id: `scene-${i}`,
        name: `Scene ${i + 1}`,
        pads: [],
      })),
    });
    useProjectStore.setState({
      ...initialProjectState,
      project,
      activeSceneId: activeIdx !== null ? `scene-${activeIdx}` : null,
    });
    return project;
  }

  // ── Configuration ───────────────────────────────────────────────────────────

  it("registers left and right arrows with preventDefault: true", () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["left"]?.options).toMatchObject({ preventDefault: true });
    expect(hotkeyRegistrations["right"]?.options).toMatchObject({ preventDefault: true });
  });

  // ── Guard: null / empty ─────────────────────────────────────────────────────

  it("does nothing on right arrow when project is null", () => {
    useProjectStore.setState({ ...initialProjectState, project: null, activeSceneId: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("right");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on left arrow when project is null", () => {
    useProjectStore.setState({ ...initialProjectState, project: null, activeSceneId: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("left");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on right arrow when scenes array is empty", () => {
    const project = createMockProject({ scenes: [] });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("right");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on left arrow when scenes array is empty", () => {
    const project = createMockProject({ scenes: [] });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("left");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  // ── Right arrow ─────────────────────────────────────────────────────────────

  describe("right arrow", () => {
    it("advances to next scene from first scene", () => {
      setupScenes(3, 0);
      renderHook(() => useGlobalHotkeys());

      triggerKey("right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-1");
    });

    it("wraps from last scene to first scene", () => {
      setupScenes(3, 2);
      renderHook(() => useGlobalHotkeys());

      triggerKey("right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is null (idx === -1)", () => {
      setupScenes(3, null);
      renderHook(() => useGlobalHotkeys());

      triggerKey("right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is stale/invalid", () => {
      setupScenes(3, 0);
      // Manually set an ID that doesn't match any scene
      useProjectStore.setState({ activeSceneId: "scene-stale-id" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("does nothing when fewer than 2 scenes", () => {
      const project = createMockProject({
        scenes: [{ id: "scene-0", name: "Scene 1", pads: [] }],
      });
      useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-0" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("right");

      // activeSceneId stays as-is — single-scene guard fires
      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });
  });

  // ── Left arrow ──────────────────────────────────────────────────────────────

  describe("left arrow", () => {
    it("moves to previous scene from middle scene", () => {
      setupScenes(3, 1);
      renderHook(() => useGlobalHotkeys());

      triggerKey("left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("wraps from first scene to last scene", () => {
      setupScenes(3, 0);
      renderHook(() => useGlobalHotkeys());

      triggerKey("left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-2");
    });

    it("falls back to first scene when activeSceneId is null (idx === -1)", () => {
      setupScenes(3, null);
      renderHook(() => useGlobalHotkeys());

      triggerKey("left");

      // Before fix: (-1 - 1 + 3) % 3 = 1 → scene-1. After fix: scene-0.
      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is stale/invalid", () => {
      setupScenes(3, 0);
      useProjectStore.setState({ activeSceneId: "scene-stale-id" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("does nothing when fewer than 2 scenes", () => {
      const project = createMockProject({
        scenes: [{ id: "scene-0", name: "Scene 1", pads: [] }],
      });
      useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-0" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });
  });
});
