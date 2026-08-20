import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  it("processes every item once without exceeding the requested limit", async () => {
    let active = 0;
    let peak = 0;
    const visited: number[] = [];

    await runWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, item % 2 ? 2 : 1));
      visited.push(item);
      active -= 1;
    });

    expect(peak).toBe(3);
    expect(visited.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("handles an empty batch without invoking the worker", async () => {
    let calls = 0;
    await runWithConcurrency([], 3, async () => { calls += 1; });
    expect(calls).toBe(0);
  });
});
