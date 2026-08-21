import { describe, expect, it, vi } from "vitest";
import { pollProviderTaskUntilTerminal, ProviderPollingTerminalError, providerPollingRetryDelay, providerReadCanRetry } from "./provider-polling.js";
import { ProviderRequestError, type ProviderTaskResult } from "./provider.js";

const sequence = (...values: (ProviderTaskResult | Error)[]) => vi.fn(async () => {
  const value = values.shift();
  if (value instanceof Error) throw value;
  if (!value) throw new Error("test sequence exhausted");
  return value;
});

describe("recoverable provider polling", () => {
  it("absorbs transient read failures and resets the failure streak after a valid response", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const get = sequence(
      new ProviderRequestError("offline", "network"),
      new ProviderRequestError("unavailable", 503),
      { status: "running" },
      new ProviderRequestError("limited", 429),
      { status: "succeeded", content: { video_url: "https://video.test/result.mp4" } },
    );
    const retries: number[] = [];
    const result = await pollProviderTaskUntilTerminal({
      providerId: "provider-1", deadlineAt: 120_000, pollIntervalMs: 7000, shouldContinue: () => true,
      onRetry: ({ consecutiveFailures }) => retries.push(consecutiveFailures),
    }, { get, sleep, now: () => now });

    expect(result?.status).toBe("succeeded");
    expect(get).toHaveBeenCalledTimes(5);
    expect(retries).toEqual([1, 2, 1]);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("stops immediately for a deterministic authentication rejection", async () => {
    const get = sequence(new ProviderRequestError("unauthorized", 401));
    await expect(pollProviderTaskUntilTerminal({
      providerId: "provider-1", deadlineAt: 60_000, pollIntervalMs: 7000, shouldContinue: () => true,
    }, { get, sleep: vi.fn(), now: () => 0 })).rejects.toBeInstanceOf(ProviderPollingTerminalError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("bounds eventual-consistency 404 retries instead of polling an invalid id for six hours", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const get = vi.fn(async () => { throw new ProviderRequestError("not found", 404); });
    await expect(pollProviderTaskUntilTerminal({
      providerId: "provider-missing", deadlineAt: 360_000, pollIntervalMs: 7000, shouldContinue: () => true,
    }, { get, sleep, now: () => now })).rejects.toThrow("not found");
    expect(get).toHaveBeenCalledTimes(5);
  });

  it("returns without another read after the durable task is deleted", async () => {
    let checks = 0;
    const get = vi.fn(async () => ({ status: "running" }));
    const result = await pollProviderTaskUntilTerminal({
      providerId: "provider-1", deadlineAt: 60_000, pollIntervalMs: 7000, shouldContinue: () => ++checks < 2,
    }, { get, sleep: vi.fn(), now: () => 0 });
    expect(result).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded exponential delay and classifies only safe read failures", () => {
    expect(providerPollingRetryDelay(1, 7000)).toBe(7000);
    expect(providerPollingRetryDelay(8, 7000)).toBe(60_000);
    expect(providerReadCanRetry(new ProviderRequestError("busy", 503), 20)).toBe(true);
    expect(providerReadCanRetry(new ProviderRequestError("missing", 404), 4)).toBe(true);
    expect(providerReadCanRetry(new ProviderRequestError("missing", 404), 5)).toBe(false);
    expect(providerReadCanRetry(new Error("programming error"), 1)).toBe(false);
  });
});
