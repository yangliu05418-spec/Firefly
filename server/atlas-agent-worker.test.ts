import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { AtlasAgentProviderError } from "./atlas-agent-provider.js";
import type { AtlasAgentService, AtlasAgentQueuePayload } from "./atlas-agent-service.js";
import { processAtlasAgentQueueJob } from "./atlas-agent-worker.js";

const payload: AtlasAgentQueuePayload = {
  runId: "run-1", ownerId: "user-a", projectId: "project-1", requestDigest: "digest",
  snapshot: { version: 1, revision: 0, durationMs: 0, tracks: [], clips: [], assets: [], selection: { clipIds: [], trackIds: [] } },
};

describe("Atlas Agent worker processor", () => {
  it("passes BullMQ attempt metadata to the durable service", async () => {
    const processRun = vi.fn(async () => ({ status: "ready" }));
    const service = { processRun } as unknown as AtlasAgentService;
    await processAtlasAgentQueueJob({ data: payload, attemptsMade: 1, opts: { attempts: 3 } }, service);
    expect(processRun).toHaveBeenCalledWith(payload, { number: 2, maximum: 3 });
  });

  it("turns deterministic provider failures into unrecoverable BullMQ failures", async () => {
    const service = {
      processRun: vi.fn(async () => { throw new AtlasAgentProviderError("AGENT_PROVIDER_REJECTED", "rejected", false, 400); }),
    } as unknown as AtlasAgentService;
    await expect(processAtlasAgentQueueJob({ data: payload, attemptsMade: 0, opts: { attempts: 3 } }, service)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
