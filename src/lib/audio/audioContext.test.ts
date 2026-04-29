import { describe, it, expect, vi, beforeEach } from "vitest";

// ── AudioContext mock ─────────────────────────────────────────────────────────

let mockGainValue = 1;
const mockGainNode = {
  get gain() { return { get value() { return mockGainValue; }, set value(v: number) { mockGainValue = v; } }; },
  connect: vi.fn(),
};

function MockAudioContext(this: any) {
  this.createGain = vi.fn(() => mockGainNode);
  this.destination = {};
  this.state = "running";
  this.resume = vi.fn().mockResolvedValue(undefined);
}
vi.stubGlobal("AudioContext", MockAudioContext);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getMasterGain", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockGainValue = 1;
    mockGainNode.connect.mockClear();
  });

  it("initializes master gain to 1.0 by default (no store read)", async () => {
    const { getMasterGain } = await import("./audioContext");
    getMasterGain();
    expect(mockGainValue).toBe(1);
  });

  it("returns the same GainNode instance on repeated calls", async () => {
    const { getMasterGain } = await import("./audioContext");
    const first = getMasterGain();
    const second = getMasterGain();
    expect(first).toBe(second);
  });

  it("connects master gain to the audio context destination exactly once", async () => {
    const { getMasterGain } = await import("./audioContext");
    getMasterGain();
    getMasterGain();
    getMasterGain();
    expect(mockGainNode.connect).toHaveBeenCalledTimes(1);
  });
});

describe("applyMasterVolume", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockGainValue = 1;
  });

  it("sets gain.value to volumePct / 100 after getMasterGain has been called", async () => {
    const { getMasterGain, applyMasterVolume } = await import("./audioContext");
    getMasterGain();
    applyMasterVolume(50);
    expect(mockGainValue).toBe(0.5);
  });

  it("converts 0 → 0.0 gain", async () => {
    const { getMasterGain, applyMasterVolume } = await import("./audioContext");
    getMasterGain();
    applyMasterVolume(0);
    expect(mockGainValue).toBe(0);
  });

  it("converts 100 → 1.0 gain", async () => {
    const { getMasterGain, applyMasterVolume } = await import("./audioContext");
    getMasterGain();
    applyMasterVolume(100);
    expect(mockGainValue).toBe(1);
  });

  it("queues volume before getMasterGain is called and applies it on first construction", async () => {
    const { applyMasterVolume, getMasterGain } = await import("./audioContext");
    applyMasterVolume(50); // masterGain not yet created — queued
    getMasterGain();        // constructs with queued 0.5
    expect(mockGainValue).toBe(0.5);
  });
});

describe("ensureResumed", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("returns the AudioContext when already running", async () => {
    const { ensureResumed, getAudioContext } = await import("./audioContext");
    const ctx = getAudioContext();
    const result = await ensureResumed();
    expect(result).toBe(ctx);
  });
});
