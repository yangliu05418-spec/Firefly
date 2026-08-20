import { describe, expect, it } from "vitest";
import { canRetryAssetAction } from "./asset-api.js";

describe("asset API retry policy", () => {
  it("retries bounded read operations", () => {
    expect(canRetryAssetAction("GetAsset")).toBe(true);
    expect(canRetryAssetAction("ListAssets")).toBe(true);
    expect(canRetryAssetAction("ListAssetGroups")).toBe(true);
  });

  it("never blindly replays non-idempotent mutations", () => {
    expect(canRetryAssetAction("CreateAsset")).toBe(false);
    expect(canRetryAssetAction("CreateAssetGroup")).toBe(false);
    expect(canRetryAssetAction("DeleteAsset")).toBe(false);
  });
});
