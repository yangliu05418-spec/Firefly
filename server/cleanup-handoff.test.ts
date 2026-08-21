import { describe, expect, it, vi } from "vitest";
import { scheduleBestEffort, scheduleTaskCleanup } from "./cleanup-handoff.js";

describe("asynchronous cleanup handoff", () => {
  it("returns immediately even while Redis operations remain unresolved", async () => {
    const never = new Promise<never>(() => undefined);
    const findGenerationJob = vi.fn(() => never);
    const enqueueMediaDeletion = vi.fn(() => never);
    const reportFailure = vi.fn();

    expect(scheduleTaskCleanup("task-1", { findGenerationJob, enqueueMediaDeletion, reportFailure })).toBeUndefined();
    expect(findGenerationJob).toHaveBeenCalledWith("task-1");
    expect(enqueueMediaDeletion).toHaveBeenCalledWith("task-1");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("contains rejected best-effort work instead of creating an unhandled rejection", async () => {
    const reportFailure = vi.fn();
    scheduleBestEffort(() => Promise.reject(new Error("redis offline")), reportFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "redis offline" }));
  });
});
