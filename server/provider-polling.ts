import { getProviderTask, ProviderRequestError, type ProviderTaskResult } from "./provider.js";

const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired"]);
const MAX_NOT_FOUND_FAILURES = 5;

export class ProviderPollingTerminalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderPollingTerminalError";
  }
}

export const providerReadCanRetry = (error: unknown, consecutiveFailures: number) => {
  if (!(error instanceof ProviderRequestError)) return false;
  if (error.status === "network") return true;
  if (error.status === 404) return consecutiveFailures < MAX_NOT_FOUND_FAILURES;
  return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
};

export const providerPollingRetryDelay = (consecutiveFailures: number, pollIntervalMs: number) =>
  Math.min(60_000, Math.max(pollIntervalMs, 1000 * 2 ** Math.min(6, Math.max(0, consecutiveFailures - 1))));

type PollingOptions = {
  providerId: string;
  deadlineAt: number;
  pollIntervalMs: number;
  shouldContinue: () => boolean | Promise<boolean>;
  onRetry?: (event: { error: unknown; consecutiveFailures: number; delayMs: number }) => void;
};

type PollingDependencies = {
  get: typeof getProviderTask;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
};

/** Polls the idempotent read endpoint without spending a BullMQ attempt on each transient failure. */
export const pollProviderTaskUntilTerminal = async (
  options: PollingOptions,
  dependencies: Partial<PollingDependencies> = {},
): Promise<ProviderTaskResult | null> => {
  const deps: PollingDependencies = {
    get: dependencies.get ?? getProviderTask,
    sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: dependencies.now ?? Date.now,
  };
  let consecutiveFailures = 0;
  while (deps.now() < options.deadlineAt) {
    if (!await options.shouldContinue()) return null;
    try {
      const result = await deps.get(options.providerId);
      consecutiveFailures = 0;
      if (terminalStatuses.has(result.status)) return result;
      const remaining = options.deadlineAt - deps.now();
      if (remaining > 0) await deps.sleep(Math.min(options.pollIntervalMs, remaining));
    } catch (error) {
      consecutiveFailures += 1;
      if (!providerReadCanRetry(error, consecutiveFailures)) {
        throw new ProviderPollingTerminalError(error instanceof Error ? error.message : "上游任务查询失败", { cause: error });
      }
      const remaining = options.deadlineAt - deps.now();
      if (remaining <= 0) break;
      const delayMs = Math.min(providerPollingRetryDelay(consecutiveFailures, options.pollIntervalMs), remaining);
      options.onRetry?.({ error, consecutiveFailures, delayMs });
      await deps.sleep(delayMs);
    }
  }
  throw new ProviderPollingTerminalError("视频生成超过六小时仍未返回终态，请通过任务编号联系管理员核查");
};
