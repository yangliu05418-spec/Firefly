import crypto from "node:crypto";
import { redis } from "./redis.js";

const LEASE_TTL_MS = 30_000;
const keyFor = (canvasId: string) => `canvas:lease:${canvasId}`;

type StoredLease = { token: string; userId: string; clientId: string; acquiredAt: number };

const parseLease = (value: string | null): StoredLease | null => {
  if (!value) return null;
  try { return JSON.parse(value) as StoredLease; }
  catch { return null; }
};

const ACQUIRE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and ARGV[4] ~= '1' then
  local decoded = cjson.decode(current)
  if decoded.clientId ~= ARGV[2] or decoded.userId ~= ARGV[1] then
    return {0, current, redis.call('PTTL', KEYS[1])}
  end
end
redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[5])
return {1, ARGV[3], tonumber(ARGV[5])}
`;

const MATCH_AND_EXPIRE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.userId ~= ARGV[1] or decoded.token ~= ARGV[2] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

const MATCH_AND_DELETE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.userId ~= ARGV[1] or decoded.token ~= ARGV[2] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export const acquireCanvasLease = async (input: { canvasId: string; userId: string; clientId: string; takeover?: boolean }) => {
  const key = keyFor(input.canvasId);
  const lease: StoredLease = {
    token: crypto.randomBytes(32).toString("base64url"),
    userId: input.userId,
    clientId: input.clientId,
    acquiredAt: Date.now(),
  };
  const encoded = JSON.stringify(lease);
  const result = await redis.eval(
    ACQUIRE_SCRIPT,
    1,
    key,
    input.userId,
    input.clientId,
    encoded,
    input.takeover ? "1" : "0",
    String(LEASE_TTL_MS),
  ) as [number, string, number];
  if (Number(result[0]) !== 1) {
    const existing = parseLease(result[1]);
    return {
      acquired: false as const,
      holder: existing ? { clientId: existing.clientId, acquiredAt: existing.acquiredAt } : undefined,
      ttlMs: Number(result[2]),
    };
  }
  return { acquired: true as const, token: lease.token, ttlMs: LEASE_TTL_MS };
};

export const renewCanvasLease = async (canvasId: string, userId: string, token: string) => {
  const result = await redis.eval(MATCH_AND_EXPIRE_SCRIPT, 1, keyFor(canvasId), userId, token, String(LEASE_TTL_MS));
  return Number(result) === 1;
};

export const releaseCanvasLease = async (canvasId: string, userId: string, token: string) => {
  const result = await redis.eval(MATCH_AND_DELETE_SCRIPT, 1, keyFor(canvasId), userId, token);
  return Number(result) === 1;
};

export const validateCanvasLease = async (canvasId: string, userId: string, token: string | undefined) => {
  if (!token) return false;
  const current = parseLease(await redis.get(keyFor(canvasId)));
  return Boolean(current && current.userId === userId && current.token === token);
};
