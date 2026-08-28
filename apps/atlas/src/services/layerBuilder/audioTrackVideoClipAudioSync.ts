import type { TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext, AudioSyncState } from './types';
import { getClipTimeInfo, getMediaFileForClip, getClipForTrack, isVideoTrackVisible } from './FrameContext';
import { proxyFrameCache } from '../proxyFrameCache';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { useTimelineStore } from '../../stores/timeline';
import type { LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';

export interface AudioTrackVideoClipAudioSyncOptions {
  getClipVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  getLinkedAudioClipAtPlayhead: (ctx: FrameContext, clip: TimelineClip) => TimelineClip | undefined;
  getClipAudioRouteSettings: (
    ctx: FrameContext,
    clip: TimelineClip,
    track: TimelineTrack | undefined,
    clipLocalTime: number,
    clipSourceTime: number,
  ) => LiveAudioRouteSettings;
}

export class AudioTrackVideoClipAudioSync {
  private readonly options: AudioTrackVideoClipAudioSyncOptions;

  constructor(options: AudioTrackVideoClipAudioSyncOptions) {
    this.options = options;
  }

  sync(ctx: FrameContext, _state: AudioSyncState): Set<string> {
    const activeVideoClipIds = new Set<string>();
    let hasScrubAudioSource = false;
    const regionGainPreview = useTimelineStore.getState().audioRegionGainPreview;

    for (const track of ctx.videoTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip || clip.isComposition) continue;
      const videoElement = this.options.getClipVideoElement(clip);
      if (!videoElement) continue;

      const mediaFile = getMediaFileForClip(ctx, clip);
      const timeInfo = getClipTimeInfo(ctx, clip);
      const isMuted = !isVideoTrackVisible(ctx, track.id);
      const mediaFileId = mediaFile?.id || clip.mediaFileId || clip.id;
      const linkedAudioClip = this.options.getLinkedAudioClipAtPlayhead(ctx, clip);
      if (!videoElement.muted) videoElement.muted = true;
      if (!linkedAudioClip) continue;

      const audioSettingsTimeInfo = getClipTimeInfo(ctx, linkedAudioClip);
      const linkedAudioTrack = linkedAudioClip
        ? ctx.audioTracks.find(candidate => candidate.id === linkedAudioClip.trackId)
        : undefined;
      const audioSettingsTrack = linkedAudioTrack ?? track;

      const routeSettings = this.options.getClipAudioRouteSettings(
        ctx,
        linkedAudioClip,
        audioSettingsTrack,
        audioSettingsTimeInfo.clipLocalTime,
        audioSettingsTimeInfo.clipTime,
      );
      const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(
        linkedAudioClip,
        audioSettingsTimeInfo.clipTime,
        regionGainPreview,
      );
      const effectiveVolume = routeSettings.volume * editPreviewVolume;
      let audioMuted = isMuted || routeSettings.muted || effectiveVolume <= 0.01;

      if (!audioMuted) {
        const linkedTrackMuted = !ctx.unmutedAudioTrackIds.has(linkedAudioClip.trackId);
        if (linkedTrackMuted) audioMuted = true;
      }

      const useVarispeedScrubAudio =
        ctx.isDraggingPlayhead && !audioMuted && proxyFrameCache.hasAudioBuffer(mediaFileId);

      if (useVarispeedScrubAudio) {
        hasScrubAudioSource = true;
        proxyFrameCache.playScrubAudio(
          mediaFileId,
          timeInfo.clipTime,
          undefined,
          videoElement.currentSrc || videoElement.src,
          {
            volume: effectiveVolume,
            eqGains: routeSettings.eqGains,
            pan: routeSettings.pan,
            processors: routeSettings.processors,
            masterRoute: routeSettings.master,
          }
        );
        const scrubMeter = proxyFrameCache.getScrubMeterSnapshot(ctx.now);
        if (scrubMeter) {
          useTimelineStore.getState().updateRuntimeAudioMeter(audioSettingsTrack.id, scrubMeter);
        }
      }
    }

    if (!ctx.isDraggingPlayhead || !hasScrubAudioSource) {
      proxyFrameCache.stopScrubAudio();
    }

    return activeVideoClipIds;
  }
}
