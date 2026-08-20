export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
) {
  if (!items.length) return;
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(limit)));
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
}
