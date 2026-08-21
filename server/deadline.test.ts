import { describe, expect, it, vi } from "vitest";
import { OperationDeadlineExceeded, withinDeadline } from "./deadline.js";

describe("withinDeadline", () => {
  it("preserves a dependency result that settles before the deadline", async () => {
    await expect(withinDeadline(Promise.resolve("ready"), 100)).resolves.toBe("ready");
  });

  it("preserves a dependency rejection", async () => {
    await expect(withinDeadline(Promise.reject(new Error("redis unavailable")), 100)).rejects.toThrow("redis unavailable");
  });

  it("rejects a dependency that never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = withinDeadline(new Promise<never>(() => undefined), 4_000);
      const assertion = expect(result).rejects.toBeInstanceOf(OperationDeadlineExceeded);
      await vi.advanceTimersByTimeAsync(4_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
