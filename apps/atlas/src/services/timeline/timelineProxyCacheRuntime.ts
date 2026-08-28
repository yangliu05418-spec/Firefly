import type { TimelineClip } from '../../types';

export interface TimelineProxyWarmupVideo {
  video: HTMLVideoElement;
  duration: number;
  name: string;
}

export function getTimelineClipScrubCacheVideoSrc(clip: TimelineClip): string | null {
  return clip.source?.videoElement?.src || null;
}

export function collectTimelineProxyWarmupVideos(
  clips: readonly TimelineClip[],
): TimelineProxyWarmupVideo[] {
  const videos: TimelineProxyWarmupVideo[] = [];

  const collectVideos = (clipList: readonly TimelineClip[]) => {
    for (const clip of clipList) {
      const video = clip.source?.videoElement;
      if (video) {
        videos.push({
          video,
          duration: clip.source?.naturalDuration || clip.duration,
          name: clip.name,
        });
      }

      if (clip.isComposition && clip.nestedClips) {
        collectVideos(clip.nestedClips);
      }
    }
  };

  collectVideos(clips);
  return videos;
}
