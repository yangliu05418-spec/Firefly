import { describe, expect, it } from "vitest";
import type { ImageGenerationTask } from "./db.js";
import { accessibleImageGenerationTask, publicImageGenerationTask } from "./image-generation-access.js";

const task: ImageGenerationTask = {
  id: "image-task-1", ownerId: "owner-1", status: "succeeded", model: "unknown-model",
  ratio: "1:1", resolution: "1024", requestedCount: 2, prompt: "a quiet frame",
  referenceUploadIds: ["private-upload-id"], items: [{ index: 0, mediaId: "media-1" }], failures: ["one failed"],
  createdAt: 10, updatedAt: 20, completedAt: 20
};

describe("image generation task access", () => {
  it("returns a task only to its owner", () => {
    expect(accessibleImageGenerationTask(task, "owner-1")).toBe(task);
    expect(accessibleImageGenerationTask(task, "owner-2")).toBeNull();
    expect(accessibleImageGenerationTask(null, "owner-1")).toBeNull();
  });

  it("does not expose owner or reference upload identifiers", () => {
    const result = publicImageGenerationTask(task);
    expect(result.Items).toEqual([{ mediaId: "media-1", width: undefined, height: undefined }]);
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("referenceUploadIds");
  });
});
