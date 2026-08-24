import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { rangedObjectFromUrl, tos } from "./tos.js";

describe("resumable TOS archive", () => {
  const original = { accessKey: config.tosAccessKeyId, secret: config.tosSecretAccessKey, bucket: config.tosBucket, endpoint: config.tosEndpoint };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    config.tosAccessKeyId = original.accessKey;
    config.tosSecretAccessKey = original.secret;
    config.tosBucket = original.bucket;
    config.tosEndpoint = original.endpoint;
  });

  it("uses ListParts as truth and uploads only missing parts after a worker restart", async () => {
    config.tosAccessKeyId = "test-ak";
    config.tosSecretAccessKey = "test-sk";
    config.tosBucket = "test-bucket";
    config.tosEndpoint = "tos.example.test";
    const totalSize = 10 * 1024 * 1024;
    vi.spyOn(tos, "headObject")
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { statusCode: 404 }))
      .mockResolvedValue({ data: { contentLength: totalSize, contentType: "video/mp4" }, headers: { "content-length": String(totalSize), "content-type": "video/mp4" } } as never);
    vi.spyOn(tos, "getObjectV2").mockResolvedValue({ statusCode: 206, data: { content: Buffer.from([0]) }, headers: { "content-range": `bytes 0-0/${totalSize}` } } as never);
    const listParts = vi.spyOn(tos, "listParts").mockResolvedValue({ data: { Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 5 * 1024 * 1024 }], IsTruncated: false } } as never);
    const create = vi.spyOn(tos, "createMultipartUpload");
    const complete = vi.spyOn(tos, "completeMultipartUpload").mockResolvedValue({} as never);
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (range === "bytes=0-0") return new Response(new Uint8Array([0]), { status: 206, headers: { "content-range": `bytes 0-0/${totalSize}`, "content-type": "video/mp4" } });
      if (range === `bytes=${5 * 1024 * 1024}-${totalSize - 1}`) return new Response(new Uint8Array(5 * 1024 * 1024), { status: 206 });
      if (init?.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"etag-2"' } });
      throw new Error(`unexpected request ${range ?? init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const resumed = vi.fn();

    await rangedObjectFromUrl("outputs/result.mp4", "https://provider.test/result.mp4", "result.mp4", "video/mp4", undefined, 5 * 1024 * 1024, 3, { uploadId: "upload-existing" }, { resumed });

    expect(listParts).toHaveBeenCalledWith(expect.objectContaining({ uploadId: "upload-existing" }));
    expect(create).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledWith("upload-existing", 1);
    expect(fetchMock.mock.calls.filter(([, init]) => new Headers(init?.headers).get("range")?.startsWith(`bytes=${5 * 1024 * 1024}-`))).toHaveLength(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      uploadId: "upload-existing",
      parts: [{ partNumber: 1, eTag: "etag-1" }, { partNumber: 2, eTag: "etag-2" }],
    }));
  });
});
