import { describe, expect, it, vi } from "vitest";
import { applyDownloadResponseHeaders, temporaryDownloadTarget, temporaryOriginalStatus } from "./download-contract.js";

describe("generation download contract", () => {
  it("requires an explicit unexpired provider lease", () => {
    const now = 10_000;
    expect(temporaryOriginalStatus({ status: "succeeded", sourceVideoUrl: "https://provider.test/a", sourceVideoExpiresAt: now + 1 }, now)).toBe("ready");
    expect(temporaryOriginalStatus({ status: "succeeded", sourceVideoUrl: "https://provider.test/a", sourceVideoExpiresAt: now }, now)).toBe("expired");
    expect(temporaryOriginalStatus({ status: "succeeded", sourceVideoUrl: "https://provider.test/a" }, now)).toBe("unavailable");
    expect(temporaryOriginalStatus({ status: "running", sourceVideoUrl: "https://provider.test/a", sourceVideoExpiresAt: now + 1 }, now)).toBe("unavailable");
  });

  it("makes every download decision non-cacheable", () => {
    const setHeader = vi.fn();
    applyDownloadResponseHeaders({ setHeader });
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(setHeader).toHaveBeenCalledWith("Vary", "Cookie");
  });

  it("upgrades stale temporary links to the stable TOS original", () => {
    const task = { status: "succeeded" as const, sourceVideoUrl: "https://provider.test/a", sourceVideoExpiresAt: 20_000 };
    expect(temporaryDownloadTarget(task, true, 10_000)).toBe("tos_original");
    expect(temporaryDownloadTarget(task, false, 10_000)).toBe("temporary_original");
    expect(temporaryDownloadTarget(task, false, 30_000)).toBeNull();
  });
});
