/**
 * Browser storage is an optional acceleration layer. A quota prompt, blocked
 * database or browser bug must never hold the product's primary path open.
 */
export async function bestEffortWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = globalThis.setTimeout(resolve, timeoutMs);
  });
  try {
    return await Promise.race([operation.catch(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}
