import type { Composition } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { FixtureClipSummary, FixtureCompositionSummary } from './model';
import type { FixtureTimelineClip } from './clipSegments';

export function summarizeClips(clips: FixtureTimelineClip[]): FixtureClipSummary[] {
  const keyframes = useTimelineStore.getState().clipKeyframes;
  return clips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    startTime: Math.round(clip.startTime * 1000) / 1000,
    duration: Math.round(clip.duration * 1000) / 1000,
    trackId: clip.trackId,
    sourceType: clip.source?.type,
    isComposition: clip.isComposition === true,
    effectCount: clip.effects?.length ?? 0,
    maskCount: clip.masks?.length ?? 0,
    keyframeCount: keyframes.get(clip.id)?.length ?? 0,
    hasTransitionIn: Boolean(clip.transitionIn),
    hasTransitionOut: Boolean(clip.transitionOut),
  }));
}

export function summarizeActiveComposition(composition: Composition): FixtureCompositionSummary {
  const timelineStore = useTimelineStore.getState();
  const clips = timelineStore.clips;
  const keyframeCount = Array.from(timelineStore.clipKeyframes.values())
    .reduce((count, entries) => count + entries.length, 0);

  return {
    id: composition.id,
    name: composition.name,
    duration: composition.duration,
    trackCount: timelineStore.tracks.length,
    clipCount: clips.length,
    effectCount: clips.reduce((count, clip) => count + (clip.effects?.length ?? 0), 0),
    maskCount: clips.reduce((count, clip) => count + (clip.masks?.length ?? 0), 0),
    keyframeCount,
    compositionClipCount: clips.filter((clip) => clip.isComposition).length,
  };
}

export function summarizeStoredComposition(composition: Composition): FixtureCompositionSummary {
  const timelineData = composition.timelineData;
  const clips = timelineData?.clips ?? [];
  const keyframeCount = clips.reduce((count, clip) => count + (clip.keyframes?.length ?? 0), 0);

  return {
    id: composition.id,
    name: composition.name,
    duration: composition.duration,
    trackCount: timelineData?.tracks.length ?? 0,
    clipCount: clips.length,
    effectCount: clips.reduce((count, clip) => count + (clip.effects?.length ?? 0), 0),
    maskCount: clips.reduce((count, clip) => count + (clip.masks?.length ?? 0), 0),
    keyframeCount,
    compositionClipCount: clips.filter((clip) => clip.isComposition).length,
  };
}
