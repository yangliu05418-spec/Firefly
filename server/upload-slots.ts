import crypto from "node:crypto";
import type { Redis } from "ioredis";

export const UPLOAD_SESSION_TTL_SECONDS = 24 * 3600;
const keyFor = (ownerId: string) => `upload-slots:${ownerId}`;

const claimScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local uploadId = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZCARD', key) >= limit then return 0 end
redis.call('ZADD', key, expires, uploadId)
redis.call('EXPIRE', key, math.ceil((expires - now) / 1000))
return 1
`;

export const claimUploadSlot = async (redis: Redis, ownerId: string, uploadId: string, limit: number, now = Date.now()) =>
  Number(await redis.eval(claimScript, 1, keyFor(ownerId), now, now + UPLOAD_SESSION_TTL_SECONDS * 1000, limit, uploadId)) === 1;

export const releaseUploadSlot = async (redis: Redis, ownerId: string, uploadId: string) => {
  await redis.zrem(keyFor(ownerId), uploadId);
};

export const acquireUploadCompletionLock = async (redis: Redis, uploadId: string, ttlSeconds = 300) => {
  const token = crypto.randomUUID();
  const acquired = await redis.set(`upload-complete:${uploadId}`, token, "EX", ttlSeconds, "NX");
  return acquired ? token : null;
};

export const releaseUploadCompletionLock = async (redis: Redis, uploadId: string, token: string) => {
  await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `upload-complete:${uploadId}`, token);
};

export const acquireAssetCreationLock = async (redis: Redis, ownerId: string, uploadId: string, ttlSeconds = 120) => {
  const token = crypto.randomUUID();
  const key = `asset-create:${ownerId}:${uploadId}`;
  return await redis.set(key, token, "EX", ttlSeconds, "NX") ? { key, token } : null;
};

export const releaseAssetCreationLock = async (redis: Redis, lock: { key: string; token: string }) => {
  await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lock.key, lock.token);
};
