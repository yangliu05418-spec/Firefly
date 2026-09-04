import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { rangedObjectFromUrl, tos, uploadArchivePart } from "./tos.js";

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
    const create = vi.spyOn(tos, "createMultipartUpload");
    const complete = vi.spyOn(tos, "completeMultipartUpload").mockResolvedValue({} as never);
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (init?.method === "GET" && !range) return new Response(JSON.stringify({ Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 5 * 1024 * 1024 }], IsTruncated: false }), { status: 200, headers: { "content-type": "application/json" } });
      if (range === "bytes=0-0") return new Response(new Uint8Array([0]), { status: 206, headers: { "content-range": `bytes 0-0/${totalSize}`, "content-type": "video/mp4" } });
      if (range === `bytes=${5 * 1024 * 1024}-${totalSize - 1}`) return new Response(new Uint8Array(5 * 1024 * 1024), { status: 206 });
      if (init?.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"etag-2"' } });
      throw new Error(`unexpected request ${range ?? init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const resumed = vi.fn();

    await rangedObjectFromUrl("outputs/result.mp4", "https://provider.test/result.mp4", "result.mp4", "video/mp4", undefined, 5 * 1024 * 1024, 3, { uploadId: "upload-existing" }, { resumed });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("uploadId=upload-existing"), expect.objectContaining({ method: "GET" }));
    expect(create).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledWith("upload-existing", 1);
    expect(fetchMock.mock.calls.filter(([, init]) => new Headers(init?.headers).get("range")?.startsWith(`bytes=${5 * 1024 * 1024}-`))).toHaveLength(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      uploadId: "upload-existing",
      parts: [{ partNumber: 1, eTag: "etag-1" }, { partNumber: 2, eTag: "etag-2" }],
    }));
  });

  it("resumes from the durable checkpoint when ListParts permission is unavailable", async () => {
    config.tosAccessKeyId = "test-ak";
    config.tosSecretAccessKey = "test-sk";
    config.tosBucket = "test-bucket";
    config.tosEndpoint = "tos.example.test";
    const totalSize = 10 * 1024 * 1024;
    vi.spyOn(tos, "headObject")
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { statusCode: 404 }))
      .mockResolvedValue({ data: { contentLength: totalSize, contentType: "video/mp4" }, headers: { "content-length": String(totalSize), "content-type": "video/mp4" } } as never);
    vi.spyOn(tos, "getObjectV2").mockResolvedValue({ statusCode: 206, data: { content: Buffer.from([0]) }, headers: { "content-range": `bytes 0-0/${totalSize}` } } as never);
    const create = vi.spyOn(tos, "createMultipartUpload");
    const complete = vi.spyOn(tos, "completeMultipartUpload").mockResolvedValue({} as never);
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (init?.method === "GET" && !range) return new Response(JSON.stringify({ Code: "AccessDenied" }), { status: 403, headers: { "content-type": "application/json" } });
      if (range === "bytes=0-0") return new Response(new Uint8Array([0]), { status: 206, headers: { "content-range": `bytes 0-0/${totalSize}`, "content-type": "video/mp4" } });
      if (range === `bytes=${5 * 1024 * 1024}-${totalSize - 1}`) return new Response(new Uint8Array(5 * 1024 * 1024), { status: 206 });
      if (init?.method === "PUT") return new Response(null, { status: 200, headers: { etag: '"etag-2"' } });
      throw new Error(`unexpected request ${range ?? init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const degraded = vi.fn();

    await rangedObjectFromUrl(
      "outputs/result.mp4", "https://provider.test/result.mp4", "result.mp4", "video/mp4", undefined,
      5 * 1024 * 1024, 3,
      { uploadId: "upload-existing", parts: [{ partNumber: 1, eTag: "etag-1" }] },
      { listPartsDegraded: degraded },
    );

    expect(degraded).toHaveBeenCalledWith("upload-existing", 403, "AccessDenied");
    expect(create).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      uploadId: "upload-existing",
      parts: [{ partNumber: 1, eTag: "etag-1" }, { partNumber: 2, eTag: "etag-2" }],
    }));
  });

  it("rejects authoritative ListParts entries outside the current source shape", async () => {
    config.tosAccessKeyId = "test-ak";
    config.tosSecretAccessKey = "test-sk";
    config.tosBucket = "test-bucket";
    config.tosEndpoint = "tos.example.test";
    const totalSize = 10 * 1024 * 1024;
    vi.spyOn(tos, "headObject").mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 }));
    const complete = vi.spyOn(tos, "completeMultipartUpload").mockResolvedValue({} as never);
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (range === "bytes=0-0") return new Response(new Uint8Array([0]), { status: 206, headers: { "content-range": `bytes 0-0/${totalSize}`, "content-type": "video/mp4" } });
      if (init?.method === "GET" && !range) return new Response(JSON.stringify({ Parts: [{ PartNumber: 3, ETag: "unexpected" }], IsTruncated: false }), { status: 200 });
      throw new Error("unexpected request");
    }));
    await expect(rangedObjectFromUrl(
      "outputs/result.mp4", "https://provider.test/result.mp4", "result.mp4", "video/mp4", undefined,
      5 * 1024 * 1024, 3, { uploadId: "upload-existing" },
    )).rejects.toThrow(/超出当前对象范围/);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("archive part hedging", () => {
  it("starts a duplicate same-part request before a stalled upload reaches the hard timeout", async () => {
    let requests = 0;
    const onHedge = vi.fn();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      requests += 1;
      if (requests === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return new Response(null, { status: 200, headers: { etag: '"hedged-etag"', "x-tos-request-id": "hedged-request" } });
    });

    const result = await uploadArchivePart({
      sign: () => "https://tos.example.test/upload-part",
      body: new Uint8Array([1, 2, 3]).buffer,
      timeoutMs: 100,
      hedgeDelayMs: 5,
      fetcher,
      onHedge,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onHedge).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ eTag: "hedged-etag", requestId: "hedged-request" });
  });
});
