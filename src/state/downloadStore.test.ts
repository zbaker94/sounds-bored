import { describe, it, expect, beforeEach } from "vitest";
import { useDownloadStore, initialDownloadState } from "./downloadStore";
import type { DownloadJobUpdate } from "./downloadStore";
import type { DownloadJob } from "@/lib/schemas";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueuedJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    url: "https://example.com/audio",
    outputName: "My Track",
    status: "queued",
    percent: 0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("downloadStore", () => {
  beforeEach(() => {
    useDownloadStore.setState({ ...initialDownloadState });
  });

  // ── addJob ──────────────────────────────────────────────────────────────────

  describe("addJob", () => {
    it("adds a job to the store", () => {
      const job = makeQueuedJob();
      useDownloadStore.getState().addJob(job);
      expect(useDownloadStore.getState().jobs["job-1"]).toEqual(job);
    });

    it("overwrites an existing job with the same id", () => {
      const job = makeQueuedJob({ percent: 0 });
      useDownloadStore.getState().addJob(job);
      useDownloadStore.getState().addJob({ ...job, percent: 50 });
      expect(useDownloadStore.getState().jobs["job-1"].percent).toBe(50);
    });
  });

  // ── updateJob — downloading ─────────────────────────────────────────────────

  describe("updateJob — downloading", () => {
    it("transitions queued → downloading with percent", () => {
      useDownloadStore.getState().addJob(makeQueuedJob());
      const update: DownloadJobUpdate = { status: "downloading", percent: 25 };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.status).toBe("downloading");
      expect(job.percent).toBe(25);
    });

    it("sets optional speed and eta when provided", () => {
      useDownloadStore.getState().addJob(makeQueuedJob());
      const update: DownloadJobUpdate = { status: "downloading", percent: 50, speed: "1.2 MiB/s", eta: "00:30" };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.speed).toBe("1.2 MiB/s");
      expect(job.eta).toBe("00:30");
    });
  });

  // ── updateJob — processing ──────────────────────────────────────────────────

  describe("updateJob — processing", () => {
    it("transitions downloading → processing with percent", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 99 }));
      const update: DownloadJobUpdate = { status: "processing", percent: 99 };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.status).toBe("processing");
      expect(job.percent).toBe(99);
    });
  });

  // ── updateJob — completed ───────────────────────────────────────────────────

  describe("updateJob — completed", () => {
    it("transitions to completed with required outputPath", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 100 }));
      const update: DownloadJobUpdate = { status: "completed", percent: 100, outputPath: "/sounds/track.mp3" };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.status).toBe("completed");
      expect(job.outputPath).toBe("/sounds/track.mp3");
      expect(job.percent).toBe(100);
    });

    it("clears speed and eta on transition to completed", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 100, speed: "1 MiB/s", eta: "00:01" }));
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "/sounds/track.mp3" });
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.speed).toBeUndefined();
      expect(job.eta).toBeUndefined();
    });
  });

  // ── updateJob — failed ──────────────────────────────────────────────────────

  describe("updateJob — failed", () => {
    it("transitions to failed with required error message", () => {
      useDownloadStore.getState().addJob(makeQueuedJob());
      const update: DownloadJobUpdate = { status: "failed", error: "Network timeout" };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.status).toBe("failed");
      expect(job.error).toBe("Network timeout");
    });

    it("clears speed and eta on transition to failed", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 50, speed: "1 MiB/s", eta: "00:30" }));
      useDownloadStore.getState().updateJob("job-1", { status: "failed", error: "boom" });
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.speed).toBeUndefined();
      expect(job.eta).toBeUndefined();
    });
  });

  // ── updateJob — cancelled ───────────────────────────────────────────────────

  describe("updateJob — cancelled", () => {
    it("transitions to cancelled", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 30 }));
      const update: DownloadJobUpdate = { status: "cancelled" };
      useDownloadStore.getState().updateJob("job-1", update);
      expect(useDownloadStore.getState().jobs["job-1"].status).toBe("cancelled");
    });

    it("clears speed and eta on transition to cancelled", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "downloading", percent: 30, speed: "500 KiB/s", eta: "01:00" }));
      useDownloadStore.getState().updateJob("job-1", { status: "cancelled" });
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.speed).toBeUndefined();
      expect(job.eta).toBeUndefined();
    });
  });

  // ── updateJob — soundId ─────────────────────────────────────────────────────

  describe("updateJob — soundId (no status change)", () => {
    it("sets soundId without changing status on a completed job", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "completed", outputPath: "/sounds/track.mp3", percent: 100 }));
      const update: DownloadJobUpdate = { soundId: "sound-abc" };
      useDownloadStore.getState().updateJob("job-1", update);
      const job = useDownloadStore.getState().jobs["job-1"];
      expect(job.soundId).toBe("sound-abc");
      expect(job.status).toBe("completed"); // unchanged
    });
  });

  // ── updateJob — terminal state guard ───────────────────────────────────────

  describe("updateJob — terminal state guard", () => {
    it("ignores a status update when the job is already completed", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "completed", outputPath: "/sounds/track.mp3", percent: 100 }));
      useDownloadStore.getState().updateJob("job-1", { status: "downloading", percent: 50 });
      expect(useDownloadStore.getState().jobs["job-1"].status).toBe("completed");
    });

    it("ignores a status update when the job is already failed", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "failed", error: "Network error" }));
      useDownloadStore.getState().updateJob("job-1", { status: "downloading", percent: 50 });
      expect(useDownloadStore.getState().jobs["job-1"].status).toBe("failed");
    });

    it("ignores a status update when the job is already cancelled", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "cancelled" }));
      useDownloadStore.getState().updateJob("job-1", { status: "completed", percent: 100, outputPath: "/sounds/track.mp3" });
      expect(useDownloadStore.getState().jobs["job-1"].status).toBe("cancelled");
    });

    it("allows soundId update on a completed job despite terminal status", () => {
      useDownloadStore.getState().addJob(makeQueuedJob({ status: "completed", outputPath: "/sounds/track.mp3", percent: 100 }));
      useDownloadStore.getState().updateJob("job-1", { soundId: "sound-xyz" });
      expect(useDownloadStore.getState().jobs["job-1"].soundId).toBe("sound-xyz");
    });
  });

  // ── updateJob — no-op for unknown id ───────────────────────────────────────

  describe("updateJob — unknown id", () => {
    it("is a no-op for an unknown job id", () => {
      const update: DownloadJobUpdate = { status: "cancelled" };
      expect(() => useDownloadStore.getState().updateJob("nonexistent", update)).not.toThrow();
      expect(useDownloadStore.getState().jobs["nonexistent"]).toBeUndefined();
    });
  });

  // ── updateJob — type contract ───────────────────────────────────────────────

  describe("updateJob — type contract", () => {
    it("type: completed requires outputPath", () => {
      // @ts-expect-error — outputPath is required for 'completed'
      const u: DownloadJobUpdate = { status: "completed" };
      expect(u).toBeDefined();
    });

    it("type: failed requires error", () => {
      // @ts-expect-error — error is required for 'failed'
      const u: DownloadJobUpdate = { status: "failed" };
      expect(u).toBeDefined();
    });

    it("type: downloading requires percent", () => {
      // @ts-expect-error — percent is required for 'downloading'
      const u: DownloadJobUpdate = { status: "downloading" };
      expect(u).toBeDefined();
    });

    it("type: processing requires percent", () => {
      // @ts-expect-error — percent is required for 'processing'
      const u: DownloadJobUpdate = { status: "processing" };
      expect(u).toBeDefined();
    });
  });

  // ── removeJob ───────────────────────────────────────────────────────────────

  describe("removeJob", () => {
    it("removes the job from the store", () => {
      useDownloadStore.getState().addJob(makeQueuedJob());
      useDownloadStore.getState().removeJob("job-1");
      expect(useDownloadStore.getState().jobs["job-1"]).toBeUndefined();
    });

    it("is a no-op for an unknown id", () => {
      expect(() => useDownloadStore.getState().removeJob("nonexistent")).not.toThrow();
    });
  });
});
