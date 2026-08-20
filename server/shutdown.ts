type ClosableWorker = { close: (force?: boolean) => Promise<void> };

export const closeWorkersWithin = async (workers: ClosableWorker[], graceMs: number) => {
  let timer: NodeJS.Timeout | undefined;
  const graceful = Promise.all(workers.map((worker) => worker.close(false))).then(() => true);
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), graceMs); });
  const completed = await Promise.race([graceful, timeout]);
  if (timer) clearTimeout(timer);
  // BullMQ memoizes the first close() promise, so a later close(true) cannot
  // upgrade an in-flight graceful close. The caller exits the process after
  // this deadline; its lock then expires and another worker recovers the job.
  return completed;
};
