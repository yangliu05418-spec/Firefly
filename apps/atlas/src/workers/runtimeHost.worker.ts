import { attachRuntimeWorkerHost, type RuntimeWorkerGlobalScopeLike } from '../runtime/worker';
import { WORKER_RENDER_HOST_RUNTIME_HANDLERS } from '../services/render/workerRenderHostRuntimeHandlers';

attachRuntimeWorkerHost(self as unknown as RuntimeWorkerGlobalScopeLike, {
  handlers: WORKER_RENDER_HOST_RUNTIME_HANDLERS,
  includeStandardHandlers: true,
});

export {};
