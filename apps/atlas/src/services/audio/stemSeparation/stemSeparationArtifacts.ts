import type { SignalMetadata } from '../../../signals';
import { encodeFloat32PcmChunksToWavBlob } from '../../../engine/audio/AudioFileEncoder';
import type { MediaFile, MediaFolder } from '../../../stores/mediaStore';
import type { AudioChannelLayout, AudioArtifactRef } from '../audioArtifactTypes';
import type { ClipAudioStemLayer, MediaFileStemInfo } from '../../../types/audio';
import type { ClipStemSeparationRunnerRequest } from '../../../stores/timeline/types';
import { AudioArtifactStore } from '../AudioArtifactStore';
import { Logger } from '../../logger';
import {
  CLIP_AUDIO_ANALYSIS_DECODER_VERSION,
  SOURCE_AUDIO_ANALYSIS_DECODER_ID,
  type PreparedClipAudioAnalysisInput,
} from '../ClipAudioAnalysisOrchestrator';
import {
  createStemPcmF32Metadata,
  encodeStemPcmF32Payload,
  STEM_PCM_F32_MIME_TYPE,
} from './stemPcm';
import { createStemWaveformPreview } from './stemWaveformPreview';
import type {
  StemModelCatalogEntry,
  StemSeparationWorkerStemResult,
} from './types';
import { stemLabel, type StoredStemLayer } from './stemSeparationJob';
import {
  STEM_MEDIA_PROGRESS,
  throwIfStemSeparationAborted,
} from './stemSeparationProgress';

const STEM_SEPARATION_DECODER_ID = 'masterselects.stem-separation-worker';
const STEM_SEPARATION_ANALYZER_ID = 'masterselects.stem-separation';
const STEM_SEPARATION_ANALYZER_VERSION = '1.0.0';
const STEM_MEDIA_ROOT_FOLDER_NAME = 'Stems';

const log = Logger.create('StemSeparationArtifacts');

export interface StemMediaLibraryStore {
  folders: MediaFolder[];
  createFolder: (name: string, parentId?: string | null) => MediaFolder;
  importFile: (
    file: File,
    parentId?: string | null,
    options?: { forceCopyToProject?: boolean; projectFileName?: string; stemInfo?: MediaFileStemInfo },
  ) => Promise<unknown>;
}

function channelLayoutForCount(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) {
    return { kind: 'mono', channelCount, labels: ['M'] };
  }
  if (channelCount === 2) {
    return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  }
  return { kind: 'discrete', channelCount };
}

function createStemSeparationAnalyzerVersion(model: StemModelCatalogEntry): string {
  return `${STEM_SEPARATION_ANALYZER_ID}:${STEM_SEPARATION_ANALYZER_VERSION}:${model.modelVersion}`;
}

function logicalStemArtifactId(input: {
  mediaFileId: string;
  sourceFingerprint: string;
  modelId: string;
  activeSetId: string;
  stemKind: string;
}): string {
  return [
    'audio',
    'stem-separation',
    input.mediaFileId,
    input.sourceFingerprint,
    input.modelId,
    input.activeSetId,
    input.stemKind,
  ].join(':');
}

function createStemManifestMetadata(input: {
  activeSetId: string;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  stem: StemSeparationWorkerStemResult;
  payloadRef: AudioArtifactRef;
  createdAt: number;
  frameCount: number;
  channelCount: number;
  duration: number;
}): SignalMetadata {
  return {
    stemSeparationManifest: {
      schemaVersion: 1,
      activeSetId: input.activeSetId,
      modelId: input.model.id,
      modelVersion: input.model.modelVersion,
      sourceFingerprint: input.prepared.sourceFingerprint,
      sourceMediaFileId: input.prepared.mediaFileId,
      sourceRangeStart: 0,
      sourceRangeEnd: input.prepared.sourceBuffer.duration,
      stemKind: input.stem.kind,
      outputStemOrder: input.model.outputStemOrder,
      payloadArtifactId: input.payloadRef.artifactId,
      payloadEncoding: 'planar-f32',
      sampleRate: input.stem.sampleRate,
      channelCount: input.channelCount,
      frameCount: input.frameCount,
      duration: input.duration,
      normalizationPolicy: 'model-native',
      createdAt: input.createdAt,
    },
    activeSetId: input.activeSetId,
    modelId: input.model.id,
    modelVersion: input.model.modelVersion,
    stemKind: input.stem.kind,
    sourceDecoderId: input.prepared.decoderId,
    sourceDecoderVersion: input.prepared.decoderVersion,
    sourceClipId: input.prepared.metadata.sourceClipId ?? '',
  };
}

function createStemMediaFileInfo(input: {
  activeSetId: string;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  request: ClipStemSeparationRunnerRequest;
  stem: StemSeparationWorkerStemResult;
  createdAt: number;
}): MediaFileStemInfo {
  const sourceClipId = typeof input.prepared.metadata.sourceClipId === 'string'
    ? input.prepared.metadata.sourceClipId
    : undefined;
  const sourceClipName = typeof input.prepared.metadata.sourceClipName === 'string'
    ? input.prepared.metadata.sourceClipName
    : undefined;

  return {
    schemaVersion: 1,
    sourceMediaFileId: input.prepared.mediaFileId,
    sourceFingerprint: input.prepared.sourceFingerprint,
    sourceClipId: sourceClipId ?? input.request.clip.id,
    sourceClipName: sourceClipName ?? input.request.clip.name,
    activeSetId: input.activeSetId,
    modelId: input.model.id,
    modelVersion: input.model.modelVersion,
    kind: input.stem.kind,
    label: stemLabel(input.stem.kind),
    createdAt: input.createdAt,
  };
}

export async function storeStemSeparationResults(input: {
  request: ClipStemSeparationRunnerRequest;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  stems: readonly StemSeparationWorkerStemResult[];
  artifactStore: AudioArtifactStore;
  getMediaLibraryStore: () => StemMediaLibraryStore;
  publishStemFilesToMediaLibrary: boolean;
  now: () => number;
}): Promise<StoredStemLayer[]> {
  const activeSetId = `stem-set:${input.request.jobId}`;
  const createdAt = input.now();
  const createdAtIso = new Date(createdAt).toISOString();
  const analyzerVersion = createStemSeparationAnalyzerVersion(input.model);
  const stored: StoredStemLayer[] = [];

  for (const stem of input.stems) {
    throwIfStemSeparationAborted(input.request.signal);
    const frameCount = stem.channels[0]?.length ?? 0;
    const channelCount = stem.channels.length;
    const duration = frameCount / stem.sampleRate;
    const pcmMetadata = createStemPcmF32Metadata({
      channels: stem.channels,
      sampleRate: stem.sampleRate,
      normalizationPolicy: 'model-native',
    });
    const payloadMetadata: SignalMetadata = {
      ...pcmMetadata,
      activeSetId,
      modelId: input.model.id,
      modelVersion: input.model.modelVersion,
      stemKind: stem.kind,
      sourceFingerprint: input.prepared.sourceFingerprint,
    };
    const payloadRef = await input.artifactStore.putPayload(encodeStemPcmF32Payload({
      channels: stem.channels,
      sampleRate: stem.sampleRate,
      normalizationPolicy: 'model-native',
    }), {
      mediaFileId: input.prepared.mediaFileId,
      kind: 'stem-separation',
      sourceFingerprint: input.prepared.sourceFingerprint,
      mimeType: STEM_PCM_F32_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion,
      createdAt: createdAtIso,
      sourceRefs: [
        `clip:${input.request.clip.id}`,
        `stem-set:${activeSetId}`,
        `stem:${stem.kind}`,
      ],
      metadata: payloadMetadata,
    });
    const artifactId = logicalStemArtifactId({
      mediaFileId: input.prepared.mediaFileId,
      sourceFingerprint: input.prepared.sourceFingerprint,
      modelId: input.model.id,
      activeSetId,
      stemKind: stem.kind,
    });
    const artifact = await input.artifactStore.putAnalysisArtifact({
      id: artifactId,
      kind: 'stem-separation',
      mediaFileId: input.prepared.mediaFileId,
      sourceFingerprint: input.prepared.sourceFingerprint,
      decoderId: STEM_SEPARATION_DECODER_ID,
      decoderVersion: `${SOURCE_AUDIO_ANALYSIS_DECODER_ID}:${CLIP_AUDIO_ANALYSIS_DECODER_VERSION}`,
      analyzerVersion,
      sampleRate: stem.sampleRate,
      channelLayout: channelLayoutForCount(channelCount),
      duration,
      payloadRefs: [payloadRef],
      createdAt,
      stale: false,
      metadata: createStemManifestMetadata({
        activeSetId,
        model: input.model,
        prepared: input.prepared,
        stem,
        payloadRef,
        createdAt,
        frameCount,
        channelCount,
        duration,
      }),
    });

    stored.push({
      sampleRate: stem.sampleRate,
      channelCount,
      frameCount,
      duration,
      layer: {
        id: `stem-${input.request.jobId}-${stem.kind}`,
        kind: stem.kind,
        label: stemLabel(stem.kind),
        analysisArtifactId: artifact.artifact.id,
        manifestArtifactId: artifact.artifact.manifestRef.artifactId,
        payloadRef,
        waveform: createStemWaveformPreview(stem.channels),
        enabled: true,
        gainDb: 0,
        phaseAligned: true,
        modelId: input.model.id,
        sourceFingerprint: input.prepared.sourceFingerprint,
      },
    });
  }

  if (input.publishStemFilesToMediaLibrary) {
    input.request.updateProgress({
      phase: 'storing',
      progress: STEM_MEDIA_PROGRESS,
      message: 'Adding stem WAV files to the media library.',
    });

    try {
      const publishedIds = await publishStemWavFilesToMediaLibrary({
        request: input.request,
        model: input.model,
        prepared: input.prepared,
        stems: input.stems,
        activeSetId,
        createdAt,
        getMediaLibraryStore: input.getMediaLibraryStore,
      });

      for (const layer of stored) {
        const mediaFileId = publishedIds.get(layer.layer.kind);
        if (mediaFileId) {
          layer.layer.mediaFileId = mediaFileId;
        }
      }
    } catch (error) {
      log.warn('Failed to add stem WAV files to the media library', { error });
    }
  }

  return stored;
}

async function publishStemWavFilesToMediaLibrary(input: {
  request: ClipStemSeparationRunnerRequest;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  stems: readonly StemSeparationWorkerStemResult[];
  activeSetId: string;
  createdAt: number;
  getMediaLibraryStore: () => StemMediaLibraryStore;
}): Promise<Map<ClipAudioStemLayer['kind'], string>> {
  if (typeof File === 'undefined') {
    return new Map();
  }

  const sourceFolderName = createStemMediaFolderName(input.prepared, input.request);
  const rootFolderId = getOrCreateMediaFolder(input.getMediaLibraryStore, STEM_MEDIA_ROOT_FOLDER_NAME, null);
  const sourceFolderId = getOrCreateMediaFolder(input.getMediaLibraryStore, sourceFolderName, rootFolderId);
  const importedIds = new Map<ClipAudioStemLayer['kind'], string>();

  for (const stem of input.stems) {
    throwIfStemSeparationAborted(input.request.signal);
    const stemFileName = createStemFileName(sourceFolderName, stem.kind);
    const wavBlob = encodeFloat32PcmChunksToWavBlob({
      sampleRate: stem.sampleRate,
      channelCount: stem.channels.length,
      frameCount: stem.channels[0]?.length ?? 0,
      chunks: [{
        channels: stem.channels,
        frameCount: stem.channels[0]?.length ?? 0,
      }],
    });
    const file = new File([wavBlob], stemFileName, {
      type: 'audio/wav',
      lastModified: input.createdAt,
    });
    const imported = await input.getMediaLibraryStore().importFile(file, sourceFolderId, {
      forceCopyToProject: true,
      projectFileName: `${STEM_MEDIA_ROOT_FOLDER_NAME}/${sourceFolderName}/${stemFileName}`,
      stemInfo: createStemMediaFileInfo({
        activeSetId: input.activeSetId,
        model: input.model,
        prepared: input.prepared,
        request: input.request,
        stem,
        createdAt: input.createdAt,
      }),
    });
    if (isImportedAudioMediaFile(imported)) {
      importedIds.set(stem.kind, imported.id);
    }
  }

  return importedIds;
}

function getOrCreateMediaFolder(
  getStore: () => StemMediaLibraryStore,
  name: string,
  parentId: string | null,
): string {
  const store = getStore();
  const existing = store.folders.find(folder => folder.name === name && folder.parentId === parentId);
  return existing?.id ?? store.createFolder(name, parentId).id;
}

function isImportedAudioMediaFile(value: unknown): value is MediaFile {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<MediaFile>).type === 'audio' &&
    typeof (value as Partial<MediaFile>).id === 'string',
  );
}

function sanitizeStemPathPart(value: string, fallback: string): string {
  const sanitized = Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized.slice(0, 120) : fallback;
}

function stripFileExtension(value: string): string {
  const lastDot = value.lastIndexOf('.');
  return lastDot > 0 ? value.slice(0, lastDot) : value;
}

function createStemMediaFolderName(
  prepared: PreparedClipAudioAnalysisInput,
  request: ClipStemSeparationRunnerRequest,
): string {
  const metadataName = typeof prepared.metadata.sourceClipName === 'string'
    ? prepared.metadata.sourceClipName
    : '';
  const rawName = metadataName
    || request.requestedClip.name
    || request.clip.name
    || request.requestedClip.file?.name
    || request.clip.file?.name
    || 'Source Clip';
  return sanitizeStemPathPart(stripFileExtension(rawName), 'Source Clip');
}

function createStemFileName(sourceFolderName: string, stemKind: ClipAudioStemLayer['kind']): string {
  return sanitizeStemPathPart(`${sourceFolderName} - ${stemLabel(stemKind)}.wav`, `${stemLabel(stemKind)}.wav`);
}
