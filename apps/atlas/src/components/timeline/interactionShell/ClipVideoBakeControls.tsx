import { useCallback, useMemo } from 'react';
import { ClipVideoBakeRegionOverlays } from '../components/ClipVideoBakeRegionOverlays';
import { resolveClipVideoBakeRegionOverlays } from '../utils/activeRegionOverlays';
import type { ClipInteractionShellCommandContext, ClipInteractionShellCommands } from './types';

const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

interface ClipVideoBakeControlsProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

function sourceTimeToClipTimelineTime(context: ClipInteractionShellCommandContext, sourceTime: number): number {
  const clip = context.clip;
  const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, clip.outPoint ?? sourceStart + clipDuration);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
  const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
  return clip.startTime + timelineRatio * clipDuration;
}

function isShellAudioClip(context: ClipInteractionShellCommandContext): boolean {
  const sourceType = context.clip.source?.type;
  const fileExt = (context.clip.name || '').split('.').pop()?.toLowerCase() || '';
  return context.track.type === 'audio' ||
    sourceType === 'audio' ||
    AUDIO_EXTENSIONS.has(fileExt);
}

export function ClipVideoBakeControls({ context, commands }: ClipVideoBakeControlsProps) {
  const videoBake = context.activeModules.videoBake;

  const overlays = useMemo(() => {
    if (!videoBake?.enabled) return [];
    return resolveClipVideoBakeRegionOverlays({
      isAudioClip: isShellAudioClip(context),
      bakeRegions: videoBake.regions,
      selection: videoBake.selection,
      displayStartTime: context.clip.startTime,
      displayDuration: Math.max(0.001, context.clip.duration),
      width: context.geometry.clip.width,
      sourceTimeToVideoBakeTimelineTime: (sourceTime) => sourceTimeToClipTimelineTime(context, sourceTime),
    });
  }, [context, videoBake]);

  const handleBakeRegion = useCallback((regionId: string) => {
    commands?.onModuleCommand?.('video-bake', { type: 'video-bake:bake-region', regionId }, context);
  }, [commands, context]);

  const handleUnbakeRegion = useCallback((regionId: string) => {
    commands?.onModuleCommand?.('video-bake', { type: 'video-bake:unbake-region', regionId }, context);
  }, [commands, context]);

  const handleRemoveRegion = useCallback((regionId: string) => {
    commands?.onModuleCommand?.('video-bake', { type: 'video-bake:remove-region', regionId }, context);
  }, [commands, context]);

  if (!videoBake?.enabled || overlays.length === 0) return null;

  return (
    <div
      className="shell-video-bake-module"
      data-clip-interaction-slot="video-bake"
    >
      <ClipVideoBakeRegionOverlays
        overlays={overlays}
        onBakeRegion={handleBakeRegion}
        onUnbakeRegion={handleUnbakeRegion}
        onRemoveRegion={handleRemoveRegion}
      />
    </div>
  );
}
