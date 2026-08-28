import { useEffect, useRef } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runtimeAudioMeterBus } from '../../../src/services/audio/runtimeAudioMeterBus';
import {
  useRuntimeAudioMeterFrame,
  useRuntimeAudioMeterRef,
} from '../../../src/services/audio/runtimeAudioMeterHooks';
import type { AudioMeterSnapshot } from '../../../src/types';

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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  runtimeAudioMeterBus.resetForTest();
});

describe('runtimeAudioMeterHooks', () => {
  it('useRuntimeAudioMeterRef keeps the latest snapshot in a ref', () => {
    const { result } = renderHook(() =>
      useRuntimeAudioMeterRef({ kind: 'track', trackId: 'a' }, { features: ['level'] }),
    );

    const next = snap({ peakLinear: 0.8, updatedAt: 1010 });
    act(() => {
      runtimeAudioMeterBus.publishTrack('a', next);
    });

    expect(result.current.current).toBe(next);
  });

  it('useRuntimeAudioMeterRef registers and releases feature demand on unmount', () => {
    const { unmount } = renderHook(() =>
      useRuntimeAudioMeterRef({ kind: 'track', trackId: 'a' }, { features: ['level', 'spectrum'] }),
    );

    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'spectrum')).toBe(true);

    unmount();

    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'spectrum')).toBe(false);
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'level')).toBe(false);
  });

  it('useRuntimeAudioMeterFrame does not re-render React on each published snapshot', () => {
    const renderCounter = { count: 0 };

    function MeterConsumer() {
      const frames = useRef(0);
      useEffect(() => {
        renderCounter.count += 1;
      });
      useRuntimeAudioMeterFrame({ kind: 'track', trackId: 'a' }, () => {
        frames.current += 1;
      }, { features: ['level'] });
      return null;
    }

    render(<MeterConsumer />);
    const initialRenderCount = renderCounter.count;

    act(() => {
      runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.6, updatedAt: 1010 }));
      runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.7, updatedAt: 1020 }));
      runtimeAudioMeterBus.publishTrack('a', snap({ peakLinear: 0.8, updatedAt: 1030 }));
    });

    expect(renderCounter.count).toBe(initialRenderCount);
  });

  it('useRuntimeAudioMeterFrame unsubscribes on unmount', () => {
    const { unmount } = renderHook(() =>
      useRuntimeAudioMeterFrame({ kind: 'track', trackId: 'a' }, () => {}, { features: ['stereo'] }),
    );
    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'stereo')).toBe(true);

    unmount();

    expect(runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId: 'a' }, 'stereo')).toBe(false);
  });
});
