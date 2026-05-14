import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  register,
  dispose,
  clearAll,
  isPadStreaming,
  getStreamingElement,
  getBestForPad,
  iterateBestLayers,
  hasAnyStreamingPad,
  hasAnyStreamingLayer,
} from "./streamingAudioLifecycle";

function makeAudio(duration: number, currentTime = 0): HTMLAudioElement {
  const listeners = new Map<string, Array<(e: Event) => void>>();
  return {
    duration,
    currentTime,
    addEventListener: vi.fn((event: string, cb: (e: Event) => void, options?: AddEventListenerOptions | boolean) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      const signal = typeof options === 'object' ? options?.signal : undefined;
      if (signal) {
        signal.addEventListener('abort', () => {
          const current = listeners.get(event);
          if (current) {
            const idx = current.indexOf(cb);
            if (idx >= 0) current.splice(idx, 1);
          }
        }, { once: true });
      }
    }),
    dispatchEvent: vi.fn((e: Event) => {
      for (const cb of (listeners.get(e.type) ?? []).slice()) cb(e);
      return true;
    }),
  } as unknown as HTMLAudioElement;
}

beforeEach(() => {
  clearAll();
});

describe("streaming audio best-element cache", () => {
  it("register populates pad cache with the registered element", () => {
    const el = makeAudio(10);
    register("pad-1", "layer-1", el);
    expect(getBestForPad("pad-1")).toBe(el);
  });

  it("register populates layer cache with the registered element", () => {
    const el = makeAudio(10);
    register("pad-1", "layer-1", el);
    expect(getStreamingElement("pad-1", "layer-1")).toBe(el);
  });

  it("pad cache picks the element with the longest finite duration", () => {
    const short = makeAudio(5);
    const long = makeAudio(20);
    register("pad-1", "layer-1", short);
    register("pad-1", "layer-2", long);
    expect(getBestForPad("pad-1")).toBe(long);
  });

  it("layer cache picks the element with the longest finite duration within that layer", () => {
    const el1 = makeAudio(5);
    const el2 = makeAudio(15);
    register("pad-1", "layer-1", el1);
    register("pad-1", "layer-1", el2);
    expect(getStreamingElement("pad-1", "layer-1")).toBe(el2);
  });

  it("element with NaN duration is set as best only when it is the sole element", () => {
    const nanEl = makeAudio(NaN);
    register("pad-1", "layer-1", nanEl);
    expect(getBestForPad("pad-1")).toBe(nanEl);
  });

  it("element with finite duration wins over element with NaN duration", () => {
    const nanEl = makeAudio(NaN);
    const finiteEl = makeAudio(10);
    register("pad-1", "layer-1", nanEl);
    register("pad-1", "layer-2", finiteEl);
    expect(getBestForPad("pad-1")).toBe(finiteEl);
  });

  it("dispose updates pad cache when the best element is removed", () => {
    const short = makeAudio(5);
    const long = makeAudio(20);
    register("pad-1", "layer-1", short);
    register("pad-1", "layer-2", long);
    dispose("pad-1", "layer-2", long);
    expect(getBestForPad("pad-1")).toBe(short);
  });

  it("dispose clears pad cache when the last element is removed", () => {
    const el = makeAudio(10);
    register("pad-1", "layer-1", el);
    dispose("pad-1", "layer-1", el);
    expect(getBestForPad("pad-1")).toBeUndefined();
  });

  it("dispose updates layer cache when the best element is removed", () => {
    const el1 = makeAudio(5);
    const el2 = makeAudio(20);
    register("pad-1", "layer-1", el1);
    register("pad-1", "layer-1", el2);
    dispose("pad-1", "layer-1", el2);
    expect(getStreamingElement("pad-1", "layer-1")).toBe(el1);
  });

  it("dispose without el removes the layer's entry from the layer cache", () => {
    register("pad-1", "layer-1", makeAudio(10));
    dispose("pad-1", "layer-1");
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
  });

  it("dispose without el updates the pad cache to exclude the cleared layer", () => {
    const el1 = makeAudio(10);
    const el2 = makeAudio(20);
    register("pad-1", "layer-1", el1);
    register("pad-1", "layer-2", el2);
    dispose("pad-1", "layer-2");
    expect(getBestForPad("pad-1")).toBe(el1);
  });

  it("clearAll clears both caches", () => {
    register("pad-1", "layer-1", makeAudio(10));
    register("pad-2", "layer-2", makeAudio(15));
    clearAll();
    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(getBestForPad("pad-2")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
    expect(getStreamingElement("pad-2", "layer-2")).toBeUndefined();
  });
});

describe("register — loadedmetadata listener lifecycle", () => {
  it("loadedmetadata listener is a no-op after the element is unregistered", () => {
    const el = makeAudio(NaN);
    register("pad-1", "layer-1", el);
    dispose("pad-1", "layer-1", el);

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
  });

  it("late loadedmetadata does not displace a new element registered after unregister", () => {
    const staleEl = makeAudio(NaN);
    const freshEl = makeAudio(5);
    register("pad-1", "layer-1", staleEl);
    dispose("pad-1", "layer-1", staleEl);
    register("pad-1", "layer-1", freshEl);

    Object.defineProperty(staleEl, "duration", { value: 20, configurable: true });
    (staleEl as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBe(freshEl);
    expect(getStreamingElement("pad-1", "layer-1")).toBe(freshEl);
  });

  it("loadedmetadata listener updates cache when element is still registered", () => {
    const el1 = makeAudio(NaN);
    const el2 = makeAudio(NaN);
    register("pad-1", "layer-1", el1);
    register("pad-1", "layer-2", el2);

    Object.defineProperty(el2, "duration", { value: 20, configurable: true });
    (el2 as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBe(el2);
  });

  it("pending listener is removed from element when dispose with el is called before loadedmetadata fires", () => {
    const el = makeAudio(NaN);
    register("pad-1", "layer-1", el);
    dispose("pad-1", "layer-1", el);

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
  });

  it("pending listener is removed from element when dispose without el is called before loadedmetadata fires", () => {
    const el = makeAudio(NaN);
    register("pad-1", "layer-1", el);
    dispose("pad-1", "layer-1");

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
  });

  it("aborting one layer's listener does not remove another active layer's listener on the same element", () => {
    const el = makeAudio(NaN);
    register("pad-1", "layer-1", el);
    register("pad-2", "layer-2", el);

    dispose("pad-1", "layer-1", el);

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-2")).toBe(el);
    expect(getStreamingElement("pad-2", "layer-2")).toBe(el);
  });

  it("re-registering the same element before metadata fires aborts the previous listener", () => {
    const el = makeAudio(NaN);
    register("pad-1", "layer-1", el);
    register("pad-1", "layer-1", el);
    dispose("pad-1", "layer-1");

    Object.defineProperty(el, "duration", { value: 10, configurable: true });
    (el as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new Event("loadedmetadata"));

    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
  });
});

describe("dispose without el — multi-element layer", () => {
  it("removes all elements registered to a layer when called without el", () => {
    const el1 = makeAudio(10);
    const el2 = makeAudio(15);
    register("pad-1", "layer-1", el1);
    register("pad-1", "layer-1", el2);
    dispose("pad-1", "layer-1");
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
    expect(getBestForPad("pad-1")).toBeUndefined();
  });
});

describe("clearAll — multi-pad", () => {
  it("removes elements across multiple pads and layers", () => {
    const el1 = makeAudio(10);
    const el2 = makeAudio(15);
    register("pad-1", "layer-1", el1);
    register("pad-2", "layer-2", el2);
    clearAll();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(isPadStreaming("pad-1")).toBe(false);
    expect(isPadStreaming("pad-2")).toBe(false);
  });

  it("clears all layers on the same pad", () => {
    register("pad-1", "layer-1", makeAudio(10));
    register("pad-1", "layer-2", makeAudio(20));
    clearAll();
    expect(getStreamingElement("pad-1", "layer-1")).toBeUndefined();
    expect(getStreamingElement("pad-1", "layer-2")).toBeUndefined();
    expect(getBestForPad("pad-1")).toBeUndefined();
    expect(isPadStreaming("pad-1")).toBe(false);
  });
});

describe("getStreamingElement", () => {
  it("returns undefined for pad/layer with no registered elements", () => {
    expect(getStreamingElement("missing-pad", "missing-layer")).toBeUndefined();
  });
});

describe("iterateBestLayers", () => {
  it("yields [layerId, element] pairs for all registered layers", () => {
    const el1 = makeAudio(10);
    const el2 = makeAudio(20);
    register("pad-1", "layer-1", el1);
    register("pad-2", "layer-2", el2);
    const entries = [...iterateBestLayers()];
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(["layer-1", el1]);
    expect(entries).toContainEqual(["layer-2", el2]);
  });

  it("yields nothing after clearAll", () => {
    register("pad-1", "layer-1", makeAudio(10));
    clearAll();
    expect([...iterateBestLayers()]).toHaveLength(0);
  });
});

describe("isPadStreaming", () => {
  it("reflects current state across register and dispose", () => {
    const el = makeAudio(10);
    expect(isPadStreaming("pad-1")).toBe(false);
    register("pad-1", "layer-1", el);
    expect(isPadStreaming("pad-1")).toBe(true);
    dispose("pad-1", "layer-1", el);
    expect(isPadStreaming("pad-1")).toBe(false);
  });

  it("returns false for unknown pads", () => {
    expect(isPadStreaming("never-registered")).toBe(false);
  });
});

describe("hasAnyStreamingPad / hasAnyStreamingLayer", () => {
  it("both return false when nothing is registered", () => {
    expect(hasAnyStreamingPad()).toBe(false);
    expect(hasAnyStreamingLayer()).toBe(false);
  });

  it("hasAnyStreamingPad returns true after register, false after last element is disposed", () => {
    const el = makeAudio(10);
    register("pad-1", "layer-1", el);
    expect(hasAnyStreamingPad()).toBe(true);

    dispose("pad-1", "layer-1", el);
    expect(hasAnyStreamingPad()).toBe(false);
  });

  it("hasAnyStreamingLayer returns true after register, false after last element is disposed", () => {
    const el = makeAudio(10);
    register("pad-1", "layer-1", el);
    expect(hasAnyStreamingLayer()).toBe(true);

    dispose("pad-1", "layer-1", el);
    expect(hasAnyStreamingLayer()).toBe(false);
  });

  it("both return false after clearAll", () => {
    register("pad-1", "layer-1", makeAudio(10));
    register("pad-2", "layer-2", makeAudio(5));
    expect(hasAnyStreamingPad()).toBe(true);
    expect(hasAnyStreamingLayer()).toBe(true);

    clearAll();
    expect(hasAnyStreamingPad()).toBe(false);
    expect(hasAnyStreamingLayer()).toBe(false);
  });

  it("hasAnyStreamingPad stays true when one of two pads is disposed", () => {
    register("pad-1", "layer-1", makeAudio(10));
    const el2 = makeAudio(5);
    register("pad-2", "layer-2", el2);
    dispose("pad-2", "layer-2", el2);
    expect(hasAnyStreamingPad()).toBe(true);
  });

  it("hasAnyStreamingLayer stays true when one of two layers is disposed", () => {
    register("pad-1", "layer-1", makeAudio(10));
    const el2 = makeAudio(5);
    register("pad-1", "layer-2", el2);
    dispose("pad-1", "layer-2", el2);
    expect(hasAnyStreamingLayer()).toBe(true);
  });

  it("sentinels stay true when one layer is fully disposed via whole-layer overload (no el)", () => {
    register("pad-1", "layer-1", makeAudio(10));
    register("pad-1", "layer-2", makeAudio(5));
    dispose("pad-1", "layer-2"); // whole-layer overload — different cache update path
    expect(hasAnyStreamingLayer()).toBe(true);
    expect(hasAnyStreamingPad()).toBe(true);
  });
});
