import { afterEach, describe, expect, it, vi } from "vitest";

describe("video generation capacity", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("defaults to six user admissions and six worker slots", async () => {
    vi.stubEnv("GENERATION_CONCURRENCY", undefined);
    vi.stubEnv("MAX_ACTIVE_GENERATIONS_PER_USER", undefined);
    vi.resetModules();
    const { config } = await import("./config.js");
    expect(config.generationConcurrency).toBe(6);
    expect(config.maxActiveGenerationsPerUser).toBe(6);
  });

  it("preserves independent environment overrides for operational rollback", async () => {
    vi.stubEnv("GENERATION_CONCURRENCY", "4");
    vi.stubEnv("MAX_ACTIVE_GENERATIONS_PER_USER", "3");
    vi.resetModules();
    const { config } = await import("./config.js");
    expect(config.generationConcurrency).toBe(4);
    expect(config.maxActiveGenerationsPerUser).toBe(3);
  });
});

describe("downstream capacity headroom", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const keys = ["MAX_ACTIVE_UPLOADS_PER_USER", "MEDIA_MAINTENANCE_CONCURRENCY", "UPLOAD_FINALIZATION_CONCURRENCY", "ASSET_INGEST_CONCURRENCY", "TOS_PREVIEW_CONCURRENCY", "TOS_UPLOAD_CONCURRENCY"];

  it("expands I/O stages without multiplying per-file buffers or CPU transcodes", async () => {
    keys.forEach(key => vi.stubEnv(key, undefined));
    vi.resetModules();
    const { config } = await import("./config.js");
    expect(config.maxActiveUploadsPerUser).toBe(9);
    expect(config.mediaMaintenanceConcurrency).toBe(3);
    expect(config.uploadFinalizationConcurrency).toBe(3);
    expect(config.assetIngestConcurrency).toBe(3);
    expect(config.tosPreviewConcurrency).toBe(2);
    expect(config.tosUploadConcurrency).toBe(3);
  });

  it("allows independent rollback of downstream workers", async () => {
    for (const key of keys.slice(1, 4)) vi.stubEnv(key, "2");
    vi.resetModules();
    const { config } = await import("./config.js");
    expect(config.mediaMaintenanceConcurrency).toBe(2);
    expect(config.uploadFinalizationConcurrency).toBe(2);
    expect(config.assetIngestConcurrency).toBe(2);
  });

  it.each(keys.slice(1, 4))("rejects unbounded %s", async (key) => {
    vi.stubEnv(key, "100");
    vi.resetModules();
    await expect(import("./config.js")).rejects.toThrow(`${key} must be between 1 and 6`);
  });
});

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

  it("uses bounded resumable multipart by default after URL fetch proved slow for ModelArk URLs", async () => {
    delete process.env.TOS_FETCH_DEADLINE_MS;
    delete process.env.TOS_FETCH_MAX_WAIT_MS;
    delete process.env.TOS_FETCH_POLL_INTERVAL_MS;
    delete process.env.TOS_URL_FETCH_ENABLED;
    delete process.env.TOS_ARCHIVE_CONCURRENCY;
    delete process.env.TOS_ARCHIVE_PART_SIZE;
    delete process.env.TOS_ARCHIVE_PART_CONCURRENCY;
    delete process.env.TOS_ARCHIVE_PART_REQUEST_TIMEOUT_MS;
    delete process.env.TOS_ARCHIVE_PART_HEDGE_DELAY_MS;
    delete process.env.TOS_SOURCE_READ_CONCURRENCY;
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosUrlFetchEnabled).toBe(false);
    expect(config.tosFetchDeadlineMs).toBe(30_000);
    expect(config.tosFetchMaxWaitMs).toBe(60_000);
    expect(config.tosFetchPollIntervalMs).toBe(3_000);
    expect(config.tosArchiveConcurrency).toBe(4);
    expect(config.tosArchivePartSize).toBe(5 * 1024 * 1024);
    expect(config.tosArchivePartConcurrency).toBe(4);
    expect(config.tosArchivePartRequestTimeoutMs).toBe(60_000);
    expect(config.tosArchivePartHedgeDelayMs).toBe(20_000);
    expect(config.tosSourceReadConcurrency).toBe(10);
  });

  it("keeps the fetch deadline configurable for controlled rollback", async () => {
    vi.stubEnv("TOS_FETCH_DEADLINE_MS", "60000");
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosFetchDeadlineMs).toBe(60_000);
  });

  it("keeps storage-side URL fetch available as an explicit canary", async () => {
    vi.stubEnv("TOS_URL_FETCH_ENABLED", "true");
    vi.resetModules();

    const { config } = await import("./config.js");

    expect(config.tosUrlFetchEnabled).toBe(true);
  });
});
