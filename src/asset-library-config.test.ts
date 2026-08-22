import { describe, expect, it } from "vitest";
import { assetLibraryGroupsOrDefault, defaultAssetLibraryGroup } from "./asset-library-config";

describe("asset library control-plane fallback", () => {
  it("keeps upload admission available before group metadata arrives", () => {
    expect(assetLibraryGroupsOrDefault()).toEqual([defaultAssetLibraryGroup]);
    expect(defaultAssetLibraryGroup.Id).toBe("group-firefly-auto-references");
  });

  it("prefers server metadata once it is available", () => {
    const server = { Id: "group-server", Name: "Server group" };
    expect(assetLibraryGroupsOrDefault([server])).toEqual([server]);
  });
});
