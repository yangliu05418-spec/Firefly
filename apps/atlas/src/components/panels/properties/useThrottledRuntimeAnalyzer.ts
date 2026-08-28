import { useEffect, useRef, useState } from 'react';
import type { AudioEqAnalyzerView } from '../../../engine/audio/eq/AudioEqTypes';
import {
  runtimeAudioMeterBus,
  type RuntimeAudioMeterScope,
} from '../../../services/audio/runtimeAudioMeterBus';
import { runtimeSpectrumTaps } from '../../../services/audio/runtimeSpectrumTaps';
import type { AudioMeterSnapshot } from '../../../types';

export type RuntimeAnalyzerScope = 'track' | 'master' | undefined;

type AnalyzerRef = { current: AudioEqAnalyzerView | undefined };

// Spectrum snapshots arrive at whatever cadence the active publisher runs
// (media routes ~60Hz, stem mixer 20Hz, MIDI scheduler 40Hz, tail polls
// 20Hz). The analyzer therefore animates display-side: every animation frame
// eases the drawn spectrum toward the latest published snapshot with
// attack/release ballistics, so the graph moves at display rate regardless of
// publisher cadence (see the METER_PUBLISH_INTERVAL_MS note in
// AudioSyncHandler: sub-display publish rates need UI-side interpolation).
const ATTACK_TIME_CONSTANT_MS = 50;
const RELEASE_TIME_CONSTANT_MS = 260;
// Once the display converged and no fresh snapshot arrived for a while, the
// loop stops; the next snapshot restarts it.
const IDLE_STOP_AFTER_MS = 300;
const CONVERGED_EPSILON_DB = 0.05;
const MAX_FRAME_DELTA_MS = 100;
// Publishers interleave on the master scope: media routes publish spectrum
// while stem-mixer aggregates do not. Spectrum-less snapshots therefore only
// clear the display after the last spectrum is older than the bus stale age,
// instead of blanking the graph for one frame between spectrum publishes.
const SPECTRUM_HOLD_MS = 450;
// While the display-rate tap delivers fresh FFT data, bus snapshot copies are
// skipped (they carry the same analyser's data, just older).
const DIRECT_TAP_FRESH_MS = 100;
// AnalyserNode FFT data reports -Infinity for silent bins; clamp to a finite
// floor (and a defensive ceiling against +Infinity) so the easing arithmetic
// stays NaN-free.
const SPECTRUM_FLOOR_DB = -160;
const SPECTRUM_CEILING_DB = 24;
// Once every displayed bin has released below this level (well under the
// graph's -96dB draw floor), the analyzer is cleared entirely instead of
// keeping an invisible floor line alive.
const CLEAR_BELOW_DB = -120;
const SPECTRUM_SUBSCRIPTION = { features: ['spectrum'] as const };

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function sanitizeSpectrumCopy(source: Float32Array, target: Float32Array): void {
  for (let index = 0; index < target.length; index += 1) {
    const value = source[index];
    // NaN fails the comparison and lands on the floor as well.
    const floored = value > SPECTRUM_FLOOR_DB ? value : SPECTRUM_FLOOR_DB;
    target[index] = floored < SPECTRUM_CEILING_DB ? floored : SPECTRUM_CEILING_DB;
  }
}

function resolveBusScope(
  scope: RuntimeAnalyzerScope,
  trackId: string | undefined,
): RuntimeAudioMeterScope | undefined {
  if (scope === 'track' && trackId) return { kind: 'track', trackId };
  if (scope === 'master') return { kind: 'master' };
  return undefined;
}

function getScopeSpectrumDb(busScope: RuntimeAudioMeterScope): Float32Array | undefined {
  const snapshot = busScope.kind === 'master'
    ? runtimeAudioMeterBus.getMasterSnapshot()
    : runtimeAudioMeterBus.getTrackSnapshot(busScope.trackId);
  return snapshot?.spectrumDb;
}

/**
 * Streams the live analyzer spectrum from the runtime audio meter bus into `analyzerRef`,
 * scheduling a canvas redraw without forcing a React render per published snapshot. Only
 * the "has analyzer" boolean is surfaced as React state. The drawn spectrum is eased
 * toward the latest snapshot per animation frame, so display motion stays smooth even
 * when the publisher ticks below display rate.
 */
export function useRuntimeAnalyzerStream(
  scope: RuntimeAnalyzerScope,
  trackId: string | undefined,
  analyzerRef: AnalyzerRef,
  onAnalyzerFrame?: () => void,
): boolean {
  const onAnalyzerFrameRef = useRef(onAnalyzerFrame);
  const [hasAnalyzer, setHasAnalyzer] = useState(false);
  const hasAnalyzerRef = useRef(false);

  useEffect(() => {
    onAnalyzerFrameRef.current = onAnalyzerFrame;
  }, [onAnalyzerFrame]);

  useEffect(() => {
    const setHasAnalyzerIfChanged = (next: boolean) => {
      if (hasAnalyzerRef.current === next) return;
      hasAnalyzerRef.current = next;
      setHasAnalyzer(next);
    };

    const busScope = resolveBusScope(scope, trackId);
    if (!busScope) {
      setHasAnalyzerIfChanged(false);
      return undefined;
    }

    const canUseRaf = typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function' &&
      typeof window.cancelAnimationFrame === 'function';

    let targetDb: Float32Array | undefined;
    let displayDb: Float32Array | undefined;
    let displayView: AudioEqAnalyzerView | undefined;
    let frameId: number | null = null;
    let lastFrameTs = 0;
    let lastSnapshotAt = 0;
    let lastSpectrumAt = 0;
    let lastDirectAt = 0;

    const commitDisplay = () => {
      analyzerRef.current = displayView;
      setHasAnalyzerIfChanged(Boolean(displayView));
      onAnalyzerFrameRef.current?.();
    };

    const stopLoop = () => {
      if (frameId !== null && canUseRaf) window.cancelAnimationFrame(frameId);
      frameId = null;
    };

    // Copies a spectrum into the easing target; (re)initializes the display
    // buffers on the first spectrum or an FFT size change, jumping straight to
    // the published values instead of easing up from stale data.
    const applyTargetSpectrum = (spectrumDb: Float32Array) => {
      if (!targetDb || !displayDb || targetDb.length !== spectrumDb.length) {
        targetDb = new Float32Array(spectrumDb.length);
        displayDb = new Float32Array(spectrumDb.length);
        sanitizeSpectrumCopy(spectrumDb, targetDb);
        displayDb.set(targetDb);
        displayView = { postDb: displayDb };
        return;
      }
      sanitizeSpectrumCopy(spectrumDb, targetDb);
    };

    const step = (timestamp: number) => {
      frameId = null;
      // Display-rate sampling: read the live analyser directly each frame.
      // Meter-bus snapshots stay as data source for scopes without a tap
      // (e.g. stem-mixer tracks) and as the initial value.
      const direct = runtimeSpectrumTaps.read(busScope);
      if (direct && direct.length > 0) {
        const at = nowMs();
        lastSnapshotAt = at;
        lastSpectrumAt = at;
        lastDirectAt = at;
        applyTargetSpectrum(direct);
      } else if (targetDb && nowMs() - lastSpectrumAt >= SPECTRUM_HOLD_MS) {
        // The spectrum source went away (playback stopped, route gone):
        // release the display toward the silence floor instead of freezing
        // the last frame; once fully decayed the analyzer clears below.
        targetDb.fill(SPECTRUM_FLOOR_DB);
      }
      if (!targetDb || !displayDb) return;
      const dt = lastFrameTs > 0
        ? Math.min(MAX_FRAME_DELTA_MS, Math.max(0, timestamp - lastFrameTs))
        : 1000 / 60;
      lastFrameTs = timestamp;
      const attack = 1 - Math.exp(-dt / ATTACK_TIME_CONSTANT_MS);
      const release = 1 - Math.exp(-dt / RELEASE_TIME_CONSTANT_MS);
      let maxRemainingDb = 0;
      let maxDisplayDb = SPECTRUM_FLOOR_DB;
      for (let index = 0; index < displayDb.length; index += 1) {
        const target = targetDb[index];
        const delta = target - displayDb[index];
        const eased = displayDb[index] + delta * (delta > 0 ? attack : release);
        displayDb[index] = eased;
        if (eased > maxDisplayDb) maxDisplayDb = eased;
        const remaining = Math.abs(target - eased);
        if (remaining > maxRemainingDb) maxRemainingDb = remaining;
      }
      commitDisplay();
      if (maxDisplayDb <= CLEAR_BELOW_DB) {
        targetDb = undefined;
        displayDb = undefined;
        displayView = undefined;
        commitDisplay();
        return;
      }
      if (maxRemainingDb <= CONVERGED_EPSILON_DB && nowMs() - lastSnapshotAt >= IDLE_STOP_AFTER_MS) {
        return;
      }
      frameId = window.requestAnimationFrame(step);
    };

    const ensureLoop = () => {
      if (!canUseRaf) {
        if (targetDb && displayDb) displayDb.set(targetDb);
        commitDisplay();
        return;
      }
      if (frameId !== null) return;
      lastFrameTs = 0;
      frameId = window.requestAnimationFrame(step);
    };

    const acceptSpectrum = (spectrumDb: Float32Array | undefined) => {
      lastSnapshotAt = nowMs();
      if (!spectrumDb || spectrumDb.length === 0) {
        if (displayView && lastSnapshotAt - lastSpectrumAt < SPECTRUM_HOLD_MS) {
          // Interleaved spectrum-less publisher: keep showing the recent
          // spectrum instead of blanking for a frame.
          return;
        }
        targetDb = undefined;
        displayDb = undefined;
        displayView = undefined;
        stopLoop();
        commitDisplay();
        return;
      }
      lastSpectrumAt = lastSnapshotAt;
      if (lastSnapshotAt - lastDirectAt < DIRECT_TAP_FRESH_MS) {
        // The display-rate tap already delivers this analyser's data fresher
        // than the bus snapshot; just keep the loop alive.
        ensureLoop();
        return;
      }
      applyTargetSpectrum(spectrumDb);
      ensureLoop();
    };

    // Seed from the freshest available source: the live tap when a route is
    // already active, otherwise the last bus snapshot.
    const initialDirect = runtimeSpectrumTaps.read(busScope);
    if (initialDirect && initialDirect.length > 0) {
      const at = nowMs();
      lastSnapshotAt = at;
      lastSpectrumAt = at;
      lastDirectAt = at;
      applyTargetSpectrum(initialDirect);
      commitDisplay();
      ensureLoop();
    } else {
      acceptSpectrum(getScopeSpectrumDb(busScope));
    }

    const onSnapshot = (snapshot: AudioMeterSnapshot | undefined) => {
      acceptSpectrum(snapshot?.spectrumDb);
    };
    const unsubscribe = busScope.kind === 'master'
      ? runtimeAudioMeterBus.subscribeMaster(onSnapshot, SPECTRUM_SUBSCRIPTION)
      : runtimeAudioMeterBus.subscribeTrack(busScope.trackId, onSnapshot, SPECTRUM_SUBSCRIPTION);

    return () => {
      unsubscribe();
      stopLoop();
    };
  }, [analyzerRef, scope, trackId]);

  return hasAnalyzer;
}
