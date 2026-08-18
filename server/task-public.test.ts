import { describe, expect, it } from "vitest";
import type { StoredTask } from "./db.js";
import { publicTask } from "./task-public.js";

const makeTask = (mediaStatus: StoredTask["mediaStatus"], overrides: Partial<StoredTask> = {}): StoredTask => ({
  id: "task-1",
  ownerId: "user-1",
  visibility: "private",
  status: "succeeded",
  mediaStatus,
  mediaRevision: 3,
  prompt: "private prompt",
  model: "seedance",
  mode: "text",
  ratio: "16:9",
  resolution: "720p",
  duration: 5,
  sourceVideoUrl: "https://provider.example/temporary.mp4?secret=1",
  sourceVideoExpiresAt: Date.now() + 86_400_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides
});

describe("publicTask media exposure", () => {
  it("exposes the upstream temporary source while TOS is archiving (playable but non-final)", () => {
    const task = publicTask(makeTask("archiving"));

    expect(task.videoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(task.videoExpiresAt).toBeGreaterThan(Date.now());
    expect(task.mediaSource).toBe("upstream");
    expect(task.downloadUrl).toBeUndefined();
    expect(task.posterUrl).toBeUndefined();
    expect(task).not.toHaveProperty("sourceVideoUrl");
    expect(task).not.toHaveProperty("sourceVideoExpiresAt");
  });

  it("keeps the temporary source visible in fallback and archive-failed states", () => {
    expect(publicTask(makeTask("fallback")).videoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(publicTask(makeTask("failed")).videoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(publicTask(makeTask("failed")).mediaSource).toBe("upstream");
    expect(publicTask(makeTask("failed")).downloadUrl).toBeUndefined();
  });

  it("hides the temporary source once it expired", () => {
    const task = publicTask(makeTask("archiving", { sourceVideoExpiresAt: Date.now() - 1000 }));
    expect(task.videoUrl).toBeUndefined();
    expect(task.videoExpiresAt).toBeUndefined();
    expect(task.mediaSource).toBeUndefined();
  });

  it("only exposes stable Firefly routes after TOS verification", () => {
    const task = publicTask(makeTask("ready"));

    expect(task.caseId).toBe("task-1");
    expect(task.videoUrl).toBe("/api/generations/task-1/media?rev=3");
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterUrl).toBe("/api/generations/task-1/poster?rev=3");
    expect(task.mediaSource).toBe("tos");
    expect(task.videoExpiresAt).toBeUndefined();
  });

  it("never exposes media for non-succeeded tasks", () => {
    const task = publicTask(makeTask("ready", { status: "running" }));
    expect(task.videoUrl).toBeUndefined();
    expect(task.downloadUrl).toBeUndefined();
    expect(task.posterUrl).toBeUndefined();
  });
});
