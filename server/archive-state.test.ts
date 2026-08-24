import { describe, expect, it } from "vitest";
import { archiveTransferStrategy, shouldRecoverArchiveHandoff } from "./archive-state.js";

describe("generation archive handoff recovery", () => {
  const now = 1_800_000_000_000;

  it("preserves a provider success while its temporary source can still be archived", () => {
    expect(shouldRecoverArchiveHandoff({ sourceVideoUrl: "https://provider.example/video.mp4", sourceVideoExpiresAt: now + 3600_000 }, "tos", now)).toBe(true);
  });

  it("does not reinterpret genuine provider failures or expired sources", () => {
    expect(shouldRecoverArchiveHandoff({}, "tos", now)).toBe(false);
    expect(shouldRecoverArchiveHandoff({ sourceVideoUrl: "https://provider.example/video.mp4", sourceVideoExpiresAt: now + 60_000 }, "tos", now)).toBe(false);
    expect(shouldRecoverArchiveHandoff({ sourceVideoUrl: "https://provider.example/video.mp4", sourceVideoExpiresAt: now + 3600_000 }, "legacy", now)).toBe(false);
  });
});

describe("generation archive transfer strategy", () => {
  it("reuses URL fetch until its cumulative window expires, then resumes multipart", () => {
    expect(archiveTransferStrategy(null)).toBe("url_fetch");
    expect(archiveTransferStrategy({ strategy: "url_fetch", fetchStartedAt: 1_000 }, false, 299_000, 300_000)).toBe("url_fetch");
    expect(archiveTransferStrategy({ strategy: "url_fetch", fetchStartedAt: 1_000 }, false, 301_000, 300_000)).toBe("stream_multipart");
    expect(archiveTransferStrategy({ strategy: "stream_multipart" })).toBe("stream_multipart");
  });

  it("only verifies the deterministic key during stored-object recovery", () => {
    expect(archiveTransferStrategy(null, true)).toBe("existing_object");
    expect(archiveTransferStrategy({ strategy: "stream_multipart" }, true)).toBe("existing_object");
  });
});
