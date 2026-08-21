import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { readWorkerHealth, workerHeartbeatTtlMs } from "./worker-heartbeat.js";

const record = (revision: string, role: string, updatedAt: number) => JSON.stringify({
  token: `token-${role}`,
  role,
  revision,
  startedAt: updatedAt - 1000,
  updatedAt
});

describe("worker heartbeat readiness", () => {
  it("requires a fresh heartbeat from every worker role for the same revision", async () => {
    const now = Date.now();
    const client = {
      mget: vi.fn().mockResolvedValue([
        record("revision-a", "generation", now),
        record("revision-a", "image", now - 1000),
        record("revision-a", "media", now - 2000),
        record("revision-a", "canvas", now - 3000)
      ])
    } as unknown as Redis;

    const health = await readWorkerHealth(client, "revision-a", now);

    expect(health.ready).toBe(true);
    expect(health.missing).toEqual([]);
    expect(client.mget).toHaveBeenCalledWith(
      "runtime:worker-heartbeat:revision-a:generation",
      "runtime:worker-heartbeat:revision-a:image",
      "runtime:worker-heartbeat:revision-a:media",
      "runtime:worker-heartbeat:revision-a:canvas"
    );
  });

  it("does not let an old release or stale worker make the candidate healthy", async () => {
    const now = Date.now();
    const client = {
      mget: vi.fn().mockResolvedValue([
        record("old-revision", "generation", now),
        record("revision-b", "image", now - workerHeartbeatTtlMs - 1),
        record("revision-b", "media", now),
        null
      ])
    } as unknown as Redis;

    const health = await readWorkerHealth(client, "revision-b", now);

    expect(health.ready).toBe(false);
    expect(health.missing).toEqual(["generation", "image", "canvas"]);
    expect(health.workers.generation.status).toBe("stale");
    expect(health.workers.image.status).toBe("stale");
    expect(health.workers.media.status).toBe("ready");
    expect(health.workers.canvas.status).toBe("missing");
  });

  it("treats malformed heartbeat data as unavailable", async () => {
    const client = { mget: vi.fn().mockResolvedValue(["not-json", null, null, null]) } as unknown as Redis;

    const health = await readWorkerHealth(client, "revision-c", Date.now());

    expect(health.ready).toBe(false);
    expect(health.workers.generation.status).toBe("stale");
  });
});
