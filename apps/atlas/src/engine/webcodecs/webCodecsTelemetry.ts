import { wcPipelineMonitor } from '../../services/wcPipelineMonitor';

type ChunkKind = 'key' | 'delta';
type DecodeFeedMode =
  | 'seek'
  | 'advance_seek'
  | 'pause_preroll'
  | 'advance_pending'
  | 'advance_resume_warmup'
  | 'advance';
type DecoderResetReason = 'loop' | 'advance_seek' | 'seek' | 'fast_seek';
type PendingSeekKind = 'seek' | 'advance';
type PendingSeekEndReason = 'resolved' | 'cancelled' | 'replaced' | 'cleared' | 'fallback';
type SeekPublishMode =
  | 'playback_start_fallback'
  | 'strict_flush_fallback'
  | 'interactive_preview'
  | 'resolved'
  | 'playback_startup_warmup';

export const webCodecsTelemetry = {
  seekPublish(targetUs: number, frameUs: number, diffUs: number, mode: SeekPublishMode): void {
    wcPipelineMonitor.record('seek_publish', {
      targetUs: Math.round(targetUs),
      frameUs: Math.round(frameUs),
      diffUs: Math.round(diffUs),
      mode,
    });
  },

  decodeOutput(ts: number, queueSize: number): void {
    wcPipelineMonitor.record('decode_output', {
      ts,
      queueSize,
    });
  },

  frameDropSeekIntermediate(frameUs: number, targetUs: number): void {
    wcPipelineMonitor.record('frame_drop', {
      reason: 'seek_intermediate',
      frameUs: Math.round(frameUs),
      targetUs: Math.round(targetUs),
    });
  },

  play(): void {
    wcPipelineMonitor.record('play');
  },

  pause(buffered: number, seeking: boolean): void {
    wcPipelineMonitor.record('pause', {
      buffered,
      seeking: seeking ? 'true' : 'false',
    });
  },

  seekCancelPause(): void {
    wcPipelineMonitor.record('seek_cancel', { reason: 'pause' });
  },

  rafGap(gapMs: number): void {
    wcPipelineMonitor.record('rAF_gap', { gapMs: Math.round(gapMs) });
  },

  decodeFeed(
    sampleIdx: number,
    type: ChunkKind,
    queueSize: number,
    mode?: DecodeFeedMode
  ): void {
    const detail: {
      sampleIdx: number;
      type: ChunkKind;
      queueSize: number;
      mode?: DecodeFeedMode;
    } = { sampleIdx, type, queueSize };
    if (mode !== undefined) {
      detail.mode = mode;
    }
    wcPipelineMonitor.record('decode_feed', detail);
  },

  pendingSeekStart(kind: PendingSeekKind, targetUs: number): void {
    wcPipelineMonitor.record('pending_seek_start', {
      kind,
      targetUs: Math.round(targetUs),
    });
  },

  pendingSeekEnd(
    kind: PendingSeekKind | 'unknown',
    durationMs: number,
    targetUs: number,
    reason: PendingSeekEndReason
  ): void {
    wcPipelineMonitor.record('pending_seek_end', {
      kind,
      durationMs: Math.round(durationMs),
      targetUs: Math.round(targetUs),
      reason,
    });
  },

  decoderReset(reason: DecoderResetReason): void {
    wcPipelineMonitor.record('decoder_reset', { reason });
  },

  seekSkipStrictFlushWithoutPublish(targetUs: number): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'strict_seek_flush_without_publish',
      targetUs: Math.round(targetUs),
    });
  },

  seekSkipAdvancePendingTimeout(
    targetIdx: number,
    pendingTargetIdx: number,
    durationMs: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'advance_pending_timeout',
      targetIdx,
      pendingTargetIdx,
      durationMs: Math.round(durationMs),
    });
  },

  seekSkipAwaitPendingPausedSeekForPlay(
    targetUs: number,
    pendingTargetUs: number,
    diffUs: number,
    queueSize: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'await_pending_paused_seek_for_play',
      targetUs: Math.round(targetUs),
      pendingTargetUs: Math.round(pendingTargetUs),
      diffUs: Math.round(diffUs),
      queueSize,
    });
  },

  seekSkipResetAlreadyPositioned(
    feedIndex: number,
    keyframe: number,
    targetIdx: number,
    feedDist: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'reset_already_positioned',
      feedIndex,
      keyframe,
      targetIdx,
      feedDist,
    });
  },

  seekSkipResumeHotFrame(
    targetIdx: number,
    feedIndex: number,
    queueSize: number,
    futureBuffered: boolean,
    warmup: boolean
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'resume_hot_frame',
      targetIdx,
      feedIndex,
      queueSize,
      futureBuffered: futureBuffered ? 1 : 0,
      warmup: warmup ? 1 : 0,
    });
  },

  seekSkipAdvanceInflight(
    timeSeconds: number,
    targetIdx: number,
    pendingTargetIdx: number,
    coverageEnd: number,
    queueSize: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'advance_inflight',
      target: Math.round(timeSeconds * 1000) / 1000,
      targetIdx,
      pendingTargetIdx,
      coverageEnd,
      queueSize,
    });
  },

  advanceSeek(
    target: number,
    keyframeDist: number,
    forwardGap: number,
    currentFrameIdx: number,
    reason: 'playback_restart' | 'advance'
  ): void {
    wcPipelineMonitor.record('advance_seek', {
      target,
      keyframeDist,
      forwardGap,
      currentFrameIdx,
      reason,
    });
  },

  queuePressure(queueSize: number, queueLimit: number): void {
    wcPipelineMonitor.record('queue_pressure', {
      queueSize,
      queueLimit,
    });
  },

  seekSkipAdvanceQueueCap(
    timeSeconds: number,
    targetIdx: number,
    queueSize: number,
    queueLimit: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason: 'advance_queue_cap',
      target: Math.round(timeSeconds * 1000) / 1000,
      targetIdx,
      queueSize,
      queueLimit,
    });
  },

  seekStart(target: number, keyframeDist: number): void {
    wcPipelineMonitor.record('seek_start', {
      target,
      keyframeDist,
    });
  },

  seekSkipReuse(
    reason: 'seek_extend_pending' | 'seek_reuse_pipeline',
    targetIdx: number,
    currentFrameIdx: number,
    feedIndex: number
  ): void {
    wcPipelineMonitor.record('seek_skip', {
      reason,
      targetIdx,
      currentFrameIdx,
      feedIndex,
    });
  },

  seekEnd(target: number, framesDecoded: number, durationMs: number): void {
    wcPipelineMonitor.record('seek_end', {
      target,
      framesDecoded,
      durationMs: Math.round(durationMs),
    });
  },
};
