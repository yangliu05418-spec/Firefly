import { describe, expect, it } from "vitest";
import { canCreatePendingAsset, canKeepPreparingReference, REFERENCE_PREPARATION_DEADLINE_MS, UploadReferencePendingError } from "./asset-upload-admission.js";
import type { MediaObject } from "./db.js";

const media = (status: MediaObject["status"], ownerId = "owner-1"): MediaObject => ({ id: "input:upload-1", ownerId, uploadId: "upload-1", kind: "input", objectKey: "inputs/one", status, fileName: "one.png", contentType: "image/png", size: 1, etag: "", createdAt: 1, updatedAt: 1 });

describe("asset upload admission", () => {
  it("admits both transported and fully validated inputs", () => {
    expect(canCreatePendingAsset(media("uploading"), "owner-1")).toBe(true);
    expect(canCreatePendingAsset(media("ready"), "owner-1")).toBe(true);
  });

  it("rejects deleted, missing and cross-user inputs", () => {
    expect(canCreatePendingAsset(media("deleted"), "owner-1")).toBe(false);
    expect(canCreatePendingAsset(media("uploading", "owner-2"), "owner-1")).toBe(false);
    expect(canCreatePendingAsset(null, "owner-1")).toBe(false);
  });

  it("bounds background reference preparation", () => {
    expect(canKeepPreparingReference(1_000, 1_000 + REFERENCE_PREPARATION_DEADLINE_MS - 1)).toBe(true);
    expect(canKeepPreparingReference(1_000, 1_000 + REFERENCE_PREPARATION_DEADLINE_MS)).toBe(false);
    expect(new UploadReferencePendingError("图片.png")).toMatchObject({ code: "UPLOAD_REFERENCE_PENDING", message: "图片.png已上传，正在完成内容校验" });
  });
});
