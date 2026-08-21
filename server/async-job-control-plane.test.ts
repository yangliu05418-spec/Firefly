import { describe, expect, it, vi } from "vitest";

const wiring = vi.hoisted(() => ({
  stop: vi.fn(async () => undefined),
  start: vi.fn(),
  users: { source: "sqlite" },
  generation: { name: "generation" },
  image: { name: "image-generation" },
  canvas: { name: "canvas-jobs" },
}));

vi.mock("./async-job-outbox.js", () => ({
  startAsyncJobOutboxDispatcher: wiring.start,
}));
vi.mock("./store.js", () => ({ users: wiring.users }));
vi.mock("./redis.js", () => ({
  generationQueue: wiring.generation,
  imageGenerationQueue: wiring.image,
  canvasQueue: wiring.canvas,
}));

import { startAsyncJobControlPlane } from "./async-job-control-plane.js";

describe("async job control plane", () => {
  it("publishes every durable generation intent independently of worker processes", () => {
    wiring.start.mockReturnValue(wiring.stop);

    expect(startAsyncJobControlPlane()).toBe(wiring.stop);
    expect(wiring.start).toHaveBeenCalledWith(wiring.users, {
      generation: wiring.generation,
      "image-generation": wiring.image,
      "canvas-jobs": wiring.canvas,
    });
  });
});
