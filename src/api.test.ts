import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, inferUploadType } from "./api";
import { uploadFileUntilAccepted } from "./upload-acceptance";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const hangingFetch = () => vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  const signal = init?.signal;
  signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
}));

describe("bounded API requests", () => {
  it("ends a stalled read with a retryable client timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(api.get("/api/slow", { timeoutMs: 50 })).rejects.toMatchObject({
      name: "ApiError", status: 0, code: "CLIENT_TIMEOUT", message: "网络响应超时，请重试",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay an ambiguous timed-out mutation", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(api.post("/api/generations", { prompt: "test" }, { timeoutMs: 50 })).rejects.toMatchObject({
      status: 0, code: "CLIENT_TIMEOUT", message: "响应超时，操作可能已完成，请刷新确认",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active while a partial JSON body is still streaming", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }));
    const assertion = expect(api.get("/api/partial", { timeoutMs: 50 })).rejects.toMatchObject({ code: "CLIENT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("preserves an explicit caller cancellation", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = api.get("/api/cancelled", { signal: controller.signal, timeoutMs: 1_000 });
    controller.abort(new DOMException("页面已离开", "AbortError"));
    await expect(request).rejects.toMatchObject({ name: "AbortError", message: "页面已离开" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears its deadline after a successful response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(api.get<{ ok: boolean }>("/api/fast", { timeoutMs: 50 })).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("classifies a malformed successful response without exposing parser internals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })));
    await expect(api.get("/api/malformed", { timeoutMs: 50 })).rejects.toMatchObject({
      status: 0, code: "INVALID_RESPONSE", message: "服务器响应格式异常，请稍后重试",
    } satisfies Partial<ApiError>);
  });
});

describe("inferUploadType", () => {
  it("uses a trusted browser media category when present", () => {
    expect(inferUploadType({ name: "still.bin", type: "image/png" })).toBe("image");
    expect(inferUploadType({ name: "clip.bin", type: "video/mp4" })).toBe("video");
  });

  it("falls back to the extension when Windows supplies an empty MIME", () => {
    expect(inferUploadType({ name: "reference.MOV", type: "" })).toBe("video");
    expect(inferUploadType({ name: "voice.mp3", type: "" })).toBe("audio");
    expect(inferUploadType({ name: "portrait.HEIC", type: "" })).toBe("image");
  });

  it("does not silently classify unsupported files as audio", () => {
    expect(inferUploadType({ name: "notes.pdf", type: "" })).toBeUndefined();
  });
});

describe("upload transport acceptance", () => {
  it("returns on the first durable 202 instead of polling deep validation in the browser", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requests.push(url);
      if (url === "/api/uploads") return new Response(JSON.stringify({ id: "upload-12345678901234567890", chunkSize: 1024, direct: false }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/chunks")) return new Response(null, { status: 204 });
      if (url.endsWith("/complete")) return new Response(JSON.stringify({ id: "upload-12345678901234567890", uploadId: "upload-12345678901234567890", name: "voice.mp3", type: "audio", size: 2, state: "processing" }), { status: 202, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected request ${url}`);
    }));
    const file = Object.assign(new Blob([new Uint8Array([1, 2])], { type: "audio/mpeg" }), { name: "voice.mp3", lastModified: 1 }) as File;
    const phases: string[] = []; const accepted: string[] = [];
    const result = await uploadFileUntilAccepted(file, "audio", (_progress, phase) => phases.push(phase), { onTransportComplete: (upload) => accepted.push(upload.uploadId ?? upload.id) });
    expect(result.uploadId).toBe("upload-12345678901234567890");
    expect(requests).toEqual(["/api/uploads", "/api/uploads/upload-12345678901234567890/chunks", "/api/uploads/upload-12345678901234567890/complete"]);
    expect(phases.at(-1)).toBe("verifying");
    expect(accepted).toEqual(["upload-12345678901234567890"]);
  });
});
