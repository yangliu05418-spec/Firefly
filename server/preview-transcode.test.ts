import { describe, expect, it } from "vitest";
import { isPermanentTosTranscodeFailure } from "./preview-transcode.js";

describe("TOS preview transcode fallback", () => {
  it("classifies missing processing-role permission as permanent for the worker lifetime", () => {
    expect(isPermanentTosTranscodeFailure("assume role access denied")).toBe(true);
    expect(isPermanentTosTranscodeFailure("Assume Role Access Denied (4024)")).toBe(true);
  });

  it("keeps transient control-plane failures eligible for a later retry", () => {
    expect(isPermanentTosTranscodeFailure("request timeout")).toBe(false);
    expect(isPermanentTosTranscodeFailure("service unavailable")).toBe(false);
  });
});
