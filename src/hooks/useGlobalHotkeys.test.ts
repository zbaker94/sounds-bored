import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
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
  editingPadId: null as string | null,
  fadePopoverPadId: null as string | null,
  fadePopoverTarget: null as number | null,
  overlayStack: [] as object[],
  closeOverlay: vi.fn(),
  toggleOverlay: vi.fn(),
  openOverlay: vi.fn(),
  hasOpenOverlay: vi.fn(() => false),
  isTopOverlay: vi.fn(() => false),
  isOverlayOpen: vi.fn(() => false),
  toggleEditMode: vi.fn(),
  setHoveredPadId: vi.fn(),
  setEditingPadId: vi.fn((id: string | null) => { mockUiState.editingPadId = id; }),
  setFadePopoverPadId: vi.fn((id: string | null) => { mockUiState.fadePopoverPadId = id; }),
  setFadePopoverTarget: vi.fn((t: number | null) => { mockUiState.fadePopoverTarget = t; }),
  pageByScene: {} as Record<string, number>,
  setScenePage: vi.fn(),
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
  usePlaybackStore: { getState: vi.fn(() => ({})), subscribe: vi.fn(() => () => {}) },
}));

vi.mock("@/lib/audio/audioState", () => ({
  isPadActive: vi.fn(() => false),
  onLayerVoiceSetChanged: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("@/lib/audio/padPlayer", () => ({
  executeFadeTap: vi.fn(),
}));

vi.mock("@/state/appSettingsStore", () => ({
  useAppSettingsStore: { getState: vi.fn(() => ({ settings: { globalFadeDurationMs: 300 } })) },
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
    mockUiState.editingPadId = null;
    mockUiState.fadePopoverPadId = null;
    mockUiState.fadePopoverTarget = null;
    mockUiState.overlayStack = [];
    mockUiState.pageByScene = {};
  });

  it('registers "f" with enableOnFormTags: true so fade fires even when a slider or input is focused', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["f"]?.options).toEqual({ enableOnFormTags: true });
  });

  it('registers "x" with enableOnFormTags: true so multi-fade fires even when a slider or input is focused', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["x"]?.options).toEqual({ enableOnFormTags: true });
  });

  it('registers "esc" with enableOnFormTags: true (existing behaviour)', () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["esc"]?.options).toEqual({ enableOnFormTags: true });
  });

  it("does not register alt+left/alt+right with enableOnFormTags (modifier guards against interactive-element conflicts)", () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["alt+left"]?.options).not.toMatchObject({ enableOnFormTags: true });
    expect(hotkeyRegistrations["alt+right"]?.options).not.toMatchObject({ enableOnFormTags: true });
  });

  it("does NOT register bare left/right without Alt modifier (bare arrows conflict with inputs/comboboxes — issue #67)", () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["left"]).toBeUndefined();
    expect(hotkeyRegistrations["right"]).toBeUndefined();
  });

  it("F in normal mode over a hovered pad with no popover open calls setFadePopoverPadId (opens the popover, does not fade yet)", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");

    const pad = { id: "pad-1", layers: [], volume: 90, fadeTargetVol: 10 } as unknown as import("@/lib/schemas").Pad;
    useProjectStore.setState({
      ...initialProjectState,
      project: createMockProject({ scenes: [{ id: "s1", name: "Scene 1", pads: [pad] }] }),
    });
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = "pad-1";
    mockUiState.editingPadId = null;
    mockUiState.fadePopoverPadId = null;

    renderHook(() => useGlobalHotkeys());
    triggerKey("f");

    expect(mockUiState.setFadePopoverPadId).toHaveBeenCalledWith("pad-1");
    expect(executeFadeTap).not.toHaveBeenCalled();
  });

  it("F in normal mode with popover already open for hovered pad executes the fade and closes the popover", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");

    const pad = { id: "pad-1", layers: [], volume: 90, fadeTargetVol: 10 } as unknown as import("@/lib/schemas").Pad;
    useProjectStore.setState({
      ...initialProjectState,
      project: createMockProject({ scenes: [{ id: "s1", name: "Scene 1", pads: [pad] }] }),
    });
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = "pad-1";
    mockUiState.editingPadId = null;
    mockUiState.fadePopoverPadId = "pad-1";

    renderHook(() => useGlobalHotkeys());
    triggerKey("f");

    expect(executeFadeTap).toHaveBeenCalledWith(expect.objectContaining({ id: "pad-1" }), 300);
    expect(mockUiState.setFadePopoverPadId).toHaveBeenCalledWith(null);
  });

  it("F in edit mode with editingPadId set executes the fade for the editing pad (does not exit edit mode)", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");

    const pad = { id: "pad-1", layers: [], volume: 90, fadeTargetVol: 10 } as unknown as import("@/lib/schemas").Pad;
    useProjectStore.setState({
      ...initialProjectState,
      project: createMockProject({ scenes: [{ id: "s1", name: "Scene 1", pads: [pad] }] }),
    });
    mockUiState.editMode = true;
    mockUiState.editingPadId = "pad-1";
    mockUiState.hoveredPadId = null;

    renderHook(() => useGlobalHotkeys());
    triggerKey("f");

    expect(executeFadeTap).toHaveBeenCalledWith(expect.objectContaining({ id: "pad-1" }), 300);
    // Edit mode should not be toggled off by F
    expect(mockUiState.toggleEditMode).not.toHaveBeenCalled();
  });

  it("F callback is a no-op when multi-fade is active (deferred to useMultiFadeSideEffects)", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    const { useMultiFadeStore } = await import("@/state/multiFadeStore");
    vi.mocked(useMultiFadeStore.getState).mockReturnValue({
      active: true,
    } as ReturnType<typeof useMultiFadeStore.getState>);
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = "pad-1";

    renderHook(() => useGlobalHotkeys());
    triggerKey("f");

    expect(executeFadeTap).not.toHaveBeenCalled();
    expect(mockUiState.setFadePopoverPadId).not.toHaveBeenCalled();
  });

  it("F callback is a no-op when no pad is hovered (prevents accidental fire while typing)", async () => {
    const { executeFadeTap } = await import("@/lib/audio/padPlayer");
    mockUiState.editMode = false;
    mockUiState.hoveredPadId = null;
    renderHook(() => useGlobalHotkeys());
    triggerKey("f");
    expect(executeFadeTap).not.toHaveBeenCalled();
    expect(mockUiState.setFadePopoverPadId).not.toHaveBeenCalled();
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

// ── Mod+Shift+N ───────────────────────────────────────────────────────────────

describe("useGlobalHotkeys — mod+shift+n (add pad)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.keys(hotkeyRegistrations).forEach((k) => delete hotkeyRegistrations[k]);
    useProjectStore.setState({ ...initialProjectState });
    mockUiState.editingPadId = null;
    mockUiState.pageByScene = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op when activeSceneId is null", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: [] }],
    });
    useProjectStore.setState({ ...initialProjectState, project });

    const addPadSpy = vi.spyOn(useProjectStore.getState(), "addPad");
    renderHook(() => useGlobalHotkeys());
    triggerKey("mod+shift+n");

    expect(addPadSpy).not.toHaveBeenCalled();
    expect(mockUiState.setEditingPadId).not.toHaveBeenCalled();
  });

  it("calls addPad and setEditingPadId with a UUID on the happy path", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: [] }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });

    const addPadSpy = vi.spyOn(useProjectStore.getState(), "addPad");
    renderHook(() => useGlobalHotkeys());
    triggerKey("mod+shift+n");

    expect(addPadSpy).toHaveBeenCalledTimes(1);
    const [calledSceneId, , calledId] = addPadSpy.mock.calls[0];
    expect(calledSceneId).toBe("scene-1");
    expect(calledId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // setScenePage fires synchronously; setEditingPadId is deferred via setTimeout
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
    expect(mockUiState.setEditingPadId).not.toHaveBeenCalled();

    act(() => { vi.runAllTimers(); });
    expect(mockUiState.setEditingPadId).toHaveBeenCalledWith(calledId);
  });
});

// Note: these are registration-level unit tests — they assert which key strings are
// passed to useHotkeys and that callbacks produce the right store mutations.
// They do not exercise real keyboard event dispatch; that is covered by E2E/manual tests.
describe("useGlobalHotkeys — alt+arrow scene navigation", () => {
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

  it("registers alt+left and alt+right with preventDefault: true", () => {
    renderHook(() => useGlobalHotkeys());
    expect(hotkeyRegistrations["alt+left"]?.options).toMatchObject({ preventDefault: true });
    expect(hotkeyRegistrations["alt+right"]?.options).toMatchObject({ preventDefault: true });
  });

  // ── Guard: null / empty ─────────────────────────────────────────────────────

  it("does nothing on alt+right when project is null", () => {
    useProjectStore.setState({ ...initialProjectState, project: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("alt+right");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on alt+left when project is null", () => {
    useProjectStore.setState({ ...initialProjectState, project: null });
    renderHook(() => useGlobalHotkeys());
    triggerKey("alt+left");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on alt+right when scenes array is empty", () => {
    const project = createMockProject({ scenes: [] });
    useProjectStore.setState({ ...initialProjectState, project });
    renderHook(() => useGlobalHotkeys());
    triggerKey("alt+right");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  it("does nothing on alt+left when scenes array is empty", () => {
    const project = createMockProject({ scenes: [] });
    useProjectStore.setState({ ...initialProjectState, project });
    renderHook(() => useGlobalHotkeys());
    triggerKey("alt+left");
    expect(useProjectStore.getState().activeSceneId).toBeNull();
  });

  // ── Alt+Right ───────────────────────────────────────────────────────────────

  describe("alt+right", () => {
    it("advances to next scene from first scene", () => {
      setupScenes(3, 0);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-1");
    });

    it("wraps from last scene to first scene", () => {
      setupScenes(3, 2);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is null (idx === -1)", () => {
      setupScenes(3, null);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is stale/invalid", () => {
      setupScenes(3, 0);
      // Manually set an ID that doesn't match any scene
      useProjectStore.setState({ activeSceneId: "scene-stale-id" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+right");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("does nothing when fewer than 2 scenes", () => {
      const project = createMockProject({
        scenes: [{ id: "scene-0", name: "Scene 1", pads: [] }],
      });
      useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-0" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+right");

      // activeSceneId stays as-is — single-scene guard fires
      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });
  });

  // ── Alt+Left ────────────────────────────────────────────────────────────────

  describe("alt+left", () => {
    it("moves to previous scene from middle scene", () => {
      setupScenes(3, 1);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("wraps from first scene to last scene", () => {
      setupScenes(3, 0);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-2");
    });

    it("falls back to first scene when activeSceneId is null (idx === -1)", () => {
      setupScenes(3, null);
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+left");

      // Before fix: (-1 - 1 + 3) % 3 = 1 → scene-1. After fix: scene-0.
      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("falls back to first scene when activeSceneId is stale/invalid", () => {
      setupScenes(3, 0);
      useProjectStore.setState({ activeSceneId: "scene-stale-id" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });

    it("does nothing when fewer than 2 scenes", () => {
      const project = createMockProject({
        scenes: [{ id: "scene-0", name: "Scene 1", pads: [] }],
      });
      useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-0" });
      renderHook(() => useGlobalHotkeys());

      triggerKey("alt+left");

      expect(useProjectStore.getState().activeSceneId).toBe("scene-0");
    });
  });
});

// ── Shift+Left / Shift+Right — page navigation ────────────────────────────────

describe("useGlobalHotkeys — shift+left / shift+right — page navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(hotkeyRegistrations).forEach((k) => delete hotkeyRegistrations[k]);
    useProjectStore.setState({ ...initialProjectState });
    mockUiState.pageByScene = {};
    mockUiState.setScenePage.mockClear();
  });

  // PADS_PER_PAGE = 12, so:
  //   0 pads  → totalPages = 1
  //  12 pads  → totalPages = 1
  //  13 pads  → totalPages = 2
  //  25 pads  → totalPages = 3

  function makePads(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `pad-${i}`,
      name: `Pad ${i}`,
      layers: [],
      muteTargetPadIds: [],
    }));
  }

  // ── Guard: null activeSceneId ───────────────────────────────────────────────

  it("shift+left is a no-op when activeSceneId is null", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project });
    mockUiState.pageByScene = {};

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+left");

    expect(mockUiState.setScenePage).not.toHaveBeenCalled();
  });

  it("shift+right is a no-op when activeSceneId is null", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project });
    mockUiState.pageByScene = {};

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+right");

    expect(mockUiState.setScenePage).not.toHaveBeenCalled();
  });

  // ── Single-page scene (totalPages = 1) — wraps back to page 0 ──────────────

  it("shift+left on single-page scene stays at page 0 (wrap: 0 → totalPages-1 = 0)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(1) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 0 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+left");

    // totalPages = 1; safePage = 0; 0 > 0 is false → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });

  it("shift+right on single-page scene stays at page 0 (wrap: 0 → 0)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(1) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 0 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+right");

    // totalPages = 1; safePage = 0; 0 < 0 is false → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });

  // ── Multi-page: decrement ───────────────────────────────────────────────────

  it("shift+left decrements page (page 1 → page 0)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 1 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+left");

    // totalPages = 3; safePage = 1; 1 > 0 → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });

  // ── Multi-page: wrap left (page 0 → last page) ─────────────────────────────

  it("shift+left wraps from page 0 to last page (page 0 → page 2)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 0 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+left");

    // totalPages = 3; safePage = 0; 0 > 0 is false → setScenePage(2)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 2);
  });

  // ── Multi-page: increment ───────────────────────────────────────────────────

  it("shift+right increments page (page 0 → page 1)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 0 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+right");

    // totalPages = 3; safePage = 0; 0 < 2 → setScenePage(1)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 1);
  });

  // ── Multi-page: wrap right (last page → page 0) ────────────────────────────

  it("shift+right wraps from last page to page 0 (page 2 → page 0)", () => {
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(25) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 2 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+right");

    // totalPages = 3; safePage = 2; 2 < 2 is false → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });

  // ── Stale page clamping ─────────────────────────────────────────────────────

  it("shift+left clamps stale page before decrementing (pageByScene=5, totalPages=1 → setScenePage(0))", () => {
    // 12 pads → totalPages = 1; pageByScene holds stale value of 5
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(12) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 5 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+left");

    // totalPages = 1; safePage = min(5, 0) = 0; 0 > 0 is false → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });

  it("shift+right clamps stale page before incrementing (pageByScene=5, totalPages=1 → setScenePage(0))", () => {
    // 12 pads → totalPages = 1; pageByScene holds stale value of 5
    const project = createMockProject({
      scenes: [{ id: "scene-1", name: "Scene 1", pads: makePads(12) }],
    });
    useProjectStore.setState({ ...initialProjectState, project, activeSceneId: "scene-1" });
    mockUiState.pageByScene = { "scene-1": 5 };

    renderHook(() => useGlobalHotkeys());
    triggerKey("shift+right");

    // totalPages = 1; safePage = min(5, 0) = 0; 0 < 0 is false → setScenePage(0)
    expect(mockUiState.setScenePage).toHaveBeenCalledWith("scene-1", 0);
  });
});
