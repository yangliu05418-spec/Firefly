import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerSeekState } from './playerSeekState';

export abstract class WebCodecsPlayerFrameOutput extends WebCodecsPlayerSeekState {
  protected abstract feedPendingSeekSamples(mode?: 'seek' | 'advance_seek'): void;
  protected abstract feedPausedPrerollSamples(): void;
  protected abstract holdCurrentFrameDuringPause(): void;
  protected abstract startPausedPreroll(): void;

  protected setDisplayedFrame(frame: VideoFrame): void {
    if (this.currentFrame && this.currentFrame !== frame) {
      this.currentFrame.close();
    }
    this.currentFrame = frame;
    this.currentFrameTimestampUs = frame.timestamp;
  }

  protected shouldPublishInteractiveSeekPreview(frameTimestampUs: number): boolean {
    if (this.seekTargetUs === null) {
      return false;
    }

    if (this.currentFrameTimestampUs === null) {
      return true;
    }

    const currentDiff = Math.abs(this.currentFrameTimestampUs - this.seekTargetUs);
    const nextDiff = Math.abs(frameTimestampUs - this.seekTargetUs);
    if (nextDiff >= currentDiff) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const nearTargetWindowUs = Math.max(
      this.seekTargetToleranceUs * 3,
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.INTERACTIVE_PREVIEW_NEAR_TARGET_FRAMES
    );
    if (nextDiff <= nearTargetWindowUs) {
      return true;
    }

    const improvementUs = currentDiff - nextDiff;
    const hasWaitedLongEnough =
      performance.now() - this.lastInteractivePreviewPublishAtMs >=
      WEB_CODECS_PLAYER_LIMITS.INTERACTIVE_PREVIEW_FAR_FRAME_PUBLISH_MS;

    return hasWaitedLongEnough && improvementUs >= frameDurationUs;
  }

  isPlaybackStartupWarmupActive(): boolean {
    return (
      this.playbackStartupWarmupStartedAtMs !== null &&
      performance.now() - this.playbackStartupWarmupStartedAtMs <=
        WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_MS
    );
  }

  protected shouldPublishPlaybackStartupFrame(
    frameTimestampUs: number,
    targetUs: number
  ): boolean {
    if (!this.isPlaybackStartupWarmupActive()) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const maxWarmupDriftUs =
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_FRAMES;
    const nextDiff = Math.abs(frameTimestampUs - targetUs);
    if (nextDiff > maxWarmupDriftUs) {
      return false;
    }

    if (this.currentFrameTimestampUs === null) {
      return true;
    }

    if (frameTimestampUs <= this.currentFrameTimestampUs) {
      return false;
    }

    const currentDiff = Math.abs(this.currentFrameTimestampUs - targetUs);
    return nextDiff + frameDurationUs < currentDiff;
  }

  protected isFrameUsableForPlaybackStartup(
    frameTimestampUs: number | null,
    targetUs: number
  ): boolean {
    if (frameTimestampUs === null) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    return (
      Math.abs(frameTimestampUs - targetUs) <=
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_FRAMES
    );
  }

  protected promotePendingSeekFallbackForPlaybackStartup(targetUs: number): boolean {
    const fallbackFrame = this.pendingSeekFallbackFrame;
    if (!fallbackFrame) {
      return false;
    }

    const fallbackDiffUs = Math.abs(fallbackFrame.timestamp - targetUs);
    if (!this.isFrameUsableForPlaybackStartup(fallbackFrame.timestamp, targetUs)) {
      return false;
    }

    const currentDiffUs =
      this.currentFrameTimestampUs !== null
        ? Math.abs(this.currentFrameTimestampUs - targetUs)
        : Number.POSITIVE_INFINITY;
    if (fallbackDiffUs >= currentDiffUs) {
      return false;
    }

    this.setDisplayedFrame(fallbackFrame);
    this.clearPendingSeekFallback(fallbackFrame);
    webCodecsTelemetry.seekPublish(
      targetUs,
      fallbackFrame.timestamp,
      fallbackDiffUs,
      'playback_start_fallback'
    );
    this.onFrame?.(fallbackFrame);
    return true;
  }

  protected isDisplayedFrameNearTarget(
    targetUs: number,
    maxFrameDelta = 6
  ): boolean {
    if (this.currentFrameTimestampUs === null) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    return Math.abs(this.currentFrameTimestampUs - targetUs) <= frameDurationUs * maxFrameDelta;
  }

  protected resolvePendingSeekWithDisplayedFrame(
    targetUs: number,
    options: { readonly resetQueuedDecode?: boolean } = {}
  ): boolean {
    const frame = this.currentFrame;
    if (
      this._isPlaying ||
      !frame ||
      this.pendingSeekKind !== 'seek' ||
      this.seekTargetUs === null ||
      this.currentFrameTimestampUs === null
    ) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const resolveToleranceUs = Math.min(
      this.seekTargetToleranceUs || frameDurationUs,
      frameDurationUs * 0.55
    );
    const diffUs = Math.abs(this.currentFrameTimestampUs - targetUs);
    if (diffUs > resolveToleranceUs) {
      return false;
    }

    if (
      options.resetQueuedDecode === true &&
      this.decoder &&
      this.decoder.state === 'configured' &&
      this.codecConfig
    ) {
      this.recordDecoderReset('seek');
      this.decoder.reset();
      this.decoder.configure(this.codecConfig);
      this.resetDecodeQueueTracking();
      this.clearFrameBuffer();
      this.invalidateStrictPausedSeekFlush();
    }

    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.clearPendingSeekFeed();
    this.endPendingSeek('resolved');
    webCodecsTelemetry.seekPublish(targetUs, frame.timestamp, diffUs, 'resolved');

    this.holdCurrentFrameDuringPause();
    this.startPausedPreroll();
    this.onFrame?.(frame);
    if (this.frameResolve) {
      this.frameResolve();
      this.frameResolve = null;
    }
    return true;
  }

  protected clearDisplayedFrame(): void {
    if (this.currentFrame) {
      this.currentFrame.close();
    }
    this.currentFrame = null;
    this.currentFrameTimestampUs = null;
  }

  protected clearPendingSeekFallback(exceptFrame: VideoFrame | null = null): void {
    if (
      this.pendingSeekFallbackFrame &&
      this.pendingSeekFallbackFrame !== exceptFrame &&
      this.pendingSeekFallbackFrame !== this.currentFrame
    ) {
      this.pendingSeekFallbackFrame.close();
    }
    this.pendingSeekFallbackFrame = null;
    this.pendingSeekFallbackDiffUs = Number.POSITIVE_INFINITY;
  }

  protected promoteBufferedFrameForPausedSeekTarget(targetUs: number, toleranceUs: number): boolean {
    if (this._isPlaying || this.frameBuffer.length === 0) {
      return false;
    }

    let bestIndex = -1;
    let bestDiffUs = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.frameBuffer.length; index += 1) {
      const frame = this.frameBuffer[index];
      if (!frame) continue;
      const diffUs = Math.abs(frame.timestamp - targetUs);
      if (diffUs < bestDiffUs) {
        bestDiffUs = diffUs;
        bestIndex = index;
      }
    }

    if (bestIndex < 0 || bestDiffUs > toleranceUs) {
      return false;
    }

    const skippedFrames = this.frameBuffer.splice(0, bestIndex);
    for (const skippedFrame of skippedFrames) {
      if (skippedFrame !== this.currentFrame) {
        skippedFrame.close();
      }
    }
    const frame = this.frameBuffer.shift();
    if (!frame) {
      return false;
    }

    this.setDisplayedFrame(frame);
    this.clearPendingSeekFallback(frame);
    this.clearPendingSeekFeed();
    this.endPendingSeek('resolved');
    webCodecsTelemetry.seekPublish(targetUs, frame.timestamp, bestDiffUs, 'resolved');

    this.holdCurrentFrameDuringPause();
    this.startPausedPreroll();
    this.onFrame?.(frame);
    if (this.frameResolve) {
      this.frameResolve();
      this.frameResolve = null;
    }
    return true;
  }

  promoteBufferedFrameNearTime(timeSeconds: number, maxFrameDelta = 1.5): VideoFrame | null {
    if (!Number.isFinite(timeSeconds)) {
      return this.currentFrame;
    }

    const targetUs = timeSeconds * 1_000_000;
    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const toleranceUs = Math.max(this.seekTargetToleranceUs, frameDurationUs * maxFrameDelta);
    if (
      this.currentFrame &&
      this.currentFrameTimestampUs !== null &&
      Math.abs(this.currentFrameTimestampUs - targetUs) <= toleranceUs
    ) {
      return this.currentFrame;
    }

    if (this.promoteBufferedFrameForPausedSeekTarget(targetUs, toleranceUs)) {
      return this.currentFrame;
    }

    return null;
  }

  protected rememberPendingSeekFallback(frame: VideoFrame, diffUs: number): boolean {
    if (this.pendingSeekPreviewMode !== 'strict') {
      return false;
    }

    if (diffUs >= this.pendingSeekFallbackDiffUs) {
      return false;
    }

    this.clearPendingSeekFallback(frame);
    this.pendingSeekFallbackFrame = frame;
    this.pendingSeekFallbackDiffUs = diffUs;
    return true;
  }

  protected publishStrictSeekFallbackAfterFlush(): boolean {
    if (
      this.pendingSeekPreviewMode !== 'strict' ||
      this.seekTargetUs === null ||
      this.pendingSeekFallbackFrame === null
    ) {
      return false;
    }

    const frame = this.pendingSeekFallbackFrame;
    const diffUs = Math.abs(frame.timestamp - this.seekTargetUs);
    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const fallbackToleranceUs = Math.max(this.seekTargetToleranceUs * 2, frameDurationUs * 3);

    if (diffUs > fallbackToleranceUs && this.currentFrame !== null) {
      return false;
    }

    this.setDisplayedFrame(frame);
    this.clearPendingSeekFallback(frame);
    webCodecsTelemetry.seekPublish(
      this.seekTargetUs,
      frame.timestamp,
      diffUs,
      'strict_flush_fallback'
    );

    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.clearPendingSeekFeed();
    this.endPendingSeek('fallback');

    if (!this._isPlaying) {
      this.holdCurrentFrameDuringPause();
      this.startPausedPreroll();
    }

    this.onFrame?.(frame);
    return true;
  }

  protected handleDecodedFrame(frame: VideoFrame): void {
    const queueSize = this.noteDecodeDequeued();
    webCodecsTelemetry.decodeOutput(frame.timestamp, queueSize);
    this.onDecodedFrame?.(frame);

    if (this.exportMode.isInExportMode) {
      this.exportMode.handleDecoderOutput(frame);
    } else if (this.seekTargetUs !== null && this.pendingSeekKind !== null) {
      const diff = Math.abs(frame.timestamp - this.seekTargetUs);
      const publishPreview =
        this.pendingSeekPreviewMode !== 'strict' &&
        this.shouldPublishInteractiveSeekPreview(frame.timestamp);
      const resolvesPendingSeek =
        diff <= this.seekTargetToleranceUs ||
        (this._isPlaying && publishPreview);

      if (diff <= this.seekTargetToleranceUs || publishPreview) {
        this.setDisplayedFrame(frame);
        this.clearPendingSeekFallback(frame);
        this.lastInteractivePreviewPublishAtMs = performance.now();
        webCodecsTelemetry.seekPublish(
          this.seekTargetUs,
          frame.timestamp,
          diff,
          publishPreview ? 'interactive_preview' : 'resolved'
        );

        if (resolvesPendingSeek) {
          this.seekTargetUs = null;
          this.seekTargetToleranceUs = 0;
          this.clearPendingSeekFeed();
          this.endPendingSeek('resolved');

          // After a paused seek resolves, protect the just-seeked frame from
          // being overwritten by post-seek lookahead frames still in the
          // decoder queue.  holdCurrentFrameDuringPause + startPausedPreroll
          // route those late arrivals into the preroll buffer instead.
          // This is critical for cold-start after page reload where no
          // pause() has been called on the player yet.
          if (!this._isPlaying) {
            this.holdCurrentFrameDuringPause();
            this.startPausedPreroll();
          }
        }

        this.onFrame?.(frame);
      } else {
        if (!this.rememberPendingSeekFallback(frame, diff)) {
          webCodecsTelemetry.frameDropSeekIntermediate(frame.timestamp, this.seekTargetUs);
          frame.close();
        }
        // Don't return early - fall through so feedPendingSeekSamples
        // continues feeding the decoder towards the seek target.
      }
    } else if (this._isPlaying) {
      this.frameBuffer.push(frame);
      while (this.frameBuffer.length > WEB_CODECS_PLAYER_LIMITS.MAX_FRAME_BUFFER) {
        const oldest = this.frameBuffer[0];
        if (oldest === this.currentFrame) break;
        this.frameBuffer.shift()!.close();
      }
    } else if (this.pausedPrerollEndIndex !== null) {
      if (
        this.currentFrameTimestampUs !== null &&
        frame.timestamp <= this.currentFrameTimestampUs
      ) {
        frame.close();
      } else {
        this.frameBuffer.push(frame);
        while (this.frameBuffer.length > WEB_CODECS_PLAYER_LIMITS.MAX_FRAME_BUFFER) {
          this.frameBuffer.shift()!.close();
        }
      }
    } else {
      this.setDisplayedFrame(frame);
      this.onFrame?.(frame);
    }

    if (!this.exportMode.isInExportMode && !this._isPlaying && this.pendingSeekFeedEndIndex !== null) {
      this.feedPendingSeekSamples('seek');
    }
    if (!this.exportMode.isInExportMode && !this._isPlaying && this.pausedPrerollEndIndex !== null) {
      this.feedPausedPrerollSamples();
    }
    if (this.frameResolve) {
      this.frameResolve();
      this.frameResolve = null;
    }
  }

  /** Close all buffered frames */
  protected clearFrameBuffer(): void {
    for (const f of this.frameBuffer) {
      f.close();
    }
    this.frameBuffer.length = 0;
  }

  protected decodeFirstFrame(): void {
    if (!this.decoder || this.samples.length === 0) return;

    // Decode the first keyframe to have an initial frame available
    const firstSample = this.samples[0];
    if (!firstSample.is_sync) return; // First frame should be a keyframe

    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: this.getSamplePresentationTimestampUs(firstSample),
      duration: (firstSample.duration * 1_000_000) / firstSample.timescale,
      data: firstSample.data,
    });

    try {
      this.decoder.decode(chunk);
      this.noteDecodeQueued();
      this.sampleIndex = 0;
      this.feedIndex = 1;
      this.clearAdvanceSeekState();
    } catch (error) {
      this.recordDecodeError(error, 'decodeFirstFrame.decode');
    }
  }

  // Check if there's a valid frame available
  hasFrame(): boolean {
    return this.currentFrame !== null;
  }

  hasBufferedFutureFrame(minFrameDelta = 0.5): boolean {
    if (this.currentFrameTimestampUs === null || this.frameBuffer.length === 0) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const minFutureTimestampUs = this.currentFrameTimestampUs + frameDurationUs * minFrameDelta;
    return this.frameBuffer.some((frame) => frame.timestamp >= minFutureTimestampUs);
  }

  /** Debug info for stats overlay (null in simple mode) */
  getDebugInfo(): {
    codec: string;
    hwAccel: string;
    decodeQueueSize: number;
    samplesLoaded: number;
    sampleIndex: number;
    feedIndex?: number;
    frameBufferSize?: number;
    decoderState?: string | null;
    currentFrameTimestampSeconds?: number | null;
    pendingSeekKind?: string | null;
    pendingSeekTargetSeconds?: number | null;
    pendingSeekFeedEndIndex?: number | null;
    decodeErrorCount?: number;
    lastDecodeError?: string | null;
    lastSeekPlan?: {
      targetIndex: number;
      keyframeIndex: number;
      feedEndIndex: number;
      targetTimeSeconds: number;
      targetSampleTimeSeconds: number | null;
      keyframeTimeSeconds: number | null;
    } | null;
  } | null {
    if (this.useSimpleMode || !this.codecConfig) return null;
    return {
      codec: this.codecConfig.codec,
      hwAccel: (this.codecConfig.hardwareAcceleration as string) || 'no-preference',
      decodeQueueSize: this.getEffectiveDecodeQueueSize(),
      samplesLoaded: this.samples.length,
      sampleIndex: this.sampleIndex,
      feedIndex: this.feedIndex,
      frameBufferSize: this.frameBuffer.length,
      decoderState: this.decoder?.state ?? null,
      currentFrameTimestampSeconds: this.currentFrameTimestampUs === null
        ? null
        : this.currentFrameTimestampUs / 1_000_000,
      pendingSeekKind: this.pendingSeekKind,
      pendingSeekTargetSeconds: this.pendingSeekTargetDebugUs === null
        ? null
        : this.pendingSeekTargetDebugUs / 1_000_000,
      pendingSeekFeedEndIndex: this.pendingSeekFeedEndIndex,
      decodeErrorCount: this.decodeErrorCount,
      lastDecodeError: this.lastDecodeError,
      lastSeekPlan: this.lastSeekPlanDebug,
    };
  }
}
