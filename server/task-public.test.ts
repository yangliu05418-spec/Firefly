import { describe, expect, it } from "vitest";
import type { StoredTask } from "./db.js";
import { publicTask } from "./task-public.js";

const makeTask = (mediaStatus: StoredTask["mediaStatus"]): StoredTask => ({
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
  updatedAt: Date.now()
});

describe("publicTask media exposure", () => {
  it("never exposes the provider URL while TOS is still archiving", () => {
    const task = publicTask(makeTask("archiving"));

    expect(task.videoUrl).toBeUndefined();
    expect(task.downloadUrl).toBeUndefined();
    expect(task.posterUrl).toBeUndefined();
    expect(task).not.toHaveProperty("sourceVideoUrl");
    expect(task).not.toHaveProperty("sourceVideoExpiresAt");
  });

  it("only exposes stable Firefly routes after TOS verification", () => {
    const task = publicTask(makeTask("ready"));

    expect(task.caseId).toBe("task-1");
    expect(task.videoUrl).toBe("/api/generations/task-1/media?rev=3");
    expect(task.downloadUrl).toBe("/api/generations/task-1/download?rev=3");
    expect(task.posterUrl).toBe("/api/generations/task-1/poster?rev=3");
  });
});
