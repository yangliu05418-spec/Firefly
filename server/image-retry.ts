type ProviderFailure = Error & { status?: number | "network" };

export const imageItemFailureAction = (error: unknown, hasItems: boolean, finalAttempt: boolean): "fail" | "retry" | "partial" => {
  const status = (error as ProviderFailure).status;
  const deterministic = typeof status === "number" && status < 500 && status !== 429;
  if (deterministic) return hasItems ? "partial" : "fail";
  return finalAttempt ? "partial" : "retry";
};

export const isTerminalImageJobFailure = (error: unknown, attemptsMade: number, attempts: number) =>
  (error as Error).name === "UnrecoverableError" || attemptsMade >= attempts;
