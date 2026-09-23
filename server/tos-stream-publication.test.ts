import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { streamObjectToTos, tos } from "./tos.js";

describe("producer-aware multipart publication", () => {
  const original = { ...config };
  beforeEach(() => {
    Object.assign(config, { tosAccessKeyId: "test-ak", tosSecretAccessKey: "test-sk", tosBucket: "test-bucket", tosEndpoint: "tos.example.test" });
    vi.spyOn(tos, "createMultipartUpload").mockResolvedValue({ data: { UploadId: "upload-1" } } as never);
    vi.spyOn(tos, "completeMultipartUpload").mockResolvedValue({} as never);
    vi.spyOn(tos, "abortMultipartUpload").mockResolvedValue({} as never);
    vi.spyOn(tos, "headObject").mockResolvedValue({ data: { contentLength: 3, contentType: "video/mp4" }, headers: { "content-length": "3", "content-type": "video/mp4" } } as never);
    vi.spyOn(tos, "getObjectV2").mockResolvedValue({ statusCode: 206, data: { content: Buffer.from([1]) }, headers: { "content-range": "bytes 0-0/3" } } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { etag: "part-etag" } })));
  });
  afterEach(() => { Object.assign(config, original); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("does not complete on EOF until the encoder has exited successfully", async () => {
    let success!: () => void;
    const gate = new Promise<void>((resolve) => { success = resolve; });
    const beforeComplete = vi.fn(() => gate);
    const result = streamObjectToTos("preview", Readable.from([Buffer.from([1, 2, 3])]), "preview.mp4", "video/mp4", undefined, 5 * 1024 * 1024, { beforeComplete });
    await vi.waitFor(() => expect(beforeComplete).toHaveBeenCalledOnce());
    expect(tos.completeMultipartUpload).not.toHaveBeenCalled();
    success();
    await result;
    expect(tos.completeMultipartUpload).toHaveBeenCalledOnce();
    expect(tos.abortMultipartUpload).not.toHaveBeenCalled();
  });
  it("aborts instead of publishing playable partial output when the producer failed", async () => {
    await expect(streamObjectToTos("preview", Readable.from([Buffer.from([1, 2, 3])]), "preview.mp4", "video/mp4", undefined, 5 * 1024 * 1024, {
      beforeComplete: async () => { throw new Error("encoder timeout"); },
    })).rejects.toThrow("encoder timeout");
    expect(tos.completeMultipartUpload).not.toHaveBeenCalled();
    expect(tos.abortMultipartUpload).toHaveBeenCalledOnce();
  });
  it("cancels an in-flight PUT without retrying or completing", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const result = streamObjectToTos("preview", Readable.from([Buffer.from([1, 2, 3])]), "preview.mp4", "video/mp4", undefined, 5 * 1024 * 1024, { signal: controller.signal, beforeComplete: async () => undefined });
    const rejected = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(tos.completeMultipartUpload).not.toHaveBeenCalled();
    expect(tos.abortMultipartUpload).toHaveBeenCalledOnce();
  });
});
