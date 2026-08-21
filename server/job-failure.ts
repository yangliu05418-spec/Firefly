import { UnrecoverableError } from "bullmq";

export const isUnrecoverableJobError = (error: unknown) =>
  error instanceof UnrecoverableError || (error instanceof Error && error.name === "UnrecoverableError");

/**
 * BullMQ bypasses remaining attempts for UnrecoverableError. Business state
 * must therefore finalize immediately instead of waiting for attemptsMade to
 * reach the configured retry count.
 */
export const shouldFinalizeJobFailure = (error: unknown, attemptsMade: number, maxAttempts: number) =>
  isUnrecoverableJobError(error) || attemptsMade >= maxAttempts;
