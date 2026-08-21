import { afterEach, describe, expect, it, vi } from "vitest";
import { inferUploadType } from "./api";
import { uploadFileUntilAccepted } from "./upload-acceptance";

afterEach(() => vi.unstubAllGlobals());

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
