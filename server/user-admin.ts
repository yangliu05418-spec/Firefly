import { revokeUserSessions } from "./auth.js";
import { users } from "./db.js";
import { Redis } from "ioredis";
import { config } from "./config.js";

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const [command, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

try {
  if (command !== "disable" || !email) throw new Error("Usage: node dist-server/user-admin.js disable user@dokuai.tv");
  const user = users.disableByEmail(email);
  if (!user) throw new Error("User not found");
  await revokeUserSessions(redis, user.id);
  console.log(`Disabled ${user.email} and revoked active sessions.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await redis.quit();
  users.close();
}
