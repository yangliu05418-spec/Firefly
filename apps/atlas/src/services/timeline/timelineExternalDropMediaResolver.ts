import type { MediaFile, SignalAssetItem } from '../../stores/mediaStore';
import type { FileImportResult } from '../../stores/mediaStore/types';
import {
  isMediaFileImportResult,
  isSignalAssetImportResult,
} from '../../stores/mediaStore/helpers/importResult';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { createPrimaryMediaObjectUrl } from '../project/mediaObjectUrlManager';
import { Logger } from '../logger';
import { materializeFireflyRemoteMedia } from '../project/firefly/FireflyRemoteMediaCache';

const log = Logger.create('TimelineExternalDropMediaResolver');
const TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS = 750;
const fireflyTimelineMaterializations = new Map<string, Promise<File | null>>();
const fireflyTimelineMaterializationSources = new Map<string, MediaFile>();

type FileWithPath = File & { path?: string };

const CLIP_TYPED_MEDIA_TYPES = new Set<MediaFile['type']>(['gaussian-splat', 'lottie', 'rive', 'model']);

async function warmMaterializedVideoFilmstrip(
  mediaFile: MediaFile,
  localUrl: string,
): Promise<void> {
  if (mediaFile.type !== 'video') return;

  const timelineDuration = useTimelineStore.getState().clips
    .filter((clip) => (
      clip.source?.type === 'video'
      && (clip.source.mediaFileId ?? clip.mediaFileId) === mediaFile.id
    ))
    .reduce((duration, clip) => Math.max(
      duration,
      clip.source?.naturalDuration ?? 0,
      clip.outPoint ?? 0,
      clip.duration ?? 0,
    ), 0);
  const duration = mediaFile.duration && mediaFile.duration > 0
    ? mediaFile.duration
    : timelineDuration;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const { thumbnailCacheService } = await import('../thumbnailCacheService');
  const status = thumbnailCacheService.getStatus(mediaFile.id);
  if (status === 'generating' || status === 'error') {
    // A remote extraction may have raced the OPFS transfer. Reset that source
    // before starting from the now-authoritative local file.
    await thumbnailCacheService.clearSource(mediaFile.id);
  }
  await thumbnailCacheService.generateForSourceUrl(
    mediaFile.id,
    localUrl,
    duration,
    mediaFile.fileHash,
    'anonymous',
  );
}

function getFireflyTimelineMaterializationKey(mediaFile: MediaFile): string {
  const descriptor = mediaFile.localMediaDescriptor;
  const revision = descriptor
    ? `${descriptor.cacheKey}:${descriptor.revision}`
    : `${mediaFile.fireflyProjectAssetId ?? ''}:${mediaFile.remoteSourcePath ?? ''}:${mediaFile.fileSize ?? ''}`;
  return `${mediaFile.id}:${revision}`;
}

function isSameFireflyTimelineContent(left: MediaFile, right: MediaFile): boolean {
  if (
    left.id !== right.id
    || left.fireflyProjectAssetId !== right.fireflyProjectAssetId
  ) {
    return false;
  }

  const leftDescriptor = left.localMediaDescriptor;
  const rightDescriptor = right.localMediaDescriptor;
  if (!leftDescriptor || !rightDescriptor) {
    // A copying asset can gain its durable descriptor and media route while an
    // existing transfer is running. That is a metadata upgrade, not new bytes.
    return true;
  }

  return leftDescriptor.cacheKey === rightDescriptor.cacheKey
    && leftDescriptor.revision === rightDescriptor.revision;
}

function getCurrentFireflyTimelineMedia(mediaFile: MediaFile): MediaFile | undefined {
  const current = useMediaStore.getState().files.find((file) => file.id === mediaFile.id);
  return current && isSameFireflyTimelineContent(mediaFile, current) ? current : undefined;
}

export function materializeFireflyTimelineMedia(mediaFile: MediaFile): Promise<File | null> {
  const materializationKey = getFireflyTimelineMaterializationKey(mediaFile);
  const existing = fireflyTimelineMaterializations.get(materializationKey);
  if (existing) return existing;
  for (const [key, source] of fireflyTimelineMaterializationSources) {
    if (isSameFireflyTimelineContent(source, mediaFile)) {
      const sameContentMaterialization = fireflyTimelineMaterializations.get(key);
      if (sameContentMaterialization) return sameContentMaterialization;
    }
  }

  useMediaStore.setState((state) => ({
    files: state.files.map((currentFile) => (
      isSameFireflyTimelineContent(mediaFile, currentFile)
        ? { ...currentFile, remoteCacheStatus: 'downloading', remoteCacheProgress: 0 }
        : currentFile
    )),
  }));

  let shouldMaterializeCurrentRevision = false;
  const promise = (async (): Promise<File | null> => {
    try {
      const materialized = await materializeFireflyRemoteMedia(mediaFile, {
        onProgress: (progress) => {
          useMediaStore.setState((state) => ({
            files: state.files.map((currentFile) => (
              isSameFireflyTimelineContent(mediaFile, currentFile)
                ? { ...currentFile, remoteCacheProgress: progress }
                : currentFile
            )),
          }));
        },
      });
      const current = getCurrentFireflyTimelineMedia(mediaFile);
      if (!current) {
        // A genuinely newer content revision replaced this transfer. Never
        // publish stale bytes, but immediately continue with the current one.
        shouldMaterializeCurrentRevision = true;
        return materialized.file;
      }
      const expectedSize = current.localMediaDescriptor?.size ?? current.fileSize;
      if (expectedSize && expectedSize > 0 && materialized.file.size !== expectedSize) {
        throw new Error('Materialized Firefly media does not match the ready asset size');
      }

      const url = createPrimaryMediaObjectUrl(current.id, materialized.file);
      useMediaStore.setState((state) => ({
        files: state.files.map((currentFile) => (
          isSameFireflyTimelineContent(current, currentFile)
            ? {
                ...currentFile,
                file: materialized.file,
                url,
                projectPath: materialized.relativePath,
                hasFileHandle: true,
                remoteCacheStatus: 'ready',
                remoteCacheProgress: 100,
              }
            : currentFile
        )),
      }));
      await warmMaterializedVideoFilmstrip(current, url).catch((error) => {
        log.warn('Could not warm timeline filmstrip from materialized Firefly media', {
          mediaFileId: current.id,
          fireflyProjectAssetId: current.fireflyProjectAssetId,
          error,
        });
      });
      return materialized.file;
    } catch (error) {
      const current = useMediaStore.getState().files.find((file) => file.id === mediaFile.id);
      const sameContentSourceUpgraded = current
        && isSameFireflyTimelineContent(mediaFile, current)
        && (
          current.remoteSourcePath !== mediaFile.remoteSourcePath
          || getFireflyTimelineMaterializationKey(current) !== materializationKey
        );
      shouldMaterializeCurrentRevision = Boolean(current && (
        !isSameFireflyTimelineContent(mediaFile, current)
        || sameContentSourceUpgraded
      ));
      useMediaStore.setState((state) => ({
        files: state.files.map((currentFile) => (
          isSameFireflyTimelineContent(mediaFile, currentFile)
          && !sameContentSourceUpgraded
            ? { ...currentFile, remoteCacheStatus: 'error' }
            : currentFile
        )),
      }));
      log.warn('Could not materialize Firefly project asset for timeline drop', {
        mediaFileId: mediaFile.id,
        fireflyProjectAssetId: mediaFile.fireflyProjectAssetId,
        error,
      });
      return null;
    }
  })().finally(() => {
    if (fireflyTimelineMaterializations.get(materializationKey) === promise) {
      fireflyTimelineMaterializations.delete(materializationKey);
      fireflyTimelineMaterializationSources.delete(materializationKey);
    }
    if (shouldMaterializeCurrentRevision) {
      const current = useMediaStore.getState().files.find((file) => file.id === mediaFile.id);
      if (
        current?.fireflyProjectAssetId
        && current.remoteSourcePath
        && (!current.file || current.file.size <= 0)
      ) {
        void materializeFireflyTimelineMedia(current);
      }
    }
  });

  fireflyTimelineMaterializations.set(materializationKey, promise);
  fireflyTimelineMaterializationSources.set(materializationKey, mediaFile);
  return promise;
}

export function setTimelineDroppedFilePath(file: File, filePath?: string): void {
  if (filePath) {
    (file as FileWithPath).path = filePath;
  }
}

export function getTimelineDropMediaTypeOverride(mediaFile: MediaFile): string | undefined {
  return CLIP_TYPED_MEDIA_TYPES.has(mediaFile.type) ? mediaFile.type : undefined;
}

function getPlaceholderMimeType(mediaFile: MediaFile): string {
  const name = mediaFile.name.toLowerCase();

  if (mediaFile.type === 'model') {
    if (name.endsWith('.glb')) return 'model/gltf-binary';
    if (name.endsWith('.gltf')) return 'model/gltf+json';
    if (name.endsWith('.obj')) return 'model/obj';
  }

  if (mediaFile.type === 'gaussian-splat') {
    if (name.endsWith('.ply')) return 'application/octet-stream';
    if (name.endsWith('.spz')) return 'application/octet-stream';
  }

  return '';
}

export function createPlaceholderFileForTimelineMedia(mediaFile: MediaFile): File {
  const file = new File([], mediaFile.name, { type: getPlaceholderMimeType(mediaFile) });
  setTimelineDroppedFilePath(file, mediaFile.absolutePath ?? mediaFile.filePath);
  return file;
}

function mediaFileHasLazy3DSource(mediaFile: MediaFile): boolean {
  if (mediaFile.file || mediaFile.url || mediaFile.absolutePath || mediaFile.projectPath) {
    return true;
  }

  if (mediaFile.modelSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.modelUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  )) {
    return true;
  }

  return Boolean(mediaFile.gaussianSplatSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.splatUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  ));
}

function findMatchingMediaFile(file: File, excludedIds?: Set<string>): MediaFile | null {
  const mediaFiles = useMediaStore.getState().files;
  return mediaFiles.find((mediaFile) =>
    mediaFile.name === file.name &&
    mediaFile.fileSize === file.size &&
    !excludedIds?.has(mediaFile.id)
  ) ?? null;
}

async function waitForTimelineDropImportPlaceholder(
  file: File,
  excludedIds: Set<string>,
  timeoutMs = TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS,
): Promise<MediaFile | null> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    const placeholder = findMatchingMediaFile(file, excludedIds);
    if (placeholder) {
      return placeholder;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  return null;
}

export type TimelineDropImportResult =
  | { kind: 'media-file'; mediaFile: MediaFile }
  | { kind: 'signal-asset'; signalAsset: SignalAssetItem };

function firstTimelineDropImportResult(
  result: FileImportResult | FileImportResult[],
): TimelineDropImportResult | null {
  const results = Array.isArray(result) ? result : [result];
  const mediaFile = results.find(isMediaFileImportResult);
  if (mediaFile) {
    return { kind: 'media-file', mediaFile };
  }

  const signalAsset = results.find(isSignalAssetImportResult);
  return signalAsset ? { kind: 'signal-asset', signalAsset } : null;
}

export async function resolveTimelineDropImportResult(params: {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  waitForMediaPlaceholder?: boolean;
}): Promise<TimelineDropImportResult | null> {
  const { file, handle, absolutePath, waitForMediaPlaceholder = true } = params;
  const existing = findMatchingMediaFile(file);
  if (existing) {
    return { kind: 'media-file', mediaFile: existing };
  }

  const mediaStore = useMediaStore.getState();
  const excludedIds = new Set(mediaStore.files.map((mediaFile) => mediaFile.id));
  const importPromise: Promise<FileImportResult | FileImportResult[]> = handle
    ? mediaStore.importFilesWithHandles([{ file, handle, absolutePath }])
    : mediaStore.importFile(file);
  void importPromise.catch(() => undefined);

  const placeholder = waitForMediaPlaceholder
    ? await waitForTimelineDropImportPlaceholder(file, excludedIds)
    : null;
  if (placeholder) {
    void importPromise.catch((error) => {
      log.warn('Timeline drop media import failed after placeholder creation', {
        name: file.name,
        error,
      });
    });
    return { kind: 'media-file', mediaFile: placeholder };
  }

  try {
    return firstTimelineDropImportResult(await importPromise);
  } catch (error) {
    log.warn('Timeline drop media import failed', { name: file.name, error });
    return null;
  }
}

export async function resolveTimelineDropMediaFile(params: {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}): Promise<MediaFile | null> {
  const result = await resolveTimelineDropImportResult(params);
  return result?.kind === 'media-file' ? result.mediaFile : null;
}

export async function resolveMediaFileForTimelineDrop(mediaFile: MediaFile): Promise<File | null> {
  // A zero-byte File is Atlas' lazy clip-admission placeholder, not a usable
  // local media source. Treating it as materialized bypasses OPFS recovery and
  // the editor's native thumbnail cache, leaving a permanent generic icon.
  if (mediaFile.file && mediaFile.file.size > 0) {
    return mediaFile.file;
  }

  if (mediaFile.fireflyProjectAssetId && mediaFile.remoteSourcePath) {
    const materialization = materializeFireflyTimelineMedia(mediaFile);

    // Firefly project assets already have a stable, authenticated remote URL.
    // Creating the timeline clip must not wait for the complete object to be
    // copied into OPFS. The renderer resolves the source by mediaFileId and can
    // play that URL immediately; the original file is materialized in the
    // background for subsequent scrubbing and offline editing.
    if (mediaFile.type === 'video' || mediaFile.type === 'image') {
      void materialization;
      const contentType = mediaFile.type === 'image'
        ? (mediaFile.name.toLowerCase().endsWith('.png') ? 'image/png' : mediaFile.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')
        : mediaFile.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
      return new File([], mediaFile.name, { type: contentType });
    }

    return materialization;
  }

  if (mediaFile.type === 'model' || mediaFile.type === 'gaussian-splat') {
    return mediaFileHasLazy3DSource(mediaFile) ? createPlaceholderFileForTimelineMedia(mediaFile) : null;
  }

  const nativeReferenceUrl = NativeHelperClient.parseFileReferenceUrl(mediaFile.url)
    ? mediaFile.url
    : mediaFile.absolutePath
      ? NativeHelperClient.getFileReferenceUrl(mediaFile.absolutePath)
      : null;

  if (!nativeReferenceUrl) {
    return null;
  }

  try {
    const file = await NativeHelperClient.getReferencedFile(nativeReferenceUrl, mediaFile.name);
    if (!file) {
      return null;
    }

    const referencedPath = NativeHelperClient.parseFileReferenceUrl(nativeReferenceUrl) ?? mediaFile.absolutePath;
    setTimelineDroppedFilePath(file, referencedPath ?? undefined);
    const url = createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });

    useMediaStore.setState((state) => ({
      files: state.files.map((currentFile) =>
        currentFile.id === mediaFile.id
          ? {
              ...currentFile,
              file,
              url,
              hasFileHandle: true,
              absolutePath: currentFile.absolutePath ?? referencedPath ?? undefined,
            }
          : currentFile
      ),
    }));

    return file;
  } catch (error) {
    log.warn('Could not resolve restored media file for timeline drop', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      error,
    });
    return null;
  }
}

/**
 * Makes a persisted Firefly project asset available through the same real
 * File/object-URL contract used by Atlas' original local import pipeline.
 * Visible timeline warmups call this after project restore so an existing clip
 * does not need to be dragged again before its native filmstrip can recover.
 */
export function ensureFireflyTimelineMediaMaterialized(mediaFileId: string): Promise<File | null> {
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (!mediaFile) return Promise.resolve(null);
  if (mediaFile.file && mediaFile.file.size > 0) return Promise.resolve(mediaFile.file);
  if (!mediaFile.fireflyProjectAssetId || !mediaFile.remoteSourcePath) return Promise.resolve(null);
  return materializeFireflyTimelineMedia(mediaFile);
}
