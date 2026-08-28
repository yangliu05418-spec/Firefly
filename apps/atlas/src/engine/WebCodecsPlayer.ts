// WebCodecs-based video player for hardware-accelerated decoding
// Bypasses browser VAAPI issues by using WebCodecs API directly
// Export mode delegated to WebCodecsExportMode

import { vfPipelineMonitor } from '../services/vfPipelineMonitor';
import { webCodecsTelemetry } from './webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './webCodecsPlayer/playerConstants';
import { WebCodecsPlayerExportLifecycle } from './webCodecsPlayer/playerExportLifecycle';

export type { WebCodecsPlayerOptions } from './webCodecsPlayer/playerTypes';

export class WebCodecsPlayer extends WebCodecsPlayerExportLifecycle {
  play(): void {
    if (this._isPlaying || !this.ready) return;
    this._isPlaying = true;
    this.clearPausedPreroll();

    if (!this.useSimpleMode) {
      webCodecsTelemetry.play();
    }

    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      vfPipelineMonitor.record('vf_play');
      this.simpleSource.play();
    } else {
      // Sync feedIndex to sampleIndex on play start
      if (this.feedIndex < this.sampleIndex) {
        this.feedIndex = this.sampleIndex;
      }
      this.lastFrameTime = performance.now();
      this.lastRAFTime = 0;
      this.scheduleNextFrame();
    }
  }

  pause(): void {
    if (this._isPlaying && !this.useSimpleMode) {
      webCodecsTelemetry.pause(this.frameBuffer.length, this.seekTargetUs !== null);
    }
    if (this._isPlaying && this.useSimpleMode) {
      vfPipelineMonitor.record('vf_pause');
    }
    this._isPlaying = false;
    this.playbackStartupWarmupStartedAtMs = null;

    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.pause();
    } else {
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      const keepBufferedFutureFrames =
        this.seekTargetUs === null &&
        this.pendingAdvanceSeekTargetIdx === null &&
        this.frameBuffer.length > 0;
      this.clearPausedPreroll();
      if (!keepBufferedFutureFrames) {
        this.clearFrameBuffer();
      }
      if (this.seekTargetUs !== null) {
        webCodecsTelemetry.seekCancelPause();
        if (this.pendingSeekKind === 'seek') {
          this.endPendingSeek('cancelled');
        }
      }
      this.clearPendingSeekFeed();
      this.holdCurrentFrameDuringPause();
      this.startPausedPreroll();
      this.clearAdvanceSeekState('cancelled');
    }
  }

  stop(): void {
    this.pause();

    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.stopToStart();
    } else {
      this.sampleIndex = 0;
      this.feedIndex = 0;
    }

    this.clearFrameBuffer();
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.playbackStartupWarmupStartedAtMs = null;
    this.clearPendingSeekFeed();
    this.clearPausedPreroll();
    this.endPendingSeek('cleared');
    this.clearAdvanceSeekState('cleared');
    if (this.currentFrame) {
      this.currentFrame.close();
      this.currentFrame = null;
    }
    this.currentFrameTimestampUs = null;
  }

  private scheduleNextFrame(): void {
    if (!this._isPlaying) return;

    this.animationId = requestAnimationFrame((now) => {
      // Track rAF gaps to detect main thread stalls
      if (this.lastRAFTime > 0) {
        const rafGap = now - this.lastRAFTime;
        if (rafGap > 100) {
          webCodecsTelemetry.rafGap(rafGap);
        }
      }
      this.lastRAFTime = now;

      // Keep decoder pipeline fed ahead of display
      this.pumpDecoder();

      const elapsed = now - this.lastFrameTime;

      if (elapsed >= this.frameInterval) {
        // Present next buffered frame at the video's natural frame rate
        this.presentBufferedFrame();
        this.lastFrameTime = now - (elapsed % this.frameInterval);
      }

      this.scheduleNextFrame();
    });
  }

  /** Feed samples to the decoder, staying ahead of the display position */
  private pumpDecoder(): void {
    if (!this.decoder || this.samples.length === 0) return;

    while (
      this.feedIndex < this.samples.length &&
      this.feedIndex - this.sampleIndex < WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD &&
      this.getEffectiveDecodeQueueSize() < WEB_CODECS_PLAYER_LIMITS.FEED_QUEUE_TARGET
    ) {
      const sample = this.samples[this.feedIndex];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSamplePresentationTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        this.decoder.decode(chunk);
        const queueSize = this.decoder.decodeQueueSize;
        webCodecsTelemetry.decodeFeed(
          this.feedIndex,
          sample.is_sync ? 'key' : 'delta',
          queueSize
        );
      } catch {
        // Skip decode errors
      }

      this.feedIndex++;
    }

    // Handle loop
    if (this.feedIndex >= this.samples.length && this.loop) {
      this.feedIndex = 0;
      this.sampleIndex = 0;
      this.recordDecoderReset('loop');
      this.decoder.reset();
      this.decoder.configure(this.codecConfig!);
      this.resetDecodeQueueTracking();
      this.clearFrameBuffer();
    }
  }

  /** Present the oldest frame from the buffer */
  private presentBufferedFrame(): void {
    if (this.frameBuffer.length === 0) return;

    const frame = this.frameBuffer.shift()!;
    this.setDisplayedFrame(frame);
    this.sampleIndex++;
    this.onFrame?.(frame);
  }

  protected holdCurrentFrameDuringPause(): void {
    if (
      this.exportMode.isInExportMode ||
      this.currentFrameTimestampUs === null ||
      !this.videoTrack ||
      this.samples.length === 0
    ) {
      this.seekTargetUs = null;
      this.seekTargetToleranceUs = 0;
      this.pendingSeekPreviewMode = 'strict';
      return;
    }

    const targetCts = this.getTargetCtsForTimeSeconds(this.currentFrameTimestampUs / 1_000_000);
    const targetIdx = this.findSampleNearCts(targetCts);
    this.seekTargetUs = this.currentFrameTimestampUs;
    this.seekTargetToleranceUs = this.computeSeekToleranceUs(targetIdx);
    this.pendingSeekPreviewMode = 'strict';
  }
}
