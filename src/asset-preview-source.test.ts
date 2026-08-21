import { describe, expect, it } from "vitest";
import { assetPreviewSource } from "./asset-preview-source";
import type { LibraryAsset } from "./types";

const asset = (Status: LibraryAsset["Status"]): LibraryAsset => ({ Id: "asset-1", Name: "frame.png", AssetType: "Image", Status, URL: "/api/assets/asset-1/source", GroupId: "group", Category: "material" });

describe("asset preview source", () => {
  it("uses the zero-latency local preview while server validation is pending", () => expect(assetPreviewSource(asset("Processing"), "blob:local")).toBe("blob:local"));
  it("does not request protected media early and switches to it after activation", () => {
    expect(assetPreviewSource(asset("Processing"))).toBeUndefined();
    expect(assetPreviewSource(asset("Active"))).toBe("/api/assets/asset-1/source");
  });
});
