import { describe, expect, it } from "vitest";
import { queueRedisOptions, requestRedisOptions } from "./redis-options.js";

describe("Redis client roles", () => {
  it("bounds user-facing request commands", () => {
    expect(requestRedisOptions).toMatchObject({ maxRetriesPerRequest: 1, connectTimeout: 5_000, commandTimeout: 5_000 });
  });

  it("keeps BullMQ connections recoverable", () => {
    expect(queueRedisOptions.maxRetriesPerRequest).toBeNull();
  });
});
