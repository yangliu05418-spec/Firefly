import { describe, expect, it } from "vitest";
import { imageItemFailureAction, isTerminalImageJobFailure } from "./image-retry.js";

describe("image generation retry decisions", () => {
  it("retries transient failures until the final attempt", () => {
    expect(imageItemFailureAction(Object.assign(new Error("rate limited"), { status: 429 }), false, false)).toBe("retry");
    expect(imageItemFailureAction(Object.assign(new Error("network"), { status: "network" }), false, true)).toBe("partial");
  });

  it("stops deterministic failures while preserving existing partial results", () => {
    const invalid = Object.assign(new Error("invalid request"), { status: 400 });
    expect(imageItemFailureAction(invalid, false, false)).toBe("fail");
    expect(imageItemFailureAction(invalid, true, false)).toBe("partial");
  });

  it("marks unrecoverable failures terminal without waiting for the attempts counter", () => {
    const error = Object.assign(new Error("invalid"), { name: "UnrecoverableError" });
    expect(isTerminalImageJobFailure(error, 1, 3)).toBe(true);
    expect(isTerminalImageJobFailure(new Error("temporary"), 1, 3)).toBe(false);
    expect(isTerminalImageJobFailure(new Error("exhausted"), 3, 3)).toBe(true);
  });
});
