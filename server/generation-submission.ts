import { UnrecoverableError } from "bullmq";
import type { StoredTask } from "./db.js";
import { createProviderTask, ProviderRequestError, type GenerationInput } from "./provider.js";

type SubmissionDependencies = {
  create: typeof createProviderTask;
  save: (task: StoredTask) => Promise<unknown>;
  now: () => number;
};

const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : "未知错误";

export const providerSubmissionCanRetry = (error: unknown) =>
  error instanceof ProviderRequestError && error.status === 429;

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
 * can create a second billable generation, so only an explicit 429 response is
 * returned to the queue for retry.
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
    if (providerSubmissionWasRejected(error)) throw new UnrecoverableError(message(error));
    throw new UnrecoverableError(`上游任务提交结果未知（${message(error)}）。为避免重复创建和重复计费，系统没有自动再次提交；请联系管理员核对上游任务列表后再决定是否重试。`);
  }
};
