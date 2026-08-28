import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { config } from "./config.js";

export const workerRoles = ["generation", "image", "media", "canvas", "atlas-agent"] as const;
export type WorkerRole = (typeof workerRoles)[number];

export const requiredWorkerRoles = (): readonly WorkerRole[] => config.atlasEnabled && config.atlasAgentEnabled
  ? workerRoles
  : workerRoles.filter((role) => role !== "atlas-agent");

const heartbeatIntervalMs = 10_000;
const heartbeatTtlMs = 30_000;

type HeartbeatRecord = {
  token: string;
  role: WorkerRole;
  revision: string;
  startedAt: number;
  updatedAt: number;
};

export type WorkerHealthSnapshot = {
  ready: boolean;
  revision: string;
  checkedAt: string;
  workers: Record<WorkerRole, { status: "ready" | "missing" | "stale"; updatedAt?: string }>;
  required: WorkerRole[];
  missing: WorkerRole[];
};

const keyFor = (revision: string, role: WorkerRole) => `runtime:worker-heartbeat:${revision}:${role}`;

const parseHeartbeat = (raw: string | null, revision: string, role: WorkerRole, now: number) => {
  if (!raw) return { status: "missing" as const };
  try {
    const record = JSON.parse(raw) as Partial<HeartbeatRecord>;
    if (record.revision !== revision || record.role !== role || typeof record.updatedAt !== "number") return { status: "stale" as const };
    if (now - record.updatedAt > heartbeatTtlMs) return { status: "stale" as const, updatedAt: new Date(record.updatedAt).toISOString() };
    return { status: "ready" as const, updatedAt: new Date(record.updatedAt).toISOString() };
  } catch {
    return { status: "stale" as const };
  }
};

export const readWorkerHealth = async (client: Redis, revision = config.revision, now = Date.now(), requiredRoles: readonly WorkerRole[] = requiredWorkerRoles()): Promise<WorkerHealthSnapshot> => {
  const values = await client.mget(...workerRoles.map((role) => keyFor(revision, role)));
  const workers = Object.fromEntries(workerRoles.map((role, index) => [role, parseHeartbeat(values[index] ?? null, revision, role, now)])) as WorkerHealthSnapshot["workers"];
  const required = [...requiredRoles];
  const missing = required.filter((role) => workers[role].status !== "ready");
  return { ready: missing.length === 0, revision, checkedAt: new Date(now).toISOString(), workers, required, missing };
};

export const startWorkerHeartbeat = async (client: Redis, role: WorkerRole) => {
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  const key = keyFor(config.revision, role);
  let stopped = false;

  const refresh = async () => {
    if (stopped) return;
    const record: HeartbeatRecord = { token, role, revision: config.revision, startedAt, updatedAt: Date.now() };
    await client.set(key, JSON.stringify(record), "PX", heartbeatTtlMs);
  };

  await refresh();
  const timer = setInterval(() => {
    void refresh().catch((error) => console.error(JSON.stringify({
      type: "worker_heartbeat_failed",
      at: new Date().toISOString(),
      worker: role,
      revision: config.revision,
      code: (error as { code?: string }).code ?? "unknown"
    })));
  }, heartbeatIntervalMs);
  timer.unref();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await client.eval(
        "local value = redis.call('get', KEYS[1]); if value and string.find(value, ARGV[1], 1, true) then return redis.call('del', KEYS[1]); end; return 0",
        1,
        key,
        token
      ).catch(() => undefined);
    }
  };
};

export const workerHeartbeatTtlMs = heartbeatTtlMs;
