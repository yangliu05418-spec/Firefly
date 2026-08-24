import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { StoredTask } from "./db.js";
import { providerSubmissionCanRetry, providerSubmissionWasRejected, submitProviderTaskOnce } from "./generation-submission.js";
import { ProviderRequestError, type GenerationInput } from "./provider.js";

const input: GenerationInput = {
  prompt: "雨夜列车", model: "dreamina-seedance-2-5-260628", mode: "text", ratio: "16:9",
  resolution: "720p", duration: 5, generateAudio: true, seed: -1, cameraFixed: false,
  watermark: false, outputFormat: "mp4", assets: [],
};

const task = (status: StoredTask["status"] = "queued"): StoredTask => ({
  id: "task-1", ownerId: "user-1", status, prompt: input.prompt, model: input.model, mode: input.mode,
  ratio: input.ratio, resolution: input.resolution, duration: input.duration, createdAt: 1, updatedAt: 1,
});

describe("non-idempotent provider submission", () => {
  it("persists the submission boundary before create and the provider id immediately after success", async () => {
    const saved: StoredTask[] = [];
    const create = vi.fn(async () => ({ id: "provider-task-1" }));
    const result = await submitProviderTaskOnce(task(), input, { create, save: async (value) => { saved.push(value); }, now: () => saved.length + 10 });

    expect(saved.map((value) => ({ status: value.status, providerId: value.providerId }))).toEqual([
      { status: "submitting", providerId: undefined },
      { status: "running", providerId: "provider-task-1" },
    ]);
    expect(result).toMatchObject({ status: "running", providerId: "provider-task-1" });
  });

  it("never replays a task whose create response may already have been accepted", async () => {
    const create = vi.fn();
    await expect(submitProviderTaskOnce(task("submitting"), input, { create, save: vi.fn() })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an explicit 429 to BullMQ after resetting the durable state to queued", async () => {
    const saved: StoredTask[] = [];
    const error = new ProviderRequestError("rate limited", 429);
    await expect(submitProviderTaskOnce(task(), input, {
      create: vi.fn(async () => { throw error; }), save: async (value) => { saved.push(value); }, now: () => saved.length + 10,
    })).rejects.toBe(error);
    expect(saved.at(-1)?.status).toBe("queued");
    expect(saved.at(-1)?.providerId).toBeUndefined();
  });

  it.each([new ProviderRequestError("bad request", 400), new ProviderRequestError("timeout", "network")])(
    "stops blind replay for rejected or ambiguous creates: $message",
    async (error) => {
      const create = vi.fn(async () => { throw error; });
      await expect(submitProviderTaskOnce(task(), input, { create, save: vi.fn() })).rejects.toBeInstanceOf(UnrecoverableError);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it("only retries explicit throttling and provider 5xx responses", () => {
    expect(providerSubmissionCanRetry(new ProviderRequestError("busy", 429))).toBe(true);
    expect(providerSubmissionCanRetry(new ProviderRequestError("unavailable", 503))).toBe(true);
    expect(providerSubmissionCanRetry(new ProviderRequestError("timeout", "network"))).toBe(false);
    expect(providerSubmissionWasRejected(new ProviderRequestError("bad", 400))).toBe(true);
    expect(providerSubmissionWasRejected(new ProviderRequestError("timeout", 408))).toBe(false);
  });
});
