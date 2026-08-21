import { Redis } from "ioredis";
import { config } from "./config.js";
import { readWorkerHealth, workerRoles, type WorkerRole } from "./worker-heartbeat.js";

const requestedRole = process.argv[2];
if (!workerRoles.includes(requestedRole as WorkerRole)) {
  process.stderr.write(`invalid worker role: ${requestedRole ?? "missing"}\n`);
  process.exit(2);
}

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000 });
try {
  const health = await readWorkerHealth(redis);
  if (health.workers[requestedRole as WorkerRole].status !== "ready") process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
