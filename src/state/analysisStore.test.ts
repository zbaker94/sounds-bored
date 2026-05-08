import { describe, it, expect, beforeEach } from "vitest";
import { useAnalysisStore, initialAnalysisState } from "./analysisStore";

function getState() {
  return useAnalysisStore.getState();
}

function makeQueue(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, path: `/a${i + 1}.wav` }));
}

describe("analysisStore", () => {
  beforeEach(() => {
    useAnalysisStore.setState({ ...initialAnalysisState });
  });

  describe("initial state", () => {
    it("starts idle with zeroed counts", () => {
      expect(getState().status).toBe("idle");
      expect(getState().queueLength).toBe(0);
      expect(getState().completedCount).toBe(0);
      expect(getState().analyzingCount).toBe(0);
      expect(getState().errors).toEqual({});
      expect(getState().currentSoundId).toBeNull();
      expect(getState().pendingQueue).toEqual([]);
      expect([...getState().completedIds]).toEqual([]);
    });
  });

  describe("startAnalysis", () => {
    it("sets status to running and records total count", () => {
      getState().startAnalysis(makeQueue(5));
      expect(getState().status).toBe("running");
      expect(getState().queueLength).toBe(5);
      expect(getState().analyzingCount).toBe(5);
      expect(getState().completedCount).toBe(0);
    });

    it("stores the queue in pendingQueue", () => {
      const queue = makeQueue(3);
      getState().startAnalysis(queue);
      expect(getState().pendingQueue).toEqual(queue);
    });

    it("resets errors and completed count from a prior run", () => {
      useAnalysisStore.setState({ errors: { s1: "bad" }, completedCount: 3 });
      getState().startAnalysis(makeQueue(2));
      expect(getState().errors).toEqual({});
      expect(getState().completedCount).toBe(0);
    });
  });

  describe("recordComplete", () => {
    it("increments completedCount and decrements analyzingCount", () => {
      getState().startAnalysis(makeQueue(3));
      getState().recordComplete("s1");
      expect(getState().completedCount).toBe(1);
      expect(getState().analyzingCount).toBe(2);
      expect(getState().status).toBe("running");
      expect([...getState().completedIds]).toContain("s1");
    });

    it("sets status to completed when all sounds are done", () => {
      getState().startAnalysis(makeQueue(2));
      getState().recordComplete("s1");
      getState().recordComplete("s2");
      expect(getState().status).toBe("completed");
      expect(getState().completedCount).toBe(2);
    });

    it("clears currentSoundId when the last sound completes", () => {
      getState().startAnalysis(makeQueue(1));
      getState().advance();
      getState().recordComplete("s1");
      expect(getState().currentSoundId).toBeNull();
    });
  });

  describe("recordError", () => {
    it("adds to errors map and increments completedCount", () => {
      getState().startAnalysis(makeQueue(3));
      getState().recordError("s1", "decode failed");
      expect(getState().errors).toEqual({ s1: "decode failed" });
      expect(getState().completedCount).toBe(1);
      expect(getState().analyzingCount).toBe(2);
      expect([...getState().completedIds]).toContain("s1");
    });

    it("sets status to completed when all sounds errored", () => {
      getState().startAnalysis(makeQueue(1));
      getState().recordError("s1", "unsupported format");
      expect(getState().status).toBe("completed");
    });

    it("accumulates multiple errors without overwriting", () => {
      getState().startAnalysis(makeQueue(3));
      getState().recordError("s1", "err1");
      getState().recordError("s2", "err2");
      expect(getState().errors).toEqual({ s1: "err1", s2: "err2" });
    });

    it("clears currentSoundId when the last sound errors", () => {
      getState().startAnalysis(makeQueue(1));
      getState().advance();
      getState().recordError("s1", "bad");
      expect(getState().currentSoundId).toBeNull();
    });
  });

  describe("advance", () => {
    it("returns first item, sets currentSoundId, removes from pendingQueue", () => {
      const queue = makeQueue(2);
      getState().startAnalysis(queue);
      const next = getState().advance();
      expect(next).toEqual({ id: "s1", path: "/a1.wav" });
      expect(getState().currentSoundId).toBe("s1");
      expect(getState().pendingQueue).toEqual([{ id: "s2", path: "/a2.wav" }]);
    });

    it("returns undefined when queue is empty", () => {
      expect(getState().advance()).toBeUndefined();
    });

    it("empties the queue after all items are dequeued", () => {
      getState().startAnalysis(makeQueue(1));
      getState().advance();
      expect(getState().pendingQueue).toEqual([]);
      expect(getState().advance()).toBeUndefined();
    });

    it("returns undefined and does not mutate state when idle", () => {
      expect(getState().advance()).toBeUndefined();
      expect(getState().currentSoundId).toBeNull();
      expect(getState().pendingQueue).toEqual([]);
    });

    it("returns undefined and does not mutate state when completed", () => {
      getState().startAnalysis(makeQueue(1));
      getState().advance();
      getState().recordComplete("s1");
      expect(getState().status).toBe("completed");
      const result = getState().advance();
      expect(result).toBeUndefined();
      expect(getState().currentSoundId).toBeNull();
    });
  });

  describe("cancelQueue", () => {
    it("clears pendingQueue and shrinks queueLength to allow progress to reach 100%", () => {
      getState().startAnalysis(makeQueue(5));
      getState().advance(); // s1 dispatched and set as currentSoundId atomically
      getState().recordComplete("s1");
      getState().advance(); // s2 dispatched and set as currentSoundId atomically
      getState().cancelQueue();
      expect(getState().pendingQueue).toEqual([]);
      // queueLength shrinks to completedCount (1) + inFlight (1, because advance() set currentSoundId atomically)
      expect(getState().queueLength).toBe(2);
      expect(getState().analyzingCount).toBe(1);
    });

    it("reaches completed status after the in-flight item finishes post-cancel", () => {
      getState().startAnalysis(makeQueue(3));
      getState().advance();
      getState().recordComplete("s1");
      getState().cancelQueue();
      // simulate the one remaining in-flight sound completing
      getState().recordComplete("s2");
      expect(getState().status).toBe("completed");
      expect(getState().completedCount).toBe(2);
    });

    it("is a no-op when status is idle", () => {
      getState().cancelQueue();
      expect(getState().status).toBe("idle");
      expect(getState().queueLength).toBe(0);
    });

    it("is a no-op when status is completed", () => {
      getState().startAnalysis(makeQueue(1));
      getState().recordComplete("s1");
      expect(getState().status).toBe("completed");
      getState().cancelQueue();
      expect(getState().status).toBe("completed");
    });

    it("works when pendingQueue is already empty (single in-flight item)", () => {
      getState().startAnalysis(makeQueue(1));
      getState().advance(); // s1 dispatched and set as currentSoundId atomically
      expect(getState().pendingQueue).toEqual([]);
      getState().cancelQueue(); // should still update queueLength (currentSoundId is set)
      expect(getState().pendingQueue).toEqual([]);
      expect(getState().queueLength).toBe(1);
      // item completes → reaches completed
      getState().recordComplete("s1");
      expect(getState().status).toBe("completed");
    });

    it("handles cancel followed by recordError for in-flight item", () => {
      getState().startAnalysis(makeQueue(4));
      getState().advance();
      getState().recordComplete("s1");
      getState().cancelQueue();
      getState().recordError("s2", "decode failed");
      expect(getState().status).toBe("completed");
      expect(getState().errors).toEqual({ s2: "decode failed" });
    });
  });

  describe("appendToQueue", () => {
    it("appends entries to pendingQueue and bumps counts when running", () => {
      getState().startAnalysis(makeQueue(2));
      getState().appendToQueue([{ id: "s3", path: "/a3.wav" }]);
      expect(getState().pendingQueue).toContainEqual({ id: "s3", path: "/a3.wav" });
      expect(getState().queueLength).toBe(3);
      expect(getState().analyzingCount).toBe(3);
      expect(getState().status).toBe("running");
    });

    it("deduplicates entries already in pendingQueue", () => {
      getState().startAnalysis(makeQueue(2));
      // s2 is still in pendingQueue
      getState().appendToQueue([{ id: "s2", path: "/a2.wav" }, { id: "s3", path: "/a3.wav" }]);
      expect(getState().queueLength).toBe(3); // only s3 added
      expect(getState().pendingQueue.filter((e) => e.id === "s2")).toHaveLength(1);
    });

    it("deduplicates currentSoundId (in-flight item)", () => {
      getState().startAnalysis(makeQueue(2));
      getState().advance(); // s1 dequeued and set as currentSoundId
      getState().appendToQueue([{ id: "s1", path: "/a1.wav" }]);
      expect(getState().queueLength).toBe(2); // s1 not re-added
    });

    it("deduplicates sounds already in completedIds", () => {
      getState().startAnalysis(makeQueue(2));
      getState().advance(); // s1 in-flight
      getState().recordComplete("s1"); // s1 now in completedIds
      // try to append s1 again
      getState().appendToQueue([{ id: "s1", path: "/a1.wav" }]);
      expect(getState().queueLength).toBe(2); // s1 not re-added
    });

    it("deduplicates sounds in completedIds added via recordError", () => {
      getState().startAnalysis(makeQueue(2));
      getState().advance(); // s1 in-flight
      getState().recordError("s1", "decode failed"); // s1 now in completedIds
      getState().appendToQueue([{ id: "s1", path: "/a1.wav" }]);
      expect(getState().queueLength).toBe(2); // s1 not re-added
    });

    it("is a no-op when status is idle", () => {
      getState().appendToQueue([{ id: "s1", path: "/a1.wav" }]);
      expect(getState().queueLength).toBe(0);
      expect(getState().pendingQueue).toEqual([]);
    });

    it("is a no-op when entries list is empty", () => {
      getState().startAnalysis(makeQueue(2));
      getState().appendToQueue([]);
      expect(getState().queueLength).toBe(2);
    });

    it("is a no-op when status is completed", () => {
      getState().startAnalysis(makeQueue(1));
      getState().recordError("s1", "bad");
      expect(getState().status).toBe("completed");
      const queueBefore = getState().pendingQueue;
      // appendToQueue only operates when running; completed→running transition
      // is handled by startAnalysis (called by enqueueOrStart in library.reconcile)
      getState().appendToQueue([{ id: "s2", path: "/a2.wav" }]);
      expect(getState().status).toBe("completed");
      expect(getState().pendingQueue).toEqual(queueBefore);
    });

    it("preserves the original path when an id collision occurs in dedup", () => {
      getState().startAnalysis([{ id: "s1", path: "/original.wav" }]);
      getState().appendToQueue([{ id: "s1", path: "/new.wav" }]);
      const entry = getState().pendingQueue.find((e) => e.id === "s1");
      expect(entry?.path).toBe("/original.wav");
    });

    it("appended sounds are processed after current queue empties", () => {
      getState().startAnalysis(makeQueue(2));
      getState().appendToQueue([{ id: "s3", path: "/a3.wav" }]);
      getState().recordComplete("s1");
      getState().recordComplete("s2");
      expect(getState().status).toBe("running");
      getState().recordComplete("s3");
      expect(getState().status).toBe("completed");
      expect(getState().completedCount).toBe(3);
    });
  });

  describe("reset", () => {
    it("returns store to initial state", () => {
      getState().startAnalysis(makeQueue(5));
      getState().recordComplete("s1");
      getState().reset();
      expect(getState()).toMatchObject(initialAnalysisState);
      expect([...getState().completedIds]).toEqual([]);
      expect(getState().completedIds).not.toBe(initialAnalysisState.completedIds);
    });
  });
});
