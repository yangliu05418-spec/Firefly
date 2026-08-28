import type { MediaFile } from '../../../stores/mediaStore';
import { projectFileService } from '../../projectFileService';
import { PROJECT_FOLDERS } from '../core/constants';
import { buildRawTargetPath } from '../core/rawPath';

const CACHE_FOLDER = 'FireflyGenerated';
const inFlight = new Map<string, Promise<MaterializedFireflyMedia>>();

export interface MaterializedFireflyMedia {
  file: File;
  handle: FileSystemFileHandle;
  relativePath: string;
}

interface MaterializeDependencies {
  fetcher?: typeof fetch;
  projectHandle?: FileSystemDirectoryHandle;
  onProgress?: (progress: number) => void;
}

function safeAssetSegment(assetId: string): string {
  const value = assetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  if (!value || value === '.' || value === '..') throw new Error('Firefly asset id is invalid');
  return value;
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
): Promise<File> {
  if (!response.body) throw new Error('Firefly media response has no readable body');
  const writable = await handle.createWritable({ keepExistingData: false });
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
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

  const projectHandle = dependencies.projectHandle ?? projectFileService.getProjectHandle();
  if (!projectHandle || (!dependencies.projectHandle && projectFileService.activeBackend !== 'firefly')) {
    throw new Error('Firefly project storage is unavailable');
  }

  const target = buildRawTargetPath(
    `${CACHE_FOLDER}/${safeAssetSegment(assetId)}/${mediaFile.name}`,
    `${assetId}.bin`,
  );
  const raw = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW, { create: true });
  const folder = await navigate(raw, target.folderPath);
  const cached = await existingMaterializedFile(folder, target.fileName, mediaFile.fileSize);
  if (cached) {
    dependencies.onProgress?.(100);
    return { ...cached, relativePath: target.relativePath };
  }

  const response = await (dependencies.fetcher ?? fetch)(remoteSourcePath, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Firefly media download failed (${response.status})`);
  const responseSize = Number(response.headers.get('content-length')) || undefined;
  const expectedSize = mediaFile.fileSize || responseSize;
  if (mediaFile.fileSize && responseSize && mediaFile.fileSize !== responseSize) {
    throw new Error('Firefly media response size does not match the project asset');
  }

  const handle = await folder.getFileHandle(target.fileName, { create: true });
  const file = await streamResponseToFile(response, handle, expectedSize, dependencies.onProgress);
  return { file, handle, relativePath: target.relativePath };
}

/**
 * Streams a durable Firefly project asset into the active project's OPFS Raw
 * directory. The in-flight map prevents repeated drops from downloading the
 * same asset more than once; no fetch-to-Blob buffering is used.
 */
export function materializeFireflyRemoteMedia(
  mediaFile: MediaFile,
  dependencies: MaterializeDependencies = {},
): Promise<MaterializedFireflyMedia> {
  const assetId = mediaFile.fireflyProjectAssetId;
  if (!assetId) return Promise.reject(new Error('Firefly project asset id is missing'));
  const existing = inFlight.get(assetId);
  if (existing) return existing;

  const promise = materialize(mediaFile, dependencies).finally(() => {
    if (inFlight.get(assetId) === promise) inFlight.delete(assetId);
  });
  inFlight.set(assetId, promise);
  return promise;
}
