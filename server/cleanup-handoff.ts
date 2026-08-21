type RemovableJob = { remove(): Promise<unknown> };

export type TaskCleanupDependencies = {
  findGenerationJob(taskId: string): Promise<RemovableJob | undefined | null>;
  enqueueMediaDeletion(taskId: string): Promise<unknown>;
  reportFailure(stage: "generation_job_remove" | "media_delete_enqueue", taskId: string, error: unknown): void;
};

/**
 * Deletion is committed in SQLite before this handoff. Redis is only an
 * accelerator: neither a queue outage nor a stuck command may hold the HTTP
 * response open. Media Worker periodically reconciles durable tombstones.
 */
export const scheduleTaskCleanup = (taskId: string, deps: TaskCleanupDependencies) => {
  void deps.findGenerationJob(taskId)
    .then((job) => job?.remove())
    .catch((error) => deps.reportFailure("generation_job_remove", taskId, error));
  void deps.enqueueMediaDeletion(taskId)
    .catch((error) => deps.reportFailure("media_delete_enqueue", taskId, error));
};

export const scheduleBestEffort = (work: () => Promise<unknown>, reportFailure: (error: unknown) => void) => {
  void work().catch(reportFailure);
};
