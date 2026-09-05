import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putUploadPart } from "./upload-transport";

class FakeXHR {
  static latest: FakeXHR;
  upload = { onprogress: undefined as undefined | ((event: { loaded: number }) => void), onload: undefined as undefined | (() => void) };
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  status = 200;
  abort = vi.fn(() => this.onabort?.());
  open = vi.fn(); send = vi.fn();
  getResponseHeader = () => '"committed-etag"';
  constructor() { FakeXHR.latest = this; }
}
describe("upload inactivity deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("XMLHttpRequest", FakeXHR); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("allows a continuously progressing upload beyond 180 seconds", async () => {
    const result = putUploadPart("https://media.test/part", new Blob(["data"]));
    for (let i = 1; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      FakeXHR.latest.upload.onprogress?.({ loaded: i });
    }
    expect(FakeXHR.latest.abort).not.toHaveBeenCalled();
    FakeXHR.latest.onload?.();
    await expect(result).resolves.toMatchObject({ ok: true, eTag: "committed-etag" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a stalled transfer at 30 seconds, even with zero-progress events", async () => {
    const result = expect(putUploadPart("https://media.test/part", new Blob())).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(20_000);
    FakeXHR.latest.upload.onprogress?.({ loaded: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(FakeXHR.latest.abort).toHaveBeenCalledTimes(1);
  });
  it("cancellation closes the transport and clears the watchdog", async () => {
    const controller = new AbortController();
    const result = expect(putUploadPart("https://media.test/part", new Blob(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
