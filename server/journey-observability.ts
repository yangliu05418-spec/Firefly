import type { Redis } from "ioredis";
import { config } from "./config.js";

export const journeyNames = ["studio_bootstrap", "asset_archive_view", "poster_load", "frontend_runtime"] as const;
export type JourneyName = typeof journeyNames[number];
export type JourneyOutcome = "success" | "failure";

export type JourneyEvent = {
  journey: JourneyName;
  outcome: JourneyOutcome;
  userId: string;
  requestId: string;
  elapsedMs?: number;
  taskId?: string;
  route?: string;
  component?: string;
  errorCode?: string;
  fingerprint?: string;
};

const RETENTION_SECONDS = 24 * 60 * 60;
const STREAM_MAX_LENGTH = 100_000;
const minuteBucket = (at = Date.now()) => Math.floor(at / 60_000);
const counterKey = (minute: number, journey: JourneyName, field: "total" | JourneyOutcome) => `slo:journey:${minute}:${journey}:${field}`;
const durationKey = (minute: number, journey: JourneyName) => `slo:journey:${minute}:${journey}:durations`;

export async function recordJourneyEvent(redis: Redis, event: JourneyEvent) {
  const at = new Date().toISOString();
  const minute = minuteBucket();
  const logEvent = { type: "user_journey_event", at, revision: config.revision, ...event };
  const serialized = JSON.stringify(logEvent);
  if (event.outcome === "failure") console.warn(serialized); else console.info(serialized);

  const transaction = redis.multi()
    .xadd("observability:events", "MAXLEN", "~", STREAM_MAX_LENGTH, "*", "payload", serialized)
    .incr(counterKey(minute, event.journey, "total"))
    .expire(counterKey(minute, event.journey, "total"), RETENTION_SECONDS)
    .incr(counterKey(minute, event.journey, event.outcome))
    .expire(counterKey(minute, event.journey, event.outcome), RETENTION_SECONDS);
  if (event.outcome === "success" && event.elapsedMs !== undefined) {
    transaction.rpush(durationKey(minute, event.journey), Math.round(event.elapsedMs));
    transaction.ltrim(durationKey(minute, event.journey), -500, -1);
    transaction.expire(durationKey(minute, event.journey), RETENTION_SECONDS);
  }
  await transaction.exec();
}

export type JourneySlo = {
  journey: Exclude<JourneyName, "frontend_runtime">;
  total: number;
  success: number;
  failure: number;
  availability: number | null;
  p95Ms: number | null;
  availabilityTarget: number;
  p95TargetMs: number;
  sampleStatus: "insufficient" | "healthy" | "breached";
};

const sloTargets: Record<JourneySlo["journey"], { availability: number; p95Ms: number }> = {
  studio_bootstrap: { availability: 0.99, p95Ms: 5_000 },
  asset_archive_view: { availability: 0.99, p95Ms: 3_000 },
  poster_load: { availability: 0.99, p95Ms: 5_000 },
};

const percentile95 = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
};

export async function readJourneySlos(redis: Redis, windowMinutes = 15): Promise<JourneySlo[]> {
  const minutes = Array.from({ length: windowMinutes }, (_, index) => minuteBucket() - index);
  return Promise.all((Object.keys(sloTargets) as JourneySlo["journey"][]).map(async (journey) => {
    const counters = await redis.mget(...minutes.flatMap((minute) => [
      counterKey(minute, journey, "total"),
      counterKey(minute, journey, "success"),
      counterKey(minute, journey, "failure"),
    ]));
    const total = counters.filter((_value, index) => index % 3 === 0).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const success = counters.filter((_value, index) => index % 3 === 1).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const failure = counters.filter((_value, index) => index % 3 === 2).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const durationRows = await Promise.all(minutes.map((minute) => redis.lrange(durationKey(minute, journey), 0, -1)));
    const p95Ms = percentile95(durationRows.flat().map(Number).filter(Number.isFinite));
    const availability = total ? success / total : null;
    const target = sloTargets[journey];
    const enoughSamples = total >= 5;
    const breached = enoughSamples && ((availability ?? 0) < target.availability || (p95Ms !== null && p95Ms > target.p95Ms));
    return {
      journey, total, success, failure,
      availability: availability === null ? null : Number(availability.toFixed(4)),
      p95Ms,
      availabilityTarget: target.availability,
      p95TargetMs: target.p95Ms,
      sampleStatus: !enoughSamples ? "insufficient" : breached ? "breached" : "healthy",
    };
  }));
}
