import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { shouldFinalizeJobFailure } from "./job-failure.js";

describe("BullMQ business failure finalization", () => {
  it("finalizes an unrecoverable error on its first and only attempt", () => {
    expect(shouldFinalizeJobFailure(new UnrecoverableError("provider rejected input"), 1, 4)).toBe(true);
  });

  it("also recognizes a serialized unrecoverable error by name", () => {
    const error = new Error("provider rejected input");
    error.name = "UnrecoverableError";
    expect(shouldFinalizeJobFailure(error, 1, 4)).toBe(true);
  });

  it("keeps transient failures running until all attempts are exhausted", () => {
    expect(shouldFinalizeJobFailure(new Error("network timeout"), 1, 4)).toBe(false);
    expect(shouldFinalizeJobFailure(new Error("network timeout"), 3, 4)).toBe(false);
    expect(shouldFinalizeJobFailure(new Error("network timeout"), 4, 4)).toBe(true);
  });
});
