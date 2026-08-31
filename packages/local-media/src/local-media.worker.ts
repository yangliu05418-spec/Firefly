/// <reference lib="webworker" />
import { localMediaContentHandle } from './paths';
import type { LocalMediaDescriptor } from './types';

type CacheRequest = { id: string; type: 'cache'; userId: string; descriptor: LocalMediaDescriptor };
type SeedRequest = { id: string; type: 'seed'; userId: string; descriptor: LocalMediaDescriptor; blob: Blob };
type CancelRequest = { id: string; type: 'cancel' };
type WorkerRequest = CacheRequest | SeedRequest | CancelRequest;

const controllers = new Map<string, AbortController>();

const errorCode = (error: unknown) => {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error && error.message) return error.message.slice(0, 80);
  return 'LOCAL_MEDIA_WORKER_FAILED';
};

const totalSizeFromResponse = (response: Response, offset: number) => {
  const range = response.headers.get('content-range')?.match(/\/([0-9]+)$/);
  if (range) return Number(range[1]);
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length >= 0 ? length + (response.status === 206 ? offset : 0) : undefined;
};

async function cache(request: CacheRequest) {
  const controller = new AbortController();
  controllers.set(request.id, controller);
  const handle = await localMediaContentHandle(request.userId, request.descriptor.cacheKey, true);
  const access = await handle.createSyncAccessHandle();
  let offset = access.getSize();
  let written = offset;
  try {
    const headers = new Headers();
    if (offset > 0) headers.set('Range', `bytes=${offset}-`);
    let response = await fetch(request.descriptor.url, { credentials: 'same-origin', cache: 'no-store', headers, signal: controller.signal });
    if (offset > 0 && response.status !== 206) {
      access.truncate(0);
      offset = 0;
      response = await fetch(request.descriptor.url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    }
    if (!response.ok || !response.body) throw new Error(`LOCAL_MEDIA_HTTP_${response.status}`);
    const expectedSize = request.descriptor.size ?? totalSizeFromResponse(response, offset);
    const reader = response.body.getReader();
    written = offset;
    self.postMessage({ id: request.id, type: offset ? 'resumed' : 'started', downloadedBytes: offset, expectedSize });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      let consumed = 0;
      while (consumed < chunk.value.byteLength) {
        const count = access.write(chunk.value.subarray(consumed), { at: written });
        if (count <= 0) throw new Error('LOCAL_MEDIA_PARTIAL_WRITE');
        consumed += count;
        written += count;
      }
      self.postMessage({ id: request.id, type: 'progress', downloadedBytes: written, expectedSize });
    }
    access.flush();
    if (expectedSize !== undefined && written !== expectedSize) throw new Error('LOCAL_MEDIA_SIZE_MISMATCH');
    self.postMessage({ id: request.id, type: 'ready', downloadedBytes: written, expectedSize });
  } catch (error) {
    try { access.flush(); } catch { /* partial bytes remain eligible for Range resume */ }
    self.postMessage({ id: request.id, type: 'failed', errorCode: errorCode(error), downloadedBytes: written });
  } finally {
    access.close();
    controllers.delete(request.id);
  }
}

async function seed(request: SeedRequest) {
  const handle = await localMediaContentHandle(request.userId, request.descriptor.cacheKey, true);
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    const reader = request.blob.stream().getReader();
    let written = 0;
    self.postMessage({ id: request.id, type: 'started', downloadedBytes: 0, expectedSize: request.blob.size });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      let consumed = 0;
      while (consumed < chunk.value.byteLength) {
        const count = access.write(chunk.value.subarray(consumed), { at: written });
        if (count <= 0) throw new Error('LOCAL_MEDIA_PARTIAL_WRITE');
        consumed += count; written += count;
      }
      self.postMessage({ id: request.id, type: 'progress', downloadedBytes: written, expectedSize: request.blob.size });
    }
    access.flush();
    if (written !== request.blob.size) throw new Error('LOCAL_MEDIA_SIZE_MISMATCH');
    self.postMessage({ id: request.id, type: 'ready', downloadedBytes: written, expectedSize: request.blob.size });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'failed', errorCode: errorCode(error), downloadedBytes: 0 });
  } finally { access.close(); }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'cancel') {
    controllers.get(event.data.id)?.abort();
    return;
  }
  void (event.data.type === 'seed' ? seed(event.data) : cache(event.data));
};

export {};
