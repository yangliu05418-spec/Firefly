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
  it("tries TOS URL fetch once, then falls back to bounded streaming uploads", () => {
    expect(archiveTransferStrategy(1)).toBe("url_fetch");
    expect(archiveTransferStrategy(2)).toBe("stream_multipart");
    expect(archiveTransferStrategy(4)).toBe("stream_multipart");
  });

  it("only verifies the deterministic key during stored-object recovery", () => {
    expect(archiveTransferStrategy(1, true)).toBe("existing_object");
    expect(archiveTransferStrategy(2, true)).toBe("existing_object");
  });
});
