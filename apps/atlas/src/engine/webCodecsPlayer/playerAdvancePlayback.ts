import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerSeekFeeding } from './playerSeekFeeding';

export abstract class WebCodecsPlayerAdvancePlayback extends WebCodecsPlayerSeekFeeding {
  /**
   * Advance playback to the given source time.
   * Called by the render loop each frame instead of an internal animation loop.
   * Handles: decoder feeding, timestamp-based frame selection, position tracking.
   */
  advanceToTime(timeSeconds: number): void {
    if (this.useSimpleMode || !this.decoder || this.samples.length === 0 || !this.videoTrack) return;

    const startingPlayback = !this._isPlaying;
    const targetUs = timeSeconds * 1_000_000;
    const frameDurationUs = 1_000_000 / this.frameRate;
    const pendingPausedSeekUs =
      this.pendingSeekKind === 'seek' && this.seekTargetUs !== null
        ? this.seekTargetUs
        : null;
    const pendingPausedSeekAgeMs =
      this.pendingSeekStartedAtMs !== null
        ? performance.now() - this.pendingSeekStartedAtMs
        : null;
    if (startingPlayback && pendingPausedSeekUs !== null) {
      this.promotePendingSeekFallbackForPlaybackStartup(targetUs);
    }
    const canVisuallyWaitForPendingPausedSeek =
      this.isDisplayedFrameNearTarget(targetUs) ||
      this.isFrameUsableForPlaybackStartup(this.currentFrameTimestampUs, targetUs);
    const shouldWaitForPendingPausedSeek =
      startingPlayback &&
      pendingPausedSeekUs !== null &&
      this.pendingSeekPreviewMode === 'strict' &&
      canVisuallyWaitForPendingPausedSeek &&
      Math.abs(pendingPausedSeekUs - targetUs) <= frameDurationUs * 3 &&
      (this.pendingSeekFeedEndIndex !== null || this.getEffectiveDecodeQueueSize() > 0) &&
      (pendingPausedSeekAgeMs === null ||
        pendingPausedSeekAgeMs <= WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_MAX_PENDING_MS);

    if (shouldWaitForPendingPausedSeek) {
      webCodecsTelemetry.seekSkipAwaitPendingPausedSeekForPlay(
        targetUs,
        pendingPausedSeekUs,
        Math.abs(pendingPausedSeekUs - targetUs),
        this.getEffectiveDecodeQueueSize()
      );
      return;
    }
    // Check if pipeline needs restart when starting playback.
    // The decoder may still be configured and have buffered frames from
    // the previous play session - skip reset when possible.
    const shouldRestartPlaybackPipeline = startingPlayback;

    // Clear any pending seek target from paused seeking
    if (this.seekTargetUs !== null && this.pendingSeekKind === 'seek') {
      this.endPendingSeek('replaced');
    }
    this.invalidateStrictPausedSeekFlush();
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.clearPendingSeekFeed();
    this.clearPausedPreroll();

    // Auto-enter playing state so decoder output routes to frame buffer
    if (startingPlayback) {
      this._isPlaying = true;
      this.playbackStartupWarmupStartedAtMs = performance.now();
      if (this.feedIndex < this.sampleIndex) {
        this.feedIndex = this.sampleIndex;
      }
    }

    // Cancel internal animation loop if running - we're externally driven
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    const targetCts = this.getTargetCtsForTimeSeconds(timeSeconds);
    const targetIdx = this.findSampleNearCts(targetCts);
    const currentFrameIdx = this.getCurrentFrameSampleIndex() ?? this.sampleIndex;
    const decodeCoverageEnd = Math.max(this.feedIndex, currentFrameIdx + this.frameBuffer.length);
    const backwardJumpToleranceUs =
      frameDurationUs * (WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_BACKWARD_TOLERANCE + 1);
    const backwardJump =
      this.currentFrameTimestampUs !== null
        ? targetUs < this.currentFrameTimestampUs - backwardJumpToleranceUs
        : targetIdx < currentFrameIdx - WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_BACKWARD_TOLERANCE;
    const forwardSeekThreshold = Math.max(
      WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_FORWARD_TOLERANCE,
      Math.ceil(this.frameRate * 0.35)
    );
    const forwardGap = targetIdx - decodeCoverageEnd;

    const isDecoderReady = this.decoder?.state === 'configured';
    const hasHotCurrentFrame =
      this.currentFrameTimestampUs !== null &&
      Math.abs(this.currentFrameTimestampUs - targetUs) <= frameDurationUs * 1.5;
    const isFeedNearTarget =
      this.feedIndex >= targetIdx &&
      this.feedIndex <= targetIdx + WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD;
    const hasLargeDecodeBacklog =
      this.getResumeQueueSize(targetUs) > WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET;
    const hasHotFutureFrame = this.hasBufferedFutureFrame();

    // Check if decoder needs repositioning:
    // - target is behind current position (backward jump)
    // - target is far ahead of what we've fed (gap/skip/clip start)
    // For playback restarts: skip the heavyweight decoder.reset() + configure()
    // when the decoder pipeline is already positioned at/near the target.
    // This avoids 50-100ms+ main-thread blocking from hardware decode resets.
    let restartNeedsReset = false;
    let keepHotResumeWarmupActive = false;
    if (shouldRestartPlaybackPipeline) {
      const keyframeForTarget = this.findKeyframeBefore(targetIdx);
      // feedIndex is already at or slightly past the keyframe we'd reset to,
      // AND not too far ahead (within a small window of samples).
      // In that case the decoder is already producing the right frames.
      const feedDistFromKeyframe = this.feedIndex - keyframeForTarget;
      const isFeedPositionedCorrectly =
        feedDistFromKeyframe >= 0 && feedDistFromKeyframe <= 16;
      const canResumeFromHotPausedFrame =
        isDecoderReady &&
        hasHotCurrentFrame &&
        isFeedNearTarget &&
        !hasLargeDecodeBacklog;

      if (isFeedPositionedCorrectly && isDecoderReady && this.frameBuffer.length > 0) {
        // Decoder is configured, positioned correctly, AND has decoded frames
        // available - safe to skip the heavyweight reset+configure.
        webCodecsTelemetry.seekSkipResetAlreadyPositioned(
          this.feedIndex,
          keyframeForTarget,
          targetIdx,
          feedDistFromKeyframe
        );
      } else if (canResumeFromHotPausedFrame) {
        keepHotResumeWarmupActive = !hasHotFutureFrame;
        webCodecsTelemetry.seekSkipResumeHotFrame(
          targetIdx,
          this.feedIndex,
          this.getEffectiveDecodeQueueSize(),
          hasHotFutureFrame,
          keepHotResumeWarmupActive
        );
      } else {
        restartNeedsReset = true;
      }
    }
    let needsSeek =
      restartNeedsReset ||
      backwardJump ||
      forwardGap > forwardSeekThreshold;
    const pendingAdvanceTargetIdx = this.pendingAdvanceSeekTargetIdx;
    const keepPendingAdvanceSeekAlive =
      !shouldRestartPlaybackPipeline &&
      this.shouldContinueAdvanceSeek(
        targetIdx,
        decodeCoverageEnd
      );

    if (!keepPendingAdvanceSeekAlive && pendingAdvanceTargetIdx !== null) {
      this.clearAdvanceSeekState(needsSeek ? 'replaced' : 'cancelled');
    }

    const activePendingAdvanceTargetIdx =
      keepPendingAdvanceSeekAlive
        ? this.pendingAdvanceSeekTargetIdx
        : null;
    const advanceResolveTargetIdx =
      activePendingAdvanceTargetIdx ?? targetIdx;
    const advanceFeedTargetIdx =
      activePendingAdvanceTargetIdx !== null
        ? Math.max(targetIdx, activePendingAdvanceTargetIdx)
        : targetIdx;

    if (needsSeek && keepPendingAdvanceSeekAlive) {
      webCodecsTelemetry.seekSkipAdvanceInflight(
        timeSeconds,
        targetIdx,
        activePendingAdvanceTargetIdx ?? -1,
        decodeCoverageEnd,
        this.getEffectiveDecodeQueueSize()
      );
      needsSeek = false;
    }

    if (needsSeek) {
      const keyframe = this.findKeyframeBefore(targetIdx);
      const hasUsableStartupFrame = this.isFrameUsableForPlaybackStartup(
        this.currentFrameTimestampUs,
        targetUs
      );
      const shouldDiscardStaleDisplayedFrame =
        startingPlayback &&
        this.currentFrameTimestampUs !== null &&
        !this.isDisplayedFrameNearTarget(targetUs, 8) &&
        !hasUsableStartupFrame;
      if (shouldDiscardStaleDisplayedFrame) {
        this.clearDisplayedFrame();
      }
      this.recordDecoderReset('advance_seek');
      this.decoder.reset();
      this.decoder.configure(this.codecConfig!);
      this.resetDecodeQueueTracking();
      this.clearFrameBuffer();
      this.feedIndex = keyframe;
      this.setPendingAdvanceSeekTarget(advanceResolveTargetIdx);
      webCodecsTelemetry.advanceSeek(
        timeSeconds,
        targetIdx - keyframe,
        forwardGap,
        currentFrameIdx,
        shouldRestartPlaybackPipeline ? 'playback_restart' : 'advance'
      );
    }

    // Pump decoder: feed samples ahead of target position.
    // During seeks, bypass queue limit to push all GOP frames at once -
    // the decoder processes them off-main-thread in one burst.
    const keepAdvanceFeedActive =
      needsSeek || keepPendingAdvanceSeekAlive || keepHotResumeWarmupActive;
    const feedBaseTargetIdx = keepHotResumeWarmupActive
      ? Math.max(advanceFeedTargetIdx, this.feedIndex)
      : keepAdvanceFeedActive
        ? advanceFeedTargetIdx
        : targetIdx;
    const feedTarget = Math.min(
      feedBaseTargetIdx + WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD,
      this.samples.length
    );
    const queueLimit = keepAdvanceFeedActive
      ? WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET
      : WEB_CODECS_PLAYER_LIMITS.FEED_QUEUE_TARGET;
    let hitQueueCap = false;
    while (this.feedIndex < feedTarget) {
      if (this.getEffectiveDecodeQueueSize() >= queueLimit) {
        hitQueueCap = true;
        break;
      }
      const sample = this.samples[this.feedIndex];
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
          needsSeek
            ? 'advance_seek'
            : keepPendingAdvanceSeekAlive
              ? 'advance_pending'
              : keepHotResumeWarmupActive
                ? 'advance_resume_warmup'
              : 'advance'
        );
        // Only record queue_pressure when actually at the limit (not at 3)
        if (queueSize >= queueLimit) {
          webCodecsTelemetry.queuePressure(queueSize, queueLimit);
        }
      } catch { /* skip decode errors */ }
      this.feedIndex++;
    }

    if (needsSeek && hitQueueCap) {
      webCodecsTelemetry.seekSkipAdvanceQueueCap(
        timeSeconds,
        targetIdx,
        this.getEffectiveDecodeQueueSize(),
        queueLimit
      );
    }

    this.sampleIndex = targetIdx;

    // Pick the frame closest to target time from the decode buffer.
    // CRITICAL: Only accept frames within 1.5 frame-durations of the target.
    // This prevents showing intermediate GOP-traversal frames during seeks -
    // without this, the renderer would flash through keyframe -> target visibly.
    if (this.frameBuffer.length > 0) {
      const selectionPendingTargetIdx = this.pendingAdvanceSeekTargetIdx;
      const selectionTargetUs =
        selectionPendingTargetIdx !== null
          ? this.getSampleTimestampUs(selectionPendingTargetIdx) ?? targetUs
          : targetUs;
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < this.frameBuffer.length; i++) {
        const diff = Math.abs(this.frameBuffer[i].timestamp - selectionTargetUs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }

      const acceptableToleranceUs =
        selectionPendingTargetIdx !== null
          ? frameDurationUs * 3
          : frameDurationUs * 1.5;
      const acceptable = bestIdx >= 0 && bestDiff < acceptableToleranceUs;
      const startupWarmupPublishable =
        bestIdx >= 0 &&
        !acceptable &&
        this.shouldPublishPlaybackStartupFrame(
          this.frameBuffer[bestIdx].timestamp,
          selectionTargetUs
        );

      if (acceptable || startupWarmupPublishable) {
        // Accept this frame - close everything before it
        for (let i = 0; i < bestIdx; i++) {
          if (this.frameBuffer[i] !== this.currentFrame) {
            this.frameBuffer[i].close();
          }
        }
        const frame = this.frameBuffer[bestIdx];
        if (this.currentFrame && this.currentFrame !== frame) {
          this.currentFrame.close();
        }
        this.currentFrame = frame;
        this.currentFrameTimestampUs = frame.timestamp;
        this.onFrame?.(frame);
        this.frameBuffer.splice(0, bestIdx + 1);
        if (startupWarmupPublishable) {
          webCodecsTelemetry.seekPublish(
            selectionTargetUs,
            frame.timestamp,
            bestDiff,
            'playback_startup_warmup'
          );
        } else {
          this.playbackStartupWarmupStartedAtMs = null;
        }
        if (selectionPendingTargetIdx !== null && acceptable) {
          this.clearAdvanceSeekState('resolved');
        }
      } else {
        // No acceptable frame yet - clean up stale past frames but keep future ones.
        // The decoder is still producing frames; the right one will arrive soon.
        const expireThreshold = selectionTargetUs - frameDurationUs * 2;
        while (
          this.frameBuffer.length > 0 &&
          this.frameBuffer[0].timestamp < expireThreshold &&
          this.frameBuffer[0] !== this.currentFrame
        ) {
          this.frameBuffer.shift()!.close();
        }
      }
    }
  }
}
