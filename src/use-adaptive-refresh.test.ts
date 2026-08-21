import { describe, expect, it } from "vitest";
import { adaptiveRefreshDelay } from "./use-adaptive-refresh";

describe("adaptive refresh cadence", () => {
  it("polls active work quickly and backs off in the background", () => {
    expect(adaptiveRefreshDelay(true, false)).toBe(2_000);
    expect(adaptiveRefreshDelay(true, true)).toBe(15_000);
  });

  it("keeps a low-cost recovery heartbeat after work completes", () => {
    expect(adaptiveRefreshDelay(false, false)).toBe(60_000);
    expect(adaptiveRefreshDelay(false, true)).toBe(5 * 60_000);
  });
});
