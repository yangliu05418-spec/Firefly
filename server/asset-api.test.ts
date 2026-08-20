import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetApiError, callAssetApi } from "./asset-api.js";
import { config } from "./config.js";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("asset API retry policy", () => {
  beforeEach(() => {
    config.accessKey = "test-access-key";
    config.secretKey = "test-secret-key";
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("retries bounded read requests for network errors and 5xx", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response(503, { message: "busy" }))
      .mockResolvedValueOnce(response(200, { Result: { Id: "asset-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAssetApi<{ Id: string }>("GetAsset", { Id: "asset-1" })).resolves.toEqual({ Id: "asset-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry deterministic read failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, { ResponseMetadata: { Error: { Code: "InvalidParameter", Message: "bad id" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAssetApi("ListAssets", {})).rejects.toMatchObject({ retryable: false, resultUnknown: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never blindly retries mutations and marks transport failure unknown", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    const error = await callAssetApi("CreateAsset", { Name: "asset" }).catch((caught: unknown) => caught);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(AssetApiError);
    expect((error as AssetApiError).resultUnknown).toBe(true);
  });

  it("does not retry deterministic mutation 4xx failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(400, { ResponseMetadata: { Error: { Code: "InvalidParameter", Message: "bad asset" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAssetApi("CreateAsset", {})).rejects.toMatchObject({ retryable: false, resultUnknown: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry mutation 5xx responses and marks their outcome unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(503, { ResponseMetadata: { Error: { Code: "ServiceUnavailable", Message: "busy" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callAssetApi("CreateAssetGroup", {})).rejects.toMatchObject({ retryable: true, resultUnknown: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
