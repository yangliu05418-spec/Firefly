import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerFrameOutput } from './playerFrameOutput';
import type { SeekPreviewMode } from './playerTypes';

export abstract class WebCodecsPlayerSeekFeeding extends WebCodecsPlayerFrameOutput {
  protected flushStrictPausedSeek(): void {
    if (
      this.useSimpleMode ||
      this._isPlaying ||
      !this.decoder ||
      this.decoder.state !== 'configured' ||
      this.pendingSeekKind !== 'seek' ||
      this.pendingSeekPreviewMode !== 'strict'
    ) {
      return;
    }

    const flushToken = ++this.strictPausedSeekFlushToken;
    const decoder = this.decoder;
    void decoder.flush().finally(() => {
      if (
        flushToken !== this.strictPausedSeekFlushToken ||
        this.decoder !== decoder
      ) {
        return;
      }

      if (
        !this._isPlaying &&
        this.pendingSeekKind === 'seek' &&
        this.seekTargetUs !== null &&
        this.pendingSeekFeedEndIndex === null &&
        this.getEffectiveDecodeQueueSize() === 0
      ) {
        if (this.publishStrictSeekFallbackAfterFlush()) {
          return;
        }
        webCodecsTelemetry.seekSkipStrictFlushWithoutPublish(this.seekTargetUs);
      }
    }).catch(() => {});
  }

  protected feedPendingSeekSamples(mode: 'seek' | 'advance_seek' = 'seek'): void {
    if (
      !this.decoder ||
      this.pendingSeekFeedEndIndex === null ||
      this.samples.length === 0
    ) {
      return;
    }

    while (
      this.feedIndex <= this.pendingSeekFeedEndIndex &&
      this.getEffectiveDecodeQueueSize() < WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET
    ) {
      const sample = this.samples[this.feedIndex];
      if (!sample) {
        break;
      }

      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSamplePresentationTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        this.decoder.decode(chunk);
        const queueSize = this.noteDecodeQueued();
        webCodecsTelemetry.decodeFeed(
          this.feedIndex,
          sample.is_sync ? 'key' : 'delta',
          queueSize,
          mode
        );
      } catch (error) {
        this.recordDecodeError(error, `${mode}.decode`);
      }

      this.feedIndex++;
    }

    if (this.pendingSeekFeedEndIndex !== null && this.feedIndex > this.pendingSeekFeedEndIndex) {
      this.pendingSeekFeedEndIndex = null;

      // All seek samples have been fed - now it's safe to flush the
      // decoder so the strict fallback can fire once all outputs arrive.
      if (this.pendingSeekPreviewMode === 'strict') {
        this.flushStrictPausedSeek();
      }
    }
  }

  protected feedPausedPrerollSamples(): void {
    if (
      !this.decoder ||
      this.pausedPrerollEndIndex === null ||
      this.samples.length === 0
    ) {
      return;
    }

    while (
      this.feedIndex <= this.pausedPrerollEndIndex &&
      this.getEffectiveDecodeQueueSize() < WEB_CODECS_PLAYER_LIMITS.FEED_QUEUE_TARGET
    ) {
      const sample = this.samples[this.feedIndex];
      if (!sample) {
        break;
      }

      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSamplePresentationTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        this.decoder.decode(chunk);
        const queueSize = this.noteDecodeQueued();
        webCodecsTelemetry.decodeFeed(
          this.feedIndex,
          sample.is_sync ? 'key' : 'delta',
          queueSize,
          'pause_preroll'
        );
      } catch (error) {
        this.recordDecodeError(error, 'pause_preroll.decode');
      }

      this.feedIndex++;
    }
  }

  protected startPausedPreroll(): void {
    if (
      this.useSimpleMode ||
      this._isPlaying ||
      !this.decoder ||
      this.decoder.state !== 'configured' ||
      this.currentFrameTimestampUs === null ||
      !this.videoTrack ||
      this.samples.length === 0
    ) {
      return;
    }

    const currentFrameIdx = this.getCurrentFrameSampleIndex();
    if (currentFrameIdx === null || currentFrameIdx >= this.samples.length - 1) {
      return;
    }

    this.feedIndex = Math.max(this.feedIndex, currentFrameIdx + 1);
    this.pausedPrerollEndIndex = Math.min(currentFrameIdx + 6, this.samples.length - 1);
    this.feedPausedPrerollSamples();
  }

  protected canReusePausedSeekPipeline(
    targetIndex: number,
    previewMode: SeekPreviewMode = 'strict'
  ): boolean {
    if (
      this.useSimpleMode ||
      this._isPlaying ||
      !this.decoder ||
      this.decoder.state !== 'configured' ||
      this.samples.length === 0
    ) {
      return false;
    }

    const currentFrameIdx = this.getCurrentFrameSampleIndex();
    if (currentFrameIdx === null) {
      return false;
    }

    const maxForwardFrames = previewMode !== 'strict'
      ? Math.max(90, Math.ceil(this.frameRate * 3))
      : Math.max(
          12,
          Math.ceil(this.frameRate * WEB_CODECS_PLAYER_LIMITS.PAUSED_SEEK_REUSE_SECONDS)
        );
    const forwardDistance = targetIndex - currentFrameIdx;
    if (forwardDistance <= 0 || forwardDistance > maxForwardFrames) {
      return false;
    }

    if (this.pendingSeekKind !== null && this.pendingSeekKind !== 'seek') {
      return false;
    }

    return this.getEffectiveDecodeQueueSize() < WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET;
  }

  protected canExtendPendingPausedSeek(
    targetIndex: number,
    previewMode: SeekPreviewMode = 'strict'
  ): boolean {
    if (
      this.useSimpleMode ||
      this._isPlaying ||
      !this.decoder ||
      this.decoder.state !== 'configured' ||
      this.pendingSeekKind !== 'seek' ||
      this.samples.length === 0
    ) {
      return false;
    }

    const currentFrameIdx = this.getCurrentFrameSampleIndex();
    if (currentFrameIdx === null || targetIndex <= currentFrameIdx) {
      return false;
    }

    if (this.getEffectiveDecodeQueueSize() >= WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET) {
      return false;
    }

    const currentPendingEnd = Math.max(
      this.pendingSeekFeedEndIndex ?? this.feedIndex - 1,
      this.sampleIndex
    );
    const maxExtensionFrames = previewMode !== 'strict'
      ? Math.max(180, Math.ceil(this.frameRate * 6))
      : Math.max(
          24,
          Math.ceil(this.frameRate * 0.75)
        );

    return targetIndex <= currentPendingEnd + maxExtensionFrames;
  }

  protected getPausedSeekFeedEndIndex(
    targetIndex: number,
    previewMode: SeekPreviewMode = 'strict'
  ): number {
    if (this.samples.length === 0) {
      return targetIndex;
    }

    if (previewMode === 'interactive') {
      return targetIndex;
    }

    // Strict and startup-preroll paused seeks need decode lookahead past the
    // target so reordered B-frames can actually be emitted. Preroll keeps the
    // interactive preview behavior but avoids the strict decoder flush.
    const reorderLookaheadFrames = Math.max(
      WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD,
      Math.ceil(this.frameRate * 0.35)
    );

    return Math.min(
      this.samples.length - 1,
      targetIndex + reorderLookaheadFrames
    );
  }

  protected shouldContinueAdvanceSeek(
    targetIdx: number,
    decodeCoverageEnd: number
  ): boolean {
    const pendingTargetIdx = this.pendingAdvanceSeekTargetIdx;
    if (pendingTargetIdx === null) {
      return false;
    }

    if (
      targetIdx < pendingTargetIdx - WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_BACKWARD_TOLERANCE
    ) {
      return false;
    }

    if (
      this.pendingSeekStartedAtMs !== null &&
      performance.now() - this.pendingSeekStartedAtMs > WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_MAX_PENDING_MS
    ) {
      webCodecsTelemetry.seekSkipAdvancePendingTimeout(
        targetIdx,
        pendingTargetIdx,
        performance.now() - this.pendingSeekStartedAtMs
      );
      return false;
    }

    const staleResolveFrameLimit = Math.max(
      WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_MAX_STALE_RESOLVE_FRAMES,
      Math.ceil(this.frameRate * 0.1)
    );
    if (
      targetIdx > pendingTargetIdx + staleResolveFrameLimit &&
      decodeCoverageEnd >= targetIdx
    ) {
      return false;
    }

    const desiredCoverageEnd =
      Math.max(targetIdx, pendingTargetIdx) + WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD;

    return (
      this.getEffectiveDecodeQueueSize() > 0 ||
      decodeCoverageEnd < desiredCoverageEnd
    );
  }

  /** Compute seek acceptance tolerance in microseconds with VFR-aware neighbor spacing. */
  protected computeSeekToleranceUs(targetIndex: number): number {
    return this.sampleTimeline.computeSeekToleranceUs(targetIndex, this.frameRate);
  }
}
