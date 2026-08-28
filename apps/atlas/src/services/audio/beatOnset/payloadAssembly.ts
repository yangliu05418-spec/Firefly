import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioArtifactRef } from '../audioArtifactTypes';
import {
  AUDIO_EVENT_LIST_PAYLOAD_VERSION,
  encodeAudioEventListPayload,
  eventsToFloat32,
  type AudioEvent,
} from '../beatOnsetManifest';
import type { BeatOnsetAnalysisContext } from './beatOnsetAnalysisTypes';

export const AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.audio-event-list';

export function summarizeOnsets(onsets: readonly AudioEvent[]) {
  const peakStrength = onsets.reduce((peak, event) => Math.max(peak, event.strength), 0);
  const averageStrength = onsets.length > 0
    ? onsets.reduce((sum, event) => sum + event.strength, 0) / onsets.length
    : 0;
  return {
    eventCount: onsets.length,
    averageStrength,
    peakStrength,
  };
}

export async function storeEventsPayload(input: {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  kind: 'onset-map' | 'beat-grid';
  cacheKey: string;
  analyzerVersion: string;
  generatedAt: string;
  events: readonly AudioEvent[];
  context: BeatOnsetAnalysisContext;
  now: () => string;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<AudioArtifactRef> {
  input.context.onProgress?.({
    jobId: input.context.jobId,
    mediaFileId: input.context.mediaFileId,
    sourceFingerprint: input.context.sourceFingerprint,
    onsetCacheKey: input.context.onsetCacheKey,
    beatCacheKey: input.context.beatCacheKey,
    phase: 'storing-payloads',
    percent: input.kind === 'onset-map' ? 72 : 90,
    timestamp: input.now(),
    message: `Storing ${input.kind} event payload`,
  });
  input.throwIfCancelled(input.context.signal, input.context.jobId);

  return input.artifactStore.putPayload(encodeAudioEventListPayload({
    header: {
      schemaVersion: AUDIO_EVENT_LIST_PAYLOAD_VERSION,
      kind: input.kind,
      eventCount: input.events.length,
      valueLayout: 'event-major',
      valueEncoding: 'time-strength-confidence-f32',
      timeUnit: 'seconds',
    },
    values: eventsToFloat32(input.events),
  }), {
    mediaFileId: input.mediaFileId,
    kind: input.kind,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    mimeType: AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE,
    encoding: 'raw',
    analyzerVersion: input.analyzerVersion,
    createdAt: input.generatedAt,
    sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
    metadata: {
      cacheKey: input.cacheKey,
      eventCount: input.events.length,
      valueEncoding: 'time-strength-confidence-f32',
    },
  });
}
