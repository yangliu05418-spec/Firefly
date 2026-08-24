import { UnrecoverableError } from "bullmq";
import type { StoredTask } from "./db.js";
import { createProviderTask, ProviderRequestError, type GenerationInput } from "./provider.js";

type SubmissionDependencies = {
  create: typeof createProviderTask;
  save: (task: StoredTask) => Promise<unknown>;
  now: () => number;
};

const unrecoverableProviderError = (error: ProviderRequestError, fallback?: string) => Object.assign(
  new UnrecoverableError(fallback ?? error.message),
  { errorCode: error.errorCode, providerCode: error.providerCode, providerRequestId: error.requestId, providerStage: error.stage },
);

export const providerSubmissionCanRetry = (error: unknown) =>
  error instanceof ProviderRequestError && (error.status === 429 || typeof error.status === "number" && error.status >= 500);

export const providerSubmissionWasRejected = (error: unknown) =>
  error instanceof ProviderRequestError
  && typeof error.status === "number"
  && error.status >= 400
  && error.status < 500
  && ![408, 409, 425, 429].includes(error.status);

/**
 * Crosses the non-idempotent ModelArk Create boundary exactly once.
 *
 * A persisted `submitting` task without a provider id means the process may
 * have lost the response after ModelArk accepted the task. Replaying that POST
 * can create a second billable generation, so only explicit rate-limit or
 * provider 5xx responses are returned to the bounded queue retry policy.
 */
export const submitProviderTaskOnce = async (
  task: StoredTask,
  input: GenerationInput,
  dependencies: Partial<SubmissionDependencies> & Pick<SubmissionDependencies, "save">,
) => {
  const deps: SubmissionDependencies = {
    create: dependencies.create ?? createProviderTask,
    save: dependencies.save,
    now: dependencies.now ?? Date.now,
  };
  if (task.providerId) return task;
  if (task.status === "submitting") {
    throw new UnrecoverableError("上游任务接纳响应未能确认。为避免重复创建和重复计费，系统没有自动再次提交；请联系管理员核对上游任务列表后再决定是否重试。");
  }

  const submitting: StoredTask = { ...task, request: input, status: "submitting", error: undefined, updatedAt: deps.now() };
  await deps.save(submitting);
  try {
    const created = await deps.create(input);
    if (!created.id) throw new Error("上游未返回任务 ID");
    const running: StoredTask = { ...submitting, providerId: created.id, status: "running", updatedAt: deps.now() };
    await deps.save(running);
    return running;
  } catch (error) {
    if (providerSubmissionCanRetry(error)) {
      await deps.save({ ...submitting, status: "queued", updatedAt: deps.now() });
      throw error;
    }
    if (providerSubmissionWasRejected(error) && error instanceof ProviderRequestError) throw unrecoverableProviderError(error);
    if (error instanceof ProviderRequestError) throw unrecoverableProviderError(error, `模型服务提交结果暂时无法确认。为避免重复创建和重复计费，系统没有自动再次提交；请通过 Case ID 联系管理员核查。`);
    throw new UnrecoverableError(`模型服务提交结果暂时无法确认。为避免重复创建和重复计费，系统没有自动再次提交；请通过 Case ID 联系管理员核查。`);
  }
};
