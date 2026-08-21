import { users } from "./store.js";
import { generationQueue, mediaQueue, queueConnection, redis } from "./redis.js";

if (process.env.CONFIRM_CLEAR_GENERATION_HISTORY !== "yes") throw new Error("Set CONFIRM_CLEAR_GENERATION_HISTORY=yes to clear generation history");

await Promise.all([generationQueue.obliterate({ force: true }), mediaQueue.obliterate({ force: true })]);
let cursor = "0";
let redisKeys = 0;
do {
  const [next, keys] = await redis.scan(cursor, "MATCH", "task:*", "COUNT", 200);
  cursor = next;
  if (keys.length) { redisKeys += keys.length; await redis.del(...keys); }
} while (cursor !== "0");
cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, "MATCH", "tasks:*", "COUNT", 200);
  cursor = next;
  if (keys.length) { redisKeys += keys.length; await redis.del(...keys); }
} while (cursor !== "0");
users.clearGenerationHistory();
console.info(JSON.stringify({ type: "generation_history_cleared", redisKeys }));
await Promise.all([generationQueue.close(), mediaQueue.close()]);
await Promise.allSettled([redis.quit(), queueConnection.quit()]);
users.close();
