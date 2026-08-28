import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runtimeAudioMeterBus,
  RuntimeAudioMeterBus,
  RUNTIME_AUDIO_METER_MAX_AGE_MS,
} from '../../../src/services/audio/runtimeAudioMeterBus';
import type { AudioDynamicsReductionSnapshot, AudioMeterSnapshot } from '../../../src/types';

function snap(overrides: Partial<AudioMeterSnapshot> = {}): AudioMeterSnapshot {
  return {
    peakLinear: 0.5,
    rmsLinear: 0.25,
    peakDb: -6,
    rmsDb: -12,
    clipping: false,
    updatedAt: 1000,
    ...overrides,
  };
}

function silent(updatedAt = 1000): AudioMeterSnapshot {
  return {
    peakLinear: 0,
    rmsLinear: 0,
    peakDb: -120,
    rmsDb: -120,
    clipping: false,
    updatedAt,
  };
}

function dynamics(effectId: string, gainReductionDb: number): Record<string, AudioDynamicsReductionSnapshot> {
  return {
    [effectId]: { effectId, processorType: 'compressor', gainReductionDb, updatedAt: 1000 },
  };
}

describe('runtimeAudioMeterBus', () => {
  beforeEach(() => {
    runtimeAudioMeterBus.resetForTest();
  });

  it('publishTrack stores the snapshot and notifies only relevant track subscribers', () => {
    const trackA = vi.fn();
    const trackB = vi.fn();
    runtimeAudioMeterBus.subscribeTrack('a', trackA);
    runtimeAudioMeterBus.subscribeTrack('b', trackB);

    const a = snap({ peakLinear: 0.7 });
    runtimeAudioMeterBus.publishTrack('a', a);

    expect(trackA).toHaveBeenCalledTimes(1);
    expect(trackA).toHaveBeenCalledWith(a);
    expect(trackB).not.toHaveBeenCalled();
    expect(runtimeAudioMeterBus.getTrackSnapshot('a')).toBe(a);
  });

  it('publishMaster notifies master subscribers', () => {
    const masterListener = vi.fn();
    runtimeAudioMeterBus.subscribeMaster(masterListener);

    const master = snap({ peakLinear: 0.9 });
    runtimeAudioMeterBus.publishMaster(master);

    expect(masterListener).toHaveBeenCalledWith(master);
    expect(runtimeAudioMeterBus.getMasterSnapshot()).toBe(master);
  });

  it('forwards an explicit master snapshot from publishTrack', () => {
    const masterListener = vi.fn();
    runtimeAudioMeterBus.subscribeMaster(masterListener);

    const master = snap({ peakLinear: 0.95 });
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.3 }), master);

    expect(runtimeAudioMeterBus.getMasterSnapshot()).toBe(master);
    expect(masterListener).toHaveBeenCalledWith(master);
  });

  it('aggregates the master from track snapshots when no master is provided', () => {
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.5, rmsLinear: 0.25, updatedAt: 1000 }));
    runtimeAudioMeterBus.publishTrack('b', snap({ peakLinear: 0.25, rmsLinear: 0.25, updatedAt: 1010 }));

    const master = runtimeAudioMeterBus.getMasterSnapshot();
    expect(master?.peakLinear).toBe(0.5);
    expect(master?.rmsLinear).toBeCloseTo(Math.sqrt(0.25 * 0.25 + 0.25 * 0.25));
  });

  it('suppresses silent duplicate publishes', () => {
    const listener = vi.fn();
    const masterListener = vi.fn();
    runtimeAudioMeterBus.subscribeTrack('a', listener);
    runtimeAudioMeterBus.subscribeMaster(masterListener);

    runtimeAudioMeterBus.publishTrack('a', silent());
    runtimeAudioMeterBus.publishTrack('a', silent(1010));

    expect(listener).not.toHaveBeenCalled();
    expect(masterListener).not.toHaveBeenCalled();
    expect(runtimeAudioMeterBus.getMasterSnapshot()).toBeUndefined();
  });

  it('clearStale removes stale track snapshots and aggregates surviving tracks', () => {
    runtimeAudioMeterBus.publishTrack('a', snap({ updatedAt: 1000 }));
    runtimeAudioMeterBus.publishTrack('b', snap({ peakLinear: 0.1, updatedAt: 1500 }));

    runtimeAudioMeterBus.clearStale(RUNTIME_AUDIO_METER_MAX_AGE_MS, 1600);

    expect(runtimeAudioMeterBus.getTrackSnapshot('a')).toBeUndefined();
    expect(runtimeAudioMeterBus.getTrackSnapshot('b')).toBeDefined();
  });

  it('clearStale publishes a silent master once all tracks expire', () => {
    const masterListener = vi.fn();
    runtimeAudioMeterBus.publishTrack('a', snap({ updatedAt: 1000 }));
    runtimeAudioMeterBus.subscribeMaster(masterListener);

    runtimeAudioMeterBus.clearStale(100, 1201);

    expect(runtimeAudioMeterBus.getState().trackMeters).toEqual({});
    const master = runtimeAudioMeterBus.getMasterSnapshot();
    expect(master?.peakLinear).toBe(0);
    expect(master?.rmsLinear).toBe(0);
  });

  it('clearTrack drops the track and re-aggregates the master', () => {
    const trackListener = vi.fn();
    runtimeAudioMeterBus.subscribeTrack('a', trackListener);
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.8 }));
    trackListener.mockClear();

    runtimeAudioMeterBus.clearTrack('a');

    expect(runtimeAudioMeterBus.getTrackSnapshot('a')).toBeUndefined();
    expect(trackListener).toHaveBeenLastCalledWith(undefined);
  });

  it('getState preserves identity until content changes', () => {
    const first = runtimeAudioMeterBus.getState();
    expect(runtimeAudioMeterBus.getState()).toBe(first);

    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.6 }));
    const afterPublish = runtimeAudioMeterBus.getState();
    expect(afterPublish).not.toBe(first);

    // A suppressed silent publish on an empty/silent track must not churn identity.
    runtimeAudioMeterBus.resetForTest();
    const empty = runtimeAudioMeterBus.getState();
    runtimeAudioMeterBus.publishTrack('a', silent());
    expect(runtimeAudioMeterBus.getState()).toBe(empty);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = runtimeAudioMeterBus.subscribeTrack('a', listener);
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.4 }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.9, updatedAt: 1010 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tracks feature demand per scope and decrements on unsubscribe', () => {
    const unsubLevel = runtimeAudioMeterBus.subscribeTrack('a', vi.fn(), { features: ['level'] });
    const unsubStereo = runtimeAudioMeterBus.subscribeTrack('a', vi.fn(), { features: ['stereo', 'phase'] });
    const unsubMasterSpectrum = runtimeAudioMeterBus.subscribeMaster(vi.fn(), { features: ['spectrum'] });

    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'level')).toBe(true);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'stereo')).toBe(true);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'spectrum')).toBe(false);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'master' }, 'spectrum')).toBe(true);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'master' }, 'stereo')).toBe(false);

    const demand = runtimeAudioMeterBus.getDemand({ kind: 'track', trackId: 'a' });
    expect(demand.level).toBe(1);
    expect(demand.stereo).toBe(1);
    expect(demand.phase).toBe(1);

    unsubLevel();
    unsubStereo();
    unsubMasterSpectrum();

    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'level')).toBe(false);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'stereo')).toBe(false);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'master' }, 'spectrum')).toBe(false);
  });

  it('tracks per-effect dynamics demand independently', () => {
    const unsub = runtimeAudioMeterBus.subscribeTrack('a', vi.fn(), {
      features: ['dynamics'],
      dynamicsEffectIds: ['comp-1', 'comp-2'],
    });

    let demand = runtimeAudioMeterBus.getDemand({ kind: 'track', trackId: 'a' });
    expect(demand.dynamics).toBe(1);
    expect(demand.dynamicsEffects['comp-1']).toBe(1);
    expect(demand.dynamicsEffects['comp-2']).toBe(1);

    unsub();
    demand = runtimeAudioMeterBus.getDemand({ kind: 'track', trackId: 'a' });
    expect(demand.dynamics).toBe(0);
    expect(demand.dynamicsEffects['comp-1']).toBeUndefined();
  });

  it('produces a debug snapshot with meters and demand', () => {
    runtimeAudioMeterBus.subscribeTrack('a', vi.fn(), { features: ['level', 'spectrum'] });
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.6, dynamics: dynamics('comp-1', 3) }));

    const debug = runtimeAudioMeterBus.getDebugSnapshot();
    expect(debug.tracks['a']?.peakLinear).toBe(0.6);
    expect(debug.master?.peakLinear).toBe(0.6);
    expect(debug.demand.tracks['a']?.spectrum).toBe(1);
  });

  it('clearAll drops all snapshots and notifies subscribers', () => {
    const trackListener = vi.fn();
    const masterListener = vi.fn();
    runtimeAudioMeterBus.subscribeTrack('a', trackListener);
    runtimeAudioMeterBus.subscribeMaster(masterListener);
    runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.6 }));
    trackListener.mockClear();
    masterListener.mockClear();

    runtimeAudioMeterBus.clearAll();

    expect(runtimeAudioMeterBus.getState().trackMeters).toEqual({});
    expect(runtimeAudioMeterBus.getMasterSnapshot()).toBeUndefined();
    expect(trackListener).toHaveBeenLastCalledWith(undefined);
    expect(masterListener).toHaveBeenLastCalledWith(undefined);
  });

  it('exports a singleton instance of RuntimeAudioMeterBus', () => {
    expect(runtimeAudioMeterBus).toBeInstanceOf(RuntimeAudioMeterBus);
  });
});
