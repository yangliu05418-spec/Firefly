import { describe, expect, it } from "vitest";
import type { ImageResultBundle, Task } from "./types";
import { hasActiveStudioWork, replaceSessionSnapshot } from "./studio-sync";

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

  it("treats video generation, TOS archiving and image generation as active work", () => {
    expect(hasActiveStudioWork([task({ status: "running" })], [])).toBe(true);
    expect(hasActiveStudioWork([task({ mediaStatus: "archiving" })], [])).toBe(true);
    expect(hasActiveStudioWork([], [image({ status: "generating" })])).toBe(true);
    expect(hasActiveStudioWork([task()], [image()])).toBe(false);
  });
});
