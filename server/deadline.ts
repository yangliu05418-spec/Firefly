export class OperationDeadlineExceeded extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation exceeded ${timeoutMs}ms deadline`);
    this.name = "OperationDeadlineExceeded";
  }
}

/** Bound dependency waits without changing the underlying operation's result. */
export const withinDeadline = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationDeadlineExceeded(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
