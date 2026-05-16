import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPad, createMockLayer } from "@/test/factories";

vi.mock("./chainCycleState", () => ({
  deleteLayerChain: vi.fn(),
  deleteLayerCycleIndex: vi.fn(),
  deleteLayerPlayOrder: vi.fn(),
}));

vi.mock("./layerPlaybackContext", () => ({
  clearAllLayerChainFields: vi.fn(),
}));

vi.mock("./voiceRegistry", () => ({
  nullAllOnEnded: vi.fn(),
  nullPadOnEnded: vi.fn(),
  stopPadVoices: vi.fn(),
}));

vi.mock("./fadeCoordinator", () => ({
  clearAllFades: vi.fn(),
}));

vi.mock("./audioTick", () => ({
  stopAudioTick: vi.fn(),
}));

import { stopAllPads, stopPad } from "./stopHandler";
import * as chainCycleState from "./chainCycleState";
import * as layerPlaybackContext from "./layerPlaybackContext";
import * as voiceRegistry from "./voiceRegistry";
import * as fadeCoordinator from "./fadeCoordinator";
import * as audioTick from "./audioTick";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stopHandler", () => {
  describe("stopAllPads", () => {
    it("clears chain and fade state before nullAllOnEnded — prevents onended from restarting chains during ramp", () => {
      const callOrder: string[] = [];
      vi.mocked(fadeCoordinator.clearAllFades).mockImplementation(() => { callOrder.push("clearAllFades"); });
      vi.mocked(layerPlaybackContext.clearAllLayerChainFields).mockImplementation(() => { callOrder.push("clearAllLayerChainFields"); });
      vi.mocked(voiceRegistry.nullAllOnEnded).mockImplementation(() => { callOrder.push("nullAllOnEnded"); });
      vi.mocked(audioTick.stopAudioTick).mockImplementation(() => { callOrder.push("stopAudioTick"); });

      stopAllPads();

      const nullIdx = callOrder.indexOf("nullAllOnEnded");
      expect(callOrder.indexOf("clearAllFades")).toBeLessThan(nullIdx);
      expect(callOrder.indexOf("clearAllLayerChainFields")).toBeLessThan(nullIdx);
    });

    it("calls clearAllFades, clearAllLayerChainFields, nullAllOnEnded, and stopAudioTick", () => {
      stopAllPads();

      expect(fadeCoordinator.clearAllFades).toHaveBeenCalledOnce();
      expect(layerPlaybackContext.clearAllLayerChainFields).toHaveBeenCalledOnce();
      expect(voiceRegistry.nullAllOnEnded).toHaveBeenCalledOnce();
      expect(audioTick.stopAudioTick).toHaveBeenCalledOnce();
    });
  });

  describe("stopPad", () => {
    it("clears all layer chain state before stopPadVoices — prevents onended from restarting chains on voice.stop()", () => {
      const callOrder: string[] = [];
      vi.mocked(chainCycleState.deleteLayerChain).mockImplementation(() => { callOrder.push("deleteLayerChain"); });
      vi.mocked(chainCycleState.deleteLayerCycleIndex).mockImplementation(() => { callOrder.push("deleteLayerCycleIndex"); });
      vi.mocked(chainCycleState.deleteLayerPlayOrder).mockImplementation(() => { callOrder.push("deleteLayerPlayOrder"); });
      vi.mocked(voiceRegistry.nullPadOnEnded).mockImplementation(() => { callOrder.push("nullPadOnEnded"); });
      vi.mocked(voiceRegistry.stopPadVoices).mockImplementation(() => { callOrder.push("stopPadVoices"); });

      const layer1 = createMockLayer({ id: "layer-1" });
      const layer2 = createMockLayer({ id: "layer-2" });
      const pad = createMockPad({ layers: [layer1, layer2] });
      stopPad(pad);

      const stopIdx = callOrder.indexOf("stopPadVoices");
      // All chain clears (including last layer) must precede the voice stop
      expect(callOrder.lastIndexOf("deleteLayerChain")).toBeLessThan(stopIdx);
      expect(callOrder.lastIndexOf("deleteLayerCycleIndex")).toBeLessThan(stopIdx);
      expect(callOrder.lastIndexOf("deleteLayerPlayOrder")).toBeLessThan(stopIdx);
      expect(callOrder.indexOf("nullPadOnEnded")).toBeLessThan(stopIdx);
    });

    it("clears chain state for every layer and stops pad voices once", () => {
      const layer1 = createMockLayer({ id: "layer-1" });
      const layer2 = createMockLayer({ id: "layer-2" });
      const pad = createMockPad({ id: "pad-1", layers: [layer1, layer2] });
      stopPad(pad);

      expect(chainCycleState.deleteLayerChain).toHaveBeenCalledWith("layer-1");
      expect(chainCycleState.deleteLayerChain).toHaveBeenCalledWith("layer-2");
      expect(chainCycleState.deleteLayerCycleIndex).toHaveBeenCalledWith("layer-1");
      expect(chainCycleState.deleteLayerCycleIndex).toHaveBeenCalledWith("layer-2");
      expect(chainCycleState.deleteLayerPlayOrder).toHaveBeenCalledWith("layer-1");
      expect(chainCycleState.deleteLayerPlayOrder).toHaveBeenCalledWith("layer-2");
      expect(voiceRegistry.nullPadOnEnded).toHaveBeenCalledOnce();
      expect(voiceRegistry.nullPadOnEnded).toHaveBeenCalledWith("pad-1");
      expect(voiceRegistry.stopPadVoices).toHaveBeenCalledOnce();
      expect(voiceRegistry.stopPadVoices).toHaveBeenCalledWith("pad-1");
    });

    it("still nulls onended and stops voices for a pad with no layers", () => {
      const pad = createMockPad({ id: "pad-1", layers: [] });
      stopPad(pad);

      expect(chainCycleState.deleteLayerChain).not.toHaveBeenCalled();
      expect(voiceRegistry.nullPadOnEnded).toHaveBeenCalledWith("pad-1");
      expect(voiceRegistry.stopPadVoices).toHaveBeenCalledWith("pad-1");
    });
  });
});
