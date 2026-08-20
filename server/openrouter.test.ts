import { describe, expect, it } from "vitest";
import { detectImageContentType, isBlockedImageAddress, OpenRouterError, OpenRouterKeyPool, parseOpenRouterImages } from "./openrouter.js";
import { computeImageSize, IMAGE_MODELS, imageModelById } from "./image-models.js";

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

describe("image model registry", () => {
  it("exposes the Nano Banana family with display names and default", () => {
    const lite = imageModelById("google/gemini-3.1-flash-lite-image")!;
    expect(lite.name).toBe("Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)");
    expect(IMAGE_MODELS.some((m) => m.id === "google/gemini-3.1-flash-image")).toBe(true);
    expect(IMAGE_MODELS.some((m) => m.id === "google/gemini-3-pro-image")).toBe(true);
    expect(lite.resolutions[0]).toBe("512");
    expect(lite.maxCount).toBe(4);
  });
});

describe("generated image download safety", () => {
  it("blocks loopback, private, link-local and metadata-network addresses", () => {
    expect(isBlockedImageAddress("127.0.0.1", 4)).toBe(true);
    expect(isBlockedImageAddress("10.1.2.3", 4)).toBe(true);
    expect(isBlockedImageAddress("169.254.169.254", 4)).toBe(true);
    expect(isBlockedImageAddress("::1", 6)).toBe(true);
    expect(isBlockedImageAddress("8.8.8.8", 4)).toBe(false);
  });

  it("uses image signatures instead of trusting a URL or response header", () => {
    expect(detectImageContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageContentType(Buffer.from("RIFFxxxxWEBP", "ascii"))).toBe("image/webp");
    expect(() => detectImageContentType(Buffer.from("<html>not an image</html>"))).toThrow("不是受支持的图片");
  });
});
