import type { ClipAudioState, ClipAudioStemState, TimelineClip, TimelineTrack } from '../../../types';
import { STEM_SOURCE_LAYER_ID } from '../../../services/audio/stemSeparation';
import {
  getTimelineClipAudioSourceFileKey,
  isAudioCapableTimelineClip,
} from '../../../services/audio/audioClipResolution';

function compactAudioState(audioState: ClipAudioState): ClipAudioState | undefined {
  return Object.values(audioState).some(value => value !== undefined)
    ? audioState
    : undefined;
}

export function applyStemStateToClip(
  clip: TimelineClip,
  stemSeparation: ClipAudioStemState | undefined,
): TimelineClip {
  const audioState: ClipAudioState = { ...(clip.audioState ?? {}) };
  if (stemSeparation) {
    audioState.stemSeparation = stemSeparation;
  } else {
    delete audioState.stemSeparation;
  }
  delete audioState.processedAnalysisRefs;

  return {
    ...clip,
    audioState: compactAudioState(audioState),
  };
}

function getClipStemShareMediaFileId(clip: TimelineClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

export function clipsShareStemSource(sourceClip: TimelineClip, candidate: TimelineClip): boolean {
  if (!isAudioCapableTimelineClip(candidate)) return false;

  const sourceMediaFileId = getClipStemShareMediaFileId(sourceClip);
  const candidateMediaFileId = getClipStemShareMediaFileId(candidate);
  if (sourceMediaFileId && candidateMediaFileId) {
    return sourceMediaFileId === candidateMediaFileId;
  }

  const sourceFileKey = getTimelineClipAudioSourceFileKey(sourceClip);
  const candidateFileKey = getTimelineClipAudioSourceFileKey(candidate);
  return Boolean(sourceFileKey && candidateFileKey && sourceFileKey === candidateFileKey);
}

function cloneStemSeparationState(stemSeparation: ClipAudioStemState): ClipAudioStemState {
  return structuredClone(stemSeparation);
}

export function createSharedStemAvailabilityState(
  stemSeparation: ClipAudioStemState,
  existing: ClipAudioStemState | undefined,
): ClipAudioStemState {
  const shared = cloneStemSeparationState(stemSeparation);

  if (!existing || existing.sourceFingerprint !== stemSeparation.sourceFingerprint) {
    return {
      ...shared,
      mixMode: 'original',
      soloStemId: STEM_SOURCE_LAYER_ID,
      sourceGainDb: 0,
    };
  }

  const existingStemByKind = new Map(existing.stems.map(stem => [stem.kind, stem]));
  const existingSoloKind = existing.soloStemId === STEM_SOURCE_LAYER_ID
    ? null
    : existing.stems.find(stem => stem.id === existing.soloStemId)?.kind;
  const nextSoloStem = existingSoloKind
    ? shared.stems.find(stem => stem.kind === existingSoloKind)
    : null;

  return {
    ...shared,
    mixMode: existing.mixMode,
    soloStemId: existing.soloStemId === STEM_SOURCE_LAYER_ID
      ? STEM_SOURCE_LAYER_ID
      : nextSoloStem?.id,
    sourceGainDb: existing.sourceGainDb ?? 0,
    stems: shared.stems.map(stem => {
      const existingStem = existingStemByKind.get(stem.kind);
      return existingStem
        ? {
            ...stem,
            enabled: existingStem.enabled,
            gainDb: existingStem.gainDb,
          }
        : stem;
    }),
  };
}

function isTrackLocked(tracks: readonly TimelineTrack[], trackId: string | undefined): boolean {
  return !!trackId && tracks.find(track => track.id === trackId)?.locked === true;
}

export function applyStemStateToSourceCopies(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  sourceClipId: string,
  stemSeparation: ClipAudioStemState,
): { clips: TimelineClip[]; changedCount: number } {
  const sourceClip = clips.find(clip => clip.id === sourceClipId);
  if (!sourceClip) return { clips: [...clips], changedCount: 0 };

  let changedCount = 0;
  const nextClips = clips.map((clip) => {
    if (!clipsShareStemSource(sourceClip, clip)) return clip;
    if (clip.id !== sourceClipId && isTrackLocked(tracks, clip.trackId)) return clip;

    changedCount += 1;
    const nextStemState = clip.id === sourceClipId
      ? cloneStemSeparationState(stemSeparation)
      : createSharedStemAvailabilityState(stemSeparation, clip.audioState?.stemSeparation);
    return applyStemStateToClip(clip, nextStemState);
  });

  return { clips: nextClips, changedCount };
}

export function shareExistingStemStateWithClip(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  targetClipId: string,
): { clips: TimelineClip[]; changedCount: number; sourceClipId: string | null } {
  const targetClip = clips.find(clip => clip.id === targetClipId);
  if (
    !targetClip ||
    targetClip.audioState?.stemSeparation ||
    isTrackLocked(tracks, targetClip.trackId)
  ) {
    return { clips: [...clips], changedCount: 0, sourceClipId: null };
  }

  const sourceClip = clips.find(clip =>
    clip.id !== targetClip.id &&
    Boolean(clip.audioState?.stemSeparation) &&
    clipsShareStemSource(clip, targetClip)
  );
  const stemSeparation = sourceClip?.audioState?.stemSeparation;
  if (!sourceClip || !stemSeparation) {
    return { clips: [...clips], changedCount: 0, sourceClipId: null };
  }

  return {
    clips: clips.map(clip =>
      clip.id === targetClip.id
        ? applyStemStateToClip(clip, createSharedStemAvailabilityState(stemSeparation, undefined))
        : clip
    ),
    changedCount: 1,
    sourceClipId: sourceClip.id,
  };
}
