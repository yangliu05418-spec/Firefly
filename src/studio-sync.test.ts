import { describe, expect, it, vi } from "vitest";
import type { ImageResultBundle, Task } from "./types";
import { createSessionRecoverably, hasActiveStudioWork, isAmbiguousSubmissionFailure, replaceSessionSnapshot, selectSessionSnapshot, upsertStudioItem } from "./studio-sync";

const task = (patch: Partial<Task> = {}): Task => ({
  id: "task-1", sessionId: "session-a", caseId: "task-1", status: "succeeded", mediaStatus: "ready",
  prompt: "", model: "model", mode: "text", ratio: "16:9", resolution: "720p", duration: 5,
  createdAt: 1, updatedAt: 1, ...patch,
});

const image = (patch: Partial<ImageResultBundle> = {}): ImageResultBundle => ({
  id: "image-1", sessionId: "session-a", modelName: "model", ratio: "1:1", resolution: "1K",
  prompt: "", items: [], createdAt: 1, status: "succeeded", ...patch,
});

describe("studio synchronization", () => {
  it("replaces a session snapshot while preserving and sorting other sessions", () => {
    const current = [task({ id: "stale", createdAt: 3 }), task({ id: "other", sessionId: "session-b", createdAt: 2 })];
    const snapshot = [task({ id: "fresh", createdAt: 4 })];
    expect(replaceSessionSnapshot(current, "session-a", snapshot).map((item) => item.id)).toEqual(["fresh", "other"]);
  });

  it("selects an isolated session snapshot and never carries cards from the previous session", () => {
    const snapshot = selectSessionSnapshot(
      [task({ id: "a", sessionId: "session-a" }), task({ id: "b", sessionId: "session-b" })],
      [image({ id: "ia", sessionId: "session-a" }), image({ id: "ib", sessionId: "session-b" })],
      "session-b",
    );
    expect(snapshot.tasks.map((item) => item.id)).toEqual(["b"]);
    expect(snapshot.images.map((item) => item.id)).toEqual(["ib"]);
  });

  it("upserts an optimistic task when the authoritative admission arrives", () => {
    const optimistic = task({ id: "same", status: "queued", updatedAt: 1 });
    const authoritative = task({ id: "same", status: "running", updatedAt: 2 });
    expect(upsertStudioItem([optimistic], authoritative)).toEqual([authoritative]);
  });

  it("treats video generation, TOS archiving and image generation as active work", () => {
    expect(hasActiveStudioWork([task({ status: "running" })], [])).toBe(true);
    expect(hasActiveStudioWork([task({ mediaStatus: "archiving" })], [])).toBe(true);
    expect(hasActiveStudioWork([], [image({ status: "generating" })])).toBe(true);
    expect(hasActiveStudioWork([task()], [image()])).toBe(false);
  });

  it("distinguishes ambiguous transport/server failures from deterministic rejection", () => {
    expect(isAmbiguousSubmissionFailure({ status: 0, code: "CLIENT_TIMEOUT" })).toBe(true);
    expect(isAmbiguousSubmissionFailure({ status: 503 })).toBe(true);
    expect(isAmbiguousSubmissionFailure({ status: 400 })).toBe(false);
    expect(isAmbiguousSubmissionFailure({ status: 429 })).toBe(false);
  });

  it("recovers a committed session after its create response is lost", async () => {
    const recovered = { id: "session-recovered" };
    const read = vi.fn(async () => recovered);
    await expect(createSessionRecoverably(async () => { throw { status: 503 }; }, read)).resolves.toBe(recovered);
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not reconcile a deterministic session rejection", async () => {
    const read = vi.fn();
    await expect(createSessionRecoverably(async () => { throw { status: 400 }; }, read)).rejects.toMatchObject({ status: 400 });
    expect(read).not.toHaveBeenCalled();
  });
});
