import { Redis } from "ioredis";
import { config } from "./config.js";
import { createImageGenerationWorker } from "./image-generation-worker.js";
import { closeWorkersWithin } from "./shutdown.js";
import { users } from "./store.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const worker = createImageGenerationWorker(connection);

await worker.waitUntilReady();
const heartbeat = await startWorkerHeartbeat(connection, "image");

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await heartbeat.stop();
  const graceful = await closeWorkersWithin([worker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "image", graceful }));
  await connection.quit();
  users.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
