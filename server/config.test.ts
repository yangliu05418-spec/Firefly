import { afterEach, describe, expect, it, vi } from "vitest";

describe("Canvas V2 rollout configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("enables Canvas V2 by default for the general-availability release", async () => {
    delete process.env.CANVAS_V2_ENABLED;
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.canvasV2Enabled).toBe(true);
  });

  it("keeps an explicit emergency rollback switch", async () => {
    vi.stubEnv("CANVAS_V2_ENABLED", "false");
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.canvasV2Enabled).toBe(false);
  });
});
