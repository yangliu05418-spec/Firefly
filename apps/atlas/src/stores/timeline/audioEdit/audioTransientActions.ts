import type { ClipAudioEditOperation, TimelineClip } from '../../../types';
import type {
  ApplyDetectedTransientSofteningOptions,
  AudioEditActions,
  SliceCreator,
} from '../types';
import {
  detectClipTransientRanges as detectClipTransientRangesForAudio,
  type AudioTransientRange,
} from '../../../services/audio/audioTransientDetection';
import { getClipAudioSourceRange } from '../../../services/audio/audioRepairSuggestionOperations';
import { Logger } from '../../../services/logger';
import { captureSnapshot } from '../../historyStore';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { createAudioEditOperationId, isAudioClip } from './audioEditHelpers';

const log = Logger.create('TimelineAudioEdit');

type TransientAudioEditActions = Pick<
  AudioEditActions,
  'detectClipTransientRanges' | 'applyDetectedTransientSoftening'
>;

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceSpan = Math.max(0.001, sourceRange.end - sourceRange.start);
  const ratio = Math.max(0, Math.min(1, (sourceTime - sourceRange.start) / sourceSpan));
  return clip.startTime + ratio * clip.duration;
}

function normalizeDetectedTransientRanges(
  clip: TimelineClip,
  ranges: readonly AudioTransientRange[],
): AudioTransientRange[] {
  const sourceRange = getClipAudioSourceRange(clip);
  return ranges
    .map(range => {
      const start = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(range.start, range.end)));
      const end = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(range.start, range.end)));
      return {
        start,
        end,
        duration: Math.max(0, end - start),
        peakDb: typeof range.peakDb === 'number' && Number.isFinite(range.peakDb) ? range.peakDb : -120,
        rmsDb: typeof range.rmsDb === 'number' && Number.isFinite(range.rmsDb) ? range.rmsDb : -120,
        crestDb: typeof range.crestDb === 'number' && Number.isFinite(range.crestDb) ? range.crestDb : 0,
        strength: typeof range.strength === 'number' && Number.isFinite(range.strength) ? range.strength : 0,
      };
    })
    .filter(range => range.duration > 0.001)
    .toSorted((a, b) => a.start - b.start);
}

async function resolveDetectedTransientRanges(
  clip: TimelineClip,
  options: ApplyDetectedTransientSofteningOptions,
): Promise<AudioTransientRange[]> {
  if (options.ranges?.length) {
    return options.ranges;
  }
  return detectClipTransientRangesForAudio(clip, options.detection ?? {});
}

export const createAudioTransientActions: SliceCreator<TransientAudioEditActions> = (set, get) => ({
  detectClipTransientRanges: async (clipId, options = {}) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot detect transients for missing or non-audio clip', { clipId });
      return [];
    }

    return detectClipTransientRangesForAudio(clip, options);
  },

  applyDetectedTransientSoftening: async (clipId, options = {}) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot soften detected transients for missing or non-audio clip', { clipId });
      return [];
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot soften detected transients on locked track', { clipId, trackId: clip.trackId });
      return [];
    }

    const ranges = normalizeDetectedTransientRanges(
      clip,
      await resolveDetectedTransientRanges(clip, options),
    );
    if (ranges.length === 0) {
      log.info('No detected transients to soften', { clipId });
      return [];
    }

    const now = Date.now();
    const operations: ClipAudioEditOperation[] = ranges.map((range, index) => ({
      id: createAudioEditOperationId(),
      type: 'repair',
      enabled: true,
      params: {
        label: 'Soften detected transient',
        repairType: 'transient-soften',
        detectedTransient: true,
        preserveClipDuration: true,
        gainDb: options.gainDb ?? -6,
        attackSeconds: options.attackSeconds ?? 0.002,
        releaseSeconds: options.releaseSeconds ?? 0.018,
        transientPeakDb: Number(range.peakDb.toFixed(3)),
        transientRmsDb: Number(range.rmsDb.toFixed(3)),
        transientCrestDb: Number(range.crestDb.toFixed(3)),
        transientStrength: Number(range.strength.toFixed(3)),
        sequenceIndex: index + 1,
        sequenceCount: ranges.length,
        timelineStart: sourceTimeToTimelineTime(clip, range.start),
        timelineEnd: sourceTimeToTimelineTime(clip, range.end),
      },
      timeRange: { start: range.start, end: range.end },
      createdAt: now + index,
    }));
    const operationIds = operations.map(operation => operation.id);

    captureSnapshot('Soften detected transients');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              ...operations,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return operationIds;
  },
});
