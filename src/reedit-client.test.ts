// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { loadReeditPayload } from "./reedit-client";

const payload = {
  sourceId: "task-1", sourceType: "video", sessionId: "session-1", snapshotVersion: 1,
  recoveryQuality: "exact", sourceSessionStatus: "active", omittedAssets: 0, warnings: [], adjustments: [],
  state: {
    engine: "video", prompt: "雨夜", modelId: "dreamina-seedance-2-5-260628", mode: "text",
    ratio: "16:9", resolution: "1080p", duration: 4, generateAudio: true, cameraFixed: false,
    watermark: false, seed: -1, imageModelId: "", imageRatio: "1:1", imageResolution: "", imageCount: 1, assets: [],
  },
};

describe("re-edit client recovery", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("retries only transient failures and validates the recovered payload", async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, "get")
      .mockRejectedValueOnce(new ApiError("busy", 503))
      .mockRejectedValueOnce(new ApiError("limited", 429))
      .mockResolvedValueOnce(payload);
    const result = loadReeditPayload("/api/generations/task-1/reedit");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ sourceId: "task-1", recoveryQuality: "exact", state: { prompt: "雨夜" } });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("does not retry deterministic authorization or validation errors", async () => {
    const get = vi.spyOn(api, "get").mockRejectedValue(new ApiError("missing", 404));
    await expect(loadReeditPayload("/api/generations/missing/reedit")).rejects.toMatchObject({ status: 404 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed server data instead of partially overwriting the composer", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ ...payload, state: { ...payload.state, assets: [{ id: "bad" }] } });
    await expect(loadReeditPayload("/api/generations/task-1/reedit")).rejects.toThrow();
  });

  it("stops retrying immediately when navigation aborts the active restore", async () => {
    const controller = new AbortController();
    const get = vi.spyOn(api, "get").mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const result = loadReeditPayload("/api/generations/task-1/reedit", controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
