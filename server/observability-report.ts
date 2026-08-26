import { Redis } from "ioredis";
import { config } from "./config.js";
import { readJourneySlos } from "./journey-observability.js";
import { requestRedisOptions } from "./redis-options.js";

const limit = Math.min(1000, Math.max(1, Number(process.argv[2] ?? 100)));
const redis = new Redis(config.redisUrl, requestRedisOptions);
redis.on("error", () => undefined);

try {
  const [rows, slos] = await Promise.all([
    redis.xrevrange("observability:events", "+", "-", "COUNT", limit),
    readJourneySlos(redis, 60),
  ]);
  process.stdout.write(`${JSON.stringify({ type: "observability_summary", at: new Date().toISOString(), revision: config.revision, slos })}\n`);
  for (const [_id, fields] of rows.reverse()) {
    const payloadIndex = fields.indexOf("payload");
    if (payloadIndex >= 0 && fields[payloadIndex + 1]) process.stdout.write(`${fields[payloadIndex + 1]}\n`);
  }
} finally {
  redis.disconnect();
}
