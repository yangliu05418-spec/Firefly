type HtmlVideoHealthClip = {
  id: string;
  trackId?: string;
  source?: {
    videoElement?: HTMLVideoElement;
    webCodecsPlayer?: {
      isFullMode?: () => boolean;
    } | null;
  } | null;
};

export function shouldMonitorHtmlVideoHealth(clip: HtmlVideoHealthClip): boolean {
  return !clip.source?.webCodecsPlayer?.isFullMode?.();
}

export function getVisibleHtmlVideoClipsAtPlayhead<TClip extends HtmlVideoHealthClip>(
  ctx: {
    clipsAtTime: TClip[];
    tracks: unknown[];
    videoTracks: unknown[];
    visibleVideoTrackIds: Set<string>;
  }
): TClip[] {
  const seenClipIds = new Set<string>();
  const seenVideos = new Set<HTMLVideoElement>();
  const result: TClip[] = [];

  for (const clip of ctx.clipsAtTime) {
    const video = clip.source?.videoElement;
    const hasTrackMetadata = ctx.tracks.length > 0 || ctx.videoTracks.length > 0;
    const trackVisible = hasTrackMetadata && clip.trackId
      ? ctx.visibleVideoTrackIds.has(clip.trackId)
      : true;
    if (!video || !clip.trackId || !trackVisible) {
      continue;
    }
    if (seenClipIds.has(clip.id) || seenVideos.has(video)) {
      continue;
    }

    seenClipIds.add(clip.id);
    seenVideos.add(video);
    result.push(clip);
  }

  return result;
}
