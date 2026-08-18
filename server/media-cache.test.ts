import { describe, expect, it } from "vitest";
import { previewRedirectCacheControl, previewRedirectCacheSeconds } from "./media-cache.js";

describe("preview redirect cache", () => {
  it("reuses one signed TOS URL until five minutes before expiry", () => {
    expect(previewRedirectCacheSeconds(7200)).toBe(6900);
    expect(previewRedirectCacheControl(7200)).toBe("private, max-age=6900, stale-if-error=300");
  });

  it("never returns a negative or unbounded private cache lifetime", () => {
    expect(previewRedirectCacheSeconds(120)).toBe(0);
    expect(previewRedirectCacheSeconds(7 * 24 * 3600)).toBe(24 * 3600);
  });
});
