import { api, ApiError } from "./api";
import type { ComposerDraftState } from "./composer-draft-cache";
import { parseComposerRestorePayload, type ComposerRestorePayload } from "./composer-restore";

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
  const timer = window.setTimeout(finish, ms);
  const abort = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("请求已取消", "AbortError")); };
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
});

const retryable = (error: unknown) => error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500);

export const loadReeditPayload = async (endpoint: string, signal?: AbortSignal): Promise<ComposerRestorePayload> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return parseComposerRestorePayload(await api.get<unknown>(endpoint, { timeoutMs: 8_000, signal })); }
    catch (error) {
      lastError = error;
      if (signal?.aborted || !retryable(error) || attempt === 2) throw error;
      await wait([250, 750][attempt] ?? 750, signal);
    }
  }
  throw lastError;
};

export const hasMeaningfulComposerDraft = (state: ComposerDraftState | undefined) => Boolean(
  state && (state.prompt.trim() || state.assets.length),
);
