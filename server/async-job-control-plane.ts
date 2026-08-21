import { startAsyncJobOutboxDispatcher } from "./async-job-outbox.js";
import { canvasQueue, generationQueue, imageGenerationQueue } from "./redis.js";
import { users } from "./store.js";

/**
 * Publish durable SQLite job intents from the always-on Web control plane.
 * Consumers remain independent: a failed generation worker cannot prevent
 * image, video, or Canvas work from reaching its BullMQ queue.
 */
export const startAsyncJobControlPlane = () => startAsyncJobOutboxDispatcher(users, {
  generation: generationQueue,
  "image-generation": imageGenerationQueue,
  "canvas-jobs": canvasQueue,
});
