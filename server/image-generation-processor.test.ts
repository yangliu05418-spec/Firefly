import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { ImageGenerationTask, MediaObject } from "./db.js";
import {
  processImageGenerationAttempt,
  shouldFinalizeImageGenerationFailure,
  type ImageGenerationProcessorDependencies,
} from "./image-generation-processor.js";
import { OpenRouterError } from "./openrouter.js";

const taskFixture = (requestedCount = 1): ImageGenerationTask => ({
  id: "image-task-1",
  ownerId: "user-1",
  model: "google/gemini-3.1-flash-lite-image-preview",
  modelName: "Nano Banana 2 Lite",
  ratio: "16:9",
  resolution: "1024",
  prompt: "cinematic firefly",
  requestedCount,
  status: "running",
  items: [],
  failures: [],
  createdAt: 1,
  updatedAt: 1,
});

const mediaFixture = (id: string): MediaObject => ({
  id,
  ownerId: "user-1",
  kind: "generated",
  objectKey: `generated/${id}.png`,
  status: "ready",
  fileName: `${id}.png`,
  contentType: "image/png",
  size: 3,
  etag: "etag",
  createdAt: 1,
  updatedAt: 1,
});

const harness = (initialTask = taskFixture()) => {
  let task: ImageGenerationTask | null = initialTask;
  const generate = vi.fn<ImageGenerationProcessorDependencies["generate"]>();
  const store = vi.fn<ImageGenerationProcessorDependencies["store"]>();
  const discard = vi.fn<ImageGenerationProcessorDependencies["discard"]>();
  const deps: ImageGenerationProcessorDependencies = {
    readTask: () => task,
    readUpload: (() => null) as ImageGenerationProcessorDependencies["readUpload"],
    updateTask: ((id, ownerId, patch) => {
      if (!task || task.id !== id || task.ownerId !== ownerId) return null;
      task = { ...task, ...patch, updatedAt: task.updatedAt + 1 };
      return task;
    }) as ImageGenerationProcessorDependencies["updateTask"],
    signReference: (objectKey) => `https://tos.example/${objectKey}`,
    generate,
    download: vi.fn(async () => Buffer.from("png")),
    store,
    discard,
  };
  return { deps, generate, store, discard, setTask: (next: ImageGenerationTask | null) => { task = next; }, task: () => task };
};

const attempt = (attemptNumber: number, maxAttempts = 3) => ({
  id: "image-task-1",
  attemptNumber,
  maxAttempts,
  data: {
    ownerId: "user-1",
    model: "google/gemini-3.1-flash-lite-image-preview",
    prompt: "cinematic firefly",
    ratio: "16:9",
    resolution: "1024",
    count: 1,
    referenceUploadIds: [],
  },
});

describe("image generation processor", () => {
  it("rethrows transient failures without consuming the image slot", async () => {
    const state = harness();
    state.generate.mockRejectedValue(new OpenRouterError("temporary outage", 503));

    await expect(processImageGenerationAttempt(attempt(1), state.deps)).rejects.toThrow("temporary outage");

    expect(state.task()).toMatchObject({ status: "running", items: [], failures: [] });
    expect(state.store).not.toHaveBeenCalled();
  });

  it("rejects a queue payload that does not belong to the persisted task owner", async () => {
    const state = harness();
    const mismatched = attempt(1);
    mismatched.data.ownerId = "user-2";

    await expect(processImageGenerationAttempt(mismatched, state.deps)).rejects.toThrow("所有者校验失败");
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("resumes from durable checkpoints and does not regenerate completed items", async () => {
    const state = harness({ ...taskFixture(2), items: [{ mediaId: "existing" }] });
    state.generate.mockResolvedValue("data:image/png;base64,cG5n");
    state.store.mockResolvedValue(mediaFixture("generated-2"));

    await processImageGenerationAttempt(attempt(2), state.deps);

    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.task()).toMatchObject({
      status: "succeeded",
      items: [{ mediaId: "existing" }, { mediaId: "generated-2" }],
      failures: [],
    });
  });

  it("records a permanent item error and continues producing the remaining items", async () => {
    const state = harness(taskFixture(2));
    state.generate
      .mockRejectedValueOnce(new OpenRouterError("unsupported input", 400))
      .mockResolvedValueOnce("data:image/png;base64,cG5n");
    state.store.mockResolvedValue(mediaFixture("generated-2"));

    await processImageGenerationAttempt(attempt(1), state.deps);

    expect(state.task()).toMatchObject({
      status: "succeeded",
      items: [{ mediaId: "generated-2" }],
      failures: ["unsupported input"],
    });
  });

  it("preserves partial success when the final retry still fails", async () => {
    const state = harness({ ...taskFixture(2), items: [{ mediaId: "existing" }] });
    state.generate.mockRejectedValue(new OpenRouterError("provider unavailable", 503));

    await processImageGenerationAttempt(attempt(3), state.deps);

    expect(state.task()).toMatchObject({
      status: "succeeded",
      items: [{ mediaId: "existing" }],
      failures: ["provider unavailable"],
    });
  });

  it("marks a just-stored image for deletion when the user removed the task concurrently", async () => {
    const state = harness();
    state.generate.mockResolvedValue("data:image/png;base64,cG5n");
    const media = mediaFixture("orphaned-after-delete");
    state.store.mockImplementation(async () => {
      state.setTask(null);
      return media;
    });

    await processImageGenerationAttempt(attempt(1), state.deps);

    expect(state.discard).toHaveBeenCalledWith(media);
  });

  it("finalizes unrecoverable errors immediately but waits for transient retry exhaustion", () => {
    expect(shouldFinalizeImageGenerationFailure(new UnrecoverableError("bad reference"), 1, 3)).toBe(true);
    expect(shouldFinalizeImageGenerationFailure(new Error("network"), 1, 3)).toBe(false);
    expect(shouldFinalizeImageGenerationFailure(new Error("network"), 3, 3)).toBe(true);
  });
});
