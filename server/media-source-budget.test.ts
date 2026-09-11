import { describe, expect, it } from "vitest";
import { MediaSourceBudget } from "./media-source-budget.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("MediaSourceBudget", () => {
  it("admits a queued preview before the next archive read", async () => {
    const budget = new MediaSourceBudget(1);
    const gate = deferred();
    const order: string[] = [];
    const first = budget.run("archive", async () => { order.push("archive-1"); await gate.promise; });
    await Promise.resolve();
    const second = budget.run("archive", async () => { order.push("archive-2"); });
    const preview = budget.run("preview", async () => { order.push("preview"); });
    gate.resolve();
    await Promise.all([first, second, preview]);
    expect(order).toEqual(["archive-1", "preview", "archive-2"]);
  });

  it.each([2, 10, 14])("never exceeds its source connection budget of %i under a burst", async (limit) => {
    const budget = new MediaSourceBudget(limit);
    let active = 0;
    let peak = 0;
    const work = Array.from({ length: limit * 3 }, () => budget.run("archive", async () => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }));
    await Promise.all(work);
    expect(peak).toBe(limit);
  });
});
