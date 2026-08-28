import { describe, expect, it } from 'vitest';

import { WebCodecsSampleTimeline } from '../../src/engine/webcodecs/sampleTimeline';
import type { Sample } from '../../src/engine/webCodecsTypes';

function sample(index: number, cts: number, isSync = false): Sample {
  return {
    number: index + 1,
    track_id: 1,
    data: new ArrayBuffer(0),
    size: 0,
    cts,
    dts: index,
    duration: 1,
    is_sync: isSync,
    timescale: 1,
  };
}

describe('WebCodecsSampleTimeline', () => {
  it('selects a keyframe before the target presentation time, not just before its sample index', () => {
    const samples = [
      sample(0, 0, true),
      sample(1, 4.5),
      sample(2, 4.75, true),
      sample(3, 3.5),
      sample(4, 3.55),
    ];
    const timeline = new WebCodecsSampleTimeline(() => samples);

    expect(timeline.findKeyframeBefore(3)).toBe(0);
  });

  it('falls back to the first sample instead of a future keyframe when no prior sync sample is marked', () => {
    const samples = [
      sample(0, 0),
      sample(1, 4.75, true),
      sample(2, 3.15),
    ];
    const timeline = new WebCodecsSampleTimeline(() => samples);

    expect(timeline.findKeyframeBefore(2)).toBe(0);
  });
});
