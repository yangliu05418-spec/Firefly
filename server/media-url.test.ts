import { beforeEach, describe, expect, it, vi } from "vitest";

const { signedObjectUrl } = vi.hoisted(() => ({ signedObjectUrl: vi.fn() }));
vi.mock("./tos.js", () => ({ signedObjectUrl }));
vi.mock("./redis.js", () => ({ redis: { get: vi.fn() } }));

import { resolveUploadMediaUrl } from "./media-url.js";

describe("trusted upload media URLs", () => {
  beforeEach(() => {
    signedObjectUrl.mockReset();
    signedObjectUrl.mockReturnValue("https://tos.example/signed-atlas-export");
  });

  it("signs a verified Atlas export for Provider asset registration", async () => {
    const result = await resolveUploadMediaUrl({
      objectKey: "atlas/exports/ab/user-1/project-1/export-1/result.mp4",
      uploadId: "atlas-export:export-1",
      fileName: "result.mp4",
    });
    expect(result).toBe("https://tos.example/signed-atlas-export");
    expect(signedObjectUrl).toHaveBeenCalledWith(
      "atlas/exports/ab/user-1/project-1/export-1/result.mp4",
      { expires: 86_400, fileName: "result.mp4" },
    );
  });

  it("continues to reject arbitrary object keys", async () => {
    await expect(resolveUploadMediaUrl({ objectKey: "untrusted/private.bin", uploadId: "upload-1", fileName: "private.bin" }))
      .rejects.toThrow(/无法解析/);
    expect(signedObjectUrl).not.toHaveBeenCalled();
  });
});
