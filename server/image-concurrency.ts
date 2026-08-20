import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { redis } from "./redis.js";

const leaseKey = (userId: string) => `image-generation:compatibility-leases:${userId}`;
const leaseTtlMs = 20 * 60 * 1000;

export const acquireCompatibilityImageLease = async (userId: string, connection: Redis = redis) => {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await connection.eval(`
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
    return 1
  `, 1, leaseKey(userId), now, 2, now + leaseTtlMs, token, leaseTtlMs);
  return Number(result) === 1 ? token : null;
};

export const releaseCompatibilityImageLease = async (userId: string, token: string, connection: Redis = redis) => {
  await connection.zrem(leaseKey(userId), token);
};
