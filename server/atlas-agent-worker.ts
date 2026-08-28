import path from "node:path";
import { fileURLToPath } from "node:url";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { AtlasAgentProtocolError } from "./atlas-agent-contract.js";
import { config } from "./config.js";
import { AtlasAgentProviderError, OpenRouterAtlasAgentProvider } from "./atlas-agent-provider.js";
import { type AtlasAgentQueuePayload, AtlasAgentService } from "./atlas-agent-service.js";
import { AtlasAgentSqliteStore } from "./atlas-agent-store.js";
import { queueRedisOptions } from "./redis-options.js";
import { closeWorkersWithin } from "./shutdown.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";

export const ATLAS_AGENT_QUEUE_NAME = "atlas-agent";
export const createAtlasAgentQueue = (connection: Redis) => new Queue<AtlasAgentQueuePayload>(ATLAS_AGENT_QUEUE_NAME, { connection });

export const processAtlasAgentQueueJob = async (job: Pick<Job<AtlasAgentQueuePayload>, "data" | "attemptsMade" | "opts">, service: AtlasAgentService) => {
  try {
    return await service.processRun(job.data, { number: job.attemptsMade + 1, maximum: job.opts.attempts ?? 1 });
  } catch (error) {
    if (error instanceof AtlasAgentProtocolError || (error instanceof AtlasAgentProviderError && !error.retryable)) {
      throw new UnrecoverableError(error instanceof Error ? error.message : "Agent 任务不可恢复");
    }
    throw error;
  }
};

export const createAtlasAgentWorker = (input: {
  connection: Redis;
  service: AtlasAgentService;
  concurrency?: number;
  autorun?: boolean;
}) => {
  const worker = new Worker<AtlasAgentQueuePayload>(ATLAS_AGENT_QUEUE_NAME, (job) => processAtlasAgentQueueJob(job, input.service), {
    connection: input.connection,
    concurrency: Math.max(1, Math.min(4, input.concurrency ?? 2)),
    lockDuration: Math.max(240_000, config.atlasAgentRequestTimeoutMs + 60_000),
    autorun: input.autorun ?? false,
  });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({
      type: "atlas_agent_worker_failed",
      at: new Date().toISOString(),
      runId: job?.data.runId,
      userId: job?.data.ownerId,
      projectId: job?.data.projectId,
      attempt: job?.attemptsMade,
      code: (error as { code?: string }).code ?? "unknown",
    }));
  });
  return worker;
};

export const startAtlasAgentWorkerRuntime = async () => {
  const connection = new Redis(config.redisUrl, queueRedisOptions);
  connection.on("error", () => undefined);
  const store = AtlasAgentSqliteStore.open(config.databasePath);
  const service = new AtlasAgentService({
    store,
    provider: new OpenRouterAtlasAgentProvider(),
    maxToolCalls: config.atlasAgentMaxToolCalls,
  });
  const worker = createAtlasAgentWorker({ connection, service, concurrency: 2, autorun: false });
  const done = worker.run();
  try {
    await worker.waitUntilReady();
    const heartbeat = await startWorkerHeartbeat(connection, "atlas-agent");
    let stopped = false;
    return {
      worker,
      connection,
      store,
      service,
      done,
      shutdown: async () => {
        if (stopped) return true;
        stopped = true;
        await heartbeat.stop();
        const graceful = await closeWorkersWithin([worker], config.shutdownGraceMs);
        await connection.quit().catch(() => undefined);
        store.close();
        if (graceful) await done.catch(() => undefined);
        else void done.catch(() => undefined);
        return graceful;
      },
    };
  } catch (error) {
    await worker.close(true).catch(() => undefined);
    await connection.quit().catch(() => undefined);
    store.close();
    await done.catch(() => undefined);
    throw error;
  }
};

const runAsMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (runAsMain) {
  let runtime: Awaited<ReturnType<typeof startAtlasAgentWorkerRuntime>> | undefined;
  try {
    runtime = await startAtlasAgentWorkerRuntime();
    console.info(JSON.stringify({ type: "worker_started", at: new Date().toISOString(), worker: "atlas-agent", revision: config.revision }));
    let resolveSignal!: () => void;
    const signal = new Promise<void>((resolve) => { resolveSignal = resolve; });
    const stop = () => resolveSignal();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    await Promise.race([signal, runtime.done]);
  } catch (error) {
    console.error(JSON.stringify({
      type: "worker_start_failed", at: new Date().toISOString(), worker: "atlas-agent",
      code: (error as { code?: string }).code ?? "unknown", errorType: error instanceof Error ? error.name : typeof error,
    }));
    process.exitCode = 1;
  } finally {
    if (runtime) {
      const graceful = await runtime.shutdown();
      console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "atlas-agent", graceful }));
    }
  }
  process.exit(process.exitCode ?? 0);
}
