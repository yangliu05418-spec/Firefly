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
  it("never makes the upstream source the default while TOS is archiving", () => {
    const task = publicTask(makeTask("archiving"));

    expect(task.videoUrl).toBeUndefined();
    expect(task.temporaryVideoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(task.temporaryVideoExpiresAt).toBeGreaterThan(Date.now());
    expect(task.mediaSource).toBeUndefined();
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterUrl).toBeUndefined();
    expect(task.posterStatus).toBe("processing");
    expect(task).not.toHaveProperty("sourceVideoUrl");
    expect(task).not.toHaveProperty("sourceVideoExpiresAt");
  });

  it("keeps the temporary source separate in fallback and archive-failed states", () => {
    expect(publicTask(makeTask("fallback")).temporaryVideoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(publicTask(makeTask("failed")).temporaryVideoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(publicTask(makeTask("failed")).videoUrl).toBeUndefined();
    expect(publicTask(makeTask("failed")).mediaSource).toBeUndefined();
    expect(publicTask(makeTask("failed")).downloadUrl).toBe("/api/generations/task-1/download?rev=3");
  });

  it("hides the temporary source once it expired", () => {
    const task = publicTask(makeTask("archiving", { sourceVideoExpiresAt: Date.now() - 1000 }));
    expect(task.videoUrl).toBeUndefined();
    expect(task.temporaryVideoUrl).toBeUndefined();
    expect(task.temporaryVideoExpiresAt).toBeUndefined();
    expect(task.mediaSource).toBeUndefined();
    expect(task.downloadUrl).toBeUndefined();
  });

  it("only exposes stable Firefly routes after TOS verification", () => {
    const task = publicTask(makeTask("ready"), { stablePosterReady: true });

    expect(task.caseId).toBe("task-1");
    expect(task.videoUrl).toBe("/api/generations/task-1/media?rev=3");
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterUrl).toBe("/api/generations/task-1/poster?rev=3");
    expect(task.posterStatus).toBe("ready");
    expect(task.mediaSource).toBe("tos");
    expect(task.temporaryVideoUrl).toBeUndefined();
  });

  it("keeps a database-ready original behind the archive state until its output object is verified", () => {
    const task = publicTask(makeTask("ready"), { stableOutputReady: false });

    expect(task.mediaStatus).toBe("archiving");
    expect(task.videoUrl).toBeUndefined();
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterUrl).toBeUndefined();
    expect(task.posterStatus).toBe("processing");
    expect(task.temporaryVideoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
    expect(task.mediaSource).toBeUndefined();
  });

  it("opens a browser-compatible TOS preview while the original is still archiving", () => {
    const task = publicTask(makeTask("archiving"), { stableOutputReady: false, stablePreviewReady: true, outputIsPreview: false });

    expect(task.mediaStatus).toBe("archiving");
    expect(task.videoUrl).toBe("/api/generations/task-1/media?rev=3");
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.temporaryVideoUrl).toBeUndefined();
    expect(task.mediaSource).toBe("tos");
  });

  it("opens the verified original for download without waiting for a separate streaming preview", () => {
    const task = publicTask(makeTask("ready"), { stableOutputReady: true, stablePreviewReady: false, outputIsPreview: false });

    expect(task.mediaStatus).toBe("ready");
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.videoUrl).toBeUndefined();
    expect(task.temporaryVideoUrl).toBe("https://provider.example/temporary.mp4?secret=1");
  });

  it("never exposes media for non-succeeded tasks", () => {
    const task = publicTask(makeTask("ready", { status: "running" }));
    expect(task.videoUrl).toBeUndefined();
    expect(task.downloadUrl).toBeUndefined();
    expect(task.posterUrl).toBeUndefined();
    expect(task.posterStatus).toBe("unavailable");
    expect(task.temporaryVideoUrl).toBeUndefined();
  });

  it("does not advertise a poster route until the poster object is verified", () => {
    const task = publicTask(makeTask("ready"), { stableOutputReady: true, stablePosterReady: false });

    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterStatus).toBe("processing");
    expect(task.posterUrl).toBeUndefined();
  });
});
