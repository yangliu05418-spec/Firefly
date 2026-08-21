import { describe, expect, it } from "vitest";
import { buildImageRequestBody, OpenRouterError, OpenRouterKeyPool, parseOpenRouterImages, parseOpenRouterTextDelta } from "./openrouter.js";
import { computeImageSize, IMAGE_MODELS, imageModelById, openRouterResolution } from "./image-models.js";

describe("OpenRouterKeyPool", () => {
  it("round-robins across healthy keys", () => {
    const pool = new OpenRouterKeyPool(["k1", "k2", "k3"]);
    expect([pool.next(), pool.next(), pool.next(), pool.next()]).toEqual(["k2", "k3", "k1", "k2"]);
  });

  it("skips cooled-down keys and rotates to healthy ones", () => {
    const pool = new OpenRouterKeyPool(["k1", "k2"]);
    pool.next();
    pool.reportFailure("k2", 429);
    expect(pool.next()).toBe("k1");
    expect(pool.healthyCount()).toBe(1);
  });

  it("applies graduated cooldowns per failure type", () => {
    const pool = new OpenRouterKeyPool(["k1", "k2", "k3"]);
    pool.next(); // k2
    pool.reportFailure("k2", 401); // 1h cooldown
    const second = pool.next(); // k3
    pool.reportFailure(second!, 429); // 60s
    expect(pool.next()).toBe("k1"); // only k1 healthy now
    expect(pool.healthyCount()).toBe(1);
    pool.reportFailure("k1", "network"); // 10s cooldown
    expect(pool.healthyCount()).toBe(0);
    expect(pool.next()).toBeNull();
  });

  it("recovers after cooldown expiry", () => {
    const pool = new OpenRouterKeyPool(["k1"]);
    pool.next();
    pool.reportFailure("k1", 429);
    expect(pool.next()).toBeNull();
    // 60s later the key recovers (cooldown 429 = 60s)
    const future = Date.now() + 61_000;
    const now = Date.now;
    Date.now = () => future;
    try {
      expect(pool.next()).toBe("k1");
    } finally {
      Date.now = now;
    }
  });

  it("resets health on success", () => {
    const pool = new OpenRouterKeyPool(["k1"]);
    pool.next();
    pool.reportFailure("k1", 401);
    expect(pool.next()).toBeNull();
    pool.reportSuccess("k1");
    expect(pool.next()).toBe("k1");
  });

  it("returns null when no keys are configured", () => {
    expect(new OpenRouterKeyPool([]).next()).toBeNull();
  });
});

describe("parseOpenRouterImages", () => {
  it("parses the dedicated Images API base64 response", () => {
    const urls = parseOpenRouterImages({
      data: [
        { b64_json: "AAAA", media_type: "image/jpeg" },
        { b64_json: "BBBB" },
      ],
    });
    expect(urls).toEqual(["data:image/jpeg;base64,AAAA", "data:image/png;base64,BBBB"]);
  });

  it("parses content arrays with image_url parts", () => {
    const urls = parseOpenRouterImages({
      choices: [{ message: { content: [
        { type: "text", text: "here you go" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] } }],
    });
    expect(urls).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("parses markdown image URLs from string content", () => {
    const urls = parseOpenRouterImages({
      choices: [{ message: { content: "![image](https://example.com/a.png)" } }],
    });
    expect(urls).toEqual(["https://example.com/a.png"]);
  });

  it("parses message.images arrays", () => {
    const urls = parseOpenRouterImages({
      choices: [{ message: { images: ["https://example.com/b.png", { url: "https://example.com/c.png" }] } }],
    });
    expect(urls).toEqual(["https://example.com/b.png", "https://example.com/c.png"]);
  });

  it("throws on provider errors with the provider message", () => {
    expect(() => parseOpenRouterImages({ error: { message: "rate limited" } })).toThrow(OpenRouterError);
    expect(() => parseOpenRouterImages({ error: { message: "rate limited" } })).toThrow("rate limited");
  });

  it("returns empty when no image is present", () => {
    expect(parseOpenRouterImages({ choices: [{ message: { content: "text only" } }] })).toEqual([]);
  });
});

describe("parseOpenRouterTextDelta", () => {
  it("parses string and structured streaming deltas", () => {
    expect(parseOpenRouterTextDelta(JSON.stringify({ choices: [{ delta: { content: "镜头" } }] }))).toBe("镜头");
    expect(parseOpenRouterTextDelta(JSON.stringify({ choices: [{ delta: { content: [{ type: "text", text: "向前" }] } }] }))).toBe("向前");
  });

  it("surfaces provider stream errors", () => {
    expect(() => parseOpenRouterTextDelta(JSON.stringify({ error: { message: "stream failed" } }))).toThrow("stream failed");
  });
});

describe("computeImageSize", () => {
  it("derives size from ratio and tier", () => {
    expect(computeImageSize("1:1", 1024, 1024)).toBe("1024x1024");
    expect(computeImageSize("16:9", 1024, 1024)).toBe("1024x576");
    expect(computeImageSize("9:16", 1024, 1024)).toBe("576x1024");
    expect(computeImageSize("21:9", 1024, 1024)).toBe("1024x432");
  });

  it("respects the model max size cap", () => {
    expect(computeImageSize("1:1", 1536, 1024)).toBe("1024x1024");
  });

  it("emits multiples of 16", () => {
    for (const ratio of ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]) {
      const size = computeImageSize(ratio, 1024, 2048);
      const [w, h] = size.split("x").map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
    }
  });
});

describe("OpenRouter image resolution normalization", () => {
  it("maps UI pixel tiers to the dedicated Images API enums", () => {
    expect(openRouterResolution("512")).toBe("512");
    expect(openRouterResolution("768")).toBe("1K");
    expect(openRouterResolution("1024")).toBe("1K");
    expect(openRouterResolution("1536")).toBe("2K");
    expect(openRouterResolution("2048")).toBe("2K");
    expect(openRouterResolution("4096")).toBe("4K");
  });

  it("sends aspect ratio and normalized resolution without a lossy fallback", () => {
    expect(buildImageRequestBody({ model: "model", prompt: "landscape", references: ["https://example.test/ref.png"], ratio: "16:9", resolution: "1K" })).toEqual({
      model: "model", prompt: "landscape", n: 1, resolution: "1K", aspect_ratio: "16:9",
      input_references: [{ type: "image_url", image_url: { url: "https://example.test/ref.png" } }],
    });
  });
});

describe("image model registry", () => {
  it("exposes the Nano Banana family with display names and default", () => {
    const lite = imageModelById("google/gemini-3.1-flash-lite-image")!;
    expect(lite.name).toBe("Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)");
    expect(IMAGE_MODELS.some((m) => m.id === "google/gemini-3.1-flash-image")).toBe(true);
    expect(IMAGE_MODELS.some((m) => m.id === "google/gemini-3-pro-image")).toBe(true);
    expect(lite.resolutions).toEqual(["1024"]);
    expect(lite.maxCount).toBe(4);
  });
});
