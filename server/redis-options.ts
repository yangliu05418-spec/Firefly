import type { RedisOptions } from "ioredis";

// HTTP requests must fail quickly when Redis is unavailable. BullMQ workers,
// on the other hand, need an unbounded retry policy so durable jobs recover.
export const requestRedisOptions: RedisOptions = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 5_000,
};

export const queueRedisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
};
