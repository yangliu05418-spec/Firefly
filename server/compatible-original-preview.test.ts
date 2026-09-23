import { beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "./store.js";
import { tos, verifyStoredObject, deleteObject } from "./tos.js";
import { probePreviewSource } from "./preview-integrity.js";
import { exposeCompatibleOriginalPreview } from "./compatible-original-preview.js";

vi.mock("./store.js", () => ({ users: { readTaskMedia: vi.fn(), commitOriginalPreviewIfMissing: vi.fn() } }));
vi.mock("./tos.js", () => ({
  tos: { copyObject: vi.fn() }, verifyStoredObject: vi.fn(), deleteObject: vi.fn(),
  signedObjectUrl: vi.fn(() => "https://tos.test/original"), previewObjectKey: vi.fn(() => "previews/user/task/preview.mp4"),
}));
vi.mock("./preview-integrity.js", async (actual) => ({ ...await actual<object>(), probePreviewSource: vi.fn() }));
const original = { id: "task:output", ownerId: "owner", taskId: "task", contentType: "video/mp4", objectKey: "outputs/original.mp4", size: 1000 };
const source = { duration: 30, codec: "h264", pixelFormat: "yuv420p", width: 720, height: 1280, bitrate: 10_000_000, audioCodecs: ["aac"] };

describe("TOS compatible-original preview admission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(users.readTaskMedia).mockImplementation((_id, kind) => kind === "output" ? original as never : null);
    vi.mocked(users.commitOriginalPreviewIfMissing).mockReturnValue({ mediaRevision: 2 } as never);
    vi.mocked(probePreviewSource).mockResolvedValue(source);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(verifyStoredObject).mockResolvedValue({ data: { contentLength: 1000, etag: "copy-etag" }, headers: {} } as never);
  });
  it("uses server-side Copy only, validates Range and size, then atomically publishes", async () => {
    expect(await exposeCompatibleOriginalPreview("task")).toBe(true);
    expect(tos.copyObject).toHaveBeenCalledWith(expect.objectContaining({ key: "previews/user/task/compatible-original.mp4", srcKey: original.objectKey, forbidOverwrite: true }));
    expect(verifyStoredObject).toHaveBeenCalledTimes(2);
    expect(users.commitOriginalPreviewIfMissing).toHaveBeenCalledWith("task", expect.objectContaining({ id: "task:preview-original", objectKey: "previews/user/task/compatible-original.mp4", etag: "copy-etag", kind: "preview" }));
  });
  it("never exposes an unsupported HEVC original", async () => {
    vi.mocked(probePreviewSource).mockResolvedValue({ ...source, codec: "hevc" });
    expect(await exposeCompatibleOriginalPreview("task")).toBe(false);
    expect(tos.copyObject).not.toHaveBeenCalled();
    expect(users.commitOriginalPreviewIfMissing).not.toHaveBeenCalled();
  });
  it("does not commit a truncated copy", async () => {
    vi.mocked(verifyStoredObject).mockResolvedValue({ data: { contentLength: 20, etag: "short" }, headers: {} } as never);
    await expect(exposeCompatibleOriginalPreview("task")).rejects.toThrow(/完整性/);
    expect(users.commitOriginalPreviewIfMissing).not.toHaveBeenCalled();
  });
  it("cannot replace an optimized preview published while the probe was running", async () => {
    vi.mocked(users.commitOriginalPreviewIfMissing).mockReturnValue(null);
    expect(await exposeCompatibleOriginalPreview("task")).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith("previews/user/task/compatible-original.mp4");
  });
});
