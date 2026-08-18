import { describe, expect, it, vi } from "vitest";
import { stablePreviewUrl } from "./preview-url-cache.js";

const memoryCache = () => {
  const values = new Map<string, string>();
  return {
    values,
    cache: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        if (values.has(key)) return null;
        values.set(key, value);
        return "OK";
      })
    }
  };
};

describe("stable TOS preview URLs", () => {
  it("reuses one signed URL for the same immutable object", async () => {
    const { cache } = memoryCache();
    const sign = vi.fn(() => "https://tos.example/video?signature=one");
    const options = { objectKey: "outputs/a/task/result.mp4", fileName: "result.mp4", cache, sign, signatureTtlSeconds: 7200 };

    expect(await stablePreviewUrl(options)).toBe("https://tos.example/video?signature=one");
    expect(await stablePreviewUrl(options)).toBe("https://tos.example/video?signature=one");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 6900, "NX");
  });

  it("falls back to a fresh signature when Redis is unavailable", async () => {
    const cache = { get: vi.fn(async () => { throw new Error("offline"); }), set: vi.fn() };
    const sign = vi.fn(() => "https://tos.example/video?signature=fallback");

    await expect(stablePreviewUrl({ objectKey: "output", fileName: "result.mp4", cache, sign, signatureTtlSeconds: 7200 }))
      .resolves.toBe("https://tos.example/video?signature=fallback");
  });

  it("converges concurrent cache misses on the URL that wins Redis NX", async () => {
    const { cache } = memoryCache();
    let sequence = 0;
    const sign = vi.fn(() => `https://tos.example/video?signature=${++sequence}`);
    const options = { objectKey: "outputs/a/task/result.mp4", fileName: "result.mp4", cache, sign, signatureTtlSeconds: 7200 };

    const urls = await Promise.all([stablePreviewUrl(options), stablePreviewUrl(options)]);
    expect(new Set(urls).size).toBe(1);
  });

  it("does not cache when the signature has no safety window", async () => {
    const { cache } = memoryCache();
    const sign = vi.fn(() => "https://tos.example/video?signature=short");

    await stablePreviewUrl({ objectKey: "output", fileName: "result.mp4", cache, sign, signatureTtlSeconds: 120 });
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
