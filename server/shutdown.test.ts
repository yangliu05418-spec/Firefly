import { describe, expect, it, vi } from "vitest";
import { closeWorkersWithin } from "./shutdown.js";

describe("bounded worker shutdown", () => {
  it("waits for graceful completion when jobs finish in time", async () => {
    const close = vi.fn(async () => undefined);
    expect(await closeWorkersWithin([{ close }], 50)).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    expect(close).not.toHaveBeenCalledWith(true);
  });

  it("returns after the grace deadline so the caller can terminate and release the lock", async () => {
    const close = vi.fn((force?: boolean) => force ? Promise.resolve() : new Promise<void>(() => undefined));
    expect(await closeWorkersWithin([{ close }], 5)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(false);
  });
});
