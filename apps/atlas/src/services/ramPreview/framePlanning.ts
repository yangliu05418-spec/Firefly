import type { TimelineClip } from '../../types/timeline';

export function quantizeRamPreviewTime(time: number): number {
  return Math.round(time * 30) / 30;
}

export function buildRamPreviewFrameTimes(
  start: number,
  end: number,
  centerTime: number,
  frameInterval: number,
  clips: TimelineClip[]
): number[] {
  const center = Math.max(start, Math.min(end, centerTime));
  const frameTimes: number[] = [];

  if (hasRamPreviewContentAt(clips, center)) {
    frameTimes.push(center);
  }

  let offset = frameInterval;
  while (offset <= (end - start)) {
    const rightTime = center + offset;
    const leftTime = center - offset;

    if (rightTime <= end && hasRamPreviewContentAt(clips, rightTime)) {
      frameTimes.push(rightTime);
    }
    if (leftTime >= start && hasRamPreviewContentAt(clips, leftTime)) {
      frameTimes.push(leftTime);
    }

    offset += frameInterval;
  }

  return frameTimes;
}

export function getRamPreviewClipsAtTime(
  clips: TimelineClip[],
  time: number
): TimelineClip[] {
  return clips.filter((clip) =>
    time >= clip.startTime &&
    time < clip.startTime + clip.duration
  );
}

export function getRamPreviewProgressPercent(
  frameIndex: number,
  totalFrames: number
): number {
  return totalFrames > 0 ? ((frameIndex + 1) / totalFrames) * 100 : 100;
}

function hasRamPreviewContentAt(clips: TimelineClip[], time: number): boolean {
  return clips.some((clip) =>
    time >= clip.startTime &&
    time < clip.startTime + clip.duration &&
    (
      clip.source?.type === 'video' ||
      clip.source?.type === 'image' ||
      clip.isComposition
    )
  );
}
