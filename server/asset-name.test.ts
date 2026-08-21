import { describe, expect, it } from "vitest";
import { providerAssetName } from "./asset-name.js";

describe("provider asset names", () => {
  it("caps long filenames at the documented 64-character boundary", () => {
    expect(Array.from(providerAssetName(`${"a".repeat(100)}.png`))).toHaveLength(64);
  });

  it("does not split unicode surrogate pairs", () => {
    const result = providerAssetName("萤火虫" + "🎬".repeat(70));
    expect(Array.from(result)).toHaveLength(64);
    expect(result.endsWith("🎬")).toBe(true);
  });

  it("adds a stable upload discriminator without exceeding the provider limit", () => {
    const first = providerAssetName("同名角色参考图.png", "upload-1");
    expect(first).toBe(providerAssetName("同名角色参考图.png", "upload-1"));
    expect(first).not.toBe(providerAssetName("同名角色参考图.png", "upload-2"));
    expect(Array.from(providerAssetName("🎬".repeat(100), "upload-1"))).toHaveLength(64);
  });
});
