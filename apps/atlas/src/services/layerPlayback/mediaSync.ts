import type { TimelineClip } from '../../types/timeline';
import type { LayerPlaybackInfo } from './layerPlaybackState';

function resolveClipPlaybackTime(clip: TimelineClip, timelineTime: number): number {
  const clipLocalTime = timelineTime - clip.startTime;
  return clip.reversed
    ? clip.outPoint - clipLocalTime
    : clipLocalTime + clip.inPoint;
}

function isClipActiveAtTime(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime >= clip.startTime && timelineTime < clip.startTime + clip.duration;
}

export function syncVideoClipToPlayback(
  clip: TimelineClip,
  playback: LayerPlaybackInfo
): void {
  if (!clip.source?.videoElement) return;

  const video = clip.source.videoElement;
  const isActive = isClipActiveAtTime(clip, playback.currentTime);

  if (!playback.shouldRender || !isActive) {
    if (!video.paused) video.pause();
    return;
  }

  const clipTime = resolveClipPlaybackTime(clip, playback.currentTime);
  const timeDiff = Math.abs(video.currentTime - clipTime);

  if (timeDiff > 0.5) {
    video.currentTime = clipTime;
  }

  if (playback.playbackState === 'playing') {
    if (video.paused) video.play().catch(() => {});
  } else if (!video.paused) {
    video.pause();
  }

  if (playback.playbackState !== 'playing' && timeDiff > 0.05) {
    video.currentTime = clipTime;
  }
}

export function syncAudioClipToPlayback(
  clip: TimelineClip,
  playback: LayerPlaybackInfo
): void {
  if (!clip.source?.audioElement) return;

  const audio = clip.source.audioElement;
  const isActive = isClipActiveAtTime(clip, playback.currentTime);

  if (!playback.shouldRender || !isActive) {
    if (!audio.paused) audio.pause();
    return;
  }

  const clipTime = resolveClipPlaybackTime(clip, playback.currentTime);
  const timeDiff = Math.abs(audio.currentTime - clipTime);

  if (timeDiff > 0.3) {
    audio.currentTime = clipTime;
  }

  if (playback.playbackState === 'playing') {
    if (audio.paused) audio.play().catch(() => {});
  } else if (!audio.paused) {
    audio.pause();
  }

  if (playback.playbackState !== 'playing' && timeDiff > 0.05) {
    audio.currentTime = clipTime;
  }
}
