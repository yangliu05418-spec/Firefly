import { describe, expect, it } from "vitest";
import { AssetApiError, canRetryAssetAction, isMissingProviderAssetError } from "./asset-api.js";

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

  it("classifies provider not-found responses for deletion reconciliation", () => {
    expect(isMissingProviderAssetError(new AssetApiError("missing", 404, "NotFound", "GetAsset"))).toBe(true);
    expect(isMissingProviderAssetError(new AssetApiError("asset does not exist", 400, "InvalidAsset.NotFound", "GetAsset"))).toBe(true);
    expect(isMissingProviderAssetError(new AssetApiError("rate limited", 429, "TooManyRequests", "GetAsset"))).toBe(false);
  });
});
