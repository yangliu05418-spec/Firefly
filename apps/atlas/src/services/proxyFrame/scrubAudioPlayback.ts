import { clampAudioPan } from '../../engine/audio/audioMath';
import { calculateAudioMeterSnapshot } from '../audio/audioMetering';
import type { ScrubAudioOptions, ScrubGrain } from './scrubAudioModels';
import { ScrubAudioEffectChain } from './scrubAudioEffectChain';
import { scrubProcessorSignature } from './scrubAudioProcessing';

const SCRUB_STATIONARY_EPSILON_SECONDS = 0.003;
const SCRUB_STATIONARY_STOP_MS = 140;
const SCRUB_GRAIN_DURATION_SECONDS = 0.09;
const SCRUB_GRAIN_SPACING_SECONDS = 0.075;
const SCRUB_GRAIN_FADE_SECONDS = 0.008;
const SCRUB_GRAIN_SCHEDULE_AHEAD_SECONDS = 0.075;
const SCRUB_GRAIN_PEAK_GAIN = 0.42;
const SCRUB_RESYNC_POSITION_DELTA_SECONDS = 0.045;
const SCRUB_RESYNC_FADE_OUT_SECONDS = 0.012;
const SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND = 2.5;
const SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND = -0.04;

export class ScrubAudioPlaybackController {
  private readonly effectChain = new ScrubAudioEffectChain();
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private frequencyBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubSource: AudioBufferSourceNode | null = null;
  private scrubGrains = new Set<ScrubGrain>();
  private scrubCurrentMediaId: string | null = null;
  private scrubLastPosition = 0;
  private scrubLastTime = 0;
  private scrubLastMovementTime = 0;
  private scrubNextGrainTime = 0;
  private scrubSmoothedVelocity = 0;
  private scrubLastDirection: 1 | -1 = 1;
  private scrubPausedMediaId: string | null = null;
  private scrubPausedPosition: number | null = null;
  private scrubStationaryTimer: ReturnType<typeof setTimeout> | null = null;
  private scrubIsActive = false;

  private readonly resetFrameScrubState: () => void;
  private readonly logDebug: (message: string) => void;

  constructor(
    resetFrameScrubState: () => void,
    logDebug: (message: string) => void,
  ) {
    this.resetFrameScrubState = resetFrameScrubState;
    this.logDebug = logDebug;
  }

  get isActive(): boolean {
    return this.scrubIsActive;
  }

  initializeAudioContext(ctx: AudioContext): void {
    if (this.masterGain && this.masterAnalyser) return;
    this.masterGain = ctx.createGain();
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterAnalyser.smoothingTimeConstant = 0.2;
    this.masterMeterBuffer = new Float32Array(this.masterAnalyser.fftSize);
    this.masterAnalyser.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
    this.masterGain.gain.value = 1;
  }

  disposeAudioContextState(): void {
    this.effectChain.disconnect();
    this.masterGain = null;
    this.masterAnalyser = null;
    this.masterMeterBuffer = null;
    this.frequencyBuffer = null;
  }

  /**
   * Granular scrub audio - call continuously while dragging the playhead.
   * Short overlapping, pitch-stable grains avoid the gated/stalled sound of
   * one long buffer source and allow backward scrub feedback.
   */
  playScrubAudio(args: {
    mediaFileId: string;
    targetTime: number;
    buffer: AudioBuffer;
    getAudioContext: () => AudioContext;
    options?: ScrubAudioOptions;
  }): void {
    const { mediaFileId, targetTime, buffer, getAudioContext, options } = args;
    if (!this.scrubIsActive) {
      this.logDebug(`Granular scrub starting at ${targetTime.toFixed(2)}s`);
    }

    const ctx = getAudioContext();
    this.initializeAudioContext(ctx);
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const scrubVolume = Math.max(0, Math.min(4, options?.volume ?? 1));
    const scrubMasterVolume = Math.max(0, Math.min(4, options?.masterRoute?.volume ?? 1));
    const scrubEqGains = options?.eqGains ?? [];
    const scrubPan = clampAudioPan(options?.pan);
    const scrubProcessors = options?.processors ?? [];
    const processorSignature = scrubProcessorSignature(scrubProcessors);
    const now = performance.now();
    const maxTargetTime = Math.max(0, buffer.duration - SCRUB_GRAIN_DURATION_SECONDS);
    const clampedTarget = Math.max(0, Math.min(targetTime, maxTargetTime));

    const hasPreviousScrubSample = this.scrubLastTime > 0 && Number.isFinite(this.scrubLastPosition);
    const timeDelta = hasPreviousScrubSample ? (now - this.scrubLastTime) / 1000 : 0;
    const posDelta = hasPreviousScrubSample ? clampedTarget - this.scrubLastPosition : 0;
    const sameScrubMedia = this.scrubCurrentMediaId === mediaFileId || this.scrubPausedMediaId === mediaFileId;
    const targetMoved = !hasPreviousScrubSample ||
      !sameScrubMedia ||
      Math.abs(posDelta) > SCRUB_STATIONARY_EPSILON_SECONDS;

    if (targetMoved) {
      this.scrubLastMovementTime = now;
      this.scrubPausedMediaId = null;
      this.scrubPausedPosition = null;
    } else if (
      this.scrubPausedMediaId === mediaFileId &&
      this.scrubPausedPosition !== null &&
      Math.abs(clampedTarget - this.scrubPausedPosition) <= SCRUB_STATIONARY_EPSILON_SECONDS
    ) {
      this.scrubLastPosition = clampedTarget;
      this.scrubLastTime = now;
      return;
    } else if (
      this.scrubLastMovementTime > 0 &&
      now - this.scrubLastMovementTime >= SCRUB_STATIONARY_STOP_MS
    ) {
      this.scrubLastPosition = clampedTarget;
      this.scrubLastTime = now;
      this.pauseStationaryScrubAudio(mediaFileId, clampedTarget);
      return;
    }

    this.scrubLastPosition = clampedTarget;
    this.scrubLastTime = now;

    const needsNewEffectChain =
      !this.effectChain.sourceGainNode ||
      this.scrubCurrentMediaId !== mediaFileId ||
      this.effectChain.signature !== processorSignature;

    if (needsNewEffectChain) {
      this.stopScrubAudio({ keepMotionTracking: true });
      this.initializeAudioContext(ctx);
      this.effectChain.attach(
        ctx,
        this.masterAnalyser!,
        scrubVolume,
        scrubEqGains,
        scrubPan,
        scrubProcessors,
        processorSignature,
      );
      this.scrubCurrentMediaId = mediaFileId;
      this.scrubNextGrainTime = ctx.currentTime;
      this.scrubSmoothedVelocity = 0;
    } else {
      this.effectChain.update(ctx, scrubVolume, scrubEqGains, scrubPan, scrubProcessors);
    }

    if (this.masterGain && Math.abs(this.masterGain.gain.value - scrubMasterVolume) > 0.001) {
      this.masterGain.gain.value = scrubMasterVolume;
    }

    if (targetMoved) {
      const rawVelocity = timeDelta > 0.001 ? posDelta / timeDelta : 0;
      const previousVelocity = this.scrubSmoothedVelocity;
      this.scrubSmoothedVelocity =
        this.scrubSmoothedVelocity === 0
          ? rawVelocity
          : this.scrubSmoothedVelocity + (rawVelocity - this.scrubSmoothedVelocity) * 0.35;
      if (this.scrubSmoothedVelocity < SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND) {
        this.scrubLastDirection = -1;
      } else if (this.scrubSmoothedVelocity > Math.abs(SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND)) {
        this.scrubLastDirection = 1;
      }
      if (this.shouldResyncScrubSchedule(posDelta, rawVelocity, previousVelocity)) {
        this.resyncScrubGrainSchedule(ctx.currentTime);
      }
      this.scheduleScrubGrains(ctx, buffer, clampedTarget, this.scrubSmoothedVelocity);
      this.scheduleStationaryScrubStop(mediaFileId, clampedTarget);
    }
  }

  /**
   * Stop scrub audio - call when scrubbing ends
   */
  stopScrubAudio(options: { keepMotionTracking?: boolean } = {}): void {
    this.clearScrubStationaryTimer();

    for (const grain of Array.from(this.scrubGrains)) {
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
    this.scrubSource = null;
    this.effectChain.disconnect();
    this.scrubIsActive = false;
    this.scrubCurrentMediaId = null;

    // Also reset frame scrub tracking state
    this.resetFrameScrubState();

    if (!options.keepMotionTracking) {
      this.scrubLastPosition = 0;
      this.scrubLastTime = 0;
      this.scrubLastMovementTime = 0;
      this.scrubNextGrainTime = 0;
      this.scrubSmoothedVelocity = 0;
      this.scrubLastDirection = 1;
      this.scrubPausedMediaId = null;
      this.scrubPausedPosition = null;
      this.scrubStationaryTimer = null;
    }
  }

  getScrubMeterSnapshot(updatedAt = performance.now()): ReturnType<typeof calculateAudioMeterSnapshot> | null {
    if (!this.masterAnalyser || !this.masterMeterBuffer || !this.scrubIsActive) return null;
    this.masterAnalyser.getFloatTimeDomainData(this.masterMeterBuffer);
    if (!this.frequencyBuffer || this.frequencyBuffer.length !== this.masterAnalyser.frequencyBinCount) {
      this.frequencyBuffer = new Float32Array(this.masterAnalyser.frequencyBinCount);
    }
    this.masterAnalyser.getFloatFrequencyData(this.frequencyBuffer);
    const stereoSamples = this.effectChain.readStereoMeterSamples();

    return calculateAudioMeterSnapshot(
      this.masterMeterBuffer,
      updatedAt,
      this.effectChain.getDynamicsSnapshot(updatedAt),
      stereoSamples,
      new Float32Array(this.frequencyBuffer),
    );
  }

  private shouldResyncScrubSchedule(
    positionDelta: number,
    rawVelocity: number,
    previousVelocity: number,
  ): boolean {
    if (Math.abs(positionDelta) >= SCRUB_RESYNC_POSITION_DELTA_SECONDS) return true;
    if (Math.abs(rawVelocity) >= SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND) return true;
    if (Math.abs(previousVelocity) < 0.001 || Math.abs(rawVelocity) < 0.001) return false;
    return Math.sign(previousVelocity) !== Math.sign(rawVelocity);
  }

  private resyncScrubGrainSchedule(currentTime: number): void {
    this.stopScrubGrainsForResync(currentTime);
    this.scrubNextGrainTime = currentTime;
  }

  private stopScrubGrainsForResync(currentTime: number): void {
    for (const grain of Array.from(this.scrubGrains)) {
      if (grain.startTime <= currentTime) {
        this.fadeOutScrubGrain(grain, currentTime);
        continue;
      }
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
  }

  private fadeOutScrubGrain(grain: ScrubGrain, currentTime: number): void {
    const stopTime = currentTime + SCRUB_RESYNC_FADE_OUT_SECONDS;
    try {
      grain.gain.gain.cancelScheduledValues(currentTime);
      grain.gain.gain.setValueAtTime(Math.max(0, grain.gain.gain.value), currentTime);
      grain.gain.gain.linearRampToValueAtTime(0, stopTime);
      grain.source.stop(stopTime);
    } catch {
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
  }

  private scheduleScrubGrains(
    ctx: AudioContext,
    buffer: AudioBuffer,
    targetPosition: number,
    velocity: number,
  ): void {
    if (!this.effectChain.sourceGainNode) return;

    const scheduleUntil = ctx.currentTime + SCRUB_GRAIN_SCHEDULE_AHEAD_SECONDS;
    if (this.scrubNextGrainTime < ctx.currentTime) {
      this.scrubNextGrainTime = ctx.currentTime;
    }

    let scheduledCount = 0;
    while (this.scrubNextGrainTime < scheduleUntil) {
      const leadSeconds = Math.max(0, this.scrubNextGrainTime - ctx.currentTime);
      const grainPosition = targetPosition + velocity * leadSeconds;
      this.scheduleScrubGrain(ctx, buffer, grainPosition, velocity, this.scrubNextGrainTime);
      this.scrubNextGrainTime += SCRUB_GRAIN_SPACING_SECONDS;
      scheduledCount += 1;
    }

    if (scheduledCount === 0 && Math.abs(velocity) >= SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND) {
      this.resyncScrubGrainSchedule(ctx.currentTime);
      this.scheduleScrubGrain(ctx, buffer, targetPosition, velocity, this.scrubNextGrainTime);
      this.scrubNextGrainTime += SCRUB_GRAIN_SPACING_SECONDS;
    }
  }

  private scheduleScrubGrain(
    ctx: AudioContext,
    buffer: AudioBuffer,
    position: number,
    velocity: number,
    startTime: number,
  ): void {
    const direction: 1 | -1 =
      velocity < SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND ? -1 : this.scrubLastDirection;
    const grainDuration = Math.min(
      SCRUB_GRAIN_DURATION_SECONDS,
      Math.max(0.01, buffer.duration || SCRUB_GRAIN_DURATION_SECONDS),
    );
    const sourceBuffer = direction < 0
      ? this.createReverseScrubGrainBuffer(ctx, buffer, position, grainDuration)
      : buffer;
    const offset = direction < 0
      ? 0
      : this.getScrubGrainOffset(buffer, position, grainDuration);
    const playbackDuration = Math.min(grainDuration, sourceBuffer.duration);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = sourceBuffer;
    source.playbackRate.value = 1;
    this.shapeScrubGrainGain(gain.gain, startTime, playbackDuration);

    source.connect(gain);
    gain.connect(this.effectChain.sourceGainNode!);

    const grain: ScrubGrain = { source, gain, startTime };
    this.scrubGrains.add(grain);
    this.scrubSource = source;
    this.scrubIsActive = true;

    source.onended = () => {
      this.cleanupScrubGrain(grain);
      if (this.scrubSource === source) {
        this.scrubSource = null;
      }
      if (this.scrubGrains.size === 0 && this.scrubPausedMediaId !== null) {
        this.scrubIsActive = false;
      }
    };

    source.start(startTime, offset, playbackDuration);
  }

  private getScrubGrainOffset(
    buffer: AudioBuffer,
    position: number,
    duration: number,
  ): number {
    const maxOffset = Math.max(0, buffer.duration - duration);
    return Math.max(0, Math.min(position, maxOffset));
  }

  private shapeScrubGrainGain(gain: AudioParam, startTime: number, duration: number): void {
    const fadeSeconds = Math.min(SCRUB_GRAIN_FADE_SECONDS, duration / 3);
    const peakStart = startTime + fadeSeconds;
    const peakEnd = Math.max(peakStart, startTime + duration - fadeSeconds);
    gain.cancelScheduledValues(startTime);
    gain.setValueAtTime(0, startTime);
    gain.linearRampToValueAtTime(SCRUB_GRAIN_PEAK_GAIN, peakStart);
    gain.setValueAtTime(SCRUB_GRAIN_PEAK_GAIN, peakEnd);
    gain.linearRampToValueAtTime(0, startTime + duration);
  }

  private createReverseScrubGrainBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    position: number,
    duration: number,
  ): AudioBuffer {
    const sampleCount = Math.max(
      1,
      Math.min(buffer.length, Math.ceil(duration * buffer.sampleRate)),
    );
    const reversed = ctx.createBuffer(buffer.numberOfChannels, sampleCount, buffer.sampleRate);
    const endSample = Math.max(
      sampleCount,
      Math.min(buffer.length, Math.round(position * buffer.sampleRate)),
    );
    const startSample = endSample - sampleCount;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const source = buffer.getChannelData(channel);
      const target = reversed.getChannelData(channel);
      for (let i = 0; i < sampleCount; i += 1) {
        target[i] = source[startSample + sampleCount - 1 - i] ?? 0;
      }
    }

    return reversed;
  }

  private scheduleStationaryScrubStop(mediaFileId: string, position: number): void {
    this.clearScrubStationaryTimer();
    this.scrubStationaryTimer = setTimeout(() => {
      this.scrubStationaryTimer = null;
      const now = performance.now();
      const sameMedia = this.scrubCurrentMediaId === mediaFileId || this.scrubPausedMediaId === mediaFileId;
      const samePosition = Math.abs(this.scrubLastPosition - position) <= SCRUB_STATIONARY_EPSILON_SECONDS;

      if (
        sameMedia &&
        samePosition &&
        this.scrubLastMovementTime > 0 &&
        now - this.scrubLastMovementTime >= SCRUB_STATIONARY_STOP_MS
      ) {
        this.scrubLastTime = now;
        this.pauseStationaryScrubAudio(mediaFileId, position);
      }
    }, SCRUB_STATIONARY_STOP_MS);
  }

  private pauseStationaryScrubAudio(mediaFileId: string, position: number): void {
    this.clearScrubStationaryTimer();
    this.scrubPausedMediaId = mediaFileId;
    this.scrubPausedPosition = position;
    this.scrubLastPosition = position;
  }

  private clearScrubStationaryTimer(): void {
    if (this.scrubStationaryTimer !== null) {
      clearTimeout(this.scrubStationaryTimer);
      this.scrubStationaryTimer = null;
    }
  }

  private cleanupScrubGrain(grain: ScrubGrain): void {
    this.scrubGrains.delete(grain);
    try {
      grain.source.disconnect();
    } catch { /* ignore */ }
    try {
      grain.gain.disconnect();
    } catch { /* ignore */ }
  }
}
