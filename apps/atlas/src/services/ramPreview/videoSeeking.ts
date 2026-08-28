export interface RamPreviewSeekProvider {
  seek: (timeSeconds: number) => void;
  seekAsync?: (timeSeconds: number) => Promise<void>;
}

export interface RamPreviewSeekOptions {
  video: HTMLVideoElement;
  targetTime: number;
  runtimeProvider: RamPreviewSeekProvider | null;
  timeoutMs: number;
  runtimeSeekDelayMs: number;
  isCancelled: () => boolean;
}

export async function seekRamPreviewVideoFrame(options: RamPreviewSeekOptions): Promise<boolean> {
  const {
    video,
    targetTime,
    runtimeProvider,
    timeoutMs,
    runtimeSeekDelayMs,
    isCancelled,
  } = options;

  if (isCancelled()) {
    return false;
  }

  if (runtimeProvider) {
    try {
      if (typeof runtimeProvider.seekAsync === 'function') {
        await runtimeProvider.seekAsync(targetTime);
      } else {
        runtimeProvider.seek(targetTime);
        await new Promise((resolve) => setTimeout(resolve, runtimeSeekDelayMs));
      }
    } catch {
      video.currentTime = targetTime;
      await new Promise((resolve) => setTimeout(resolve, runtimeSeekDelayMs));
    }
  } else {
    await seekHTMLVideo(video, targetTime, timeoutMs);
  }

  return !isCancelled();
}

function seekHTMLVideo(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, timeoutMs);

    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };

    video.addEventListener('seeked', onSeeked);
    video.currentTime = targetTime;
  });
}
