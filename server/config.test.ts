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

describe("TOS preview configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("enables progressive previews by default for direct container deployments", async () => {
    delete process.env.TOS_PREVIEW_TRANSCODE_ENABLED;
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosPreviewTranscodeEnabled).toBe(true);
  });

  it("keeps an explicit emergency rollback switch", async () => {
    vi.stubEnv("TOS_PREVIEW_TRANSCODE_ENABLED", "false");
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosPreviewTranscodeEnabled).toBe(false);
  });
});

describe("TOS archive latency configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows a complete server-side URL fetch polling window by default", async () => {
    delete process.env.TOS_FETCH_DEADLINE_MS;
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosFetchDeadlineMs).toBe(180_000);
    expect(config.tosFetchMaxWaitMs).toBe(300_000);
    expect(config.tosFetchPollIntervalMs).toBe(5_000);
  });

  it("keeps the fetch deadline configurable for controlled rollback", async () => {
    vi.stubEnv("TOS_FETCH_DEADLINE_MS", "60000");
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosFetchDeadlineMs).toBe(60_000);
  });
});
