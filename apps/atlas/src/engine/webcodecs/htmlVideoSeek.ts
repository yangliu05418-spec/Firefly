import { Logger } from '../../services/logger';

const log = Logger.create('WebCodecsPlayer');

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

export function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

export function seekHtmlVideoElementAsync(
  video: HTMLVideoElement,
  timeSeconds: number,
  captureCurrentFrame: () => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      captureCurrentFrame();
      resolve();
    };

    // Longer timeout for export - we need accurate frames
    const timeout = setTimeout(() => {
      if (!resolved) {
        log.warn(`seekAsync timeout at ${timeSeconds}, readyState: ${video.readyState}`);
        doResolve();
      }
    }, 2000);

    // Wait for video to have enough data (readyState >= 2 means HAVE_CURRENT_DATA)
    const waitForReady = (callback: () => void) => {
      if (video.readyState >= 2 && !video.seeking) {
        callback();
        return;
      }
      // Poll until ready or timeout
      let retries = 0;
      const maxRetries = 60; // 60 * 16ms approx 1 second
      const checkReady = () => {
        retries++;
        if (video.readyState >= 2 && !video.seeking) {
          callback();
        } else if (retries < maxRetries) {
          requestAnimationFrame(checkReady);
        } else {
          // Give up waiting for readyState, proceed anyway
          log.warn(`waitForReady gave up after ${retries} retries, readyState: ${video.readyState}`);
          callback();
        }
      };
      requestAnimationFrame(checkReady);
    };

    const waitForFrame = () => {
      // First ensure video has data, then wait for frame callback
      waitForReady(() => {
        // Use requestVideoFrameCallback if available for precise frame timing
        if (hasVideoFrameCallback(video)) {
          video.requestVideoFrameCallback(() => {
            clearTimeout(timeout);
            doResolve();
          });
          // Also set a shorter backup timeout since rvfc may not fire when paused
          setTimeout(() => {
            if (!resolved && video.readyState >= 2) {
              clearTimeout(timeout);
              doResolve();
            }
          }, 100);
        } else {
          // Fallback: wait two animation frames
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearTimeout(timeout);
              doResolve();
            });
          });
        }
      });
    };

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      waitForFrame();
    };

    if (Math.abs(video.currentTime - timeSeconds) < 0.01 && !video.seeking) {
      // Already at position, just wait for frame
      waitForFrame();
      return;
    }

    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeSeconds;
  });
}
