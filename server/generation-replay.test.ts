import { describe, expect, it } from "vitest";
import type { StoredTask } from "./db.js";
import { generationReplayAction } from "./generation-replay.js";

const now = 1_800_000_000_000;
const task = (values: Partial<StoredTask> = {}): StoredTask => ({
  id: "task-1",
  ownerId: "user-1",
  visibility: "private",
  status: "running",
  mediaStatus: "none",
  prompt: "雨夜列车",
  model: "seedance",
  mode: "text",
  ratio: "16:9",
  resolution: "720p",
  duration: 5,
  createdAt: now - 60_000,
  updatedAt: now - 30_000,
  ...values,
});

describe("generation outbox replay", () => {
  it("continues active work", () => {
    expect(generationReplayAction(task(), "tos", now)).toBe("process");
    expect(generationReplayAction(task({ status: "queued" }), "tos", now)).toBe("process");
  });

  it("acknowledges a completed TOS task without regressing it to running", () => {
    expect(generationReplayAction(task({
      status: "succeeded",
      mediaStatus: "ready",
      sourceVideoUrl: "https://provider.test/video.mp4",
      sourceVideoExpiresAt: now + 24 * 3600_000,
    }), "tos", now)).toBe("complete");
  });

  it("repairs only the archive handoff for a generated task", () => {
    expect(generationReplayAction(task({
      status: "succeeded",
      mediaStatus: "archiving",
      sourceVideoUrl: "https://provider.test/video.mp4",
      sourceVideoExpiresAt: now + 24 * 3600_000,
    }), "tos", now)).toBe("archive");
  });

  it("does not revive failed or unrecoverable terminal work", () => {
    expect(generationReplayAction(task({ status: "failed" }), "tos", now)).toBe("complete");
    expect(generationReplayAction(task({
      status: "succeeded",
      mediaStatus: "failed",
      sourceVideoUrl: "https://provider.test/video.mp4",
      sourceVideoExpiresAt: now + 60_000,
    }), "tos", now)).toBe("complete");
  });

  it("does not create a TOS handoff while the legacy backend is active", () => {
    expect(generationReplayAction(task({
      status: "succeeded",
      mediaStatus: "archiving",
      sourceVideoUrl: "https://provider.test/video.mp4",
      sourceVideoExpiresAt: now + 24 * 3600_000,
    }), "legacy", now)).toBe("complete");
  });
});
