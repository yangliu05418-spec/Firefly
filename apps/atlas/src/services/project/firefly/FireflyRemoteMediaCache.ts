import type { MediaFile } from '../../../stores/mediaStore';
import { projectFileService } from '../../projectFileService';
import { PROJECT_FOLDERS } from '../core/constants';
import { buildRawTargetPath } from '../core/rawPath';
import { materializeAtlasLocalMedia } from '../../../firefly/local-media';

const CACHE_FOLDER = 'FireflyGenerated';
const DEFAULT_TRANSFER_INACTIVITY_TIMEOUT_MS = 30_000;
const inFlightByProject = new WeakMap<
  FileSystemDirectoryHandle,
  Map<string, Promise<MaterializedFireflyMedia>>
>();
const sharedKernelInFlight = new Map<string, Promise<MaterializedFireflyMedia>>();

export interface MaterializedFireflyMedia {
  file: File;
  handle: FileSystemFileHandle;
  relativePath: string;
}

interface MaterializeDependencies {
  fetcher?: typeof fetch;
  projectHandle?: FileSystemDirectoryHandle;
  onProgress?: (progress: number) => void;
  requestInactivityTimeoutMs?: number;
}

async function waitForTransferActivity<T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('FIREFLY_MEDIA_DOWNLOAD_STALLED');
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function safeAssetSegment(assetId: string): string {
  const value = assetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  if (!value || value === '.' || value === '..') throw new Error('Firefly asset id is invalid');
  return value;
}

function getMaterializationIdentity(mediaFile: MediaFile): string {
  const assetId = mediaFile.fireflyProjectAssetId;
  if (!assetId) return '';
  const descriptor = mediaFile.localMediaDescriptor;
  return descriptor
    ? `${assetId}\u0000${descriptor.cacheKey}\u0000${descriptor.revision}`
    : assetId;
}

function getMaterializationFolder(mediaFile: MediaFile, assetId: string): string {
  const descriptor = mediaFile.localMediaDescriptor;
  if (!descriptor) return `${CACHE_FOLDER}/${safeAssetSegment(assetId)}`;
  return [
    CACHE_FOLDER,
    safeAssetSegment(assetId),
    safeAssetSegment(`${descriptor.cacheKey}-${descriptor.revision}`),
  ].join('/');
}

function getProjectInFlight(
  projectHandle: FileSystemDirectoryHandle,
): Map<string, Promise<MaterializedFireflyMedia>> {
  let projectInFlight = inFlightByProject.get(projectHandle);
  if (!projectInFlight) {
    projectInFlight = new Map();
    inFlightByProject.set(projectHandle, projectInFlight);
  }
  return projectInFlight;
}

async function navigate(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of path.split('/').filter(Boolean)) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

async function existingMaterializedFile(
  folder: FileSystemDirectoryHandle,
  fileName: string,
  expectedSize?: number,
): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  try {
    const handle = await folder.getFileHandle(fileName);
    const file = await handle.getFile();
    if (file.size > 0 && (!expectedSize || file.size === expectedSize)) return { file, handle };
    return null;
  } catch {
    return null;
  }
}

async function streamResponseToFile(
  response: Response,
  handle: FileSystemFileHandle,
  expectedSize: number | undefined,
  onProgress: ((progress: number) => void) | undefined,
  controller: AbortController,
  inactivityTimeoutMs: number,
): Promise<File> {
  if (!response.body) throw new Error('Firefly media response has no readable body');
  const writable = await handle.createWritable({ keepExistingData: false });
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await waitForTransferActivity(
        reader.read(),
        controller,
        inactivityTimeoutMs,
      );
      if (done) break;
      await writable.write(value);
      received += value.byteLength;
      if (expectedSize && expectedSize > 0) {
        onProgress?.(Math.min(99, Math.floor((received / expectedSize) * 100)));
      }
    }
    await writable.close();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await writable.abort(error).catch(() => undefined);
    throw error;
  }

  const file = await handle.getFile();
  if (file.size <= 0 || (expectedSize && file.size !== expectedSize)) {
    throw new Error('Firefly media cache size verification failed');
  }
  onProgress?.(100);
  return file;
}

async function materialize(
  mediaFile: MediaFile,
  dependencies: MaterializeDependencies,
): Promise<MaterializedFireflyMedia> {
  const assetId = mediaFile.fireflyProjectAssetId;
  const remoteSourcePath = mediaFile.remoteSourcePath;
  if (!assetId || !remoteSourcePath) throw new Error('Firefly remote media source is incomplete');

  if (mediaFile.localMediaDescriptor) {
    try {
      const shared = await materializeAtlasLocalMedia(mediaFile.localMediaDescriptor);
      dependencies.onProgress?.(100);
      return { ...shared, relativePath: `firefly-local-media/${mediaFile.localMediaDescriptor.cacheKey}` };
    } catch {
      // Feature-disabled, unavailable and quota-failure paths retain Atlas's
      // proven project-local streaming fallback below.
    }
  }

  const projectHandle = dependencies.projectHandle;
  if (!projectHandle) {
    throw new Error('Firefly project storage is unavailable');
  }

  const target = buildRawTargetPath(
    `${getMaterializationFolder(mediaFile, assetId)}/${mediaFile.name}`,
    `${assetId}.bin`,
  );
  const raw = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW, { create: true });
  const folder = await navigate(raw, target.folderPath);
  const cached = await existingMaterializedFile(folder, target.fileName, mediaFile.fileSize);
  if (cached) {
    dependencies.onProgress?.(100);
    return { ...cached, relativePath: target.relativePath };
  }

  const controller = new AbortController();
  const inactivityTimeoutMs = Math.max(
    1,
    dependencies.requestInactivityTimeoutMs ?? DEFAULT_TRANSFER_INACTIVITY_TIMEOUT_MS,
  );
  const response = await waitForTransferActivity(
    (dependencies.fetcher ?? fetch)(remoteSourcePath, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    }),
    controller,
    inactivityTimeoutMs,
  );
  if (!response.ok) throw new Error(`Firefly media download failed (${response.status})`);
  const responseSize = Number(response.headers.get('content-length')) || undefined;
  const expectedSize = mediaFile.fileSize || responseSize;
  if (mediaFile.fileSize && responseSize && mediaFile.fileSize !== responseSize) {
    throw new Error('Firefly media response size does not match the project asset');
  }

  const handle = await folder.getFileHandle(target.fileName, { create: true });
  const file = await streamResponseToFile(
    response,
    handle,
    expectedSize,
    dependencies.onProgress,
    controller,
    inactivityTimeoutMs,
  );
  return { file, handle, relativePath: target.relativePath };
}

/**
 * Streams a durable Firefly project asset into the active project's OPFS Raw
 * directory. The in-flight map prevents repeated drops of the same immutable
 * revision from downloading it more than once; revisions never share a
 * promise or fallback OPFS target. No fetch-to-Blob buffering is used.
 */
export function materializeFireflyRemoteMedia(
  mediaFile: MediaFile,
  dependencies: MaterializeDependencies = {},
): Promise<MaterializedFireflyMedia> {
  const assetId = mediaFile.fireflyProjectAssetId;
  if (!assetId) return Promise.reject(new Error('Firefly project asset id is missing'));
  const projectHandle = dependencies.projectHandle
    ?? (projectFileService.activeBackend === 'firefly'
      ? projectFileService.getProjectHandle() ?? undefined
      : undefined);

  const materializationIdentity = getMaterializationIdentity(mediaFile);
  const projectInFlight = projectHandle
    ? getProjectInFlight(projectHandle)
    : sharedKernelInFlight;
  const existing = projectInFlight.get(materializationIdentity);
  if (existing) return existing;

  const promise = materialize(mediaFile, { ...dependencies, projectHandle }).finally(() => {
    if (projectInFlight.get(materializationIdentity) === promise) {
      projectInFlight.delete(materializationIdentity);
    }
  });
  projectInFlight.set(materializationIdentity, promise);
  return promise;
}
