import type {
  ClipAudioEditOperation,
  MediaFileAudioAnalysisRefs,
  SpectralImageLayer,
  SpectralImageLayerKeyframe,
} from '../../../../types/audio';
import type { TimelineClip } from '../../../../types/timeline';
import type { AudioRepairSuggestion } from '../../../../services/audio/audioRepairSuggestions';
import type { AudioEditPreviewPhase } from '../../../../services/audio/AudioEditPreviewService';
import type { AudioRepairPreviewPhase } from '../../../../services/audio/AudioRepairPreviewService';

const OPERATION_LABELS: Record<ClipAudioEditOperation['type'], string> = {
  trim: 'Trim',
  cut: 'Cut',
  gain: 'Gain',
  silence: 'Silence',
  copy: 'Copy',
  paste: 'Paste',
  'insert-silence': 'Insert Silence',
  'delete-silence': 'Delete Silence',
  reverse: 'Reverse',
  'invert-polarity': 'Invert Polarity',
  'swap-channels': 'Swap Channels',
  'mono-sum': 'Mono Sum',
  'split-stereo': 'Split Stereo',
  repair: 'Repair',
  effect: 'Region FX',
  'room-tone-fill': 'Room Tone Fill',
  'spectral-mask': 'Spectral Mask',
  'spectral-resynthesis': 'Spectral Resynthesis',
};

export const SPECTRAL_LAYER_BLEND_MODES: SpectralImageLayer['blendMode'][] = [
  'attenuate',
  'boost',
  'gate',
  'sidechain-mask',
  'replace',
];

export function formatSeconds(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  return `${sign}${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function formatValue(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

export function getOperationLabel(operation: ClipAudioEditOperation): string {
  const label = operation.params?.label;
  if (typeof label === 'string' && label.trim()) return label;
  return OPERATION_LABELS[operation.type] ?? operation.type;
}

export function getOperationRange(operation: ClipAudioEditOperation): string {
  if (!operation.timeRange) return '-';
  return `${formatSeconds(operation.timeRange.start)} - ${formatSeconds(operation.timeRange.end)}`;
}

export function getTimelineRange(operation: ClipAudioEditOperation): string {
  const start = operation.params?.timelineStart;
  const end = operation.params?.timelineEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return '-';
  return `${formatSeconds(start)} - ${formatSeconds(end)}`;
}

export function getEffectiveAudioAnalysisRefs(clip: TimelineClip | undefined): MediaFileAudioAnalysisRefs | undefined {
  const source = clip?.audioState?.sourceAnalysisRefs;
  const processed = clip?.audioState?.processedAnalysisRefs;
  if (!source && !processed) {
    return undefined;
  }

  return {
    waveformPyramidId: processed?.processedWaveformPyramidId ??
      processed?.waveformPyramidId ??
      source?.waveformPyramidId,
    processedWaveformPyramidId: processed?.processedWaveformPyramidId ?? source?.processedWaveformPyramidId,
    spectrogramTileSetIds: firstNonEmptyRefs(processed?.spectrogramTileSetIds, source?.spectrogramTileSetIds),
    loudnessEnvelopeId: processed?.loudnessEnvelopeId ?? source?.loudnessEnvelopeId,
    beatGridId: processed?.beatGridId ?? source?.beatGridId,
    onsetMapId: processed?.onsetMapId ?? source?.onsetMapId,
    phaseCorrelationId: processed?.phaseCorrelationId ?? source?.phaseCorrelationId,
    transcriptTimingId: processed?.transcriptTimingId ?? source?.transcriptTimingId,
    frequencySummaryId: processed?.frequencySummaryId ?? source?.frequencySummaryId,
  };
}

export function formatFrequency(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

export function createSpectralLayerKeyframe(
  layer: SpectralImageLayer,
  clip: TimelineClip,
  playheadPosition: number,
): SpectralImageLayerKeyframe {
  const sourceTime = timelineTimeToClipSourceTime(clip, playheadPosition);
  return {
    id: createSpectralLayerKeyframeId(layer.id),
    time: clamp(sourceTime - layer.timeStart, 0, Math.max(0.001, layer.duration)),
    opacity: layer.opacity,
    gainDb: layer.gainDb,
    frequencyMin: layer.frequencyMin,
    frequencyMax: layer.frequencyMax,
  };
}

export function replaceSpectralLayerKeyframe(
  layer: SpectralImageLayer,
  keyframeId: string,
  patch: Partial<SpectralImageLayerKeyframe>,
): SpectralImageLayerKeyframe[] {
  return (layer.keyframes ?? [])
    .map(keyframe => keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe)
    .toSorted((a, b) => a.time - b.time);
}

export function formatSuggestionEvidence(suggestion: AudioRepairSuggestion): string {
  return Object.entries(suggestion.evidence)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(' | ');
}

export function isSuggestionApplied(editStack: ClipAudioEditOperation[], suggestion: AudioRepairSuggestion): boolean {
  return editStack.some(operation =>
    operation.enabled !== false &&
    operation.params?.repairSuggestionId === suggestion.id
  );
}

export function getPreviewButtonLabel(
  previewing: boolean,
  phase: AudioEditPreviewPhase | AudioRepairPreviewPhase | undefined,
  idleLabel = 'Preview',
): string {
  if (!previewing) return idleLabel;
  if (phase === 'rendering') return 'Rendering';
  if (phase === 'error') return 'Dismiss';
  return 'Stop';
}

function firstNonEmptyRefs<T>(preferred: T[] | undefined, fallback: T[] | undefined): T[] | undefined {
  return preferred && preferred.length > 0 ? preferred : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function createSpectralLayerKeyframeId(layerId: string): string {
  return `${layerId}-kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timelineTimeToClipSourceTime(clip: TimelineClip, timelineTime: number): number {
  const clipDuration = Math.max(0.001, clip.duration);
  const timelineRatio = clamp((timelineTime - clip.startTime) / clipDuration, 0, 1);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart + 0.001, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = sourceEnd - sourceStart;
  return clip.reversed
    ? sourceEnd - timelineRatio * sourceSpan
    : sourceStart + timelineRatio * sourceSpan;
}
